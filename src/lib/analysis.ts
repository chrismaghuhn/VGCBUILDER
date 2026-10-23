import {Generations} from '@smogon/calc';
import {MOVES, SPECIES, TYPES, type UsageSource} from './data';
import {battleForme, parseSpread, calcStat, setStats, type PokemonSet} from './team';

const GEN = Generations.get(0);

export function typeEffect(attack: string, defTypes: string[]): number {
  const t = GEN.types.get(attack.toLowerCase() as never);
  if (!t) return 1;
  return defTypes.reduce((m, d) => m * ((t.effectiveness as Record<string, number>)[d] ?? 1), 1);
}

/** Ability-aware incoming multiplier. */
const ABILITY_DEF: Record<string, (type: string) => number | undefined> = {
  Levitate: t => (t === 'Ground' ? 0 : undefined),
  'Earth Eater': t => (t === 'Ground' ? 0 : undefined),
  'Flash Fire': t => (t === 'Fire' ? 0 : undefined),
  'Well-Baked Body': t => (t === 'Fire' ? 0 : undefined),
  'Water Absorb': t => (t === 'Water' ? 0 : undefined),
  'Storm Drain': t => (t === 'Water' ? 0 : undefined),
  'Dry Skin': t => (t === 'Water' ? 0 : t === 'Fire' ? 1.25 : undefined),
  'Volt Absorb': t => (t === 'Electric' ? 0 : undefined),
  'Lightning Rod': t => (t === 'Electric' ? 0 : undefined),
  'Motor Drive': t => (t === 'Electric' ? 0 : undefined),
  'Sap Sipper': t => (t === 'Grass' ? 0 : undefined),
  'Thick Fat': t => (t === 'Fire' || t === 'Ice' ? 0.5 : undefined),
  Heatproof: t => (t === 'Fire' ? 0.5 : undefined),
  'Water Bubble': t => (t === 'Fire' ? 0.5 : undefined),
  'Purifying Salt': t => (t === 'Ghost' ? 0.5 : undefined),
  Fluffy: t => (t === 'Fire' ? 2 : undefined),
  'Wind Rider': () => undefined,
};

export function defensiveMult(set: PokemonSet, attack: string): number {
  const forme = SPECIES[battleForme(set)];
  if (!forme) return 1;
  let m = typeEffect(attack, forme.types);
  const ability = forme.mega ? forme.abilities[0] : set.ability;
  const mod = ABILITY_DEF[ability]?.(attack);
  if (mod !== undefined) m = mod === 0 ? 0 : m * mod;
  if (set.item === 'Air Balloon' && attack === 'Ground') m = 0;
  if (m > 1 && ['Filter', 'Solid Rock', 'Prism Armor'].includes(ability)) m *= 0.75;
  return m;
}

export interface TypeRow {
  type: string;
  mults: number[];
  weak: number;
  resist: number;
  immune: number;
  score: number; // negative = problem
}

export function defensiveMatrix(sets: PokemonSet[]): TypeRow[] {
  return TYPES.map(type => {
    const mults = sets.map(s => defensiveMult(s, type));
    const weak = mults.filter(m => m > 1).length;
    const resist = mults.filter(m => m > 0 && m < 1).length;
    const immune = mults.filter(m => m === 0).length;
    const score = resist + immune * 1.25 - weak - mults.filter(m => m >= 4).length * 0.5;
    return {type, mults, weak, resist, immune, score};
  });
}

export function damagingMoves(set: PokemonSet) {
  return set.moves.filter(m => MOVES[m] && MOVES[m].cat !== 'Status' && MOVES[m].bp > 0);
}

/** Effective attacking type of a move given the user's ability (e.g. -ate abilities). */
export function moveType(set: PokemonSet, move: string): string {
  const mv = MOVES[move];
  const forme = SPECIES[battleForme(set)];
  const ability = forme?.mega ? forme.abilities[0] : set.ability;
  if (mv.type === 'Normal') {
    const ate: Record<string, string> = {Aerilate: 'Flying', Pixilate: 'Fairy', Refrigerate: 'Ice', Galvanize: 'Electric', Dragonize: 'Dragon'};
    if (ate[ability]) return ate[ability];
  }
  if (ability === 'Liquid Voice' && mv.flags?.includes('sound')) return 'Water';
  return mv.type;
}

export interface CoverageRow {
  type: string;
  best: number;
  hitters: string[]; // species that hit it super effectively
}

/** Offensive coverage against each single type. */
export function offensiveCoverage(sets: PokemonSet[]): CoverageRow[] {
  return TYPES.map(def => {
    let best = 0;
    const hitters: string[] = [];
    for (const s of sets) {
      let mine = 0;
      for (const m of damagingMoves(s)) mine = Math.max(mine, typeEffect(moveType(s, m), [def]));
      if (mine > 1) hitters.push(s.species);
      best = Math.max(best, mine);
    }
    return {type: def, best, hitters};
  });
}

// ---------------------------------------------------------------- Roles

interface RoleDef {
  key: string;
  label: string;
  hint: string;
  moves?: string[];
  abilities?: string[];
  items?: string[];
  important?: boolean;
}

export const ROLES: RoleDef[] = [
  {key: 'fakeout', label: 'Fake Out', hint: 'Freie Züge, stört Setup und Trick Room.', moves: ['Fake Out'], important: true},
  {key: 'speed', label: 'Speed Control', hint: 'Tailwind, Trick Room, Icy Wind, Electroweb, Thunder Wave …', moves: ['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave', 'Scary Face', 'Bulldoze', 'Rock Tomb', 'Nuzzle', 'Glare', 'String Shot', 'Low Sweep'], important: true},
  {key: 'redirect', label: 'Redirection', hint: 'Follow Me / Rage Powder schützt Setup-Mons.', moves: ['Follow Me', 'Rage Powder'], abilities: ['Lightning Rod', 'Storm Drain']},
  {key: 'intimidate', label: 'Atk-Drop', hint: 'Schwächt physische Angreifer.', abilities: ['Intimidate'], moves: ['Parting Shot', 'Charm', 'Feather Dance', 'Lunge', 'Breaking Swipe', 'Noble Roar', 'Tickle', 'Play Nice'], important: true},
  {key: 'spadrop', label: 'SpA-Drop', hint: 'Snarl, Eerie Impulse: schwächt spezielle Angreifer.', moves: ['Snarl', 'Eerie Impulse', 'Parting Shot', 'Noble Roar', 'Confide', 'Mystical Fire', 'Spirit Break', 'Struggle Bug', 'Skitter Smack']},
  {key: 'protect', label: 'Protect', hint: 'Mind. 4 Mons mit Protect/Detect sind Standard.', moves: ['Protect', 'Detect', 'Spiky Shield', "King's Shield", 'Baneful Bunker', 'Silk Trap', 'Burning Bulwark', 'Obstruct']},
  {key: 'spread', label: 'Spread-Damage', hint: 'Trifft beide Gegner.'},
  {key: 'priority', label: 'Priority', hint: 'Sucker Punch, Extreme Speed, Grassy Glide …'},
  {key: 'weather', label: 'Wetter / Terrain', hint: 'Setzt Sonne, Regen, Sand, Schnee oder Terrain.', abilities: ['Drought', 'Drizzle', 'Sand Stream', 'Snow Warning', 'Grassy Surge', 'Psychic Surge', 'Electric Surge', 'Misty Surge', 'Orichalcum Pulse', 'Hadron Engine', 'Mega Sol'], moves: ['Sunny Day', 'Rain Dance', 'Sandstorm', 'Snowscape']},
  {key: 'guard', label: 'Wide/Quick Guard', hint: 'Blockt Spread-Moves bzw. Priority.', moves: ['Wide Guard', 'Quick Guard']},
  {key: 'support', label: 'Support', hint: 'Helping Hand, Screens, Taunt, Encore, Will-O-Wisp …', moves: ['Helping Hand', 'Reflect', 'Light Screen', 'Aurora Veil', 'Taunt', 'Encore', 'Will-O-Wisp', 'Spore', 'Sleep Powder', 'Yawn', 'Disable', 'Imprison', 'Coaching', 'Decorate', 'Life Dew', 'Pollen Puff', 'Heal Pulse', 'Instruct', 'After You', 'Beat Up']},
];

export function roleCoverage(sets: PokemonSet[]): {role: RoleDef; members: string[]}[] {
  return ROLES.map(role => {
    const members = sets.filter(s => {
      const forme = SPECIES[battleForme(s)];
      const ability = forme?.mega ? forme.abilities[0] : s.ability;
      if (role.key === 'spread')
        return damagingMoves(s).some(m => ['allAdjacentFoes', 'allAdjacent'].includes(MOVES[m].target));
      if (role.key === 'priority')
        return damagingMoves(s).some(m => (MOVES[m].prio ?? 0) > 0 && m !== 'Fake Out') || s.moves.includes('Grassy Glide');
      return s.moves.some(m => role.moves?.includes(m)) || role.abilities?.includes(ability) || role.abilities?.includes(s.ability);
    });
    return {role, members: members.map(m => m.species)};
  });
}

// ---------------------------------------------------------------- Speed

export type Weather = '' | 'Rain' | 'Sun' | 'Sand' | 'Snow';
export const WEATHER_LABEL: Record<Weather, string> = {'': 'Kein Wetter', Rain: 'Regen', Sun: 'Sonne', Sand: 'Sand', Snow: 'Schnee'};

export interface SpeedField {
  weather: Weather;
  electricTerrain?: boolean;
  /** Tailwind on my side only. */
  tailwind?: boolean;
}

const WEATHER_SETTERS: Record<string, Weather> = {Drizzle: 'Rain', Drought: 'Sun', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow'};
const SPEED_WEATHER: Record<string, Weather> = {'Swift Swim': 'Rain', Chlorophyll: 'Sun', 'Sand Rush': 'Sand', 'Slush Rush': 'Snow'};
/** Situational speed abilities: shown as a note, not applied. */
const SPEED_NOTES: Record<string, string> = {Unburden: 'Unburden ×2 nach Item', 'Speed Boost': 'Speed Boost +1/Runde', 'Quick Feet': 'Quick Feet ×1.5 mit Status'};

const abilityOf = (set: PokemonSet) => {
  const forme = SPECIES[battleForme(set)];
  return forme?.mega ? forme.abilities[0] : set.ability;
};

/** Weather and terrain my team sets up on its own. */
export function teamField(sets: PokemonSet[]): {weather: Weather; electricTerrain: boolean} {
  let weather: Weather = '';
  let electricTerrain = false;
  for (const s of sets) {
    const a = abilityOf(s);
    if (!weather && WEATHER_SETTERS[a]) weather = WEATHER_SETTERS[a];
    if (a === 'Electric Surge') electricTerrain = true;
  }
  return {weather, electricTerrain};
}

/** Share of teams above which a teammate's weather counts as the threat's own. */
const TEAM_WEATHER_SHARE = 0.5;

export interface EnemyWeather {
  weather: Weather;
  /** The setter: the threat itself or its usual teammate. */
  source: string;
  share: number;
}

const mainAbility = (name: string, usage: UsageSource): string | undefined => {
  const sp = SPECIES[name];
  if (!sp) return undefined;
  if (sp.mega) return sp.abilities[0];
  const top = usage.mons[name]?.abilities[0];
  return top && top[1] >= 0.5 ? top[0] : undefined;
};

/** Weather a meta Pokémon usually plays under: its own setter ability, else a common setter teammate. */
export function metaWeather(name: string, usage: UsageSource): EnemyWeather | null {
  const own = WEATHER_SETTERS[mainAbility(name, usage) ?? ''];
  if (own) return {weather: own, source: name, share: 1};
  let best: EnemyWeather | null = null;
  for (const [mate, share] of usage.mons[name]?.teammates ?? []) {
    const w = WEATHER_SETTERS[mainAbility(mate, usage) ?? ''];
    if (w && share >= TEAM_WEATHER_SHARE && (!best || share > best.share)) best = {weather: w, source: mate, share};
  }
  return best;
}

/** Multiplier from ability + field, and a short label for it. */
function abilitySpeedMod(ability: string, field: SpeedField): {mult: number; label?: string} {
  const w = SPEED_WEATHER[ability];
  if (w && field.weather === w) return {mult: 2, label: `${ability} ×2`};
  if (ability === 'Surge Surfer' && field.electricTerrain) return {mult: 2, label: 'Surge Surfer ×2'};
  return {mult: 1};
}

export function effectiveSpeed(set: PokemonSet, field: SpeedField, mine = false): {speed: number; labels: string[]} {
  let spe = setStats(set).spe;
  const labels: string[] = [];
  const ability = abilityOf(set);
  const mod = abilitySpeedMod(ability, field);
  if (mod.label) labels.push(mod.label);
  spe = Math.floor(spe * mod.mult);
  if (set.item === 'Choice Scarf') { spe = Math.floor(spe * 1.5); labels.push('Scarf'); }
  if (mine && field.tailwind) { spe *= 2; labels.push('Tailwind'); }
  return {speed: spe, labels};
}

export interface SpeedEntry {
  name: string;
  speed: number;
  mine: boolean;
  /** Applied boosts (ability in weather, Scarf, Tailwind). */
  boosts: string[];
  note: string;
  usage?: number;
}

/** Speed of each top meta Pokémon with its most common spread and ability. */
export function metaSpeeds(usage: UsageSource, limit: number, field: SpeedField, enemyWeather = false): SpeedEntry[] {
  const out: SpeedEntry[] = [];
  const ranked = Object.entries(usage.mons).sort((a, b) => b[1].usage - a[1].usage).slice(0, limit);
  for (const [name, u] of ranked) {
    const sp = SPECIES[name];
    if (!sp || !u.spreads.length) continue;
    const speeds = u.spreads.slice(0, 5).map(([s]) => {
      const {nature, sps} = parseSpread(s);
      return calcStat(sp.bs.spe, 'spe', sps.spe, nature);
    });
    const ability = sp.mega ? sp.abilities[0] : u.abilities[0]?.[0] ?? sp.abilities[0];
    const own = enemyWeather ? metaWeather(name, usage) : null;
    const weather = own?.weather ?? field.weather;
    const mod = abilitySpeedMod(ability, {weather, electricTerrain: field.electricTerrain});
    const top = Math.floor(speeds[0] * mod.mult);
    const max = Math.floor(Math.max(...speeds) * mod.mult);
    const notes: string[] = [];
    if (max !== top) notes.push(`bis ${max}`);
    const scarf = u.items.find(([i]) => i === 'Choice Scarf');
    if (scarf && scarf[1] > 0.1) notes.push(`Scarf ${pct(scarf[1])}: ${Math.floor(top * 1.5)}`);
    // A speed ability that is not the main one, or whose weather is not up right now.
    for (const [a, p] of u.abilities) {
      const w = SPEED_WEATHER[a];
      if (w && (weather !== w || a !== ability) && p > 0.15) notes.push(`${a} ${pct(p)}: ${Math.floor(speeds[0] * 2)} in ${WEATHER_LABEL[w]}`);
      if (SPEED_NOTES[a] && p > 0.15) notes.push(SPEED_NOTES[a]);
    }
    if (own && mod.label) notes.unshift(`${WEATHER_LABEL[own.weather]} von ${own.source === name ? 'sich selbst' : own.source}`);
    out.push({name, speed: top, mine: false, usage: u.usage, boosts: mod.label ? [mod.label] : [], note: notes.join(' · ')});
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function teamSpeeds(sets: PokemonSet[], field: SpeedField): SpeedEntry[] {
  return sets.map(s => {
    const {speed, labels} = effectiveSpeed(s, field, true);
    const notes: string[] = [];
    const ability = abilityOf(s);
    const w = SPEED_WEATHER[ability];
    if (w && field.weather !== w) notes.push(`${WEATHER_LABEL[w]}: ${speed * 2}`);
    if (SPEED_NOTES[ability]) notes.push(SPEED_NOTES[ability]);
    if (!field.tailwind) notes.push(`Tailwind ${speed * 2}`);
    return {name: battleForme(s), speed, mine: true, boosts: labels, note: notes.join(' · ')};
  });
}
