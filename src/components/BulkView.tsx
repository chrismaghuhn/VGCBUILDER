import {useDeferredValue, useMemo, useState} from 'react';
import {MOVES, STAT_LABEL, TYPE_COLOR, pct, type UsageSource} from '../lib/data';
import {metaWeather, teamField} from '../lib/analysis';
import {metaThreats, type FieldOpts} from '../lib/calc';
import {bulkNeed, strongestMove, survives, type BulkContext, type BulkNeed, type KeptHit} from '../lib/bulk';
import {applySps} from '../lib/speed';
import type {PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {koLabel} from './MetaView';
import {Portrait, Section, WeatherChip, WeatherControls, dmgColor, type WeatherState} from './ui';

interface Row {
  threat: string;
  attacker: PokemonSet;
  move: string;
  minPct: number;
  maxPct: number;
  ko: ReturnType<typeof koLabel>;
  need: BulkNeed;
  weather?: string;
}

export function BulkView({sets, usage, weather, selected, onUpdateSet}: {
  sets: PokemonSet[];
  usage: UsageSource;
  weather: WeatherState;
  selected: number;
  onUpdateSet: (i: number, s: PokemonSet) => void;
}) {
  // Stat drops on the attacker: -1 Atk (Intimidate, Parting Shot …) and -1 SpA (Snarl, Eerie Impulse …).
  const [atkDrop, setAtkDrop] = useState(false);
  const [spaDrop, setSpaDrop] = useState(false);
  const [helpingHand, setHelpingHand] = useState(false);
  const [reflect, setReflect] = useState(false);
  const [lightScreen, setLightScreen] = useState(false);
  const [twoHits, setTwoHits] = useState(false);
  const [allMoves, setAllMoves] = useState(false);
  const [limit, setLimit] = useState(30);

  const sel = Math.min(selected, Math.max(0, sets.length - 1));
  const me = useDeferredValue(sets[sel]);
  const auto = teamField(sets);
  const baseWeather = weather.pref === 'auto' ? auto.weather : weather.pref;

  const rows = useMemo<Row[]>(() => {
    if (!me) return [];
    // Pass 1: every (threat, move) with its damage; pass 2: needs, keeping the hits already survived.
    const hits: (Omit<Row, 'need'> & {ctx: BulkContext; ok: boolean})[] = [];
    for (const t of metaThreats(usage, limit)) {
      const own = weather.enemy ? metaWeather(t.name, usage) : null;
      const w = own?.weather ?? baseWeather;
      const field: FieldOpts = {weather: w, terrain: auto.electricTerrain ? 'Electric' : '', helpingHand, reflect, lightScreen};
      const ctx: BulkContext = {field, atkBoosts: {atk: atkDrop ? -1 : 0, spa: spaDrop ? -1 : 0}, hits: twoHits ? 2 : 1};
      const moves = t.attacks.length ? t.attacks : t.set.moves.filter(m => MOVES[m] && MOVES[m].cat !== 'Status');
      const picked = allMoves ? moves : [strongestMove(t.set, me, moves, ctx)?.move].filter((m): m is string => !!m);
      for (const move of picked) {
        const res = strongestMove(t.set, me, [move], ctx);
        if (!res) continue;
        hits.push({
          threat: t.name, attacker: t.set, move, ctx,
          minPct: res.out.minPct, maxPct: res.out.maxPct,
          ko: koLabel({move, minPct: res.out.minPct, maxPct: res.out.maxPct, koText: res.out.koText, koN: res.out.koN, koChance: res.out.koChance}),
          ok: survives(t.set, me, move, ctx),
          weather: own && own.weather !== baseWeather ? own.weather : undefined,
        });
      }
    }
    const keep: KeptHit[] = hits.filter(h => h.ok).map(h => ({name: h.threat, attacker: h.attacker, move: h.move, ctx: h.ctx}));
    return hits
      .map(({ctx, ok, ...h}) => ({...h, need: ok ? {kind: 'done' as const} : bulkNeed(h.attacker, me, h.move, ctx, keep)}))
      .sort((a, b) => b.maxPct - a.maxPct);
  }, [me, usage, limit, baseWeather, auto.electricTerrain, weather.enemy, helpingHand, reflect, lightScreen, atkDrop, spaDrop, twoHits, allMoves]);

  if (!sets.length) return <Empty />;
  const live = sets[sel];
  const stale = me !== live;

  const counts = {done: 0, sp: 0, nature: 0, conflict: 0, impossible: 0};
  for (const r of rows) counts[r.need.kind]++;

  return (
    <Section
      title={`Bulk · ${live.species}`}
      right={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <WeatherControls state={weather} auto={auto.weather} />
          <Toggle on={atkDrop} onClick={() => setAtkDrop(v => !v)} title="Attacker at -1 Atk (Intimidate, Parting Shot …)">−1 Atk</Toggle>
          <Toggle on={spaDrop} onClick={() => setSpaDrop(v => !v)} title="Attacker at -1 SpA (Snarl, Eerie Impulse, Parting Shot …)">−1 SpA</Toggle>
          <Toggle on={helpingHand} onClick={() => setHelpingHand(v => !v)}>Helping Hand</Toggle>
          <Toggle on={reflect} onClick={() => setReflect(v => !v)}>Reflect</Toggle>
          <Toggle on={lightScreen} onClick={() => setLightScreen(v => !v)}>Light Screen</Toggle>
          <Toggle on={twoHits} onClick={() => setTwoHits(v => !v)} title="Survive two hits instead of one">2 hits</Toggle>
          <Toggle on={allMoves} onClick={() => setAllMoves(v => !v)} title="List every common attack, not just the strongest">All moves</Toggle>
          <select className="field !w-auto !py-1 text-xs" value={limit} onChange={e => setLimit(+e.target.value)}>
            {[20, 30, 50].map(n => <option key={n} value={n}>Top {n} meta</option>)}
          </select>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        <span className="text-faint">
          {live.nature} · {(['hp', 'def', 'spd'] as const).map(s => `${live.sps[s]} ${STAT_LABEL[s]}`).join(' / ')} · pick another Pokémon in the team bar
        </span>
        <span className="text-dim">survives <b className="text-good">{counts.done}</b> of {rows.length}</span>
        <span className="text-dim"><b className="text-gold">{counts.sp}</b> more with HP/Def/SpD SP</span>
        <span className="text-dim"><b className="text-gold">{counts.nature}</b> more with a bulk nature</span>
        {counts.conflict > 0 && <span className="text-dim"><b className="text-warn">{counts.conflict}</b> only by giving up others</span>}
        <span className="text-dim"><b>{counts.impossible}</b> out of reach</span>
      </div>

      {/* While recomputing, suggestions belong to the previous spread: block clicks until fresh. */}
      <div className={`max-h-[640px] overflow-y-auto pr-1 ${stale ? 'pointer-events-none opacity-60' : ''}`} aria-busy={stale}>
        {rows.map((r, i) => {
          const mv = MOVES[r.move];
          return (
            <div key={r.threat + r.move + i} className="flex items-center gap-2.5 border-b border-line/50 py-1">
              <Portrait name={r.threat} size={22} className="!rounded" />
              <span className="flex w-40 min-w-0 items-center gap-1.5 text-[13px]">
                <span className="truncate">{r.threat}</span>
                {r.weather && <WeatherChip weather={r.weather as never} />}
              </span>
              <span className="flex w-36 min-w-0 items-center gap-1.5 text-[12.5px] text-dim">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background: TYPE_COLOR[mv?.type] ?? '#555'}} />
                <span className="truncate">{r.move}</span>
              </span>
              <span className="num w-24 text-right text-[12px]" style={{color: dmgColor(r.maxPct)}}>
                {pct(r.minPct, 0)}–{pct(r.maxPct, 0)}
              </span>
              <span className="num hidden w-20 whitespace-nowrap text-[11.5px] text-dim sm:block">
                {r.ko.ko}{r.ko.chance && <span className="ml-0.5 text-[9.5px] opacity-80">{r.ko.chance}</span>}
              </span>
              <span className="ml-auto shrink-0 text-right">
                <NeedChip need={r.need} me={live} onApply={s => onUpdateSet(sel, s)} />
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function NeedChip({need, me, onApply}: {need: BulkNeed; me: PokemonSet; onApply: (s: PokemonSet) => void}) {
  if (need.kind === 'done') return <span className="text-[11.5px] text-good">✓ survives</span>;
  if (need.kind === 'impossible') return <span className="text-[11.5px] text-faint">✗ out of reach</span>;
  const nature = need.kind === 'sp' ? undefined : need.nature;
  const {set, taken} = applySps(me, {hp: need.hp, [need.stat]: need.def}, nature, need.protect);
  const label = `${nature ? `${nature} · ` : ''}HP ${need.hp} · ${STAT_LABEL[need.stat]} ${need.def}`;
  const conflict = need.kind === 'conflict';
  const detail = `Set ${label} SP${taken.length ? ` (takes ${taken.map(([s, n]) => `${n} from ${STAT_LABEL[s]}`).join(', ')})` : ''}`
    + (conflict ? `\nNo longer survives: ${need.breaks.join(', ')}` : '');
  return (
    <button onClick={() => onApply(set)} title={detail}
      className={`rounded-md border px-1.5 py-0.5 text-[11.5px] ${conflict ? 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/20' : 'border-gold/40 bg-gold/10 text-gold hover:bg-gold/20'}`}>
      {conflict && '⚠ '}{label}
      {conflict && <span className="ml-1 text-[10px] opacity-80">breaks {need.breaks.length}</span>}
    </button>
  );
}

function Toggle({on, onClick, title, children}: {on: boolean; onClick: () => void; title?: string; children: React.ReactNode}) {
  return (
    <button className={`btn !py-1 text-xs ${on ? '!border-gold !bg-gold/15 text-gold' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
