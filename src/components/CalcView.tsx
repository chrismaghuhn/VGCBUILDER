import {useMemo, useState} from 'react';
import {ITEM_NAMES, MOVES, NATURE_NAMES, SP_MAX, SPECIES, STAT_LABEL, STATS, TYPE_COLOR, type UsageSource} from '../lib/data';
import {metaSet, runCalc, type FieldOpts} from '../lib/calc';
import {autoField} from '../lib/analysis';
import {battleForme, setStats, type Opponent, type PokemonSet} from '../lib/team';
import {makeSide, type Side} from './calcSide';
import {speciesOptions} from './SetEditor';
import {Combobox, EstBadge, Portrait, Section, TypeBadge, dmgColor} from './ui';

export {makeSide, type Side} from './calcSide';

export function CalcView({
  sets, usage, opp, pair, setPair,
}: {
  sets: PokemonSet[];
  usage: UsageSource;
  /** Opponent team to pick Pokémon B from (and start with). */
  opp?: Opponent;
  pair: [Side, Side] | null;
  setPair: (p: [Side, Side]) => void;
}) {
  const [field, setField] = useState<FieldOpts>({crit: false, singleTarget: false});
  // Weather and terrain follow the two Pokémon's abilities unless picked by hand.
  const [weatherSel, setWeatherSel] = useState<'auto' | NonNullable<FieldOpts['weather']>>('auto');
  const [terrainSel, setTerrainSel] = useState<'auto' | NonNullable<FieldOpts['terrain']>>('auto');
  // Hits for variable multi-hit moves, per move.
  const [hits, setHits] = useState<Record<string, number>>({});
  const fallback = useMemo<[Side, Side]>(() => {
    const top = Object.entries(usage.mons).sort((a, b) => b[1].usage - a[1].usage).map(([n]) => n);
    return [makeSide(sets[0] ?? metaSet(top[0], usage)), makeSide(opp?.sets[0] ?? metaSet(top[1], usage))];
  }, [sets, usage, opp]);
  const [a, b] = pair ?? fallback;
  const auto = autoField(a.set, b.set);
  const weather = weatherSel === 'auto' ? (auto.weather?.value ?? '') : weatherSel;
  const terrain = terrainSel === 'auto' ? (auto.terrain?.value ?? '') : terrainSel;
  const update = (i: 0 | 1, side: Side) => setPair(i === 0 ? [side, b] : [a, side]);

  const results = (atk: Side, def: Side) =>
    atk.set.moves.filter(Boolean).map(m => ({
      move: m,
      out: MOVES[m]?.cat === 'Status' ? null : runCalc(atk.set, def.set, m, {
        ...field, weather, terrain,
        burn: atk.burned, steelySpirit: atk.steelySpirit, hits: hits[m],
        helpingHand: atk.helpingHand,
        reflect: def.reflect, lightScreen: def.lightScreen, auroraVeil: def.auroraVeil, friendGuard: def.friendGuard,
      }, atk.boosts, def.boosts, def.hp),
    }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr_1fr]">
        <SidePanel label="Pokémon A" side={a} onChange={s => update(0, s)} sets={sets} opp={opp} usage={usage} />
        <div className="space-y-4">
          <Results title={`${a.set.species} → ${b.set.species}`} rows={results(a, b)} hits={hits} onHits={(m, n) => setHits({...hits, [m]: n})} />
          <Results title={`${b.set.species} → ${a.set.species}`} rows={results(b, a)} hits={hits} onHits={(m, n) => setHits({...hits, [m]: n})} />
          <div className="flex justify-center">
            <button className="btn text-xs" onClick={() => setPair([b, a])}>⇄ Swap sides</button>
          </div>
        </div>
        <SidePanel label="Pokémon B" side={b} onChange={s => update(1, s)} sets={sets} opp={opp} usage={usage} />
      </div>

      <Section title="Field">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <div className="label mb-1">Weather</div>
            <select className="field !w-auto" value={weatherSel} onChange={e => setWeatherSel(e.target.value as typeof weatherSel)}
              title={auto.weather ? `${auto.weather.value} ${auto.weather.why}` : 'Neither Pokémon sets weather'}>
              <option value="auto">Auto · {auto.weather ? `${auto.weather.value} (${auto.weather.why.replace(/^from /, '').split(':')[0]})` : 'none'}</option>
              {['', 'Sun', 'Rain', 'Sand', 'Snow'].map(w => <option key={w} value={w}>{w || 'None'}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="label mb-1">Terrain</div>
            <select className="field !w-auto" value={terrainSel} onChange={e => setTerrainSel(e.target.value as typeof terrainSel)}
              title={auto.terrain ? `${auto.terrain.value} Terrain ${auto.terrain.why}` : 'Neither Pokémon sets terrain'}>
              <option value="auto">Auto · {auto.terrain ? `${auto.terrain.value} (${auto.terrain.why.replace(/^from /, '').split(':')[0]})` : 'none'}</option>
              {['', 'Electric', 'Grassy', 'Psychic', 'Misty'].map(w => <option key={w} value={w}>{w || 'None'}</option>)}
            </select>
          </label>
          <Toggle label="Critical hit" value={!!field.crit} onChange={v => setField({...field, crit: v})} />
          <Toggle label="Spread: single target" value={!!field.singleTarget} onChange={v => setField({...field, singleTarget: v})} />
        </div>
        {(auto.weather?.why.includes(':') || auto.terrain?.why.includes(':')) && (
          <p className="mt-2 text-[11.5px] text-dim">
            {[auto.weather && auto.weather.why.includes(':') && `${auto.weather.value} ${auto.weather.why}`, auto.terrain && auto.terrain.why.includes(':') && `${auto.terrain.value} Terrain ${auto.terrain.why}`].filter(Boolean).join(' · ')}.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Possible hit counts of a variable multi-hit move (Bullet Seed 2–5, Population Bomb 1–10); null for others. */
function hitRange(move: string): number[] | null {
  const mh = MOVES[move]?.multihit;
  if (Array.isArray(mh)) return Array.from({length: mh[1] - mh[0] + 1}, (_, i) => mh[0] + i);
  if (mh === 10) return Array.from({length: 10}, (_, i) => i + 1);
  return null;
}

function Results({title, rows, hits, onHits}: {
  title: string; rows: {move: string; out: ReturnType<typeof runCalc>}[];
  hits: Record<string, number>; onHits: (move: string, n: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title={title}>
      <div className="space-y-1.5">
        {rows.length === 0 && <div className="text-dim">No moves.</div>}
        {rows.map(({move, out}) => {
          const mv = MOVES[move];
          const p = out?.maxPct ?? 0;
          return (
            <div key={move}>
              <button className="w-full text-left" onClick={() => setOpen(open === move ? null : move)}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background: TYPE_COLOR[mv?.type] ?? '#555'}} />
                  <span className="w-32 truncate text-[13px] font-medium">{move}</span>
                  {hitRange(move) && (
                    <select className="field !w-auto !px-1 !py-0 text-[11px]" value={hits[move] ?? ''} onClick={e => e.stopPropagation()}
                      onChange={e => onHits(move, +e.target.value)} title="Number of hits" aria-label={`Hits of ${move}`}>
                      <option value="" disabled>hits</option>
                      {hitRange(move)!.map(n => <option key={n} value={n}>{n}×</option>)}
                    </select>
                  )}
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
                    {out && <>
                      <div className="absolute inset-y-0 left-0 rounded-full opacity-40" style={{width: `${Math.min(100, p * 100)}%`, background: dmgColor(p)}} />
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{width: `${Math.min(100, out.minPct * 100)}%`, background: dmgColor(p)}} />
                    </>}
                  </div>
                  <span className="num w-[86px] text-right text-[12.5px]" style={{color: out ? dmgColor(p) : 'var(--color-faint)'}}>
                    {out ? `${(out.minPct * 100).toFixed(1)}–${(p * 100).toFixed(1)}%` : mv?.cat === 'Status' ? 'Status' : '—'}
                  </span>
                </div>
                {out?.koText && <div className="ml-[18px] mt-0.5 text-[11.5px] text-dim">{out.koText}</div>}
              </button>
              {open === move && out?.desc && <div className="rise ml-[18px] mt-1 rounded-md bg-bg/60 p-2 text-[11.5px] leading-relaxed text-ink/80">{out.desc}</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Toggle({label, value, onChange}: {label: string; value: boolean; onChange: (v: boolean) => void}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${value ? 'border-gold bg-gold/15 text-gold' : 'border-line text-dim hover:border-line-2 hover:text-ink'}`}
    >
      {label}
    </button>
  );
}

function SidePanel({label, side, onChange, sets, opp, usage}: {label: string; side: Side; onChange: (s: Side) => void; sets: PokemonSet[]; opp?: Opponent; usage: UsageSource}) {
  const set = side.set;
  const forme = battleForme(set);
  const sp = SPECIES[forme];
  const stats = setStats(set);
  const spOpts = useMemo(() => speciesOptions(usage), [usage]);
  // Changing the nature or SP by hand makes the spread known.
  const upd = (patch: Partial<PokemonSet>) => onChange({...side, set: {...set, ...patch, ...('sps' in patch || 'nature' in patch ? {estimated: undefined} : {})}});
  const picks = (list: PokemonSet[], title?: string) => (
    <div className="flex flex-wrap items-center gap-1">
      {title && <span className="label mr-1 w-full truncate text-[10px] text-bad/80">{title}</span>}
      {list.map((s, i) => (
        <button key={i} onClick={() => onChange({...side, set: s})} title={s.species}
          className={`rounded-md border p-0.5 ${s === set ? 'border-gold' : 'border-line hover:border-line-2'}`}>
          <Portrait name={battleForme(s)} size={28} />
        </button>
      ))}
    </div>
  );

  return (
    <Section title={label}>
      {(sets.length > 0 || opp) && (
        <div className="mb-3 space-y-2">
          {sets.length > 0 && picks(sets)}
          {opp && picks(opp.sets, opp.name)}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Portrait name={forme} size={56} />
        <div className="min-w-0 flex-1">
          <Combobox value={set.species} options={spOpts} onChange={n => onChange({...side, set: metaSet(n, usage)})} />
          <div className="mt-1 flex gap-1">{sp?.types.map(t => <TypeBadge key={t} type={t} small />)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="label mb-1">Item</div>
          <Combobox value={set.item} options={[{value: ''}, ...ITEM_NAMES.map(i => ({value: i}))]} onChange={item => upd({item})} />
        </div>
        <div>
          <div className="label mb-1">Ability</div>
          <select className="field" value={sp?.mega ? sp.abilities[0] : set.ability} disabled={!!sp?.mega} onChange={e => upd({ability: e.target.value})}>
            {(sp?.mega ? sp.abilities : SPECIES[set.species]?.abilities ?? []).map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <div className="label mb-1">Nature</div>
          <select className="field" value={set.nature} onChange={e => upd({nature: e.target.value})}>
            {NATURE_NAMES.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <div className="label mb-1">HP %</div>
          <input type="number" min={1} max={100} className="field num" value={side.hp} onChange={e => onChange({...side, hp: Math.max(1, Math.min(100, +e.target.value || 100))})} />
        </div>
      </div>

      <table className="mt-3 w-full text-[12px]">
        <thead>
          <tr className="text-faint">
            <th className="text-left font-normal" />
            <th className="font-normal">{set.estimated ? <span className="inline-flex items-center gap-1">SP <EstBadge /></span> : 'SP'}</th>
            <th className="font-normal">Boost</th>
            <th className="text-right font-normal">Stat</th>
          </tr>
        </thead>
        <tbody>
          {STATS.map(s => (
            <tr key={s}>
              <td className="font-display font-semibold text-dim">{STAT_LABEL[s]}</td>
              <td className="px-1 py-0.5">
                <input type="number" min={0} max={SP_MAX} value={set.sps[s]} className="field num !px-1 !py-0.5 text-center text-xs"
                  onChange={e => upd({sps: {...set.sps, [s]: Math.max(0, Math.min(SP_MAX, +e.target.value || 0))}})} />
              </td>
              <td className="px-1 py-0.5">
                {s !== 'hp' && (
                  <select className="field num !px-1 !py-0.5 text-center text-xs" value={side.boosts[s] ?? 0}
                    onChange={e => onChange({...side, boosts: {...side.boosts, [s]: +e.target.value}})}>
                    {[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(n => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
                  </select>
                )}
              </td>
              <td className="num text-right font-semibold">{stats[s]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3">
        <div className="label mb-1">Moves</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map(k => (
            <Combobox key={k} value={set.moves[k] ?? ''}
              options={[...new Set([...(SPECIES[set.species]?.moves ?? []), ...(sp?.moves ?? [])])].map(m => ({value: m}))}
              onChange={v => {
                const moves = [0, 1, 2, 3].map(i => set.moves[i] ?? '');
                moves[k] = v;
                upd({moves});
              }} />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Toggle label="Helping Hand" value={side.helpingHand} onChange={v => onChange({...side, helpingHand: v})} />
        <Toggle label="Reflect" value={side.reflect} onChange={v => onChange({...side, reflect: v})} />
        <Toggle label="Light Screen" value={side.lightScreen} onChange={v => onChange({...side, lightScreen: v})} />
        <Toggle label="Aurora Veil" value={side.auroraVeil} onChange={v => onChange({...side, auroraVeil: v})} />
        <Toggle label="Friend Guard" value={side.friendGuard} onChange={v => onChange({...side, friendGuard: v})} />
        <Toggle label="Intimidate (−1 Atk)" value={side.boosts.atk === -1} onChange={v => onChange({...side, boosts: {...side.boosts, atk: v ? -1 : 0}})} />
        <Toggle label="Burned" value={!!side.burned} onChange={v => onChange({...side, burned: v})} />
        <Toggle label="Ally Steely Spirit" value={!!side.steelySpirit} onChange={v => onChange({...side, steelySpirit: v})} />
      </div>
    </Section>
  );
}
