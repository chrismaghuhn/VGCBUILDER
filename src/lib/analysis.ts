import typesJson from '../data/generated/types.json';
import {MOVES, SPECIES, TYPES, type UsageSource} from './data';
import {battleForme, parseSpread, calcStat, setStats, type PokemonSet} from './team';
import {metaSet} from './meta';

/** Attacking type → defending type → multiplier (only entries that aren't 1×); built from the calc's Champions data. */
const TYPE_CHART = typesJson as Record<string, Record<string, number>>;

export function typeEffect(attack: string, defTypes: string[]): number {
  const t = TYPE_CHART[attack];
  if (!t) return 1;
  return defTypes.reduce((m, d) => m * (t[d] ?? 1), 1);
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
  {key: 'fakeout', label: 'Fake Out', hint: 'Free turns; disrupts setup and Trick Room.', moves: ['Fake Out'], important: true},
  {key: 'speed', label: 'Speed Control', hint: 'Tailwind, Trick Room, Icy Wind, Electroweb, Thunder Wave …', moves: ['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave', 'Scary Face', 'Bulldoze', 'Rock Tomb', 'Nuzzle', 'Glare', 'String Shot', 'Low Sweep'], important: true},
  {key: 'redirect', label: 'Redirection', hint: 'Follow Me / Rage Powder protect setup partners.', moves: ['Follow Me', 'Rage Powder'], abilities: ['Lightning Rod', 'Storm Drain']},
  {key: 'intimidate', label: 'Atk-Drop', hint: 'Weakens physical attackers.', abilities: ['Intimidate'], moves: ['Parting Shot', 'Charm', 'Feather Dance', 'Lunge', 'Breaking Swipe', 'Noble Roar', 'Tickle', 'Play Nice'], important: true},
  {key: 'spadrop', label: 'SpA-Drop', hint: 'Snarl, Eerie Impulse: weakens special attackers.', moves: ['Snarl', 'Eerie Impulse', 'Parting Shot', 'Noble Roar', 'Confide', 'Mystical Fire', 'Spirit Break', 'Struggle Bug', 'Skitter Smack']},
  {key: 'protect', label: 'Protect', hint: 'At least 4 Protect users is standard.', moves: ['Protect', 'Detect', 'Spiky Shield', "King's Shield", 'Baneful Bunker', 'Silk Trap', 'Burning Bulwark', 'Obstruct']},
  {key: 'spread', label: 'Spread Damage', hint: 'Hits both opponents.'},
  {key: 'priority', label: 'Priority', hint: 'Sucker Punch, Extreme Speed, Grassy Glide …'},
  {key: 'weather', label: 'Weather / Terrain', hint: 'Sets sun, rain, sand, snow or terrain.', abilities: ['Drought', 'Drizzle', 'Sand Stream', 'Snow Warning', 'Grassy Surge', 'Psychic Surge', 'Electric Surge', 'Misty Surge', 'Orichalcum Pulse', 'Hadron Engine', 'Mega Sol'], moves: ['Sunny Day', 'Rain Dance', 'Sandstorm', 'Snowscape']},
  {key: 'guard', label: 'Wide/Quick Guard', hint: 'Blocks spread moves or priority.', moves: ['Wide Guard', 'Quick Guard']},
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
export const WEATHER_LABEL: Record<Weather, string> = {'': 'No weather', Rain: 'Rain', Sun: 'Sun', Sand: 'Sand', Snow: 'Snow'};

export interface SpeedField {
  weather: Weather;
  electricTerrain?: boolean;
  /** Tailwind on my side. */
  tailwind?: boolean;
  /** Tailwind on the opponents' side. */
  enemyTailwind?: boolean;
  /** Speed stages (-6..+6), e.g. -1 after Icy Wind. */
  myStage?: number;
  enemyStage?: number;
  myPara?: boolean;
  enemyPara?: boolean;
}

/** Stat stage multiplier: +1 = 1.5×, -1 = 2/3×. */
export const stageMult = (n: number) => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));

/** Stages, Tailwind and paralysis on top of a speed value (in battle order). */
function sideMods(spe: number, field: SpeedField, mine: boolean, labels: string[]): number {
  const stage = (mine ? field.myStage : field.enemyStage) ?? 0;
  if (stage) { spe = Math.floor(spe * stageMult(stage)); labels.push(`${stage > 0 ? '+' : ''}${stage}`); }
  if (mine ? field.tailwind : field.enemyTailwind) { spe *= 2; labels.push('Tailwind'); }
  if (mine ? field.myPara : field.enemyPara) { spe = Math.floor(spe / 2); labels.push('Para'); }
  return spe;
}

const WEATHER_SETTERS: Record<string, Weather> = {Drizzle: 'Rain', Drought: 'Sun', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow'};
const SPEED_WEATHER: Record<string, Weather> = {'Swift Swim': 'Rain', Chlorophyll: 'Sun', 'Sand Rush': 'Sand', 'Slush Rush': 'Snow'};
/** Situational speed abilities: shown as a note, not applied. */
const SPEED_NOTES: Record<string, string> = {Unburden: 'Unburden ×2 after item', 'Speed Boost': 'Speed Boost +1/turn', 'Quick Feet': 'Quick Feet ×1.5 when statused'};

export const abilityOf = (set: PokemonSet) => {
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
  /** The setter's set when it's known (an opponent's team sheet). */
  set?: PokemonSet;
  /** Realistic weather war: who wins and why. */
  why?: string;
  /** Realistic weather war: my weather stays. */
  kept?: boolean;
}

/** Off: my weather; worst case: theirs always wins; realistic: the setter that acts last wins. */
export type EnemyMode = 'off' | 'worst' | 'realistic';

interface Setter {weather: Weather; name: string; speed: number; mega: boolean}

const setterOf = (set: PokemonSet, weather: Weather): Setter => {
  const forme = battleForme(set);
  return {weather, name: forme, speed: setStats(set, forme).spe, mega: !!SPECIES[forme]?.mega};
};

/** My team's first weather setter. */
function mySetter(sets: PokemonSet[]): Setter | null {
  for (const s of sets) {
    const w = WEATHER_SETTERS[abilityOf(s)];
    if (w) return setterOf(s, w);
  }
  return null;
}

/**
 * The weather a threat plays under against my team, or null when nothing changes.
 * Realistic: switch-in abilities trigger fastest first, so the slower lead setter's weather stays;
 * a Mega setter sets its weather when it Mega Evolves at the start of the turn, after all switch-ins.
 * A speed tie counts as their win (worst case).
 */
export function warWeather(theirs: EnemyWeather | null, mode: EnemyMode, mySets: PokemonSet[], usage?: UsageSource): EnemyWeather | null {
  if (mode === 'off' || !theirs) return null;
  if (mode === 'worst') return theirs;
  const mine = mySetter(mySets);
  if (!mine || mine.weather === theirs.weather) return theirs;
  const theirSet = theirs.set ?? (usage && SPECIES[theirs.source] ? metaSet(theirs.source, usage) : undefined);
  if (!theirSet) return theirs;
  const them = setterOf(theirSet, theirs.weather);
  const name = (x: Setter) => `${x.name} (${x.speed})`;
  let mineWins: boolean, why: string;
  if (mine.mega !== them.mega) {
    mineWins = mine.mega;
    const m = mine.mega ? mine : them;
    why = `${m.name} Mega Evolves after the switch-ins, so its ${m.weather.toLowerCase()} comes last`;
  } else if (mine.speed === them.speed) {
    mineWins = false;
    why = `Speed tie ${name(mine)} vs ${name(them)}: counted as theirs`;
  } else {
    mineWins = mine.speed < them.speed;
    const slow = mineWins ? mine : them, fast = mineWins ? them : mine;
    why = `${name(slow)} is slower than ${name(fast)}, so its ${slow.weather.toLowerCase()} comes last`;
  }
  return mineWins
    ? {weather: mine.weather, source: mine.name, share: 1, why: `${mine.weather} stays: ${why}`, kept: true}
    : {...theirs, why: `${theirs.weather}: ${why}`};
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

/** Weather an opponent team sets up itself (its first setter), for every one of its Pokémon. */
export function oppWeather(opp: PokemonSet[]): EnemyWeather | null {
  for (const s of opp) {
    const w = WEATHER_SETTERS[abilityOf(s)];
    if (w) return {weather: w, source: battleForme(s), share: 1, set: s};
  }
  return null;
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
  const stage = (mine ? field.myStage : field.enemyStage) ?? 0;
  if (stage) { spe = Math.floor(spe * stageMult(stage)); labels.push(`${stage > 0 ? '+' : ''}${stage}`); }
  const ability = abilityOf(set);
  const mod = abilitySpeedMod(ability, field);
  if (mod.label) labels.push(mod.label);
  spe = Math.floor(spe * mod.mult);
  if (set.item === 'Choice Scarf') { spe = Math.floor(spe * 1.5); labels.push('Scarf'); }
  if (mine ? field.tailwind : field.enemyTailwind) { spe *= 2; labels.push('Tailwind'); }
  if (mine ? field.myPara : field.enemyPara) { spe = Math.floor(spe / 2); labels.push('Para'); }
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
  /** Fastest of the common spreads (meta entries). */
  max?: number;
  /** Opponent entries whose spread was guessed from usage data. */
  estimated?: boolean;
}

/** Speed of each top meta Pokémon with its most common spread and ability. */
export function metaSpeeds(usage: UsageSource, limit: number, field: SpeedField, enemy: EnemyMode = 'off', mySets: PokemonSet[] = []): SpeedEntry[] {
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
    const own = warWeather(enemy === 'off' ? null : metaWeather(name, usage), enemy, mySets, usage);
    const weather = own && !own.kept ? own.weather : field.weather;
    const mod = abilitySpeedMod(ability, {weather, electricTerrain: field.electricTerrain});
    const sideLabels: string[] = [];
    const apply = (raw: number) => {
      const st = field.enemyStage ? Math.floor(raw * stageMult(field.enemyStage)) : raw;
      return sideMods(Math.floor(st * mod.mult), {...field, enemyStage: 0}, false, []);
    };
    sideMods(1, field, false, sideLabels);
    const top = apply(speeds[0]);
    const max = apply(Math.max(...speeds));
    const notes: string[] = [];
    if (max !== top) notes.push(`up to ${max}`);
    const scarf = u.items.find(([i]) => i === 'Choice Scarf');
    if (scarf && scarf[1] > 0.1) notes.push(`Scarf ${pct(scarf[1])}: ${Math.floor(top * 1.5)}`);
    // A speed ability that is not the main one, or whose weather is not up right now.
    for (const [a, p] of u.abilities) {
      const w = SPEED_WEATHER[a];
      if (w && (weather !== w || a !== ability) && p > 0.15) notes.push(`${a} ${pct(p)}: ${Math.floor(speeds[0] * 2)} in ${WEATHER_LABEL[w].toLowerCase()}`);
      if (SPEED_NOTES[a] && p > 0.15) notes.push(SPEED_NOTES[a]);
    }
    if (own && !own.kept && mod.label) notes.unshift(`${WEATHER_LABEL[own.weather]} from ${own.source === name ? 'itself' : own.source}`);
    out.push({name, speed: top, max, mine: false, usage: u.usage, boosts: [...(mod.label ? [mod.label] : []), ...sideLabels], note: notes.join(' · ')});
  }
  return out;
}

/** Speed of each Pokémon of one opponent team, with its own spread, item and ability. */
export function oppSpeeds(opp: PokemonSet[], field: SpeedField, enemy: EnemyMode = 'off', mySets: PokemonSet[] = []): SpeedEntry[] {
  const own = warWeather(oppWeather(opp), enemy, mySets);
  const f = own && !own.kept ? {...field, weather: own.weather} : field;
  return opp.filter(s => SPECIES[battleForme(s)]).map(s => {
    const {speed, labels} = effectiveSpeed(s, f);
    const notes: string[] = [];
    const ability = abilityOf(s);
    const w = SPEED_WEATHER[ability];
    if (w && f.weather !== w) notes.push(`${WEATHER_LABEL[w]}: ${speed * 2}`);
    else if (own && w) notes.unshift(`${WEATHER_LABEL[own.weather]} from ${own.source === battleForme(s) ? 'itself' : own.source}`);
    if (SPEED_NOTES[ability]) notes.push(SPEED_NOTES[ability]);
    return {name: battleForme(s), speed, mine: false, boosts: labels, note: notes.join(' · '), estimated: s.estimated};
  });
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

const TERRAIN_SETTERS: Record<string, 'Electric' | 'Grassy' | 'Psychic' | 'Misty'> = {
  'Electric Surge': 'Electric', 'Grassy Surge': 'Grassy', 'Psychic Surge': 'Psychic', 'Misty Surge': 'Misty', 'Hadron Engine': 'Electric',
};

/**
 * Weather and terrain two Pokémon bring onto the field by themselves (Calc). When both set one, the
 * one that acts last wins, as in the weather war: the slower switch-in, a Mega setter after both.
 */
export function autoField(a: PokemonSet | undefined, b: PokemonSet | undefined) {
  const both = [a, b].filter((s): s is PokemonSet => !!s);
  const pick = <T,>(table: Record<string, T>, megaLater: boolean) => {
    const setters = both.map(s => ({s, v: table[abilityOf(s)]})).filter(x => x.v !== undefined)
      .map(x => ({...x, info: setterOf(x.s, '')}));
    if (!setters.length) return null;
    if (setters.length === 1 || setters[0].v === setters[1].v) return {value: setters[0].v, why: `from ${setters[0].info.name}`};
    const [x, y] = setters;
    const xLast = megaLater && x.info.mega !== y.info.mega ? x.info.mega : x.info.speed < y.info.speed;
    const last = xLast ? x : y, first = xLast ? y : x;
    const reason = megaLater && x.info.mega !== y.info.mega
      ? `${last.info.name} Mega Evolves after the switch-ins`
      : x.info.speed === y.info.speed ? `speed tie with ${first.info.name}` : `${last.info.name} (${last.info.speed}) is slower than ${first.info.name} (${first.info.speed})`;
    return {value: last.v, why: `from ${last.info.name}: ${reason}`};
  };
  return {weather: pick(WEATHER_SETTERS, true), terrain: pick(TERRAIN_SETTERS, false)};
}
