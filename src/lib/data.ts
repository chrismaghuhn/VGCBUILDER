import formatJson from '../data/generated/format.json';
import itemsJson from '../data/generated/items.json';
import movesJson from '../data/generated/moves.json';
import speciesJson from '../data/generated/species.json';

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatID = (typeof STATS)[number];
export type StatTable = Record<StatID, number>;
export const STAT_LABEL: Record<StatID, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

/** Champions stat points: at most 32 in one stat, 66 in total. */
export const SP_MAX = 32;
export const SP_TOTAL = 66;

export interface SpeciesData {
  id: string;
  calcName?: string;
  num: number;
  types: string[];
  bs: StatTable;
  weight: number;
  abilities: string[];
  base: string;
  mega?: boolean;
  megaOf?: string;
  requiredItem?: string;
  moves: string[];
  portrait?: boolean;
}

export interface MoveData {
  type: string;
  cat: 'Physical' | 'Special' | 'Status';
  bp: number;
  target: string;
  prio?: number;
  flags?: string[];
  multihit?: number | number[];
}

export interface ItemData {
  name: string;
  mega?: string;
  megaBase?: string;
}

export type Weighted = [string, number][];

export interface UsageMon {
  usage: number;
  lead: number;
  abilities: Weighted;
  items: Weighted;
  spreads: Weighted;
  moves: Weighted;
  teammates: Weighted;
  counters: Weighted;
}

export interface UsageSource {
  label: string;
  month: string;
  battles: number;
  metagame: Record<string, number>;
  mons: Record<string, UsageMon>;
}

export const FORMAT = formatJson as {
  id: string; name: string; game: string; period: string; month: string;
  sources: {key: string; label: string}[]; builtAt: string;
};
export const SPECIES = speciesJson as unknown as Record<string, SpeciesData>;
export const MOVES = movesJson as unknown as Record<string, MoveData>;
export const ITEMS = itemsJson as ItemData[];

// Usage stats come one file per source (≈150–400 kB each) and are loaded when first needed.
const usageFiles = import.meta.glob<{default: unknown}>('../data/generated/usage-*.json');
const usageCache = new Map<string, Promise<UsageSource>>();

/** The usage stats of one source (falls back to the first source for unknown keys). */
export function loadUsage(key: string): Promise<UsageSource> {
  const k = FORMAT.sources.some(s => s.key === key) ? key : FORMAT.sources[0].key;
  let p = usageCache.get(k);
  if (!p) {
    const file = usageFiles[`../data/generated/usage-${k}.json`];
    if (!file) return Promise.reject(new Error(`No usage data for ${k}`));
    p = file().then(m => m.default as UsageSource);
    // A failed load (offline) may be retried later.
    p.catch(() => usageCache.delete(k));
    usageCache.set(k, p);
  }
  return p;
}

export const ITEM_NAMES = ITEMS.map(i => i.name).sort();
const ITEM_BY_NAME = new Map(ITEMS.map(i => [i.name, i]));
export const getItem = (name?: string) => (name ? ITEM_BY_NAME.get(name) : undefined);

export const NATURES: Record<string, [StatID | null, StatID | null]> = {
  Hardy: [null, null], Lonely: ['atk', 'def'], Brave: ['atk', 'spe'], Adamant: ['atk', 'spa'],
  Naughty: ['atk', 'spd'], Bold: ['def', 'atk'], Docile: [null, null], Relaxed: ['def', 'spe'],
  Impish: ['def', 'spa'], Lax: ['def', 'spd'], Timid: ['spe', 'atk'], Hasty: ['spe', 'def'],
  Serious: [null, null], Jolly: ['spe', 'spa'], Naive: ['spe', 'spd'], Modest: ['spa', 'atk'],
  Mild: ['spa', 'def'], Quiet: ['spa', 'spe'], Bashful: [null, null], Rash: ['spa', 'spd'],
  Calm: ['spd', 'atk'], Gentle: ['spd', 'def'], Sassy: ['spd', 'spe'], Careful: ['spd', 'spa'],
  Quirky: [null, null],
};
export const NATURE_NAMES = Object.keys(NATURES);

export const TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

export const TYPE_COLOR: Record<string, string> = {
  Normal: '#9fa19f', Fire: '#e8613a', Water: '#3d8fe0', Electric: '#f2c230', Grass: '#4fae4a',
  Ice: '#5ccfe6', Fighting: '#d0632c', Poison: '#9a4fc7', Ground: '#a7733a', Flying: '#86a8e8',
  Psychic: '#ec5c87', Bug: '#97a41f', Rock: '#b5a771', Ghost: '#6a4b8f', Dragon: '#5465dd',
  Dark: '#5a4a45', Steel: '#5e9bb3', Fairy: '#e590e5',
};

/** Species that can be chosen in the builder (Megas are reached via their stone). */
export const PICKABLE_SPECIES = Object.keys(SPECIES).filter(n => !SPECIES[n].mega).sort();

export const getSpecies = (name?: string) => (name ? SPECIES[name] : undefined);

/** The Mega forme a species turns into with the given item, if any. */
export function megaForme(species: string, item?: string): string | undefined {
  const it = getItem(item);
  if (!it?.mega) return undefined;
  const mega = SPECIES[it.mega];
  if (!mega) return undefined;
  return mega.megaOf === species || (mega.megaOf === undefined && mega.base === species) ? it.mega : undefined;
}

export function portraitUrl(name: string): string {
  const sp = SPECIES[name];
  if (sp?.portrait) return `/portraits/${sp.id}.png`;
  const id = (sp?.id ?? name).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/home-centered/${id}.png`;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
