import {useMemo, useState} from 'react';
import {pct, type UsageSource} from '../lib/data';
import {ARCHETYPES, archetypeOf, emptyMatch, matchesCsv, matchFromReplay, matchStats, winrate, type Match, type Tally} from '../lib/matches';
import {fetchReplay, guessMe, replayId, replayPerspective} from '../lib/replay';
import type {PokemonSet} from '../lib/team';
import {speciesOptions} from './SetEditor';
import {Combobox, Portrait, Section} from './ui';

type Role = 'lead' | 'back' | null;

/** Match log of the active team: quick capture (or from a replay), the list, and win rates. */
export function MatchesView({sets, usage, matches, onChange, playmatOpp, onOpenReplay}: {
  sets: PokemonSet[];
  usage: UsageSource;
  matches: Match[];
  onChange: (fn: (m: Match[]) => Match[], key?: string) => void;
  /** Their team on the Playmat, to fill the form from. */
  playmatOpp?: PokemonSet[];
  onOpenReplay: (m: Match) => void;
}) {
  const [draft, setDraft] = useState<Match>(emptyMatch);
  const [editing, setEditing] = useState(false);
  const stats = useMemo(() => matchStats(matches), [matches]);
  const list = useMemo(() => [...matches].sort((a, b) => b.date.localeCompare(a.date)), [matches]);

  const save = () => {
    const m = {...draft, archetype: draft.archetype || archetypeOf(draft.oppTeam, usage)};
    onChange(ms => (editing ? ms.map(x => (x.id === m.id ? m : x)) : [...ms, m]));
    setDraft(emptyMatch());
    setEditing(false);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([matchesCsv(list)], {type: 'text/csv'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'matches.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <Section title={editing ? 'Edit match' : 'Add a match'}
          right={editing && <button className="text-[12px] text-faint underline hover:text-ink" onClick={() => { setDraft(emptyMatch()); setEditing(false); }}>cancel</button>}>
          <MatchForm draft={draft} setDraft={setDraft} sets={sets} usage={usage} playmatOpp={playmatOpp} onSave={save} editing={editing} />
        </Section>

        <Section title={`Matches (${matches.length})`}
          right={matches.length > 0 && <button className="btn !py-1 text-xs" onClick={download}>Export CSV</button>}>
          {list.length === 0 && <p className="text-[12.5px] text-faint">No games yet. Add one above, or paste a replay link.</p>}
          <ul className="divide-y divide-line">
            {list.map(m => (
              <MatchRow key={m.id} m={m}
                onEdit={() => { setDraft(m); setEditing(true); window.scrollTo({top: 0, behavior: 'smooth'}); }}
                onDelete={() => { if (confirm('Delete this match?')) onChange(ms => ms.filter(x => x.id !== m.id)); }}
                onOpen={() => onOpenReplay(m)} />
            ))}
          </ul>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Record">
          {stats.total.games === 0 ? <p className="text-[12.5px] text-faint">Win rates show up after the first game.</p> : (
            <div className="flex items-baseline gap-3">
              <span className="num font-display text-3xl font-bold">{pct(winrate(stats.total), 0)}</span>
              <span className="num text-[13px] text-dim">{stats.total.win}–{stats.total.loss}{stats.total.tie ? `–${stats.total.tie}` : ''} in {stats.total.games}</span>
            </div>
          )}
        </Section>
        {stats.total.games > 0 && (
          <>
            <StatTable title="Your leads" rows={stats.leads} />
            <StatTable title="Vs archetype" rows={stats.archetypes} />
            <StatTable title="Your Pokémon (brought)" rows={stats.brought} />
            <StatTable title="Vs Pokémon on their team" rows={stats.facing} limit={12} />
          </>
        )}
      </div>
    </div>
  );
}

function MatchForm({draft, setDraft, sets, usage, playmatOpp, onSave, editing}: {
  draft: Match; setDraft: (m: Match) => void; sets: PokemonSet[]; usage: UsageSource; playmatOpp?: PokemonSet[]; onSave: () => void; editing: boolean;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const spOpts = useMemo(() => speciesOptions(usage, draft.oppTeam), [usage, draft.oppTeam]);
  const set = (patch: Partial<Match>) => setDraft({...draft, ...patch});

  const fromReplay = async () => {
    setError('');
    const id = replayId(link);
    if (!id) { setError('That is not a replay link.'); return; }
    setBusy(true);
    try {
      const r = await fetchReplay(id);
      const me = guessMe(r, sets, replayPerspective(link));
      setDraft({...matchFromReplay(r, me, usage, sets), id: draft.id, notes: draft.notes});
      setLink('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setOppTeam = (team: string[]) => set({
    oppTeam: team,
    oppLeads: draft.oppLeads.filter(s => team.includes(s)),
    oppBack: draft.oppBack.filter(s => team.includes(s)),
    archetype: draft.archetype && draft.oppTeam.length ? draft.archetype : archetypeOf(team, usage),
  });

  const roleOf = (leads: string[], back: string[], s: string): Role => (leads.includes(s) ? 'lead' : back.includes(s) ? 'back' : null);
  /** Click cycles: not brought → lead → back → not brought (two leads, four brought at most). */
  const cycle = (leads: string[], back: string[], s: string): [string[], string[]] => {
    const role = roleOf(leads, back, s);
    if (role === null) {
      if (leads.length < 2) return [[...leads, s], back];
      if (leads.length + back.length < 4) return [leads, [...back, s]];
      return [leads, back];
    }
    if (role === 'lead') return [leads.filter(x => x !== s), leads.length + back.length <= 4 ? [...back, s] : back];
    return [leads, back.filter(x => x !== s)];
  };

  const myTeam = sets.map(s => s.species);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex gap-2">
          <input className="field text-[12.5px]" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && fromReplay()}
            placeholder="Paste a Showdown replay link to fill everything in …" />
          <button className="btn shrink-0" onClick={fromReplay} disabled={!link.trim() || busy}>{busy ? 'Loading …' : 'Fill from replay'}</button>
        </div>
        {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="label mb-1">Result</div>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['win', 'loss', 'tie'] as const).map(r => (
              <button key={r} onClick={() => set({result: r})}
                className={`px-3 py-1 text-[12.5px] capitalize transition ${draft.result === r ? (r === 'win' ? 'bg-good/20 text-good' : r === 'loss' ? 'bg-bad/20 text-bad' : 'bg-white/10 text-ink') : 'text-dim hover:text-ink'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <div className="label mb-1">Date</div>
          <input type="date" className="field !w-auto !py-1 text-[12.5px]" value={draft.date} onChange={e => set({date: e.target.value})} />
        </label>
        <label className="block min-w-[140px] flex-1">
          <div className="label mb-1">Opponent</div>
          <input className="field !py-1 text-[12.5px]" value={draft.opponent} onChange={e => set({opponent: e.target.value})} placeholder="Name (optional)" />
        </label>
        <label className="block w-36">
          <div className="label mb-1">Archetype</div>
          <input className="field !py-1 text-[12.5px]" list="archetypes" value={draft.archetype} onChange={e => set({archetype: e.target.value})}
            placeholder={archetypeOf(draft.oppTeam, usage) || 'auto'} />
          <datalist id="archetypes">{ARCHETYPES.map(a => <option key={a} value={a} />)}</datalist>
        </label>
      </div>

      <div>
        <div className="label mb-1.5">Your side <span className="normal-case tracking-normal text-faint">· click: lead → back → home</span></div>
        <div className="flex flex-wrap gap-2">
          {myTeam.map(s => (
            <PickMon key={s} name={s} role={roleOf(draft.myLeads, draft.myBack, s)}
              onClick={() => { const [l, b] = cycle(draft.myLeads, draft.myBack, s); set({myLeads: l, myBack: b}); }} />
          ))}
          {myTeam.length === 0 && <span className="text-[12px] text-faint">Your team is empty.</span>}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-3">
          <span className="label">Their side</span>
          {playmatOpp && playmatOpp.length > 0 && (
            <button className="text-[11.5px] text-faint underline hover:text-ink" onClick={() => setOppTeam(playmatOpp.map(s => s.species).slice(0, 6))}>from Playmat</button>
          )}
          {draft.oppTeam.length > 0 && <button className="text-[11.5px] text-faint underline hover:text-ink" onClick={() => setOppTeam([])}>clear</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft.oppTeam.map(s => (
            <div key={s} className="group relative">
              <PickMon name={s} role={roleOf(draft.oppLeads, draft.oppBack, s)}
                onClick={() => { const [l, b] = cycle(draft.oppLeads, draft.oppBack, s); set({oppLeads: l, oppBack: b}); }} />
              <button className="absolute -right-1 -top-1 hidden h-4 w-4 rounded-full bg-panel-2 text-[10px] leading-4 text-faint hover:text-bad group-hover:block"
                onClick={() => setOppTeam(draft.oppTeam.filter(x => x !== s))} title="Remove">×</button>
            </div>
          ))}
          {draft.oppTeam.length < 6 && (
            <div className="w-48"><Combobox value="" options={spOpts} placeholder="Add Pokémon …" onChange={v => setOppTeam([...draft.oppTeam, v])} /></div>
          )}
        </div>
      </div>

      <label className="block">
        <div className="label mb-1">Notes</div>
        <textarea className="field h-16 resize-none text-[12.5px]" value={draft.notes} onChange={e => set({notes: e.target.value})}
          placeholder="What decided the game?" />
      </label>

      <button className="btn btn-gold" onClick={onSave}>{editing ? 'Save changes' : 'Add match'}</button>
    </div>
  );
}

/** A portrait that shows its role: L(ead) gold, B(ack) blue, faded when it stayed home. */
function PickMon({name, role, onClick, size = 44}: {name: string; role: Role; onClick?: () => void; size?: number}) {
  return (
    <button onClick={onClick} title={`${name}${role ? ` · ${role}` : ''}`}
      className={`relative rounded-lg p-0.5 transition ${role === 'lead' ? 'ring-2 ring-gold' : role === 'back' ? 'ring-2 ring-info/70' : 'opacity-45 hover:opacity-80'}`}>
      <Portrait name={name} size={size} />
      {role && (
        <span className={`absolute -bottom-1 -right-1 rounded px-1 font-display text-[9px] font-bold leading-[13px] ${role === 'lead' ? 'bg-gold text-[#1a1406]' : 'bg-info text-[#06101c]'}`}>
          {role === 'lead' ? 'L' : 'B'}
        </span>
      )}
    </button>
  );
}

function MatchRow({m, onEdit, onDelete, onOpen}: {m: Match; onEdit: () => void; onDelete: () => void; onOpen: () => void}) {
  const badge = m.result === 'win' ? 'bg-good/20 text-good' : m.result === 'loss' ? 'bg-bad/20 text-bad' : 'bg-white/10 text-dim';
  const mons = (leads: string[], back: string[]) => (
    <span className="flex items-center gap-0.5">
      {leads.map(s => <Portrait key={s} name={s} size={28} className="ring-1 ring-gold/70" />)}
      {back.length > 0 && <span className="mx-0.5 text-faint">·</span>}
      {back.map(s => <Portrait key={s} name={s} size={24} className="opacity-80" />)}
    </span>
  );
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
      <span className={`w-11 rounded-md py-0.5 text-center font-display text-[11px] font-bold uppercase ${badge}`}>{m.result === 'tie' ? 'Tie' : m.result === 'win' ? 'Win' : 'Loss'}</span>
      <div className="w-36 min-w-0">
        <div className="truncate text-[13px]">{m.opponent || 'Opponent'}</div>
        <div className="num text-[11px] text-faint">{m.date}{m.archetype && <span className="ml-1.5 rounded bg-white/5 px-1 text-dim">{m.archetype}</span>}</div>
      </div>
      {mons(m.myLeads, m.myBack)}
      <span className="text-[11px] text-faint">vs</span>
      {m.oppLeads.length || m.oppBack.length ? mons(m.oppLeads, m.oppBack) : (
        <span className="flex gap-0.5">{m.oppTeam.map(s => <Portrait key={s} name={s} size={24} className="opacity-70" />)}</span>
      )}
      {m.notes && <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={m.notes}>{m.notes}</span>}
      <span className="ml-auto flex shrink-0 gap-2 text-[11.5px]">
        {m.replay && <button className="text-info underline hover:text-ink" onClick={onOpen} title="Watch on the Playmat">replay</button>}
        <button className="text-faint underline hover:text-ink" onClick={onEdit}>edit</button>
        <button className="text-faint underline hover:text-bad" onClick={onDelete}>delete</button>
      </span>
    </li>
  );
}

function StatTable({title, rows, limit = 8}: {title: string; rows: Tally[]; limit?: number}) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <ul className="space-y-1.5">
        {rows.slice(0, limit).map(r => {
          const w = winrate(r);
          return (
            <li key={r.key} className="flex items-center gap-2 text-[12.5px]">
              <span className="flex w-[124px] min-w-0 items-center gap-1">
                {r.mons.length ? r.mons.map(s => <Portrait key={s} name={s} size={24} />) : <span className="truncate">{r.key}</span>}
                {r.mons.length === 1 && <span className="ml-1 truncate text-dim">{r.mons[0]}</span>}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
                <span className="block h-full rounded-full" style={{width: `${w * 100}%`, background: w >= 0.6 ? 'var(--color-good)' : w >= 0.45 ? 'var(--color-warn)' : 'var(--color-bad)'}} />
              </span>
              <span className="num w-10 text-right">{pct(w, 0)}</span>
              <span className="num w-14 text-right text-[11px] text-faint">{r.win}–{r.loss}{r.tie ? `–${r.tie}` : ''}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
