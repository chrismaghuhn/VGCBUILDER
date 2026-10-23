import {useDeferredValue, useMemo, useState} from 'react';
import {MOVES, STAT_LABEL, TYPE_COLOR, pct, type UsageSource} from '../lib/data';
import {metaWeather, teamField} from '../lib/analysis';
import {metaThreats, type FieldOpts} from '../lib/calc';
import {attackStat, bestMoveOn, hitOn, koNeed, kos, type KeptKo, type KoContext, type KoNeed} from '../lib/offense';
import {applySps} from '../lib/speed';
import type {PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {PixelLock} from './icons';
import {koLabel} from './MetaView';
import {PlanBar} from './PlanBar';
import {Portrait, Section, WeatherChip, WeatherControls, type WeatherState} from './ui';

interface Row {
  target: string;
  move: string;
  minPct: number;
  maxPct: number;
  ko: ReturnType<typeof koLabel>;
  need: KoNeed;
  weather?: string;
}

export function OffenseView({sets, usage, weather, selected, onUpdateSet}: {
  sets: PokemonSet[];
  usage: UsageSource;
  weather: WeatherState;
  selected: number;
  onUpdateSet: (i: number, s: PokemonSet) => void;
}) {
  const [helpingHand, setHelpingHand] = useState(false);
  const [atkDrop, setAtkDrop] = useState(false);
  const [spaDrop, setSpaDrop] = useState(false);
  const [screens, setScreens] = useState(false);
  const [singleTarget, setSingleTarget] = useState(false);
  const [twoHits, setTwoHits] = useState(false);
  const [allMoves, setAllMoves] = useState(false);
  const [limit, setLimit] = useState(30);

  const sel = Math.min(selected, Math.max(0, sets.length - 1));
  const me = useDeferredValue(sets[sel]);
  const auto = teamField(sets);
  const baseWeather = weather.pref === 'auto' ? auto.weather : weather.pref;

  const rows = useMemo<Row[]>(() => {
    if (!me) return [];
    // Pass 1: damage per (target, move); pass 2: needs that keep every KO the set already has.
    const hits: (Omit<Row, 'need'> & {targetSet: PokemonSet; ctx: KoContext; ok: boolean})[] = [];
    for (const t of metaThreats(usage, limit)) {
      const own = weather.enemy ? metaWeather(t.name, usage) : null;
      const w = own?.weather ?? baseWeather;
      const field: FieldOpts = {
        weather: w, terrain: auto.electricTerrain ? 'Electric' : '', helpingHand, singleTarget,
        reflect: screens, lightScreen: screens,
      };
      const ctx: KoContext = {field, atkBoosts: {atk: atkDrop ? -1 : 0, spa: spaDrop ? -1 : 0}, hits: twoHits ? 2 : 1};
      const moves = allMoves
        ? me.moves.filter(m => attackStat(m))
        : [bestMoveOn(me, t.set, ctx)?.move].filter((m): m is string => !!m);
      for (const move of moves) {
        const res = hitOn(me, t.set, move, ctx);
        if (!res) continue;
        hits.push({
          target: t.name, targetSet: t.set, move, ctx, minPct: res.minPct, maxPct: res.maxPct,
          ko: koLabel({move, minPct: res.minPct, maxPct: res.maxPct, koText: res.koText, koN: res.koN, koChance: res.koChance}),
          ok: kos(me, t.set, move, ctx),
          weather: own && own.weather !== baseWeather ? own.weather : undefined,
        });
      }
    }
    const keep: KeptKo[] = hits.filter(h => h.ok).map(h => ({name: h.target, target: h.targetSet, move: h.move, ctx: h.ctx}));
    return hits
      .map(({targetSet, ctx, ok, ...h}) => ({...h, need: ok ? {kind: 'done' as const} : koNeed(me, targetSet, h.move, ctx, keep)}))
      .sort((a, b) => b.maxPct - a.maxPct);
  }, [me, usage, limit, baseWeather, auto.electricTerrain, weather.enemy, helpingHand, singleTarget, screens, atkDrop, spaDrop, twoHits, allMoves]);

  if (!sets.length) return <Empty />;
  const live = sets[sel];
  const stale = me !== live;
  const counts = {done: 0, sp: 0, nature: 0, conflict: 0, locked: 0, impossible: 0};
  for (const r of rows) counts[r.need.kind]++;
  const goal = twoHits ? '2HKOs' : 'OHKOs';

  return (
    <Section
      title={`Offense · ${live.species}`}
      right={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <WeatherControls state={weather} auto={auto.weather} />
          <Toggle on={helpingHand} onClick={() => setHelpingHand(v => !v)}>Helping Hand</Toggle>
          <Toggle on={atkDrop} onClick={() => setAtkDrop(v => !v)} title="You at -1 Atk (Intimidate)">−1 Atk</Toggle>
          <Toggle on={spaDrop} onClick={() => setSpaDrop(v => !v)} title="You at -1 SpA (Snarl)">−1 SpA</Toggle>
          <Toggle on={screens} onClick={() => setScreens(v => !v)} title="Reflect / Light Screen on the target's side">Screens</Toggle>
          <Toggle on={singleTarget} onClick={() => setSingleTarget(v => !v)} title="Spread moves hit only one target (no 0.75×)">Single target</Toggle>
          <Toggle on={twoHits} onClick={() => setTwoHits(v => !v)} title="Aim for a guaranteed 2HKO instead of an OHKO">2HKO</Toggle>
          <Toggle on={allMoves} onClick={() => setAllMoves(v => !v)} title="List every attack, not just the strongest">All moves</Toggle>
          <select className="field !w-auto !py-1 text-xs" value={limit} onChange={e => setLimit(+e.target.value)}>
            {[20, 30, 50].map(n => <option key={n} value={n}>Top {n} meta</option>)}
          </select>
        </div>
      }
    >
      <PlanBar set={live} onChange={s => onUpdateSet(sel, s)} />
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        <span className="text-dim">guaranteed {goal} <b className="text-good">{counts.done}</b> of {rows.length}</span>
        <span className="text-dim"><b className="text-gold">{counts.sp}</b> more with Atk/SpA SP</span>
        <span className="text-dim"><b className="text-gold">{counts.nature}</b> more with an attacking nature</span>
        {counts.conflict > 0 && <span className="text-dim"><b className="text-warn">{counts.conflict}</b> only by giving up others</span>}
        {counts.locked > 0 && <span className="text-dim"><b className="text-info">{counts.locked}</b> only with locked SP</span>}
        <span className="text-dim"><b>{counts.impossible}</b> out of reach</span>
      </div>

      <div className={`max-h-[640px] overflow-y-auto pr-1 ${stale ? 'pointer-events-none opacity-60' : ''}`} aria-busy={stale}>
        {rows.map((r, i) => {
          const mv = MOVES[r.move];
          return (
            <div key={r.target + r.move + i} className="flex items-center gap-2.5 border-b border-line/50 py-1">
              <Portrait name={r.target} size={22} className="!rounded" />
              <span className="flex w-40 min-w-0 items-center gap-1.5 text-[13px]">
                <span className="truncate">{r.target}</span>
                {r.weather && <WeatherChip weather={r.weather as never} />}
              </span>
              <span className="flex w-36 min-w-0 items-center gap-1.5 text-[12.5px] text-dim">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background: TYPE_COLOR[mv?.type] ?? '#555'}} />
                <span className="truncate">{r.move}</span>
              </span>
              <span className="num w-24 text-right text-[12px]" style={{color: r.maxPct >= 1 ? '#3ecf8e' : r.maxPct >= 0.5 ? '#9be3a8' : 'var(--color-dim)'}}>
                {pct(r.minPct, 0)}–{pct(r.maxPct, 0)}
              </span>
              <span className="num hidden w-20 whitespace-nowrap text-[11.5px] text-dim sm:block">
                {r.ko.ko}{r.ko.chance && <span className="ml-0.5 text-[9.5px] opacity-80">{r.ko.chance}</span>}
              </span>
              <span className="ml-auto shrink-0 text-right">
                <NeedChip need={r.need} me={live} goal={goal} onApply={s => onUpdateSet(sel, s)} />
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function NeedChip({need, me, goal, onApply}: {need: KoNeed; me: PokemonSet; goal: string; onApply: (s: PokemonSet) => void}) {
  if (need.kind === 'done') return <span className="text-[11.5px] text-good">✓ {goal.slice(0, -1)}</span>;
  if (need.kind === 'impossible') return <span className="text-[11.5px] text-faint">✗ out of reach</span>;
  if (need.kind === 'locked') return <span className="inline-flex items-center gap-1 text-[11.5px] text-info" title="Reachable only by changing a locked stat"><PixelLock /> needs locked SP</span>;
  const nature = need.kind === 'sp' ? undefined : need.nature;
  const {set, taken} = applySps(me, {[need.stat]: need.sp}, nature, need.protect);
  const label = `${nature ? `${nature} · ` : ''}${STAT_LABEL[need.stat]} ${need.sp}`;
  const conflict = need.kind === 'conflict';
  const detail = `Set ${label} SP${taken.length ? ` (takes ${taken.map(([s, n]) => `${n} from ${STAT_LABEL[s]}`).join(', ')})` : ''}`
    + (conflict ? `\nLoses the KO on: ${need.breaks.join(', ')}` : '');
  return (
    <button onClick={() => onApply(set)} title={detail}
      className={`rounded-md border px-1.5 py-0.5 text-[11.5px] ${conflict ? 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/20' : 'border-gold/40 bg-gold/10 text-gold hover:bg-gold/20'}`}>
      {conflict && '⚠ '}{label}
      {conflict && <span className="ml-1 text-[10px] opacity-80">loses {need.breaks.length}</span>}
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
