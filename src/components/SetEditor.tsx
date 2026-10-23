import {useMemo, useState} from 'react';
import {
  ITEM_NAMES, MOVES, NATURES, NATURE_NAMES, PICKABLE_SPECIES, SP_MAX, SP_TOTAL, SPECIES, STAT_LABEL, STATS,
  TYPE_COLOR, getItem, pct, type StatID, type UsageSource,
} from '../lib/data';
import {battleForme, parseSpread, popularSet, setStats, type Issue, type PokemonSet} from '../lib/team';
import {Combobox, Portrait, TypeBadge, type Option} from './ui';

const STAT_COLOR: Record<StatID, string> = {
  hp: '#3ecf8e', atk: '#f0a33a', def: '#e6d36a', spa: '#5aa9ff', spd: '#9a8cff', spe: '#f0566a',
};

const spreadText = (sps: PokemonSet['sps']) => STATS.filter(k => sps[k]).map(k => `${sps[k]} ${STAT_LABEL[k]}`).join(' / ');

export function speciesUsage(usage: UsageSource, name: string): number {
  let u = usage.mons[name]?.usage ?? 0;
  for (const m of Object.keys(SPECIES)) if (SPECIES[m].mega && SPECIES[m].megaOf === name) u += usage.mons[m]?.usage ?? 0;
  return u;
}

export function speciesOptions(usage: UsageSource, exclude: string[] = []): Option[] {
  const list = PICKABLE_SPECIES.filter(n => !exclude.includes(n)).map(n => ({n, u: speciesUsage(usage, n)}));
  const meta = list.filter(x => x.u >= 0.005).sort((a, b) => b.u - a.u);
  const rest = list.filter(x => x.u < 0.005);
  const render = (n: string) => (
    <>
      <Portrait name={n} size={22} className="!rounded" />
      <span className="truncate">{n}</span>
      <span className="flex gap-0.5">{SPECIES[n].types.map(t => <span key={t} className="h-2 w-2 rounded-full" style={{background: TYPE_COLOR[t]}} />)}</span>
    </>
  );
  return [
    ...meta.map(x => ({value: x.n, hint: pct(x.u), group: 'Meta', render: render(x.n), hintColor: 'var(--color-gold)'})),
    ...rest.map(x => ({value: x.n, group: 'Alle', render: render(x.n)})),
  ];
}

const FINE_KEY = 'teamforge.fineTuning';

export function SetEditor({
  set, slot, onChange, onRemove, usage, takenSpecies, issues,
}: {
  set: PokemonSet;
  slot: number;
  onChange: (s: PokemonSet, coalesceKey?: string) => void;
  onRemove: () => void;
  usage: UsageSource;
  takenSpecies: string[];
  issues: Issue[];
}) {
  const spOpts = useMemo(() => speciesOptions(usage, takenSpecies), [usage, takenSpecies]);
  const [fineOpen, setFineOpen] = useState(() => {
    try { return localStorage.getItem(FINE_KEY) === '1'; } catch { return false; }
  });
  const toggleFine = () => {
    setFineOpen(o => {
      try { localStorage.setItem(FINE_KEY, o ? '0' : '1'); } catch { /* ignore */ }
      return !o;
    });
  };

  const forme = battleForme(set);
  const sp = SPECIES[forme];
  const baseSp = SPECIES[set.species];
  const u = usage.mons[forme] ?? usage.mons[set.species];
  const stats = setStats(set);
  const total = STATS.reduce((a, s) => a + set.sps[s], 0);
  const update = (patch: Partial<PokemonSet>, key?: string) => onChange({...set, ...patch}, key);

  const itemOptions = useMemo<Option[]>(() => {
    const used = new Map((u?.items ?? []).map(([i, p]) => [i, p]));
    const megaStones = ITEM_NAMES.filter(i => {
      const it = getItem(i);
      if (!it?.mega) return false;
      const m = SPECIES[it.mega];
      return m && (m.megaOf ?? m.base) === set.species;
    });
    const megaUsage = (i: string) => usage.mons[getItem(i)!.mega!]?.usage ?? 0;
    const normal = ITEM_NAMES.filter(i => !getItem(i)?.mega);
    const common = normal.filter(i => used.has(i)).sort((a, b) => used.get(b)! - used.get(a)!);
    return [
      ...megaStones.map(i => ({value: i, group: 'Mega', hint: megaUsage(i) ? pct(megaUsage(i)) : undefined, hintColor: 'var(--color-gold)'})),
      ...common.map(i => ({value: i, group: 'Häufig', hint: pct(used.get(i)!)})),
      ...normal.filter(i => !used.has(i)).map(i => ({value: i, group: 'Alle'})),
    ];
  }, [u, set.species, usage]);

  const moveOptions = useMemo<Option[]>(() => {
    const all = [...new Set([...(baseSp?.moves ?? []), ...(sp?.moves ?? [])])];
    const used = new Map((u?.moves ?? []).map(([m, p]) => [m, p]));
    const render = (m: string) => {
      const mv = MOVES[m];
      return (
        <>
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background: TYPE_COLOR[mv?.type] ?? '#555'}} />
          <span className="truncate">{m}</span>
          <span className="num text-[10.5px] text-faint">{mv?.cat === 'Status' ? 'Status' : `${mv?.cat === 'Physical' ? 'Phys' : 'Spez'} ${mv?.bp}`}</span>
        </>
      );
    };
    const common = all.filter(m => used.has(m)).sort((a, b) => used.get(b)! - used.get(a)!);
    return [
      ...common.map(m => ({value: m, group: 'Häufig', hint: pct(used.get(m)!), render: render(m)})),
      ...all.filter(m => !used.has(m)).sort().map(m => ({value: m, group: 'Alle', render: render(m)})),
    ];
  }, [u, baseSp, sp]);

  const natureOptions = useMemo<Option[]>(() => {
    const byNature = new Map<string, number>();
    for (const [s, p] of u?.spreads ?? []) {
      const n = s.split(':')[0];
      byNature.set(n, (byNature.get(n) ?? 0) + p);
    }
    return NATURE_NAMES.map(n => {
      const [plus, minus] = NATURES[n];
      return {
        value: n,
        hint: byNature.get(n) ? pct(byNature.get(n)!) : undefined,
        hintColor: 'var(--color-gold)',
        render: (
          <>
            <span>{n}</span>
            <span className="text-[11px] text-faint">{plus && plus !== minus ? `+${STAT_LABEL[plus]} −${STAT_LABEL[minus!]}` : 'neutral'}</span>
          </>
        ),
      };
    }).sort((a, b) => (byNature.get(b.value) ?? 0) - (byNature.get(a.value) ?? 0));
  }, [u]);

  const setSp = (stat: StatID, v: number) => {
    const others = total - set.sps[stat];
    const clamped = Math.max(0, Math.min(SP_MAX, Math.min(v, SP_TOTAL - others)));
    update({sps: {...set.sps, [stat]: clamped}}, `sp-${slot}-${stat}`);
  };

  const [plus, minus] = NATURES[set.nature] ?? [null, null];

  return (
    <div className="panel rise p-4 sm:p-5">
      {/* Pokémon */}
      <div className="flex flex-wrap items-center gap-4">
        <Portrait name={forme} size={72} className="ring-1 ring-line-2" />
        <div className="min-w-[220px] flex-1">
          <Combobox value={set.species} options={spOpts} onChange={n => n !== set.species && onChange(popularSet(n, usage))} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {sp?.types.map(t => <TypeBadge key={t} type={t} />)}
            {sp?.mega && <span className="ml-1 text-xs text-gold">{forme}</span>}
            {u && <span className="num ml-auto text-xs text-dim">Usage <span className="text-gold">{pct(u.usage)}</span></span>}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="btn text-xs" onClick={() => onChange(popularSet(set.species, usage))}>★ Meta-Set</button>
          <button className="btn text-xs hover:!border-bad/60 hover:!text-bad" onClick={onRemove}>Entfernen</button>
        </div>
      </div>

      {/* Basics */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="label mb-1">Item</div>
          <Combobox value={set.item} options={itemOptions} onChange={item => update({item})} placeholder="Item" />
        </div>
        <div>
          <div className="label mb-1">Fähigkeit</div>
          {sp?.mega ? (
            <div className="field text-ink">{sp.abilities[0]}</div>
          ) : (
            <select className="field" value={set.ability} onChange={e => update({ability: e.target.value})}>
              {baseSp?.abilities.map(a => {
                const p = u?.abilities.find(([n]) => n === a)?.[1];
                return <option key={a} value={a}>{a}{p ? ` · ${pct(p, 0)}` : ''}</option>;
              })}
            </select>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="label mb-1">Attacken</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map(k => {
            const m = set.moves[k] ?? '';
            const mv = MOVES[m];
            return (
              <div key={k} className="relative">
                <span className="pointer-events-none absolute left-0 top-0 z-10 h-full w-1 rounded-l-lg" style={{background: mv ? TYPE_COLOR[mv.type] : 'transparent'}} />
                <Combobox
                  value={m}
                  options={moveOptions.filter(o => o.value === m || !set.moves.includes(o.value))}
                  onChange={v => {
                    const moves = [0, 1, 2, 3].map(i => set.moves[i] ?? '');
                    moves[k] = v;
                    update({moves});
                  }}
                  placeholder={`Attacke ${k + 1}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Fine tuning */}
      <div className="mt-4 rounded-xl border border-line bg-bg/40">
        <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={toggleFine}>
          <span className={`text-faint transition ${fineOpen ? 'rotate-90' : ''}`}>▸</span>
          <span className="label">Feintuning</span>
          <span className="truncate text-[12.5px] text-dim">
            <span className="text-ink">{set.nature}</span> · {spreadText(set.sps) || 'keine SP'}
          </span>
          <span className={`num ml-auto shrink-0 text-xs ${total > SP_TOTAL ? 'text-bad' : total === SP_TOTAL ? 'text-good' : 'text-warn'}`}>{total}/{SP_TOTAL}</span>
        </button>
        {fineOpen && (
          <div className="border-t border-line px-3 pb-3 pt-3">
            <div className="mb-3 max-w-[260px]">
              <div className="label mb-1">Wesen</div>
              <Combobox value={set.nature} options={natureOptions} onChange={nature => update({nature})} />
            </div>
            <div className="space-y-1.5">
              {STATS.map(s => {
                const isPlus = plus === s && minus !== s;
                const isMinus = minus === s && plus !== s;
                return (
                  <div key={s} className="grid grid-cols-[38px_30px_1fr_46px_40px] items-center gap-2.5">
                    <span className={`font-display text-[13px] font-semibold ${isPlus ? 'text-good' : isMinus ? 'text-bad' : 'text-dim'}`}>
                      {STAT_LABEL[s]}{isPlus ? '+' : isMinus ? '−' : ''}
                    </span>
                    <span className="num text-right text-xs text-faint">{sp?.bs[s]}</span>
                    <input
                      type="range" min={0} max={SP_MAX} value={set.sps[s]} className="sp w-full"
                      style={{background: `linear-gradient(90deg, ${STAT_COLOR[s]} ${(set.sps[s] / SP_MAX) * 100}%, var(--color-line) 0)`}}
                      onChange={e => setSp(s, +e.target.value)}
                    />
                    <input
                      type="number" min={0} max={SP_MAX} value={set.sps[s]}
                      onChange={e => setSp(s, +e.target.value || 0)}
                      className="field num !px-1.5 !py-1 text-center text-xs"
                    />
                    <span className="num text-right font-semibold">{stats[s]}</span>
                  </div>
                );
              })}
            </div>
            {u && u.spreads.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {u.spreads.slice(0, 6).map(([s, p]) => {
                  const parsed = parseSpread(s);
                  return (
                    <button
                      key={s}
                      className="rounded-md border border-line bg-bg/50 px-2 py-1 text-left text-[11.5px] hover:border-gold-dim"
                      onClick={() => update({nature: parsed.nature, sps: parsed.sps})}
                    >
                      <span className="font-semibold text-ink">{parsed.nature}</span> <span className="text-dim">{spreadText(parsed.sps)}</span>{' '}
                      <span className="num text-gold">{pct(p)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[12.5px]">
          {issues.map((x, i) => (
            <li key={i} className={x.level === 'error' ? 'text-bad' : 'text-warn'}>{x.level === 'error' ? '✕' : '!'} {x.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
