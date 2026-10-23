import {useEffect, useRef} from 'react';
import spritesJson from '../data/generated/sprites.json';
import {SPECIES} from '../lib/data';
import {Portrait} from './ui';

interface SpriteInfo {
  w: number;
  h: number;
  /** Frame durations in game ticks (1/60 s). */
  d: number[];
  /** Base forme's sprite stands in for this forme (most Megas). */
  base?: boolean;
}

const SPRITES = spritesJson as Record<string, SpriteInfo>;

/** PMD sheets have one row per facing, in this order. */
const ROWS = {down: 0, downRight: 1, right: 2, upRight: 3, up: 4, upLeft: 5, left: 6, downLeft: 7} as const;
export type Facing = keyof typeof ROWS;

export const spriteOf = (name: string): SpriteInfo | undefined => {
  const sp = SPECIES[name];
  return sp ? SPRITES[sp.id] : undefined;
};

// One shared animation loop for every sprite on the page.
type Tick = (ticks: number) => void;
const subscribers = new Set<Tick>();
let raf = 0;
const loop = (now: number) => {
  const ticks = (now / 1000) * 60;
  subscribers.forEach(fn => fn(ticks));
  raf = subscribers.size ? requestAnimationFrame(loop) : 0;
};
const subscribe = (fn: Tick) => {
  subscribers.add(fn);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => { subscribers.delete(fn); };
};

/**
 * Animated top-down idle sprite (PMD SpriteCollab). Falls back to the portrait when a forme has
 * no sprite at all; Megas that borrow the base sprite get a small badge.
 */
export function Sprite({name, facing = 'down', scale: maxScale = 2, fit, offset = 0, title}: {
  name: string;
  facing?: Facing;
  scale?: number;
  /** Max height in px: big sprites shrink to fit (frames range from 32×48 to 80×96). */
  fit?: number;
  /** Phase shift in ticks so a row of sprites doesn't move in lockstep. */
  offset?: number;
  title?: string;
}) {
  const info = spriteOf(name);
  const scale = info && fit ? Math.min(maxScale, fit / info.h) : maxScale;
  const ref = useRef<HTMLDivElement>(null);
  const isMega = SPECIES[name]?.mega;

  useEffect(() => {
    if (!info || info.d.length < 2) return;
    const total = info.d.reduce((a, b) => a + b, 0);
    let last = -1;
    return subscribe(ticks => {
      let t = (ticks + offset) % total;
      let frame = 0;
      while (t >= info.d[frame]) t -= info.d[frame++];
      if (frame !== last && ref.current) {
        ref.current.style.backgroundPositionX = `${-frame * info.w * scale}px`;
        last = frame;
      }
    });
  }, [info, scale, offset]);

  if (!info) {
    return (
      <div className="flex flex-col items-center" title={title ?? name}>
        <Portrait name={name} size={Math.min(fit ?? 56, 56)} className="!rounded-full ring-1 ring-line-2" />
      </div>
    );
  }
  const frames = info.d.length;
  return (
    <div className="relative" title={title ?? name} style={{width: info.w * scale, height: info.h * scale}}>
      <div
        ref={ref}
        className="portrait absolute inset-0"
        style={{
          backgroundImage: `url(/sprites/${SPECIES[name].id}.png)`,
          backgroundSize: `${frames * info.w * scale}px ${8 * info.h * scale}px`,
          backgroundPosition: `0px ${-ROWS[facing] * info.h * scale}px`,
          imageRendering: 'pixelated',
        }}
      />
      {isMega && info.base && (
        <span className="absolute -right-1 top-1 rounded bg-gold px-0.5 font-display text-[8px] font-bold leading-[11px] text-[#1a1406]">M</span>
      )}
    </div>
  );
}
