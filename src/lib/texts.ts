import {useEffect, useState} from 'react';

/** Short descriptions of moves, items and abilities (Showdown's text), loaded on first use. */
export type Texts = Record<'moves' | 'items' | 'abilities', Record<string, string>>;
export type TextKind = keyof Texts;

let cache: Texts | null = null;
let pending: Promise<Texts> | null = null;

export function loadTexts(): Promise<Texts> {
  if (cache) return Promise.resolve(cache);
  pending ??= import('../data/generated/texts.json').then(m => (cache = m.default as Texts)).catch(e => {
    pending = null;
    throw e;
  });
  return pending;
}

/** The description of one move, item or ability; '' while loading or when there is none. */
export function useText(kind: TextKind, name: string | undefined, enabled = true): string {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (enabled && !cache) loadTexts().then(() => rerender(n => n + 1), () => {});
  }, [enabled]);
  return (name && cache?.[kind][name]) || '';
}
