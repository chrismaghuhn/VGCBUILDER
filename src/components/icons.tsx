/**
 * Pixel-art icons drawn from small grids ('#' = pixel), so they match the pixel-art portraits.
 * They use currentColor and render with crisp edges at whole-pixel scales.
 */

// 7×8 grid: narrow shackle with rounded corners above a wider body with a centered keyhole.
const LOCK_BODY = [
  '#######',
  '###.###',
  '###.###',
  '#######',
  '#######',
];
const LOCK_CLOSED = [
  '..###..',
  '.#...#.',
  '.#...#.',
  ...LOCK_BODY,
];
// Right leg of the shackle out of the body.
const LOCK_OPEN = [
  '..###..',
  '.#...#.',
  '.#.....',
  ...LOCK_BODY,
];

function PixelIcon({grid, scale, className = '', title}: {grid: string[]; scale: number; className?: string; title?: string}) {
  const w = grid[0].length;
  const h = grid.length;
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {grid.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}

export function PixelLock({open = false, scale = 2, className, title}: {open?: boolean; scale?: number; className?: string; title?: string}) {
  return <PixelIcon grid={open ? LOCK_OPEN : LOCK_CLOSED} scale={scale} className={className} title={title} />;
}
