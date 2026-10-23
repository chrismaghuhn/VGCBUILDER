import {useEffect, useMemo, useState} from 'react';
import {SPECIES, pct, type UsageSource} from '../lib/data';
import {fillSpreads} from '../lib/meta';
import {matchStats, winrate} from '../lib/matches';
import {fetchPokepaste} from '../lib/share';
import {battleForme, importTeam, type Folder, type PokemonSet, type Team} from '../lib/team';
import {Portrait} from './ui';

/** A team from the VGCPastes repository (scripts/import-vgcpastes.mjs). */
interface TournamentTeam {
  id: string;
  title: string;
  player: string;
  event: string;
  rank: string;
  date: string;
  source: string;
  paste: string;
  spreads: boolean;
  mons: [string, string][];
}

type FolderSel = 'all' | 'fav' | 'unsorted' | string;
type Sort = 'edited' | 'name' | 'winrate';

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "2 h ago", "yesterday", "3 days ago", or a date. */
function ago(t?: number) {
  if (!t) return '–';
  const min = (Date.now() - t) / 60000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.floor(min)} min ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h ago`;
  const days = Math.floor(min / 60 / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

/** Does a Pokémon name match the search? "kingam" finds Kingambit, "raichu" finds Raichu-Mega-X. */
const monMatches = (name: string, q: string) => q.length > 1 && toId(name).includes(toId(q));

export function TeamsView({teams, folders, activeId, usage, onOpen, onNew, onImport, onDuplicate, onExport, onDelete, onMeta,
  onAddFolder, onRenameFolder, onDeleteFolder, onUseTournament}: {
  teams: Team[];
  folders: Folder[];
  activeId: string;
  usage: UsageSource;
  onOpen: (id: string) => void;
  onNew: (folder?: string) => void;
  onImport: () => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onMeta: (id: string, patch: Partial<Pick<Team, 'folder' | 'favorite'>>) => void;
  onAddFolder: (name: string) => string;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onUseTournament: (sets: PokemonSet[], name: string, extra: Partial<Pick<Team, 'folder' | 'tags' | 'notes'>>) => void;
}) {
  const [section, setSection] = useState<'mine' | 'tournament'>('mine');
  const [folder, setFolder] = useState<FolderSel>('all');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('edited');
  const realFolder = folder !== 'all' && folder !== 'fav' && folder !== 'unsorted' ? folder : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex border border-line">
          {(['mine', 'tournament'] as const).map(s => (
            <button key={s} onClick={() => setSection(s)}
              className={`px-3 py-1.5 text-[13px] font-medium transition ${section === s ? 'bg-gold text-black' : 'text-dim hover:text-ink'}`}>
              {s === 'mine' ? `Your teams · ${teams.length}` : 'Tournament teams'}
            </button>
          ))}
        </div>
        <div className="flex min-w-[220px] flex-1 items-center gap-2 border border-line-2 bg-panel px-3 py-1.5 focus-within:border-dim">
          <span className="text-faint">⌕</span>
          <input className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={section === 'mine' ? 'Find a Pokémon, team or tag …' : 'Find a Pokémon, player or event …'} aria-label="Search" />
          {query && <button className="text-faint hover:text-ink" onClick={() => setQuery('')} aria-label="Clear search">✕</button>}
        </div>
        {section === 'mine' && (
          <>
            <button className="btn btn-gold" onClick={() => onNew(realFolder)}>+ New team</button>
            <button className="btn" onClick={onImport}>Import</button>
          </>
        )}
      </div>

      {section === 'mine' ? (
        <MyTeams teams={teams} folders={folders} activeId={activeId} folder={folder} setFolder={setFolder} query={query}
          tag={tag} setTag={setTag} sort={sort} setSort={setSort} onOpen={onOpen} onDuplicate={onDuplicate} onExport={onExport}
          onDelete={onDelete} onMeta={onMeta} onAddFolder={onAddFolder} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} />
      ) : (
        <TournamentTeams query={query} usage={usage} folderName={folders.find(f => f.id === realFolder)?.name}
          onUse={(sets, name, extra) => onUseTournament(sets, name, {...extra, folder: realFolder})} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Your teams

function MyTeams({teams, folders, activeId, folder, setFolder, query, tag, setTag, sort, setSort, onOpen, onDuplicate, onExport,
  onDelete, onMeta, onAddFolder, onRenameFolder, onDeleteFolder}: {
  teams: Team[]; folders: Folder[]; activeId: string; folder: FolderSel; setFolder: (f: FolderSel) => void; query: string;
  tag: string | null; setTag: (t: string | null) => void; sort: Sort; setSort: (s: Sort) => void;
  onOpen: (id: string) => void; onDuplicate: (id: string) => void; onExport: (id: string) => void; onDelete: (id: string) => void;
  onMeta: (id: string, patch: Partial<Pick<Team, 'folder' | 'favorite'>>) => void;
  onAddFolder: (name: string) => string; onRenameFolder: (id: string, name: string) => void; onDeleteFolder: (id: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const q = query.trim();
  const records = useMemo(() => Object.fromEntries(teams.map(t => [t.id, matchStats(t.matches ?? []).total])), [teams]);

  const inFolder = (t: Team) =>
    folder === 'all' ? true : folder === 'fav' ? !!t.favorite : folder === 'unsorted' ? !t.folder || !folders.some(f => f.id === t.folder) : t.folder === folder;
  // The search always looks through every folder; without a search the folder and tag filters apply.
  const matches = (t: Team) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || (t.tags ?? []).some(x => x.toLowerCase().includes(q.toLowerCase()))
    || t.sets.some(s => monMatches(s.species, q) || monMatches(battleForme(s), q));
  const base = q ? teams : teams.filter(inFolder);
  const tags = [...new Set(base.flatMap(t => t.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const shown = base.filter(t => matches(t) && (!tag || (t.tags ?? []).includes(tag)));
  shown.sort((a, b) => {
    const fav = Number(!!b.favorite) - Number(!!a.favorite);
    if (fav) return fav;
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'winrate') return winrate(records[b.id]) - winrate(records[a.id]) || records[b.id].games - records[a.id].games;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  const count = (f: FolderSel) => teams.filter(t =>
    f === 'all' ? true : f === 'fav' ? t.favorite : f === 'unsorted' ? !t.folder || !folders.some(x => x.id === t.folder) : t.folder === f).length;
  const drop = (target: string | undefined) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/team');
    if (id) onMeta(id, {folder: target});
    setDragging(null);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="space-y-0.5 text-[13px]">
        <FolderRow label="All teams" count={count('all')} on={folder === 'all' && !q} onClick={() => setFolder('all')} />
        <FolderRow label="★ Favorites" count={count('fav')} on={folder === 'fav' && !q} onClick={() => setFolder('fav')} />
        <div className="label px-2 pb-1 pt-3">Folders</div>
        {folders.map(f => (
          <FolderRow key={f.id} label={f.name} count={count(f.id)} on={folder === f.id && !q} onClick={() => setFolder(f.id)}
            dropping={!!dragging} onDrop={drop(f.id)}
            onRename={() => { const n = prompt('Rename folder', f.name)?.trim(); if (n) onRenameFolder(f.id, n); }}
            onDelete={() => { if (confirm(`Delete the folder "${f.name}"? Its teams move to Unsorted.`)) { onDeleteFolder(f.id); if (folder === f.id) setFolder('all'); } }} />
        ))}
        <FolderRow label="Unsorted" count={count('unsorted')} on={folder === 'unsorted' && !q} onClick={() => setFolder('unsorted')}
          dropping={!!dragging} onDrop={drop(undefined)} muted />
        <button className="mt-1 w-full px-2 py-1 text-left text-[12.5px] text-faint hover:text-ink"
          onClick={() => { const n = prompt('Folder name')?.trim(); if (n) setFolder(onAddFolder(n)); }}>+ New folder</button>
      </aside>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <button onClick={() => setTag(null)} className={`border px-2 py-0.5 ${!tag ? 'border-gold bg-gold text-black' : 'border-line-2 text-dim hover:text-ink'}`}>All tags</button>
          {tags.map(t => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)}
              className={`border px-2 py-0.5 ${tag === t ? 'border-gold bg-gold text-black' : 'border-line-2 text-dim hover:text-ink'}`}>{t}</button>
          ))}
          <span className="ml-auto flex items-center gap-2 text-dim">
            {q && <span>{shown.length} of {teams.length} teams</span>}
            <select className="field !w-auto !py-0.5 text-xs" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="edited">Last edited</option>
              <option value="name">Name</option>
              <option value="winrate">Win rate</option>
            </select>
          </span>
        </div>

        {shown.length === 0 && (
          <p className="border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-faint">
            {q ? `No team with “${q}”.` : 'No teams here yet.'}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(t => (
            <TeamCard key={t.id} team={t} active={t.id === activeId} q={q} record={records[t.id]} folders={folders}
              onOpen={() => onOpen(t.id)} onStar={() => onMeta(t.id, {favorite: !t.favorite})} onMove={f => onMeta(t.id, {folder: f})}
              onDuplicate={() => onDuplicate(t.id)} onExport={() => onExport(t.id)}
              onDelete={() => { if (confirm(`Delete "${t.name}"?`)) onDelete(t.id); }}
              onDragStart={e => { e.dataTransfer.setData('text/team', t.id); e.dataTransfer.effectAllowed = 'move'; setDragging(t.id); }}
              onDragEnd={() => setDragging(null)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FolderRow({label, count, on, onClick, onDrop, dropping, onRename, onDelete, muted}: {
  label: string; count: number; on: boolean; onClick: () => void; onDrop?: (e: React.DragEvent) => void; dropping?: boolean;
  onRename?: () => void; onDelete?: () => void; muted?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className={`group flex items-center gap-1 border px-2 py-1 transition ${
      over ? 'border-gold bg-white/10' : on ? 'border-transparent bg-white/[.07]' : dropping && onDrop ? 'border-dashed border-line-2' : 'border-transparent hover:bg-white/[.04]'}`}
      onDragOver={onDrop && (e => { e.preventDefault(); setOver(true); })} onDragLeave={() => setOver(false)}
      onDrop={onDrop && (e => { setOver(false); onDrop(e); })}>
      <button className={`min-w-0 flex-1 truncate text-left ${on ? 'text-ink' : muted ? 'text-faint' : 'text-dim'} hover:text-ink`} onClick={onClick}>{label}</button>
      {onRename && <button className="hidden text-[11px] text-faint hover:text-ink group-hover:inline" onClick={onRename} title="Rename">✎</button>}
      {onDelete && <button className="hidden text-[11px] text-faint hover:text-bad group-hover:inline" onClick={onDelete} title="Delete folder">✕</button>}
      <span className="num text-[11px] text-faint">{count}</span>
    </div>
  );
}

function TeamCard({team, active, q, record, folders, onOpen, onStar, onMove, onDuplicate, onExport, onDelete, onDragStart, onDragEnd}: {
  team: Team; active: boolean; q: string; record: ReturnType<typeof matchStats>['total']; folders: Folder[];
  onOpen: () => void; onStar: () => void; onMove: (folder: string | undefined) => void; onDuplicate: () => void; onExport: () => void;
  onDelete: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const note = team.notes?.split('\n').find(l => l.trim())?.trim();
  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      className={`group relative flex cursor-pointer flex-col gap-2.5 border bg-panel p-3 transition hover:border-dim ${active ? 'border-gold' : 'border-line'}`}
      onClick={onOpen} onMouseLeave={() => setMenu(false)}>
      <div className="flex items-center gap-2">
        <button onClick={e => { e.stopPropagation(); onStar(); }} title={team.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`text-[15px] leading-none ${team.favorite ? 'text-gold' : 'text-line-2 hover:text-dim'}`}>★</button>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{team.name || 'Untitled'}</span>
        <span className="shrink-0 text-[11px] text-faint">{ago(team.updatedAt)}</span>
        <button onClick={e => { e.stopPropagation(); setMenu(!menu); }} className="px-1 text-faint hover:text-ink" aria-label="Team menu">⋯</button>
      </div>
      <div className="flex gap-1">
        {team.sets.map((s, i) => {
          const hit = monMatches(s.species, q) || monMatches(battleForme(s), q);
          return (
            <span key={i} title={battleForme(s)} className={hit ? 'outline-2 outline-offset-1 outline-gold [outline-style:solid]' : q && !hit ? 'opacity-45' : ''}>
              <Portrait name={battleForme(s)} size={40} />
            </span>
          );
        })}
        {team.sets.length === 0 && <span className="py-3 text-[12px] text-faint">No Pokémon yet</span>}
      </div>
      {(team.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">{team.tags!.map(t => <span key={t} className="border border-line-2 px-1.5 text-[11px] text-dim">{t}</span>)}</div>
      )}
      <div className="flex items-center gap-3 text-[11.5px] text-dim">
        {record.games > 0 ? <span className="num shrink-0">{record.win}–{record.loss} · {pct(winrate(record), 0)}</span> : <span className="shrink-0 text-faint">no games</span>}
        {note && <span className="min-w-0 truncate" title={team.notes}>✎ {note}</span>}
      </div>
      {menu && (
        <div className="absolute right-2 top-9 z-20 w-48 border border-line-2 bg-panel-2 py-1 text-[12.5px] shadow-xl shadow-black/60" onClick={e => e.stopPropagation()}>
          <div className="px-3 pb-1 pt-1.5 text-[10.5px] uppercase tracking-wider text-faint">Move to</div>
          {folders.map(f => (
            <button key={f.id} className={`block w-full px-3 py-1 text-left hover:bg-white/10 ${team.folder === f.id ? 'text-gold' : ''}`}
              onClick={() => { onMove(f.id); setMenu(false); }}>{f.name}</button>
          ))}
          <button className={`block w-full px-3 py-1 text-left hover:bg-white/10 ${!team.folder ? 'text-gold' : 'text-dim'}`}
            onClick={() => { onMove(undefined); setMenu(false); }}>Unsorted</button>
          <div className="my-1 border-t border-line" />
          <button className="block w-full px-3 py-1 text-left hover:bg-white/10" onClick={() => { onDuplicate(); setMenu(false); }}>Duplicate</button>
          <button className="block w-full px-3 py-1 text-left hover:bg-white/10" onClick={() => { onExport(); setMenu(false); }}>Export</button>
          <button className="block w-full px-3 py-1 text-left text-bad hover:bg-white/10" onClick={() => { setMenu(false); onDelete(); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Tournament teams

/** Placement as a number for filtering: Champion 1, Runner Up 2, "5th" 5, "Top 8" 8; unplaced = 999. */
function place(rank: string): number {
  const r = rank.toLowerCase();
  if (!r) return 999;
  if (r.includes('champion') || r.startsWith('1st') || r === 'winner') return 1;
  if (r.includes('runner')) return 2;
  const n = /(\d+)/.exec(r)?.[1];
  return n ? +n : 999;
}
const PLACES: {key: string; label: string; max: number}[] = [
  {key: 'all', label: 'Any placement', max: 1000},
  {key: '1', label: 'Champions', max: 1},
  {key: '4', label: 'Top 4', max: 4},
  {key: '8', label: 'Top 8', max: 8},
  {key: '16', label: 'Top 16', max: 16},
  {key: 'placed', label: 'Any placement listed', max: 998},
];

function TournamentTeams({query, usage, folderName, onUse}: {
  query: string; usage: UsageSource; folderName?: string;
  onUse: (sets: PokemonSet[], name: string, extra: Partial<Pick<Team, 'tags' | 'notes'>>) => void;
}) {
  const [all, setAll] = useState<TournamentTeam[] | null>(null);
  const [error, setError] = useState('');
  const [event, setEvent] = useState('');
  const [placeKey, setPlaceKey] = useState('all');
  const [limit, setLimit] = useState(48);
  // Loaded on demand so the main bundle doesn't carry ~300 kB of team data.
  useEffect(() => {
    import('../data/generated/tournament-teams.json')
      .then(m => setAll(m.default as unknown as TournamentTeam[]))
      .catch(e => setError((e as Error).message));
  }, []);
  useEffect(() => setLimit(48), [query, event, placeKey]);

  const events = useMemo(() => {
    const latest = new Map<string, string>();
    for (const t of all ?? []) if (t.event && (latest.get(t.event) ?? '') < t.date) latest.set(t.event, t.date);
    return [...latest.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([e]) => e);
  }, [all]);

  if (error) return <p className="text-[13px] text-bad">Couldn't load the tournament teams: {error}</p>;
  if (!all) return <p className="text-[13px] text-faint">Loading tournament teams …</p>;

  const q = query.trim().toLowerCase();
  const max = PLACES.find(p => p.key === placeKey)!.max;
  const shown = all.filter(t =>
    (!event || t.event === event) && place(t.rank) <= max
    && (!q || t.mons.some(([m]) => monMatches(m, q)) || t.player.toLowerCase().includes(q) || t.event.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <select className="field !w-auto !py-1 text-xs" value={event} onChange={e => setEvent(e.target.value)} aria-label="Event">
          <option value="">All events · {all.length} teams</option>
          {events.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="field !w-auto !py-1 text-xs" value={placeKey} onChange={e => setPlaceKey(e.target.value)} aria-label="Placement">
          {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-dim">{shown.length} teams</span>
        <span className="ml-auto text-[11.5px] text-faint">
          Source: <a className="underline hover:text-dim" href="https://x.com/VGCPastes" target="_blank" rel="noreferrer">VGCPastes</a> repository
          {folderName && <> · “Use” saves into <span className="text-dim">{folderName}</span></>}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.slice(0, limit).map(t => <TournamentCard key={t.id} team={t} q={q} usage={usage} onUse={onUse} />)}
      </div>
      {shown.length > limit && (
        <button className="btn w-full justify-center" onClick={() => setLimit(limit + 48)}>Show more ({shown.length - limit} left)</button>
      )}
    </div>
  );
}

function TournamentCard({team, q, usage, onUse}: {
  team: TournamentTeam; q: string; usage: UsageSource;
  onUse: (sets: PokemonSet[], name: string, extra: Partial<Pick<Team, 'tags' | 'notes'>>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const use = async () => {
    setError(''); setBusy(true);
    try {
      const p = await fetchPokepaste(team.paste);
      const {sets} = importTeam(p.paste);
      if (!sets.length) throw new Error('The paste has no Pokémon.');
      const name = [team.player, team.event].filter(Boolean).join(' · ') || team.title;
      const notes = [
        `${team.title}${team.rank ? ` (${team.rank})` : ''}`,
        `Paste: https://pokepast.es/${team.paste}`,
        team.source && `Source: ${team.source}`,
        !team.spreads && 'The paste had no spreads: they are the most common meta spreads.',
        'From the VGCPastes repository.',
      ].filter(Boolean).join('\n');
      onUse(fillSpreads(sets, usage), name, {tags: team.event ? [team.event] : [], notes});
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2.5 border border-line bg-panel p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold" title={team.title}>{team.player || team.title}</div>
          <div className="truncate text-[11.5px] text-dim">{team.event || 'Shared team'}{team.date && <span className="text-faint"> · {team.date}</span>}</div>
        </div>
        {team.rank && <span className="shrink-0 border border-gold px-1.5 text-[11px] font-semibold text-gold">{team.rank}</span>}
      </div>
      <div className="flex gap-1">
        {team.mons.map(([m, item], i) => (
          <span key={i} title={`${m}${item ? ` @ ${item}` : ''}`}
            className={monMatches(m, q) ? 'outline-2 outline-offset-1 outline-gold [outline-style:solid]' : q && !monMatches(m, q) ? 'opacity-45' : ''}>
            <Portrait name={SPECIES[m] ? m : m.replace(/-Mega.*$/, '')} size={40} />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[11.5px]">
        <button className="btn btn-gold !py-1 text-xs" onClick={use} disabled={busy}>{busy ? 'Loading …' : 'Use this team'}</button>
        <a className="text-faint underline hover:text-ink" href={`https://pokepast.es/${team.paste}`} target="_blank" rel="noreferrer">paste</a>
        {team.source && <a className="text-faint underline hover:text-ink" href={team.source} target="_blank" rel="noreferrer">source</a>}
        {!team.spreads && <span className="text-faint" title="The paste has no spreads; meta spreads are filled in">no spreads</span>}
      </div>
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}
