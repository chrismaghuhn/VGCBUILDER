import {useMemo, useState} from 'react';
import {ITEM_NAMES, MOVES, NATURE_NAMES, SP_MAX, SPECIES, STAT_LABEL, STATS, TYPE_COLOR, type UsageSource} from '../lib/data';
import {metaSet, runCalc, type Boosts, type FieldOpts} from '../lib/calc';
import {battleForme, setStats, type Opponent, type PokemonSet} from '../lib/team';
import {speciesOptions} from './SetEditor';
import {Combobox, EstBadge, Portrait, Section, TypeBadge, dmgColor} from './ui';

export interface Side {
  set: PokemonSet;
  boosts: Boosts;
  hp: number;
  helpingHand: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  friendGuard: boolean;
}

export const makeSide = (set: PokemonSet): Side => ({
  set, boosts: {}, hp: 100, helpingHand: false, reflect: false, lightScreen: false, auroraVeil: false, friendGuard: false,
});

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
  const [field, setField] = useState<FieldOpts>({weather: '', terrain: '', crit: false, singleTarget: false});
  const fallback = useMemo<[Side, Side]>(() => {
    const top = Object.entries(usage.mons).sort((a, b) => b[1].usage - a[1].usage).map(([n]) => n);
    return [makeSide(sets[0] ?? metaSet(top[0], usage)), makeSide(opp?.sets[0] ?? metaSet(top[1], usage))];
  }, [sets, usage, opp]);
  const [a, b] = pair ?? fallback;
  const update = (i: 0 | 1, side: Side) => setPair(i === 0 ? [side, b] : [a, side]);

  const results = (atk: Side, def: Side) =>
    atk.set.moves.filter(Boolean).map(m => ({
      move: m,
      out: MOVES[m]?.cat === 'Status' ? null : runCalc(atk.set, def.set, m, {
        ...field,
        helpingHand: atk.helpingHand,
        reflect: def.reflect, lightScreen: def.lightScreen, auroraVeil: def.auroraVeil, friendGuard: def.friendGuard,
      }, atk.boosts, def.boosts, def.hp),
    }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr_1fr]">
        <SidePanel label="Pokémon A" side={a} onChange={s => update(0, s)} sets={sets} opp={opp} usage={usage} />
        <div className="space-y-4">
          <Results title={`${a.set.species} → ${b.set.species}`} rows={results(a, b)} />
          <Results title={`${b.set.species} → ${a.set.species}`} rows={results(b, a)} />
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
            <select className="field !w-36" value={field.weather} onChange={e => setField({...field, weather: e.target.value as FieldOpts['weather']})}>
              {['', 'Sun', 'Rain', 'Sand', 'Snow'].map(w => <option key={w} value={w}>{w || 'None'}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="label mb-1">Terrain</div>
            <select className="field !w-36" value={field.terrain} onChange={e => setField({...field, terrain: e.target.value as FieldOpts['terrain']})}>
              {['', 'Electric', 'Grassy', 'Psychic', 'Misty'].map(w => <option key={w} value={w}>{w || 'None'}</option>)}
            </select>
          </label>
          <Toggle label="Critical hit" value={!!field.crit} onChange={v => setField({...field, crit: v})} />
          <Toggle label="Spread: single target" value={!!field.singleTarget} onChange={v => setField({...field, singleTarget: v})} />
        </div>
      </Section>
    </div>
  );
}

function Results({title, rows}: {title: string; rows: {move: string; out: ReturnType<typeof runCalc>}[]}) {
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
      </div>
    </Section>
  );
}
