import type {Match} from './matches';
import type {ReplayMat} from './replay';
import {
  ITEM_NAMES, MOVES, NATURES, SP_MAX, SP_TOTAL, SPECIES, STAT_LABEL, STATS,
  getItem, getSpecies, megaForme, type StatID, type StatTable, type UsageSource,
} from './data';

export interface PokemonSet {
  species: string;
  item: string;
  ability: string;
  nature: string;
  sps: StatTable;
  moves: string[];
  /** Stats whose SP the planning tabs must not change. */
  locked?: StatID[];
  /** On the Playmat: holds its Mega Stone but hasn't Mega Evolved (yet). */
  unevolved?: boolean;
}

export interface Team {
  id: string;
  name: string;
  sets: PokemonSet[];
  /** Pokémon the user hid from teammate suggestions. */
  hidden?: string[];
  /** Leave Mega Evolutions out of teammate suggestions. */
  noMegas?: boolean;
  /** The Playmat: opponent, board state and notes. */
  playmat?: Playmat;
  /** Played games (match log). */
  matches?: Match[];
}

export type MatSide = 'mine' | 'theirs';

export interface MatField {
  weather: '' | 'Rain' | 'Sun' | 'Sand' | 'Snow';
  terrain: '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  trickRoom: boolean;
  tailwind: Record<MatSide, boolean>;
  reflect: Record<MatSide, boolean>;
  lightScreen: Record<MatSide, boolean>;
}

export interface MatNote {
  id: string;
  /** Position on the board in % of its size. */
  x: number;
  y: number;
  text: string;
  color: 'gold' | 'blue' | 'red' | 'green';
}

export interface Playmat {
  name: string;
  opp: PokemonSet[];
  /** Who stands on the two battle spots per side (index into my team / opp, null = empty). */
  mine: [number | null, number | null];
  theirs: [number | null, number | null];
  /** My four brought Pokémon. */
  brought: number[];
  /** HP in % and stat stages per Pokémon, keyed "m0".."m5" / "t0".."t5". */
  hp: Record<string, number>;
  boosts: Record<string, Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>>;
  field: MatField;
  notes: MatNote[];
  /** Planned move per Pokémon on the field (keyed like hp) and whom it hits. */
  actions?: Record<string, MatAction>;
  /** Which Pokémon have Mega Evolved, keyed like hp (missing on older mats: every stone holder has). */
  megas?: Record<string, boolean>;
  /** Set when the mat plays back a Showdown replay. */
  replay?: ReplayMat;
}

export interface MatAction {
  move: string;
  /** Fighter keys it hits; empty = not aimed yet (or a move without a target). */
  targets: string[];
  /** What really happened per target, from a replay ("−34%", "KO", "Protect" …). */
  results?: Record<string, string>;
  /** Label position along the arrow (0-1) per target, when the player moved it. */
  labels?: Record<string, number>;
}

export const emptySps = (): StatTable => ({hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0});

/** Forme the set actually battles as (its Mega forme if it holds the stone). */
export const battleForme = (set: PokemonSet) => (set.unevolved ? undefined : megaForme(set.species, set.item)) ?? set.species;

export function calcStat(base: number, stat: StatID, sp: number, nature: string): number {
  if (stat === 'hp') return base === 1 ? 1 : base + sp + 75;
  const [plus, minus] = NATURES[nature] ?? [null, null];
  const mod = plus === stat && minus !== stat ? 1.1 : minus === stat && plus !== stat ? 0.9 : 1;
  return Math.floor(Math.floor(base + sp + 20) * mod);
}

export function setStats(set: PokemonSet, forme = battleForme(set)): StatTable {
  const sp = SPECIES[forme] ?? SPECIES[set.species];
  const out = {} as StatTable;
  for (const s of STATS) out[s] = sp ? calcStat(sp.bs[s], s, set.sps[s], set.nature) : 0;
  return out;
}

export function parseSpread(spread: string): {nature: string; sps: StatTable} {
  const [nature, nums] = spread.split(':');
  const v = nums.split('/').map(Number);
  const sps = emptySps();
  STATS.forEach((s, i) => (sps[s] = v[i] || 0));
  return {nature, sps};
}

/** Most common set for a species according to the usage stats. */
export function popularSet(species: string, usage: UsageSource, takenItems: string[] = []): PokemonSet {
  const sp = SPECIES[species];
  // Usage stats are recorded under the Mega forme when the stone is held.
  const megaStats = Object.keys(SPECIES)
    .filter(n => SPECIES[n].mega && SPECIES[n].megaOf === species)
    .map(n => [n, usage.mons[n]] as const)
    .filter(([, u]) => u)
    .sort((a, b) => b[1].usage - a[1].usage);
  const u = usage.mons[species] ?? megaStats[0]?.[1];
  const isMega = !usage.mons[species] && megaStats.length > 0;
  const firstLegal = (list: string[]) => list.find(i => !takenItems.includes(i));
  let item = '';
  if (isMega) item = SPECIES[megaStats[0][0]].requiredItem ?? '';
  else if (u) item = firstLegal(u.items.map(([i]) => i).filter(i => !getItem(i)?.mega)) ?? '';
  const spread = u?.spreads[0] ? parseSpread(u.spreads[0][0]) : {nature: 'Hardy', sps: emptySps()};
  const ability = (isMega ? undefined : u?.abilities[0]?.[0]) ?? sp?.abilities[0] ?? '';
  const moves = (u?.moves ?? []).map(([m]) => m).filter(m => sp?.moves.includes(m)).slice(0, 4);
  return {species, item, ability, nature: spread.nature, sps: spread.sps, moves};
}

export function blankSet(species: string): PokemonSet {
  const sp = SPECIES[species];
  return {species, item: '', ability: sp?.abilities[0] ?? '', nature: 'Hardy', sps: emptySps(), moves: []};
}

// ---------------------------------------------------------------- Legality

export interface Issue {
  slot?: number;
  level: 'error' | 'warn';
  text: string;
}

export function validateTeam(sets: PokemonSet[]): Issue[] {
  const issues: Issue[] = [];
  const seenSpecies = new Map<number, number>();
  const seenItems = new Map<string, number>();
  sets.forEach((set, slot) => {
    const sp = getSpecies(set.species);
    if (!sp) {
      issues.push({slot, level: 'error', text: `${set.species} is not legal in Reg M-C.`});
      return;
    }
    const dup = seenSpecies.get(sp.num);
    if (dup !== undefined) issues.push({slot, level: 'error', text: `Species Clause: ${set.species} duplicates slot ${dup + 1}.`});
    seenSpecies.set(sp.num, slot);
    if (set.item) {
      if (!ITEM_NAMES.includes(set.item)) issues.push({slot, level: 'error', text: `${set.item} is not legal in Reg M-C.`});
      const d = seenItems.get(set.item);
      if (d !== undefined) issues.push({slot, level: 'error', text: `Item Clause: ${set.item} duplicates slot ${d + 1}.`});
      seenItems.set(set.item, slot);
      const it = getItem(set.item);
      if (it?.mega && !megaForme(set.species, set.item))
        issues.push({slot, level: 'warn', text: `${set.item} does nothing on ${set.species}.`});
    } else {
      issues.push({slot, level: 'warn', text: `${set.species} has no item.`});
    }
    if (set.ability && !sp.abilities.includes(set.ability))
      issues.push({slot, level: 'error', text: `${set.species} can't have ${set.ability}.`});
    const total = STATS.reduce((a, s) => a + set.sps[s], 0);
    if (total > SP_TOTAL) issues.push({slot, level: 'error', text: `${set.species}: ${total}/${SP_TOTAL} Stat Points.`});
    else if (total < SP_TOTAL) issues.push({slot, level: 'warn', text: `${set.species}: ${SP_TOTAL - total} unused Stat Points.`});
    for (const s of STATS)
      if (set.sps[s] > SP_MAX) issues.push({slot, level: 'error', text: `${set.species}: ${STAT_LABEL[s]} above ${SP_MAX} SP.`});
    const moves = set.moves.filter(Boolean);
    if (moves.length < 4) issues.push({slot, level: 'warn', text: `${set.species} has only ${moves.length} move${moves.length === 1 ? '' : 's'}.`});
    if (new Set(moves).size !== moves.length) issues.push({slot, level: 'error', text: `${set.species} has a duplicate move.`});
    for (const m of moves)
      if (!MOVES[m] || !sp.moves.includes(m)) issues.push({slot, level: 'error', text: `${set.species} can't learn ${m}.`});
  });
  if (sets.length < 6) issues.push({level: 'warn', text: `Team has ${sets.length}/6 Pokémon.`});
  return issues;
}

// ---------------------------------------------------------------- Showdown paste

const STAT_FROM_LABEL: Record<string, StatID> = {hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe'};

export function exportSet(set: PokemonSet): string {
  const lines = [`${set.species}${set.item ? ` @ ${set.item}` : ''}`];
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  lines.push('Level: 50');
  const sps = STATS.filter(s => set.sps[s]).map(s => `${set.sps[s]} ${STAT_LABEL[s]}`);
  if (sps.length) lines.push(`EVs: ${sps.join(' / ')}`);
  lines.push(`${set.nature} Nature`);
  for (const m of set.moves.filter(Boolean)) lines.push(`- ${m}`);
  return lines.join('\n');
}

export const exportTeam = (sets: PokemonSet[]) => sets.map(exportSet).join('\n\n') + '\n';

const findName = (name: string, list: string[]) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return list.find(n => n.toLowerCase().replace(/[^a-z0-9]/g, '') === id);
};

export function importTeam(text: string): {sets: PokemonSet[]; warnings: string[]} {
  const sets: PokemonSet[] = [];
  const warnings: string[] = [];
  const allSpecies = Object.keys(SPECIES);
  for (const block of text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)) {
    const lines = block.split('\n').map(l => l.trim());
    const head = lines[0].match(/^(.*?)(?:\s+\((M|F)\))?(?:\s+@\s+(.*))?$/);
    if (!head) continue;
    let rawName = head[1].trim();
    // "Nickname (Species)"
    const nick = rawName.match(/\(([^)]+)\)$/);
    if (nick) rawName = nick[1];
    let species = findName(rawName, allSpecies) ?? rawName;
    // Pasted Mega formes go back to their base forme.
    if (SPECIES[species]?.mega) species = SPECIES[species].megaOf ?? SPECIES[species].base;
    if (!SPECIES[species]) warnings.push(`${rawName}: not legal in Reg M-C`);
    const set = blankSet(species);
    set.ability = '';
    if (head[3]) set.item = findName(head[3].trim(), ITEM_NAMES) ?? head[3].trim();
    for (const line of lines.slice(1)) {
      if (line.startsWith('Ability:')) set.ability = line.slice(8).trim();
      else if (/^EVs:/.test(line)) {
        const parts = line.slice(4).split('/').map(p => p.trim().match(/^(\d+)\s+(\w+)/)).filter(m => m !== null);
        // Champions pastes give stat points directly; classic EV spreads (any value > 32) get converted.
        const evMode = parts.some(m => +m[1] > SP_MAX);
        let left = SP_TOTAL;
        for (const m of parts) {
          const stat = STAT_FROM_LABEL[m[2].toLowerCase()];
          if (!stat) continue;
          const v = evMode ? (+m[1] >= 252 ? SP_MAX : Math.floor(+m[1] / 8)) : +m[1];
          set.sps[stat] = evMode ? Math.min(v, left) : v;
          left -= set.sps[stat];
        }
      } else if (/Nature$/.test(line)) set.nature = line.replace(/\s*Nature$/, '').trim();
      else if (line.startsWith('-')) {
        const mv = line.slice(1).trim().replace(/^Hidden Power .*/, 'Hidden Power');
        set.moves.push(findName(mv, Object.keys(MOVES)) ?? mv);
      }
    }
    if (!set.ability) set.ability = SPECIES[species]?.abilities[0] ?? '';
    set.moves = set.moves.slice(0, 4);
    sets.push(set);
  }
  return {sets: sets.slice(0, 6), warnings};
}
