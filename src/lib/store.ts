import {useCallback, useEffect, useRef, useState} from 'react';
import {FORMAT} from './data';
import type {PokemonSet, Team} from './team';

const KEY = 'teamforge.v1';
const HISTORY = 50;
/** Edits within this window (slider drags, typing) collapse into one undo step. */
const COALESCE_MS = 600;

interface Saved {
  teams: Team[];
  activeId: string;
  source: string;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export const newTeam = (name = 'Neues Team'): Team => ({id: newId(), name, sets: []});

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.teams?.length) return {...s, source: FORMAT.sources.some(x => x.key === s.source) ? s.source : FORMAT.sources[0].key};
    }
  } catch { /* storage unavailable */ }
  const t = newTeam('Mein M-C Team');
  return {teams: [t], activeId: t.id, source: FORMAT.sources[0].key};
}

export function useStore() {
  const [state, setState] = useState<Saved>(load);
  const [past, setPast] = useState<Saved[]>([]);
  const lastPush = useRef({at: 0, key: ''});

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  // Mirror of the latest state so commits never run side effects inside updaters (StrictMode runs those twice).
  const current = useRef(state);
  current.current = state;

  /** Apply a change and record the previous state for undo. */
  const commit = useCallback((fn: (s: Saved) => Saved, key = '') => {
    const prev = current.current;
    const next = fn(prev);
    if (next === prev) return;
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

  const updateTeam = useCallback((fn: (t: Team) => Team, key?: string) => {
    commit(s => ({...s, teams: s.teams.map(t => (t.id === s.activeId ? fn(t) : t))}), key);
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
    undo,
    setSource: (source: string) => setState(s => ({...s, source})),
    setSets,
    rename: (name: string) => updateTeam(t => ({...t, name}), 'rename'),
    select: (id: string) => setState(s => ({...s, activeId: id})),
    create: (sets: PokemonSet[] = [], name?: string) => {
      const t = {...newTeam(name), sets};
      commit(s => ({...s, teams: [...s.teams, t], activeId: t.id}));
    },
    duplicate: () => {
      const t = {...team, id: newId(), name: team.name + ' (Kopie)', sets: structuredClone(team.sets)};
      commit(s => ({...s, teams: [...s.teams, t], activeId: t.id}));
    },
    remove: () => commit(s => {
      const teams = s.teams.filter(t => t.id !== s.activeId);
      const rest = teams.length ? teams : [newTeam('Mein M-C Team')];
      return {...s, teams: rest, activeId: rest[0].id};
    }),
  };
}
