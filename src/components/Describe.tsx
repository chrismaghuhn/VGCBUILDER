import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {MOVES} from '../lib/data';
import {useText, type TextKind} from '../lib/texts';
import {TypeBadge} from './ui';

const TARGET: Record<string, string> = {
  normal: 'One target', any: 'Any target', randomNormal: 'Random foe', allAdjacentFoes: 'Both foes',
  allAdjacent: 'Everyone else', self: 'Self', adjacentAlly: 'Partner', adjacentAllyOrSelf: 'Partner or self',
  allySide: 'Your side', allies: 'Your side', allyTeam: 'Your team', foeSide: 'Their side', all: 'Whole field',
};

/**
 * Hover (or focus) to see what a move, item or ability does. The texts load on the first hover.
 * Wraps its children; with no name it renders them unchanged.
 */
export function Describe({kind, name, children, className = '', hoverOnly}: {
  kind: TextKind; name?: string; children: ReactNode; className?: string;
  /** Only on hover, and gone on click: for fields whose own dropdown explains the options. */
  hoverOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), 250); };
  const hide = () => { window.clearTimeout(timer.current); setOpen(false); };
  if (!name) return <>{children}</>;
  return (
    <span ref={ref} className={className} onMouseEnter={show} onMouseLeave={hide} onFocus={hoverOnly ? hide : show} onBlur={hide}
      onMouseDown={hoverOnly ? hide : undefined}>
      {children}
      {open && ref.current && createPortal(<Tip kind={kind} name={name} anchor={ref.current} />, document.body)}
    </span>
  );
}

function Tip({kind, name, anchor}: {kind: TextKind; name: string; anchor: HTMLElement}) {
  const text = useText(kind, name); // re-measure once the text is there
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({left: -9999, top: -9999});
  // Below the element, or above it when there's no room; kept inside the window.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    const w = b?.width ?? 280, h = b?.height ?? 80;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
    const top = a.bottom + 6 + h > window.innerHeight ? Math.max(8, a.top - h - 6) : a.bottom + 6;
    setPos({left, top});
  }, [anchor, text]);
  return (
    <div ref={box} role="tooltip" style={{left: pos.left, top: pos.top}}
      className="pointer-events-none fixed z-[100] w-max max-w-[300px] border border-line-2 bg-panel-2 px-3 py-2 text-[12px] leading-snug text-ink shadow-xl shadow-black/60">
      <div className="mb-1 font-semibold">{name}</div>
      <DescBody kind={kind} name={name} />
    </div>
  );
}

/** Move facts (type, category, power, priority, target) and the description. */
export function DescBody({kind, name}: {kind: TextKind; name: string}) {
  const text = useText(kind, name);
  const move = kind === 'moves' ? MOVES[name] : undefined;
  return (
    <>
      {move && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
          <TypeBadge type={move.type} small />
          <span>{move.cat}</span>
          {move.cat !== 'Status' && <span className="num">{move.bp || '—'} BP</span>}
          {!!move.prio && <span className="num text-ink">{move.prio > 0 ? '+' : ''}{move.prio} priority</span>}
          <span>{TARGET[move.target] ?? move.target}</span>
        </div>
      )}
      <div className="text-dim">{text || 'Loading …'}</div>
    </>
  );
}

/** A one-line description under a field (item, ability). */
export function DescLine({kind, name}: {kind: TextKind; name?: string}) {
  const text = useText(kind, name);
  if (!name || !text) return null;
  return <p className="mt-1 text-[11.5px] leading-snug text-dim">{text}</p>;
}
