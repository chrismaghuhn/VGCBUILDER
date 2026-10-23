import {useMemo, useState} from 'react';
import {STAT_LABEL, type UsageSource} from '../lib/data';
import {effectiveSpeed, metaSpeeds, teamField, teamSpeeds, type SpeedEntry, type SpeedField} from '../lib/analysis';
import {applySpeed, speedNeed, type SpeedNeed} from '../lib/speed';
import {battleForme, type PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {Portrait, Section, WeatherControls, type WeatherState} from './ui';

export function SpeedView({sets, usage, weather, selected, onUpdateSet}: {
  sets: PokemonSet[];
  usage: UsageSource;
  weather: WeatherState;
  /** Index into sets, picked via the team bar. */
  selected: number;
  onUpdateSet: (i: number, s: PokemonSet) => void;
}) {
  const [trickRoom, setTrickRoom] = useState(false);
  const [tailwind, setTailwind] = useState(false);
  const [enemyTailwind, setEnemyTailwind] = useState(false);
  const [vsFastest, setVsFastest] = useState(false);
  const [limit, setLimit] = useState(40);

  const auto = teamField(sets);
  const field: SpeedField = {weather: weather.pref === 'auto' ? auto.weather : weather.pref, electricTerrain: auto.electricTerrain, tailwind, enemyTailwind};
  const sel = Math.min(selected, Math.max(0, sets.length - 1));
  const me = sets[sel];

  const rows = useMemo(() => {
    const all = [...teamSpeeds(sets, field), ...metaSpeeds(usage, limit, field, weather.enemy)]
      .map(r => ({...r, target: !r.mine && vsFastest && r.max ? r.max : r.speed}));
    return all.sort((a, b) => (trickRoom ? a.target - b.target : b.target - a.target) || (a.mine ? -1 : 1));
  }, [sets, usage, limit, field.weather, field.electricTerrain, tailwind, enemyTailwind, weather.enemy, vsFastest, trickRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const needs = useMemo(() => {
    const m = new Map<string, SpeedNeed>();
    if (!me) return m;
    for (const r of rows) if (!r.mine) m.set(r.name, speedNeed(me, r.target, field, trickRoom));
    return m;
  }, [me, rows, trickRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sets.length) return <Empty />;

  const counts = {done: 0, sp: 0, nature: 0, rest: 0};
  for (const n of needs.values()) {
    if (n.kind === 'done') counts.done++;
    else if (n.kind === 'sp') counts.sp++;
    else if (n.kind === 'nature') counts.nature++;
    else counts.rest++;
  }
  const max = Math.max(...rows.map(r => r.target), 1);
  const myNames = new Set(rows.filter(r => r.mine).map(r => r.name));
  const verb = trickRoom ? 'underspeeds' : 'outspeeds';

  return (
    <div className="space-y-4">
      <Section
        title={me ? `Speed · ${me.species} ${effectiveSpeed(me, field, true).speed}` : 'Speed'}
        right={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <WeatherControls state={weather} auto={auto.weather} />
            <Toggle on={tailwind} onClick={() => setTailwind(t => !t)} color="info">My Tailwind</Toggle>
            <Toggle on={enemyTailwind} onClick={() => setEnemyTailwind(t => !t)} color="bad">Enemy Tailwind</Toggle>
            <Toggle on={trickRoom} onClick={() => setTrickRoom(t => !t)} color="tr">Trick Room</Toggle>
            <Toggle on={vsFastest} onClick={() => setVsFastest(v => !v)} color="gold" title="Compare against the fastest common spread instead of the most common one">
              vs fastest spread
            </Toggle>
            <select className="field !w-auto !py-1 text-xs" value={limit} onChange={e => setLimit(+e.target.value)}>
              {[20, 40, 80].map(n => <option key={n} value={n}>Top {n} meta</option>)}
            </select>
          </div>
        }
      >
        {me && (
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
            <span className="text-faint">{me.nature} · {me.sps.spe} Spe SP · pick another Pokémon in the team bar</span>
            <span className="text-dim">{me.species} {verb} <b className="text-good">{counts.done}</b> of {needs.size}</span>
            <span className="text-dim"><b className="text-gold">{counts.sp}</b> more with Spe SP</span>
            <span className="text-dim"><b className="text-gold">{counts.nature}</b> more with a speed nature</span>
            <span className="text-dim"><b>{counts.rest}</b> out of reach</span>
          </div>
        )}
        <div className="max-h-[640px] overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <Row
              key={r.name + i + r.mine}
              r={r}
              max={max}
              isMeta={!r.mine && myNames.has(r.name)}
              isSelected={r.mine && me !== undefined && r.name === battleForme(me)}
              need={r.mine ? undefined : needs.get(r.name)}
              trickRoom={trickRoom}
              onApply={(sp, nature) => me && onUpdateSet(sel, applySpeed(me, sp, nature).set)}
              me={me}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Row({r, max, isMeta, isSelected, need, trickRoom, onApply, me}: {
  r: SpeedEntry & {target: number};
  max: number;
  isMeta: boolean;
  isSelected: boolean;
  need?: SpeedNeed;
  trickRoom: boolean;
  onApply: (sp: number, nature?: string) => void;
  me?: PokemonSet;
}) {
  return (
    <div className={`flex items-center gap-2.5 border-b border-line/50 py-1 ${r.mine ? 'bg-gold/[.06] text-gold' : ''} ${isSelected ? 'outline outline-1 outline-gold/60' : ''}`}>
      <Portrait name={r.name} size={22} className="!rounded" />
      <span className={`flex w-44 min-w-0 items-center gap-1.5 text-[13px] ${r.mine ? 'font-semibold' : ''}`}>
        <span className="truncate">{r.name}</span>
        {isMeta && <span className="shrink-0 rounded bg-line px-1 text-[9.5px] font-semibold uppercase text-dim">Meta</span>}
      </span>
      <span className="num w-9 text-right text-[13px] font-semibold">{r.target}</span>
      <span className="w-3 text-[10px] text-info" title={r.boosts.join(', ')}>{r.boosts.length ? '▲' : ''}</span>
      <div className="hidden w-28 shrink-0 md:block">
        <div className="h-1.5 rounded-full" style={{width: `${(r.target / max) * 100}%`, background: r.mine ? 'var(--color-gold)' : 'var(--color-line-2)'}} />
      </div>
      <span className="hidden min-w-0 flex-1 truncate text-[11px] text-faint lg:block" title={[...r.boosts, r.note].filter(Boolean).join(' · ')}>
        {[...r.boosts.filter(b => b !== 'Tailwind' && b !== 'Scarf'), r.note].filter(Boolean).join(' · ')}
      </span>
      <span className="ml-auto w-40 shrink-0 text-right">
        {need && me && <NeedChip need={need} trickRoom={trickRoom} onApply={onApply} me={me} />}
      </span>
    </div>
  );
}

function NeedChip({need, trickRoom, onApply, me}: {need: SpeedNeed; trickRoom: boolean; onApply: (sp: number, nature?: string) => void; me: PokemonSet}) {
  if (need.kind === 'done') return <span className="text-[11.5px] text-good">✓ {trickRoom ? 'slower' : 'faster'}</span>;
  if (need.kind === 'tie') return <span className="text-[11.5px] text-warn">speed tie at best</span>;
  if (need.kind === 'impossible') return <span className="text-[11.5px] text-faint">✗ out of reach</span>;
  const nature = need.kind === 'nature' ? need.nature : undefined;
  const {taken} = applySpeed(me, need.sp, nature);
  const detail = `Set ${nature ? `${nature}, ` : ''}Spe ${need.sp} SP${taken.length ? ` (takes ${taken.map(([s, n]) => `${n} from ${STAT_LABEL[s]}`).join(', ')})` : ''}`;
  return (
    <button
      onClick={() => onApply(need.sp, nature)}
      title={detail}
      className="rounded-md border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[11.5px] text-gold hover:bg-gold/20"
    >
      {nature ? `${nature} · ` : ''}Spe {need.sp} SP
    </button>
  );
}

function Toggle({on, onClick, color, title, children}: {on: boolean; onClick: () => void; color: 'info' | 'tr' | 'gold' | 'bad'; title?: string; children: React.ReactNode}) {
  const active = {info: '!border-info !bg-info/15 text-info', tr: '!border-[#c78cff] !bg-[#c78cff]/15 text-[#e2c6ff]', gold: '!border-gold !bg-gold/15 text-gold', bad: '!border-bad !bg-bad/15 text-bad'}[color];
  return (
    <button className={`btn !py-1 text-xs ${on ? active : ''}`} onClick={onClick} title={title}>
      {children} {on ? 'on' : 'off'}
    </button>
  );
}
