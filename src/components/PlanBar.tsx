import {SP_TOTAL, STAT_LABEL, STATS, type StatID} from '../lib/data';
import type {PokemonSet} from '../lib/team';

export type PlanStep = 'offense' | 'speed' | 'bulk';

const STEPS: {key: PlanStep; label: string; hint: string}[] = [
  {key: 'offense', label: 'Offense', hint: 'SP for the KOs you want'},
  {key: 'speed', label: 'Speed', hint: 'SP to outspeed'},
  {key: 'bulk', label: 'Bulk', hint: 'the rest to survive'},
];

/** Step indicator for the planning flow plus the shared lock bar. */
export function PlanBar({step, set, onChange, onStep}: {
  step: PlanStep;
  set: PokemonSet;
  onChange: (s: PokemonSet) => void;
  onStep: (s: PlanStep) => void;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {STEPS.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-faint">→</span>}
            <button
              onClick={() => onStep(s.key)}
              className={`rounded-md border px-2 py-0.5 transition ${s.key === step ? 'border-gold bg-gold/15 text-gold' : 'border-line text-dim hover:text-ink'}`}
            >
              <b>{i + 1}</b> {s.label} <span className="text-faint">· {s.hint}</span>
            </button>
          </span>
        ))}
        <span className="ml-1 text-faint">Lock what you've settled, then move on.</span>
      </div>
      <LockBar set={set} onChange={onChange} />
    </div>
  );
}

/** SP per stat with a lock toggle; locked stats are left alone by every suggestion. */
function LockBar({set, onChange}: {set: PokemonSet; onChange: (s: PokemonSet) => void}) {
  const locked = set.locked ?? [];
  const toggle = (s: StatID) => onChange({...set, locked: locked.includes(s) ? locked.filter(x => x !== s) : [...locked, s]});
  const lockedSp = locked.reduce((a, s) => a + set.sps[s], 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span className="mr-1 text-faint">{set.nature}</span>
      {STATS.map(s => {
        const on = locked.includes(s);
        return (
          <button key={s} onClick={() => toggle(s)} title={on ? 'Unlock' : 'Lock: suggestions keep this stat as it is'}
            className={`num flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] transition ${on ? 'border-info bg-info/15 text-info' : 'border-line text-dim hover:text-ink'}`}>
            <span>{STAT_LABEL[s]} {set.sps[s]}</span>
            <span className="text-[10px]">{on ? '🔒' : '🔓'}</span>
          </button>
        );
      })}
      <span className="ml-2 text-dim">
        Free SP: <b className="text-ink">{SP_TOTAL - lockedSp}</b> SP
      </span>
    </div>
  );
}
