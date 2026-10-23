import {useDeferredValue, useMemo, useState} from 'react';
import {MOVES, STAT_LABEL, TYPE_COLOR, pct, type UsageSource} from '../lib/data';
import {metaWeather, teamField} from '../lib/analysis';
import {metaThreats, type FieldOpts} from '../lib/calc';
import {bulkNeed, strongestMove, type BulkContext, type BulkNeed} from '../lib/bulk';
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
  const [intimidate, setIntimidate] = useState(false);
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
    const out: Row[] = [];
    for (const t of metaThreats(usage, limit)) {
      const own = weather.enemy ? metaWeather(t.name, usage) : null;
      const w = own?.weather ?? baseWeather;
      const field: FieldOpts = {weather: w, terrain: auto.electricTerrain ? 'Electric' : '', helpingHand, reflect, lightScreen};
      const ctx: BulkContext = {field, atkBoosts: intimidate ? {atk: -1} : {}, hits: twoHits ? 2 : 1};
      const moves = t.attacks.length ? t.attacks : t.set.moves.filter(m => MOVES[m] && MOVES[m].cat !== 'Status');
      const picked = allMoves ? moves : [strongestMove(t.set, me, moves, ctx)?.move].filter((m): m is string => !!m);
      for (const move of picked) {
        const res = strongestMove(t.set, me, [move], ctx);
        if (!res) continue;
        out.push({
          threat: t.name, attacker: t.set, move,
          minPct: res.out.minPct, maxPct: res.out.maxPct,
          ko: koLabel({move, minPct: res.out.minPct, maxPct: res.out.maxPct, koText: res.out.koText, koN: res.out.koN, koChance: res.out.koChance}),
          need: bulkNeed(t.set, me, move, ctx),
          weather: own && own.weather !== baseWeather ? own.weather : undefined,
        });
      }
    }
    return out.sort((a, b) => b.maxPct - a.maxPct);
  }, [me, usage, limit, baseWeather, auto.electricTerrain, weather.enemy, helpingHand, reflect, lightScreen, intimidate, twoHits, allMoves]);

  if (!sets.length) return <Empty />;
  const live = sets[sel];
  const stale = me !== live;

  const counts = {done: 0, sp: 0, nature: 0, impossible: 0};
  for (const r of rows) counts[r.need.kind]++;

  return (
    <Section
      title={`Bulk · ${live.species}`}
      right={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <WeatherControls state={weather} auto={auto.weather} />
          <Toggle on={intimidate} onClick={() => setIntimidate(v => !v)}>Intimidate</Toggle>
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
        <span className="text-dim"><b>{counts.impossible}</b> out of reach</span>
      </div>

      <div className={`max-h-[640px] overflow-y-auto pr-1 ${stale ? 'opacity-60' : ''}`}>
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
  const nature = need.kind === 'nature' ? need.nature : undefined;
  const {set, taken} = applySps(me, {hp: need.hp, [need.stat]: need.def}, nature);
  const label = `${nature ? `${nature} · ` : ''}HP ${need.hp} · ${STAT_LABEL[need.stat]} ${need.def}`;
  const detail = `Set ${label} SP${taken.length ? ` (takes ${taken.map(([s, n]) => `${n} from ${STAT_LABEL[s]}`).join(', ')})` : ''}`;
  return (
    <button onClick={() => onApply(set)} title={detail}
      className="rounded-md border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[11.5px] text-gold hover:bg-gold/20">
      {label}
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
