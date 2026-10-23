import {Suspense, lazy, useEffect, useMemo, useState} from 'react';
import {FORMAT, SPECIES, TYPES, loadUsage} from './lib/data';
import {useUsage} from './lib/useUsage';
import {defensiveMult, roleCoverage} from './lib/analysis';
import {useStore} from './lib/store';
import {battleForme, validateTeam, type Opponent, type PokemonSet, type SavedBoard} from './lib/team';
import {makeSide, type Side} from './components/calcSide';
import {decodeMat, matPayload, type SharedMat} from './lib/matshare';
import type {Playmat} from './lib/team';
import {PasteDialog} from './components/PasteDialog';
import {Portrait} from './components/ui';
import {decodeShare, sharePayload} from './lib/share';
import {SearchView} from './components/SearchView';
import {SetEditor} from './components/SetEditor';
import {TeamBar} from './components/TeamBar';
import {TeamHeaderMeta, TeamNotes} from './components/TeamMeta';
import {TeamsView} from './components/TeamsView';
import type {WeatherPref, WeatherState} from './components/ui';

// Pages that need the damage calc (and its data for every generation) load when first opened,
// so Teams and Search start without them.
const AnalysisView = lazy(() => import('./components/AnalysisView').then(m => ({default: m.AnalysisView})));
const BulkView = lazy(() => import('./components/BulkView').then(m => ({default: m.BulkView})));
const CalcView = lazy(() => import('./components/CalcView').then(m => ({default: m.CalcView})));
const MatchesView = lazy(() => import('./components/MatchesView').then(m => ({default: m.MatchesView})));
const MetaView = lazy(() => import('./components/MetaView').then(m => ({default: m.MetaView})));
const OffenseView = lazy(() => import('./components/OffenseView').then(m => ({default: m.OffenseView})));
const Picker = lazy(() => import('./components/Picker').then(m => ({default: m.Picker})));
const PlaymatView = lazy(() => import('./components/PlaymatView').then(m => ({default: m.PlaymatView})));
const SpeedView = lazy(() => import('./components/SpeedView').then(m => ({default: m.SpeedView})));
const replayLib = () => import('./lib/replay');

const Loading = () => <div className="py-16 text-center text-[13px] text-faint">Loading …</div>;

const PAGES = [
  {key: 'teams', label: 'Teams'},
  {key: 'suche', label: 'Search'},
  {key: 'analyse', label: 'Analysis'},
  {key: 'offense', label: 'Offense'},
  {key: 'speed', label: 'Speed'},
  {key: 'bulk', label: 'Bulk'},
  {key: 'meta', label: 'Meta'},
  {key: 'playmat', label: 'Playmat'},
  {key: 'matches', label: 'Matches'},
  {key: 'calc', label: 'Calc'},
] as const;
type Page = (typeof PAGES)[number]['key'];

// Stable empty list so memoized suggestions don't recompute on every render.
const EMPTY: string[] = [];

const pageFromHash = (): Page => {
  const h = location.hash.slice(1);
  // #bauen was the old name of the Teams tab.
  return (PAGES.find(p => p.key === h)?.key ?? 'teams') as Page;
};

export default function App() {
  const store = useStore();
  const {team, setSets} = store;
  const sets = team.sets;
  const {usage, error: usageError} = useUsage(store.source);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [selected, setSelected] = useState(0);
  // Pokémon picked for planning on the Offense, Speed and Bulk tabs.
  const [planSel, setPlanSel] = useState(0);
  const planning = page === 'offense' || page === 'speed' || page === 'bulk';
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);
  // A team received via share link (#share=…), waiting for the user to import it.
  const [shared, setShared] = useState<{name: string; sets: PokemonSet[]; warnings: string[]} | {error: string} | null>(null);
  // A Playmat received via link (#mat=… / #matx=…), waiting to be opened.
  const [sharedMat, setSharedMat] = useState<{locked: boolean; data: string} | null>(null);
  const [calcPair, setCalcPair] = useState<[Side, Side] | null>(null);
  const [weatherPref, setWeatherPref] = useState<WeatherPref>('auto');
  const [searchQuery, setSearchQuery] = useState('');
  const [enemyWeather, setEnemyWeather] = useState(false);
  const weather: WeatherState = {pref: weatherPref, setPref: setWeatherPref, enemy: enemyWeather, setEnemy: setEnemyWeather};
  // Board whose opponent Analysis, Speed, Meta and Calc work against (null = the meta).
  const [vsId, setVsId] = useState<string | null>(null);
  const oppBoards = useMemo(() => {
    const list = (team.boards ?? []).filter(b => b.mat.opp.length);
    const open = list.find(b => b.id === team.playmat?.id);
    return open ? [open, ...list.filter(b => b !== open)] : list;
  }, [team.boards, team.playmat?.id]);
  const vsBoard = vsId ? oppBoards.find(b => b.id === vsId) : undefined;
  const opp = useMemo<Opponent | undefined>(
    () => (vsBoard ? {id: vsBoard.id, name: vsBoard.mat.name || 'Board', sets: vsBoard.mat.opp} : undefined),
    [vsBoard?.id, vsBoard?.mat.name, vsBoard?.mat.opp], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const vsPage = page === 'analyse' || page === 'speed' || page === 'meta' || page === 'calc';

  // On the Teams tab: the overview, or the editor of the open team.
  const [teamOpen, setTeamOpen] = useState(false);
  const editing = page === 'teams' && teamOpen;
  const openEditor = (slot = 0) => { setSelected(slot); setTeamOpen(true); setPage('teams'); };
  const allTags = useMemo(() => [...new Set(store.teams.flatMap(t => t.tags ?? []))].sort(), [store.teams]);
  const setPage = (p: Page) => {
    if (location.hash.slice(1) !== p) location.hash = p;
    setPageState(p);
    window.scrollTo({top: 0});
  };
  useEffect(() => {
    // Ignore hashes we don't know instead of falling back to Build; share links open a preview.
    const onHash = () => {
      const h = location.hash.slice(1);
      if (PAGES.some(p => p.key === h)) setPageState(h as Page);
      if (h === 'bauen') setPageState('teams');
      const payload = sharePayload(h);
      if (payload) decodeShare(payload).then(setShared, e => setShared({error: (e as Error).message}));
      const board = matPayload(location.hash);
      if (board) setSharedMat(board);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Ctrl+Z outside text fields undoes team edits.
  const {undo} = store;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const issues = useMemo(() => validateTeam(sets), [sets]);
  const errorCount = issues.filter(i => i.level === 'error').length;
  const sel = Math.min(selected, sets.length);

  const setSlot = (i: number, s: PokemonSet, key?: string) => setSets(prev => {
    const next = [...prev];
    next[i] = s;
    return next;
  }, key);
  const removeSlot = (i: number) => {
    setSets(p => p.filter((_, k) => k !== i));
    setSelected(s => Math.max(0, s > i ? s - 1 : s));
  };

  return (
    // The header spans the full width on every page (as on the Playmat); the content below is centred.
    <div className={`px-4 pt-4 sm:px-6 ${page === 'playmat' ? 'pb-4' : 'pb-16'}`}>
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="h-8 w-8"><circle cx="16" cy="16" r="14" fill="none" stroke="#f5f5f5" strokeWidth="2.5"/><path d="M2 16h28" stroke="#f5f5f5" strokeWidth="2.5"/><circle cx="16" cy="16" r="5" fill="#000" stroke="#f5f5f5" strokeWidth="2.5"/></svg>
          <h1 className="font-display text-xl font-bold uppercase leading-none tracking-wider">Team<span className="text-gold">forge</span></h1>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg/60 p-1">
          {PAGES.map(p => (
            <button
              key={p.key}
              onClick={() => { if (p.key === 'teams') setTeamOpen(false); setPage(p.key); }}
              className={`relative rounded-lg px-3 py-1.5 font-display text-[13px] font-semibold uppercase tracking-wider transition ${page === p.key ? 'bg-gold text-black' : 'text-dim hover:bg-panel-2 hover:text-ink'}`}
            >
              {p.label}
              {p.key === 'analyse' && errorCount > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-bad" />}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="font-display font-semibold uppercase tracking-wider text-gold">{FORMAT.name}</span>
          <select
            className="rounded-lg border border-line bg-bg px-2 py-1 text-[12px] text-ink outline-none"
            value={store.source}
            onChange={e => store.setSource(e.target.value)}
            title="Usage data"
          >
            {FORMAT.sources.map(s => <option key={s.key} value={s.key}>{s.label} · {FORMAT.month}</option>)}
          </select>
        </div>
      </header>
      <div className={page === 'playmat' ? '' : 'mx-auto max-w-[1440px]'}>

      {store.saveError && (
        <div className="mb-4 border border-bad/60 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          Your browser's storage is full, so the latest changes aren't saved. Delete old boards on the Playmat (Boards) to make room.
        </div>
      )}

      {/* Team row: shared by all pages except the Playmat (team is on the board) and Matches (a log, not editing) */}
      {page !== 'playmat' && page !== 'matches' && !(page === 'teams' && !teamOpen) && (
        <div className="panel mb-5 p-3">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {editing && <button className="text-[12.5px] text-dim hover:text-ink" onClick={() => setTeamOpen(false)}>← All teams</button>}
            {editing ? (
              <input
                className="min-w-0 flex-1 bg-transparent px-1 font-display text-lg font-semibold tracking-wide outline-none placeholder:text-faint focus:text-gold"
                value={team.name}
                onChange={e => store.rename(e.target.value)}
                aria-label="Team name"
              />
            ) : (
              // Outside the editor the name is the team switcher; renaming happens in the editor.
              <span className="flex min-w-0 flex-1 items-center">
                {store.teams.length > 1 ? (
                  // The name with ▾ right after it; an invisible select on top does the switching.
                  <span className="relative flex min-w-0 items-center gap-1.5 border border-transparent px-1 hover:border-line-2">
                    <span className="truncate font-display text-lg font-semibold tracking-wide">{team.name || 'Untitled'}</span>
                    <span className="text-[11px] text-dim">▾</span>
                    <select className="absolute inset-0 cursor-pointer opacity-0" value={team.id}
                      onChange={e => { store.select(e.target.value); setSelected(0); }} title="Switch team" aria-label="Switch team">
                      {store.teams.map(t => <option key={t.id} value={t.id}>{t.name || 'Untitled'}</option>)}
                    </select>
                  </span>
                ) : (
                  <span className="truncate px-1 font-display text-lg font-semibold tracking-wide">{team.name}</span>
                )}
              </span>
            )}
            {editing && <TeamHeaderMeta team={team} folders={store.folders} onMeta={patch => store.setTeamMeta(team.id, patch)} />}
            <CheckBar sets={sets} errors={errorCount} onClick={() => setPage('analyse')} />
            {vsPage && (
              <VsPicker boards={oppBoards} openId={team.playmat?.id} opp={opp}
                onChange={id => { setVsId(id); setCalcPair(null); }} />
            )}
            <div className="flex gap-1.5">
              <button className="btn !px-2.5 !py-1 text-xs disabled:opacity-35" onClick={store.undo} disabled={!store.canUndo} title="Undo (Ctrl+Z)">↶</button>
              <button className="btn !py-1 text-xs" onClick={() => { store.create([], undefined, {folder: team.folder}); openEditor(); }}>+ New</button>
              <button className="btn !py-1 text-xs" onClick={() => store.duplicate()} title="Duplicate">⧉</button>
              <button className="btn !py-1 text-xs" onClick={() => setDialog('import')}>Import</button>
              <button className="btn btn-gold !py-1 text-xs" onClick={() => setDialog('export')} disabled={!sets.length}>Export</button>
              <button className="btn !px-2.5 !py-1 text-xs hover:!border-bad/60 hover:!text-bad" onClick={() => { if (confirm(`Delete "${team.name}"?`)) store.remove(); }} title="Delete team">🗑</button>
            </div>
          </div>
          <TeamBar
            sets={sets}
            selected={editing ? sel : planning ? Math.min(planSel, sets.length - 1) : -1}
            issues={issues}
            onSelect={i => {
              // On the planning tabs a click picks the Pokémon to plan for; elsewhere it opens the editor.
              if (planning && i < sets.length) setPlanSel(i);
              else openEditor(i);
            }}
            onRemove={removeSlot}
            onMove={(from, to) => { setSets(p => { const n = [...p]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; }); setSelected(to); }}
          />
          {editing && <TeamNotes team={team} allTags={allTags} onMeta={(patch, key) => store.setTeamMeta(team.id, patch, key)} />}
        </div>
      )}

      {!usage ? (
        usageError ? <p className="py-16 text-center text-[13px] text-bad">Couldn't load the usage data: {usageError}</p> : <Loading />
      ) : (
        <Suspense fallback={<Loading />}>
      {page === 'teams' && !teamOpen && (
        <TeamsView teams={store.teams} folders={store.folders} activeId={team.id} usage={usage}
          onOpen={id => { store.select(id); openEditor(); }}
          onNew={folder => { store.create([], undefined, {folder}); openEditor(); }}
          onImport={() => setDialog('import')}
          onDuplicate={id => store.duplicate(id)}
          onExport={id => { store.select(id); setDialog('export'); }}
          onDelete={id => store.remove(id)}
          onMeta={(id, patch) => store.setTeamMeta(id, patch)}
          onAddFolder={store.addFolder} onRenameFolder={store.renameFolder} onDeleteFolder={store.deleteFolder}
          onUseTournament={(imported, name, extra) => { store.create(imported, name, extra); openEditor(); }} />
      )}
      {editing && (
        <div className="mx-auto max-w-[980px]">
          {sets[sel] ? (
            <SetEditor
              key={sel}
              set={sets[sel]}
              slot={sel}
              onChange={(s, key) => setSlot(sel, s, key)}
              onRemove={() => removeSlot(sel)}
              usage={usage}
              takenSpecies={sets.filter((_, i) => i !== sel).map(s => s.species)}
              issues={issues.filter(x => x.slot === sel)}
            />
          ) : sets.length < 6 ? (
            // Phase 1: keep picking. After a pick the next empty slot opens right away.
            <Picker
              sets={sets}
              slot={sel}
              usage={usage}
              onPick={s => { setSlot(sel, s); setSelected(sel + 1); }}
              hidden={team.hidden ?? EMPTY}
              noMegas={!!team.noMegas}
              onPrefs={store.setSuggestPrefs}
            />
          ) : null}
        </div>
      )}
      {page === 'suche' && (
        <SearchView
          sets={sets}
          usage={usage}
          query={searchQuery}
          setQuery={setSearchQuery}
          onAdd={s => { if (sets.length < 6) setSets(p => [...p, s]); }}
        />
      )}
      {page === 'analyse' && <AnalysisView sets={sets} usage={usage} issues={issues} weather={weather} opp={opp} />}
      {page === 'offense' && <OffenseView sets={sets} usage={usage} weather={weather} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} />}
      {page === 'speed' && <SpeedView sets={sets} usage={usage} weather={weather} opp={opp} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} />}
      {page === 'bulk' && <BulkView sets={sets} usage={usage} weather={weather} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} />}
      {page === 'meta' && <MetaView sets={sets} usage={usage} weather={weather} opp={opp} onCalc={(x, y) => { setCalcPair([makeSide(x), makeSide(y)]); setPage('calc'); }} />}
      {page === 'playmat' && (
        <PlaymatView sets={sets} usage={usage} mat={team.playmat} onChange={store.setPlaymat}
          savedReplays={(team.matches ?? []).map(m => m.replay ?? '')}
          boards={team.boards} onRenameBoard={store.renameBoard} onDeleteBoard={store.deleteBoard}
          onSaveMatch={m => store.setMatches(ms => [...ms, m])} />
      )}
      {page === 'matches' && (
        <MatchesView sets={sets} usage={usage} matches={team.matches ?? []} onChange={store.setMatches}
          teams={store.teams.map(t => ({id: t.id, name: t.name, games: t.matches?.length ?? 0}))} teamId={team.id} onTeam={store.select}
          playmatOpp={team.playmat && !team.playmat.replay ? team.playmat.opp : undefined}
          onOpenReplay={async m => {
            // The board saved with the game has its turn notes and plans; fetch the replay only without it.
            const board = m.board && team.boards?.find(b => b.id === m.board);
            if (board) { store.setPlaymat(board.mat); setPage('playmat'); return; }
            if (!m.replay) return;
            try {
              const {fetchReplay, guessMe, replayPlaymat} = await replayLib();
              const r = await fetchReplay(m.replay);
              store.setPlaymat(replayPlaymat(r, m.side ?? guessMe(r, sets, null), sets, usage!));
              setPage('playmat');
            } catch (e) { alert((e as Error).message); }
          }} />
      )}
      {page === 'calc' && <CalcView sets={sets} usage={usage} opp={opp} pair={calcPair} setPair={setCalcPair} />}
        </Suspense>
      )}

      <footer className={`mt-12 border-t border-line pt-4 text-[11.5px] text-faint ${page === 'playmat' ? 'hidden' : ''}`}>
        <a className="underline hover:text-dim" href="https://www.smogon.com/stats/" target="_blank" rel="noreferrer">Smogon</a> ({usage?.label}, {usage?.month ?? FORMAT.month}) ·
        Showdown <code>champions</code> mod · @smogon/calc ·
        Portraits: <a className="underline hover:text-dim" href="https://github.com/PMDCollab/SpriteCollab" target="_blank" rel="noreferrer">PMD SpriteCollab</a> (CC BY-NC 4.0)
      </footer>

      {shared && (
        <SharedDialog
          shared={shared}
          onClose={() => { setShared(null); history.replaceState(null, '', `${location.pathname}#teams`); setPageState('teams'); }}
          onImport={(name, imported) => { store.create(imported, name); setSelected(0); }}
        />
      )}

      {sharedMat && (
        <SharedMatDialog
          payload={sharedMat}
          teamName={team.name}
          onClose={() => { setSharedMat(null); history.replaceState(null, '', `${location.pathname}#playmat`); setPageState('playmat'); }}
          onOpen={async shared => {
            // A shared board always becomes a new board here, never overwrites one with the same id.
            let mat: Playmat = {...shared.mat, id: undefined};
            if (shared.replay) {
              // Replays travel as their id: fetch the battle again and lay it out at the same turn.
              const {fetchReplay, replayPlaymat, showStep} = await replayLib();
              const r = await fetchReplay(shared.replay.id);
              const u = usage ?? await loadUsage(store.source);
              const m = showStep(replayPlaymat(r, shared.replay.me, shared.mat.team ?? [], u, shared.replay.turnNotes), shared.replay.step);
              mat = {...m, id: undefined, notes: shared.mat.notes, plans: shared.mat.plans};
            }
            store.setPlaymat(mat);
          }}
        />
      )}

      {dialog && (
        <PasteDialog
          mode={dialog}
          sets={sets}
          teamName={team.name}
          onClose={() => setDialog(null)}
          onImport={(imported, asNew, name) => {
            if (asNew) store.create(imported, name ?? 'Imported Team');
            else setSets(() => imported);
            setSelected(0);
            setDialog(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

/** Pick what the planning tabs play against: the meta or the opponent of one of the team's boards. */
function VsPicker({boards, openId, opp, onChange}: {
  boards: SavedBoard[];
  openId?: string;
  opp?: Opponent;
  onChange: (id: string | null) => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <select
        className={`field !w-auto max-w-56 !py-1 text-xs ${opp ? '!border-gold text-gold' : 'text-dim'}`}
        value={opp?.id ?? ''}
        onChange={e => onChange(e.target.value || null)}
        title={boards.length ? 'Plan against the meta or one opponent from your Playmat boards' : 'Load an opponent on the Playmat to plan against it'}
      >
        <option value="">vs meta</option>
        {boards.map(b => <option key={b.id} value={b.id}>vs {b.mat.name || 'Board'}{b.id === openId ? ' (open)' : ''}</option>)}
      </select>
      {opp && <span className="flex gap-0.5">{opp.sets.map((s, i) => <Portrait key={i} name={battleForme(s)} size={22} />)}</span>}
    </span>
  );
}

/** Compact live status shown while building. */
function CheckBar({sets, errors, onClick}: {sets: PokemonSet[]; errors: number; onClick: () => void}) {
  const chips = useMemo(() => {
    if (!sets.length) return [];
    const out: {text: string; tone: 'bad' | 'warn' | 'good'}[] = [];
    if (errors) out.push({text: `${errors} error${errors > 1 ? 's' : ''}`, tone: 'bad'});
    for (const {role, members} of roleCoverage(sets)) {
      if (role.important && !members.length) out.push({text: `no ${role.label}`, tone: 'warn'});
    }
    for (const t of TYPES) {
      const m = sets.map(s => defensiveMult(s, t));
      const weak = m.filter(x => x > 1).length;
      if (weak >= 3 || weak - m.filter(x => x < 1).length >= 2) out.push({text: `${weak}× weak to ${t}`, tone: 'warn'});
    }
    const megas = sets.filter(s => SPECIES[battleForme(s)]?.mega).length;
    if (megas > 2) out.push({text: `${megas} Megas`, tone: 'warn'});
    if (!out.length && sets.length === 6) out.push({text: 'no issues', tone: 'good'});
    return out;
  }, [sets, errors]);

  if (!chips.length) return null;
  const tone = {bad: 'border-bad/40 bg-bad/10 text-bad', warn: 'border-warn/30 bg-warn/10 text-warn', good: 'border-good/30 bg-good/10 text-good'};
  return (
    <button onClick={onClick} className="flex flex-wrap gap-1.5" title="Go to analysis">
      {chips.slice(0, 5).map(c => (
        <span key={c.text} className={`rounded-md border px-2 py-0.5 text-[11.5px] ${tone[c.tone]}`}>{c.text}</span>
      ))}
      {chips.length > 5 && <span className="px-1 text-[11.5px] text-dim">+{chips.length - 5}</span>}
    </button>
  );
}

/** Preview of a team opened from a share link. */
function SharedDialog({shared, onImport, onClose}: {
  shared: {name: string; sets: PokemonSet[]; warnings: string[]} | {error: string};
  onImport: (name: string, sets: PokemonSet[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="panel rise w-full max-w-lg p-5" onMouseDown={e => e.stopPropagation()}>
        {'error' in shared ? (
          <>
            <h2 className="font-display text-lg font-semibold uppercase tracking-wider">Share link</h2>
            <p className="mt-2 text-[13px] text-bad">This link couldn't be read: {shared.error}</p>
            <div className="mt-4 flex justify-end"><button className="btn" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <div className="label">Shared team</div>
            <h2 className="font-display text-xl font-semibold">{shared.name}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {shared.sets.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1 text-center">
                  <Portrait name={battleForme(s)} size={48} />
                  <span className="w-full truncate text-[11px] text-dim">{s.species}</span>
                </div>
              ))}
            </div>
            {shared.warnings.length > 0 && <p className="mt-2 text-[12px] text-warn">{shared.warnings.join(' · ')}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={onClose}>Dismiss</button>
              <button className="btn btn-gold" onClick={() => { onImport(shared.name, shared.sets); onClose(); }}>Import as new team</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A board from a link: ask for the password if it has one, then put it on the Playmat. */
function SharedMatDialog({payload, teamName, onOpen, onClose}: {
  payload: {locked: boolean; data: string};
  teamName: string;
  onOpen: (m: SharedMat) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState<SharedMat | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setError(''); setBusy(true);
    try { setShared(await decodeMat(payload, password)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (!payload.locked) read(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async () => {
    if (!shared) return;
    setBusy(true);
    try { await onOpen(shared); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const plans = shared?.mat.plans ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="panel rise w-full max-w-lg p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="label">Shared Playmat</div>
        {!shared && payload.locked && (
          <>
            <h2 className="font-display text-xl font-semibold">This board is password-protected</h2>
            <input type="password" className="field mt-3 text-[13px]" value={password} autoFocus placeholder="Password"
              onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && password && read()} />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-gold" onClick={read} disabled={!password || busy}>{busy ? 'Unlocking …' : 'Unlock'}</button>
            </div>
          </>
        )}
        {shared && (
          <>
            <h2 className="font-display text-xl font-semibold">{shared.mat.name || 'Board'}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {(shared.mat.team ?? []).map((s, i) => <Portrait key={i} name={battleForme(s)} size={34} />)}
              <span className="mx-2 text-[12px] text-faint">vs</span>
              {shared.mat.opp.map((s, i) => <Portrait key={i} name={battleForme(s)} size={34} />)}
            </div>
            <p className="mt-2 text-[12.5px] text-dim">
              {shared.replay ? 'A Showdown replay' : 'A board'}
              {plans.length > 0 && ` with ${plans.length} plan${plans.length > 1 ? 's' : ''} (${plans.map(p => `${p.name}: ${p.frames.length} turns`).join(', ')})`}.
            </p>
            {shared.warnings.length > 0 && <p className="mt-1 text-[12px] text-warn">{shared.warnings.join(' · ')}</p>}
            <p className="mt-2 text-[11.5px] text-faint">Opening it replaces the Playmat of “{teamName}” (Ctrl+Z brings yours back).</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={onClose}>Dismiss</button>
              <button className="btn btn-gold" onClick={open} disabled={busy}>{busy ? 'Opening …' : 'Open on the Playmat'}</button>
            </div>
          </>
        )}
        {!shared && !payload.locked && !error && <p className="mt-2 text-[13px] text-dim">Reading the link …</p>}
        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      </div>
    </div>
  );
}
