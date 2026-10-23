import {SPECIES} from '../lib/data';
import {battleForme, type Issue, type PokemonSet} from '../lib/team';
import {Describe} from './Describe';
import {Portrait, TypeBadge} from './ui';

export function TeamBar({
  sets, selected, issues, onSelect, onRemove, onMove,
}: {
  sets: PokemonSet[];
  selected: number;
  issues: Issue[];
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const slots = Array.from({length: 6}, (_, i) => sets[i]);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {slots.map((set, i) => {
        const active = i === selected;
        if (!set) {
          // Every empty slot adds to the next free position.
          const next = sets.length;
          const isActive = selected === next;
          return (
            <button
              key={i}
              onClick={() => onSelect(next)}
              className={`flex min-h-[132px] items-center justify-center border border-dashed transition ${isActive && i === next ? 'border-gold bg-gold/5 text-gold' : 'border-line-2 text-faint hover:border-gold-dim hover:text-ink'}`}
            >
              <span className="font-display text-3xl leading-none">+</span>
            </button>
          );
        }
        const forme = battleForme(set);
        const sp = SPECIES[forme];
        const slotIssues = issues.filter(x => x.slot === i);
        const errors = slotIssues.filter(x => x.level === 'error').length;
        return (
          <div
            key={i}
            draggable
            onDragStart={e => e.dataTransfer.setData('text/slot', String(i))}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              const from = Number(e.dataTransfer.getData('text/slot'));
              if (!Number.isNaN(from) && from !== i) onMove(from, i);
            }}
            onClick={() => onSelect(i)}
            className={`group relative cursor-pointer border p-2.5 transition ${active ? 'border-gold bg-gradient-to-b from-gold/10 to-panel shadow-[0_0_0_1px_rgba(245,245,245,.25),0_8px_30px_-12px_rgba(245,245,245,.35)]' : 'panel hover:border-line-2'}`}
          >
            <button
              onClick={e => { e.stopPropagation(); onRemove(i); }}
              className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-faint hover:bg-bad/20 hover:text-bad group-hover:flex"
              title="Remove"
            >
              ×
            </button>
            <div className="flex items-start gap-2.5">
              <Portrait name={forme} size={52} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-display text-[15px] font-semibold leading-tight">{set.species}</span>
                  {sp?.mega && <span className="rounded bg-gold/15 px-1 font-display text-[9px] font-bold text-gold">MEGA</span>}
                  {errors > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-bad" title={`${errors} error${errors > 1 ? 's' : ''}`} />}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">{sp?.types.map(t => <TypeBadge key={t} type={t} small />)}</div>
                <div className="mt-1 truncate text-xs text-dim">{set.item ? <Describe kind="items" name={set.item}>{set.item}</Describe> : <span className="text-faint">no item</span>}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11.5px] text-ink/80">
              {[0, 1, 2, 3].map(k => (
                <span key={k} className="truncate">{set.moves[k] ? <Describe kind="moves" name={set.moves[k]}>{set.moves[k]}</Describe> : <span className="text-faint">—</span>}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
