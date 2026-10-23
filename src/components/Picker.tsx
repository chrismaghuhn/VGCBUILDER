import {useDeferredValue, useMemo} from 'react';
import {SPECIES, pct, type UsageSource} from '../lib/data';
import {metaSet, metaThreats, suggestTeammates, threatMatrix} from '../lib/calc';
import {teamField} from '../lib/analysis';
import {popularSet, type PokemonSet} from '../lib/team';
import {speciesOptions} from './SetEditor';
import {Combobox, Portrait, TypeBadge} from './ui';

/** Empty slot: search plus ranked suggestions that fit the current team. */
export function Picker({sets, slot, usage, onPick, hidden, noMegas, onPrefs}: {
  sets: PokemonSet[];
  slot: number;
  usage: UsageSource;
  onPick: (s: PokemonSet) => void;
  hidden: string[];
  noMegas: boolean;
  onPrefs: (p: {hidden?: string[]; noMegas?: boolean}) => void;
}) {
  const deferred = useDeferredValue(sets);
  const taken = sets.map(s => s.species);
  const spOpts = useMemo(() => speciesOptions(usage, taken), [usage, taken.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    const threats = metaThreats(usage, 30);
    const rows = deferred.length ? threatMatrix(deferred, threats, teamField(deferred)) : [];
    const problems = rows.filter(r => r.danger >= 0.45).sort((a, b) => b.danger - a.danger).slice(0, 8).map(r => r.threat);
    return suggestTeammates(deferred, usage, problems, 9, {hidden, noMegas});
  }, [deferred, usage, hidden, noMegas]);

  const takenItems = sets.map(s => s.item);
  const stale = deferred !== sets;

  return (
    <div className="panel rise p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[15px] font-semibold uppercase tracking-wider">Slot {slot + 1}</span>
        <Combobox
          className="min-w-[240px] flex-1"
          value=""
          options={spOpts}
          placeholder="Search Pokémon …"
          autoFocus
          onChange={n => onPick(popularSet(n, usage, takenItems))}
        />
      </div>

      <div className="mb-2 mt-5 flex items-center justify-between gap-3">
        <span className="label">{sets.length ? 'Fits your team' : 'Meta picks'}</span>
        <button
          className={`rounded-md border px-2 py-0.5 text-[11.5px] transition ${noMegas ? 'border-gold bg-gold/15 text-gold' : 'border-line text-dim hover:text-ink'}`}
          onClick={() => onPrefs({noMegas: !noMegas})}
        >
          No Megas
        </button>
      </div>
      <div className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${stale ? 'opacity-60' : ''}`}>
        {suggestions.map((s, i) => {
          const sp = SPECIES[s.name];
          return (
            <div
              key={s.name}
              role="button"
              tabIndex={0}
              onClick={() => onPick(metaSet(s.name, usage, takenItems))}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(metaSet(s.name, usage, takenItems)); } }}
              className="rise group relative flex cursor-pointer gap-3 rounded-xl border border-line bg-bg/40 p-2.5 text-left transition hover:border-gold-dim hover:bg-panel-2/60"
              style={{animationDelay: `${i * 20}ms`}}
            >
              <button
                className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-faint hover:bg-bad/20 hover:text-bad group-hover:flex"
                title={`Hide ${s.name} from suggestions`}
                onClick={e => { e.stopPropagation(); onPrefs({hidden: [...hidden, s.name]}); }}
              >
                ×
              </button>
              <Portrait name={s.name} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-display text-[14px] font-semibold group-hover:text-gold">{s.name}</span>
                  <span className="num text-[11px] text-gold group-hover:invisible">{pct(s.usage)}</span>
                </div>
                <div className="mt-0.5 flex gap-1">{sp.types.map(t => <TypeBadge key={t} type={t} small />)}</div>
                {s.reasons.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-dim">
                    {s.reasons.slice(0, 3).map(r => <li key={r} className="truncate">{r}</li>)}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-faint">Hidden:</span>
          {hidden.map(n => (
            <button
              key={n}
              className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-dim hover:border-gold-dim hover:text-ink"
              title="Show in suggestions again"
              onClick={() => onPrefs({hidden: hidden.filter(x => x !== n)})}
            >
              <Portrait name={n} size={16} className="!rounded-sm" />
              {n}
              <span className="text-faint">↺</span>
            </button>
          ))}
          <button className="ml-1 text-faint underline hover:text-ink" onClick={() => onPrefs({hidden: []})}>Show all</button>
        </div>
      )}
    </div>
  );
}
