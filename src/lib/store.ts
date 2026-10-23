import {useCallback, useEffect, useRef, useState} from 'react';
import {FORMAT} from './data';
import type {Folder, PokemonSet, Team} from './team';

const KEY = 'teamforge.v1';
const HISTORY = 50;
/** Edits within this window (slider drags, typing) collapse into one undo step. */
const COALESCE_MS = 600;

interface Saved {
  teams: Team[];
  activeId: string;
  source: string;
  folders?: Folder[];
}

/** Changes to these count as editing the team ("last edited"); Playmat and match log activity doesn't. */
const EDIT_KEYS: (keyof Team)[] = ['sets', 'name', 'notes', 'tags', 'hidden', 'noMegas'];

const newId = () => Math.random().toString(36).slice(2, 10);

export const newTeam = (name = 'New Team'): Team => {
  const now = Date.now();
  return {id: newId(), name, sets: [], createdAt: now, updatedAt: now};
};

/** Apply fn to a team; stamp updatedAt only when one of its own fields really changed. */
function touch(t: Team, fn: (t: Team) => Team): Team {
  const n = fn(t);
  // Shallow first: untouched fields keep their references, so only changed ones get compared in full.
  const edited = EDIT_KEYS.some(k => n[k] !== t[k] && JSON.stringify(n[k]) !== JSON.stringify(t[k]));
  return edited ? {...n, updatedAt: Date.now()} : n;
}

function load(): Saved {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.teams?.length) return {...s, source: FORMAT.sources.some(x => x.key === s.source) ? s.source : FORMAT.sources[0].key};
    }
  } catch { /* storage unavailable or unreadable */ }
  // Saved data we can't read is about to be overwritten by a fresh team: keep a copy instead of losing it.
  if (raw) try { localStorage.setItem(`${KEY}.backup-${Date.now()}`, raw); } catch { /* ignore */ }
  const t = newTeam('My M-C Team');
  return {teams: [t], activeId: t.id, source: FORMAT.sources[0].key};
}

export function useStore() {
  const [state, setState] = useState<Saved>(load);
  const [past, setPast] = useState<Saved[]>([]);
  const lastPush = useRef({at: 0, key: ''});

  // Saving can fail when the browser's storage is full; say so instead of losing changes silently.
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state]);

  // Mirror of the latest state so commits never run side effects inside updaters (StrictMode runs those twice).
  const current = useRef(state);
  current.current = state;

  /** Apply a change and record the previous state for undo. */
  const commit = useCallback((fn: (s: Saved) => Saved, key = '') => {
    const prev = current.current;
    const next = fn(prev);
    // No-op changes (e.g. the same suggestion applied twice by a double click) leave no undo step.
    if (next === prev || JSON.stringify(next) === JSON.stringify(prev)) return;
    const now = Date.now();
    const coalesce = key !== '' && lastPush.current.key === key && now - lastPush.current.at < COALESCE_MS;
    lastPush.current = {at: now, key};
    current.current = next;
    setState(next);
    if (!coalesce) setPast(p => [...p.slice(-(HISTORY - 1)), prev]);
  }, []);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (!p.length) return;
    current.current = p[p.length - 1];
    setState(p[p.length - 1]);
    setPast(p.slice(0, -1));
    lastPush.current = {at: 0, key: ''};
  }, []);
  const pastRef = useRef(past);
  pastRef.current = past;

  const team = state.teams.find(t => t.id === state.activeId) ?? state.teams[0];

  const updateTeamById = useCallback((id: string, fn: (t: Team) => Team, key?: string) => {
    commit(s => ({...s, teams: s.teams.map(t => (t.id === id ? touch(t, fn) : t))}), key);
  }, [commit]);
  const updateTeam = useCallback((fn: (t: Team) => Team, key?: string) => {
    commit(s => ({...s, teams: s.teams.map(t => (t.id === s.activeId ? touch(t, fn) : t))}), key);
  }, [commit]);

  const setSets = useCallback(
    (fn: (sets: PokemonSet[]) => PokemonSet[], key?: string) => updateTeam(t => ({...t, sets: fn(t.sets)}), key),
    [updateTeam],
  );

  return {
    teams: state.teams,
    team,
    source: state.source,
    canUndo: past.length > 0,
    saveError,
    undo,
    setSource: (source: string) => setState(s => ({...s, source})),
    setSets,
    rename: (name: string) => updateTeam(t => ({...t, name}), 'rename'),
    setSuggestPrefs: (patch: Pick<Team, 'hidden' | 'noMegas'>) => updateTeam(t => ({...t, ...patch})),
    /** Show a board; it's kept in the team's board list too, so nothing is lost when another one opens. */
    setPlaymat: (m: Team['playmat'], key?: string) => updateTeam(t => {
      if (!m) return {...t, playmat: undefined};
      const mat = m.id ? m : {...m, id: newId()};
      const boards = t.boards ?? [];
      const old = boards.find(b => b.id === mat.id);
      // Unchanged boards keep their timestamp, so a no-op stays a no-op (no empty undo step).
      if (old && JSON.stringify(old.mat) === JSON.stringify(mat)) return {...t, playmat: mat};
      const entry = {id: mat.id!, savedAt: Date.now(), mat};
      return {...t, playmat: mat, boards: [entry, ...boards.filter(b => b.id !== mat.id)]};
    }, key),
    renameBoard: (id: string, name: string) => updateTeam(t => ({
      ...t,
      boards: (t.boards ?? []).map(b => (b.id === id ? {...b, mat: {...b.mat, name}} : b)),
      playmat: t.playmat?.id === id ? {...t.playmat, name} : t.playmat,
    }), `rename-board-${id}`),
    deleteBoard: (id: string) => updateTeam(t => ({
      ...t,
      boards: (t.boards ?? []).filter(b => b.id !== id),
      // Deleting the open board closes it.
      playmat: t.playmat?.id === id ? undefined : t.playmat,
    })),
    setMatches: (fn: (m: NonNullable<Team['matches']>) => NonNullable<Team['matches']>, key?: string) =>
      updateTeam(t => ({...t, matches: fn(t.matches ?? [])}), key),
    select: (id: string) => setState(s => ({...s, activeId: id})),
    /** A new team (made active); `extra` sets folder, tags or notes. Returns its id. */
    create: (sets: PokemonSet[] = [], name?: string, extra: Partial<Pick<Team, 'folder' | 'tags' | 'notes'>> = {}) => {
      const t = {...newTeam(name), sets, ...extra};
      commit(s => ({...s, teams: [...s.teams, t], activeId: t.id}));
      return t.id;
    },
    duplicate: (id = team.id) => {
      const src = state.teams.find(t => t.id === id) ?? team;
      const now = Date.now();
      // Sets, folder, tags and notes come along; Playmat, boards and the match log stay with the original.
      const t: Team = {
        id: newId(), name: src.name + ' (copy)', sets: structuredClone(src.sets), folder: src.folder,
        tags: src.tags && [...src.tags], notes: src.notes, hidden: src.hidden, noMegas: src.noMegas, createdAt: now, updatedAt: now,
      };
      commit(s => ({...s, teams: [...s.teams, t], activeId: t.id}));
    },
    remove: (id = team.id) => commit(s => {
      const teams = s.teams.filter(t => t.id !== id);
      const rest = teams.length ? teams : [newTeam('My M-C Team')];
      return {...s, teams: rest, activeId: rest.some(t => t.id === s.activeId) ? s.activeId : rest[0].id};
    }),
    /** Folder, tags, favourite or notes of any team (not only the open one). */
    setTeamMeta: (id: string, patch: Partial<Pick<Team, 'folder' | 'tags' | 'favorite' | 'notes'>>, key?: string) =>
      updateTeamById(id, t => ({...t, ...patch}), key),
    folders: state.folders ?? [],
    addFolder: (name: string) => {
      const f = {id: newId(), name};
      commit(s => ({...s, folders: [...(s.folders ?? []), f]}));
      return f.id;
    },
    renameFolder: (id: string, name: string) =>
      commit(s => ({...s, folders: (s.folders ?? []).map(f => (f.id === id ? {...f, name} : f))}), `rename-folder-${id}`),
    /** The folder goes; its teams move to Unsorted. */
    deleteFolder: (id: string) => commit(s => ({
      ...s,
      folders: (s.folders ?? []).filter(f => f.id !== id),
      teams: s.teams.map(t => (t.folder === id ? {...t, folder: undefined} : t)),
    })),
  };
}
