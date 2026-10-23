import {useEffect, useMemo, useState} from 'react';
import {FORMAT, SPECIES, TYPES, USAGE} from './lib/data';
import {defensiveMult, roleCoverage} from './lib/analysis';
import {useStore} from './lib/store';
import {battleForme, validateTeam, type PokemonSet} from './lib/team';
import {AnalysisView} from './components/AnalysisView';
import {BulkView} from './components/BulkView';
import {CalcView, makeSide, type Side} from './components/CalcView';
import {PlaymatView} from './components/PlaymatView';
import {MatchesView} from './components/MatchesView';
import {fetchReplay, guessMe, replayPlaymat} from './lib/replay';
import {MetaView} from './components/MetaView';
import {OffenseView} from './components/OffenseView';
import {PasteDialog} from './components/PasteDialog';
import {Portrait} from './components/ui';
import {decodeShare, sharePayload} from './lib/share';
import {Picker} from './components/Picker';
import {SearchView} from './components/SearchView';
import {SetEditor} from './components/SetEditor';
import {SpeedView} from './components/SpeedView';
import {TeamBar} from './components/TeamBar';
import type {WeatherPref, WeatherState} from './components/ui';

const PAGES = [
  {key: 'bauen', label: 'Build'},
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
  return (PAGES.find(p => p.key === h)?.key ?? 'bauen') as Page;
};

export default function App() {
  const store = useStore();
  const {team, setSets} = store;
  const sets = team.sets;
  const usage = USAGE[store.source] ?? USAGE[FORMAT.sources[0].key];
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [selected, setSelected] = useState(0);
  // Pokémon picked for planning on the Offense, Speed and Bulk tabs.
  const [planSel, setPlanSel] = useState(0);
  const planning = page === 'offense' || page === 'speed' || page === 'bulk';
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);
  // A team received via share link (#share=…), waiting for the user to import it.
  const [shared, setShared] = useState<{name: string; sets: PokemonSet[]; warnings: string[]} | {error: string} | null>(null);
  const [calcPair, setCalcPair] = useState<[Side, Side] | null>(null);
  const [weatherPref, setWeatherPref] = useState<WeatherPref>('auto');
  const [searchQuery, setSearchQuery] = useState('');
  const [enemyWeather, setEnemyWeather] = useState(false);
  const weather: WeatherState = {pref: weatherPref, setPref: setWeatherPref, enemy: enemyWeather, setEnemy: setEnemyWeather};

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
      const payload = sharePayload(h);
      if (payload) decodeShare(payload).then(setShared, e => setShared({error: (e as Error).message}));
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
    <div className={`mx-auto px-4 pt-4 sm:px-6 ${page === 'playmat' ? 'max-w-none pb-4' : 'max-w-[1440px] pb-16'}`}>
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="h-8 w-8"><circle cx="16" cy="16" r="14" fill="none" stroke="#f5c542" strokeWidth="2.5"/><path d="M2 16h28" stroke="#f5c542" strokeWidth="2.5"/><circle cx="16" cy="16" r="5" fill="#0a0e16" stroke="#f5c542" strokeWidth="2.5"/></svg>
          <h1 className="font-display text-xl font-bold uppercase leading-none tracking-wider">Team<span className="text-gold">forge</span></h1>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg/60 p-1">
          {PAGES.map(p => (
            <button
              key={p.key}
              onClick={() => setPage(p.key)}
              className={`relative rounded-lg px-4 py-1.5 font-display text-[13px] font-semibold uppercase tracking-wider transition ${page === p.key ? 'bg-gold text-[#1a1406]' : 'text-dim hover:bg-panel-2 hover:text-ink'}`}
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
            {FORMAT.sources.map(s => <option key={s.key} value={s.key}>{s.label} · {USAGE[s.key].month}</option>)}
          </select>
        </div>
      </header>

      {/* Team row: shared by all pages except the Playmat (team is on the board) and Matches (a log, not editing) */}
      {page !== 'playmat' && page !== 'matches' && (
        <div className="panel mb-5 p-3">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {store.teams.length > 1 && (
              <select
                className="field !w-auto !py-1 text-xs text-dim"
                value=""
                onChange={e => { store.select(e.target.value); setSelected(0); }}
                title="Switch team"
              >
                <option value="" disabled>Teams ({store.teams.length})</option>
                {store.teams.map(t => <option key={t.id} value={t.id}>{t.id === team.id ? '● ' : ''}{t.name}</option>)}
              </select>
            )}
            <input
              className="min-w-0 flex-1 bg-transparent px-1 font-display text-lg font-semibold tracking-wide outline-none placeholder:text-faint focus:text-gold"
              value={team.name}
              onChange={e => store.rename(e.target.value)}
              aria-label="Team name"
            />
            <CheckBar sets={sets} errors={errorCount} onClick={() => setPage('analyse')} />
            <div className="flex gap-1.5">
              <button className="btn !px-2.5 !py-1 text-xs disabled:opacity-35" onClick={store.undo} disabled={!store.canUndo} title="Undo (Ctrl+Z)">↶</button>
              <button className="btn !py-1 text-xs" onClick={() => { store.create(); setSelected(0); setPage('bauen'); }}>+ New</button>
              <button className="btn !py-1 text-xs" onClick={store.duplicate} title="Duplicate">⧉</button>
              <button className="btn !py-1 text-xs" onClick={() => setDialog('import')}>Import</button>
              <button className="btn btn-gold !py-1 text-xs" onClick={() => setDialog('export')} disabled={!sets.length}>Export</button>
              <button className="btn !px-2.5 !py-1 text-xs hover:!border-bad/60 hover:!text-bad" onClick={() => { if (confirm(`Delete "${team.name}"?`)) store.remove(); }} title="Delete team">🗑</button>
            </div>
          </div>
          <TeamBar
            sets={sets}
            selected={page === 'bauen' ? sel : planning ? Math.min(planSel, sets.length - 1) : -1}
            issues={issues}
            onSelect={i => {
              // On the planning tabs a click picks the Pokémon to plan for; elsewhere it opens the editor.
              if (planning && i < sets.length) setPlanSel(i);
              else { setSelected(i); setPage('bauen'); }
            }}
            onRemove={removeSlot}
            onMove={(from, to) => { setSets(p => { const n = [...p]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; }); setSelected(to); }}
          />
        </div>
      )}

      {page === 'bauen' && (
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
      {page === 'analyse' && <AnalysisView sets={sets} usage={usage} issues={issues} weather={weather} />}
      {page === 'offense' && <OffenseView sets={sets} usage={usage} weather={weather} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} onStep={setPage} />}
      {page === 'speed' && <SpeedView sets={sets} usage={usage} weather={weather} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} onStep={setPage} />}
      {page === 'bulk' && <BulkView sets={sets} usage={usage} weather={weather} selected={planSel} onUpdateSet={(i, s) => setSlot(i, s)} onStep={setPage} />}
      {page === 'meta' && <MetaView sets={sets} usage={usage} weather={weather} onCalc={(x, y) => { setCalcPair([makeSide(x), makeSide(y)]); setPage('calc'); }} />}
      {page === 'playmat' && (
        <PlaymatView sets={sets} usage={usage} mat={team.playmat} onChange={store.setPlaymat}
          savedReplays={(team.matches ?? []).map(m => m.replay ?? '')}
          onSaveMatch={m => store.setMatches(ms => [...ms, m])} />
      )}
      {page === 'matches' && (
        <MatchesView sets={sets} usage={usage} matches={team.matches ?? []} onChange={store.setMatches}
          teams={store.teams.map(t => ({id: t.id, name: t.name, games: t.matches?.length ?? 0}))} teamId={team.id} onTeam={store.select}
          playmatOpp={team.playmat && !team.playmat.replay ? team.playmat.opp : undefined}
          onOpenReplay={async m => {
            if (!m.replay) return;
            try {
              const r = await fetchReplay(m.replay);
              store.setPlaymat(replayPlaymat(r, m.side ?? guessMe(r, sets, null), sets, usage));
              setPage('playmat');
            } catch (e) { alert((e as Error).message); }
          }} />
      )}
      {page === 'calc' && <CalcView sets={sets} usage={usage} pair={calcPair} setPair={setCalcPair} />}

      <footer className={`mt-12 border-t border-line pt-4 text-[11.5px] text-faint ${page === 'playmat' ? 'hidden' : ''}`}>
        <a className="underline hover:text-dim" href="https://www.smogon.com/stats/" target="_blank" rel="noreferrer">Smogon</a> ({usage.label}, {usage.month}) ·
        Showdown <code>champions</code> mod · @smogon/calc ·
        Portraits: <a className="underline hover:text-dim" href="https://github.com/PMDCollab/SpriteCollab" target="_blank" rel="noreferrer">PMD SpriteCollab</a> (CC BY-NC 4.0)
      </footer>

      {shared && (
        <SharedDialog
          shared={shared}
          onClose={() => { setShared(null); history.replaceState(null, '', `${location.pathname}#bauen`); setPageState('bauen'); }}
          onImport={(name, imported) => { store.create(imported, name); setSelected(0); }}
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
