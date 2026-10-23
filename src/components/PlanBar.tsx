import {SP_TOTAL, STAT_LABEL, STATS, type StatID} from '../lib/data';
import type {PokemonSet} from '../lib/team';
import {PixelLock} from './icons';

/** The shared lock bar of the planning tabs (Offense, Speed, Bulk). */
export function PlanBar({set, onChange}: {set: PokemonSet; onChange: (s: PokemonSet) => void}) {
  return (
    <div className="mb-3">
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
            <PixelLock open={!on} className={on ? '' : 'opacity-50'} />
          </button>
        );
      })}
      <span className="ml-2 text-dim">
        Free SP: <b className="text-ink">{SP_TOTAL - lockedSp}</b> SP
      </span>
    </div>
  );
}
