import {Field, Generations, Move, Pokemon, calculate} from '@smogon/calc';
import {MOVES, SPECIES, TYPES, type StatID, type UsageSource} from './data';
import {battleForme, type PokemonSet} from './team';
import {metaSet} from './meta';

export {fillSpreads, metaSet} from './meta';
import {damagingMoves, defensiveMult, effectiveSpeed, roleCoverage, typeEffect, type EnemyWeather, type SpeedField} from './analysis';

export const GEN = Generations.get(0);

export type Boosts = Partial<Record<Exclude<StatID, 'hp'>, number>>;

export interface FieldOpts {
  weather?: '' | 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  helpingHand?: boolean;
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  friendGuard?: boolean;
  tailwindAtk?: boolean;
  crit?: boolean;
  singleTarget?: boolean; // spread move hitting only one target
}

export function toCalcPokemon(set: PokemonSet, boosts: Boosts = {}, hpPercent = 100): Pokemon {
  const forme = battleForme(set);
  const sp = SPECIES[forme];
  const p = new Pokemon(GEN, sp?.calcName ?? forme, {
    level: 50,
    nature: set.nature,
    evs: set.sps,
    ability: sp?.mega ? sp.abilities[0] : set.ability,
    item: set.item || undefined,
    boosts,
  });
  if (hpPercent < 100) p.originalCurHP = Math.max(1, Math.floor((p.maxHP() * hpPercent) / 100));
  return p;
}

export function makeField(opts: FieldOpts = {}): Field {
  return new Field({
    gameType: 'Doubles',
    weather: opts.weather || undefined,
    terrain: opts.terrain || undefined,
    attackerSide: {isHelpingHand: !!opts.helpingHand, isTailwind: !!opts.tailwindAtk},
    defenderSide: {
      isReflect: !!opts.reflect, isLightScreen: !!opts.lightScreen,
      isAuroraVeil: !!opts.auroraVeil, isFriendGuard: !!opts.friendGuard,
    },
  });
}

export interface CalcOut {
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  koText: string;
  /** Hits needed to KO (0 = unknown / too many) and the chance of doing it in that many. */
  koN: number;
  koChance: number;
  desc: string;
}

export function runCalc(
  attacker: PokemonSet, defender: PokemonSet, move: string, opts: FieldOpts = {},
  atkBoosts: Boosts = {}, defBoosts: Boosts = {}, defHp = 100,
): CalcOut | null {
  try {
    const a = toCalcPokemon(attacker, atkBoosts);
    const d = toCalcPokemon(defender, defBoosts, defHp);
    const mv = new Move(GEN, move, {isCrit: !!opts.crit});
    // A spread move with only one target left skips the 0.75x spread modifier.
    if (opts.singleTarget && ['allAdjacent', 'allAdjacentFoes'].includes(mv.target)) mv.target = 'normal';
    const r = calculate(GEN, a, d, mv, makeField(opts));
    const range = r.range();
    const hp = d.maxHP();
    let koText = '';
    let koN = 0;
    let koChance = 0;
    let desc = '';
    try {
      const ko = r.kochance();
      koText = ko.text;
      koN = ko.n ?? 0;
      // "possible nHKO" comes without a chance: treat it as unlikely.
      koChance = ko.chance ?? 0;
    } catch { /* status moves etc. */ }
    try { desc = r.desc(); } catch { desc = ''; }
    return {min: range[0], max: range[1], minPct: range[0] / hp, maxPct: range[1] / hp, koText, koN, koChance, desc};
  } catch {
    return null;
  }
}

/** Fewer hits to KO wins, then a higher KO chance, then raw damage. */
const koRank = (o: CalcOut) => (o.koN > 0 && o.koN <= 4 ? (5 - o.koN) * 10 + o.koChance : 0) + o.maxPct / 10;

/** Best damage a set can deal to a target with its damaging moves. */
export function bestHit(attacker: PokemonSet, defender: PokemonSet, opts: FieldOpts = {}, moves = damagingMoves(attacker)) {
  let best: {move: string; out: CalcOut} | null = null;
  for (const m of moves) {
    const out = runCalc(attacker, defender, m, opts);
    if (out && (!best || koRank(out) > koRank(best.out))) best = {move: m, out};
  }
  return best;
}

// ---------------------------------------------------------------- Meta threats

export interface MetaThreat {
  name: string;
  usage: number;
  lead: number;
  set: PokemonSet;
  /** Most used damaging moves (for the threat's attacks). */
  attacks: string[];
}


export function metaThreats(usage: UsageSource, limit = 30): MetaThreat[] {
  return Object.entries(usage.mons)
    .sort((a, b) => b[1].usage - a[1].usage)
    .slice(0, limit)
    .filter(([name]) => SPECIES[name])
    .map(([name, u]) => {
      const sp = SPECIES[name];
      const set = metaSet(name, usage);
      if (!sp.mega) set.moves = u.moves.map(([m]) => m).filter(m => sp.moves.includes(m)).slice(0, 4);
      const attacks = u.moves
        .filter(([m, p]) => p > 0.15 && MOVES[m] && MOVES[m].cat !== 'Status' && MOVES[m].bp > 0 && sp.moves.includes(m))
        .map(([m]) => m)
        .slice(0, 5);
      return {name, usage: u.usage, lead: u.lead, set, attacks};
    });
}

/** One opponent team as threats: their own sets, every damaging move they carry. */
export function teamThreats(opp: PokemonSet[]): MetaThreat[] {
  return opp.filter(s => SPECIES[s.species]).map(set => ({
    name: battleForme(set), usage: 0, lead: 0, set, attacks: damagingMoves(set),
  }));
}

export interface HitSummary {
  move: string;
  maxPct: number;
  minPct: number;
  koText: string;
  koN: number;
  koChance: number;
}

const summarize = (hit: {move: string; out: CalcOut} | null): HitSummary | undefined =>
  hit ? {move: hit.move, maxPct: hit.out.maxPct, minPct: hit.out.minPct, koText: hit.out.koText, koN: hit.out.koN, koChance: hit.out.koChance} : undefined;

export interface MatchupCell {
  out?: HitSummary;
  in?: HitSummary;
  faster: boolean | null; // null = speed tie
}

export interface ThreatRow {
  threat: MetaThreat;
  /** Set when the row uses the threat's own weather instead of the chosen one. */
  weather?: EnemyWeather;
  cells: MatchupCell[];
  /** 0 (handled) … 1 (big problem). */
  danger: number;
}

/**
 * With `enemyWeather` each threat plays under the weather its team brings
 * (weather war worst case: their setter wins).
 */
export function threatMatrix(
  sets: PokemonSet[], threats: MetaThreat[], field: SpeedField = {weather: ''},
  enemyWeather?: (threat: string) => EnemyWeather | null,
): ThreatRow[] {
  const mySpeed = new Map<string, number[]>();
  const speedsFor = (f: SpeedField) => {
    const key = f.weather;
    if (!mySpeed.has(key)) mySpeed.set(key, sets.map(s => effectiveSpeed(s, f, true).speed));
    return mySpeed.get(key)!;
  };
  return threats.map(threat => {
    const own = enemyWeather?.(threat.name) ?? null;
    const rowField: SpeedField = own && !own.kept ? {...field, weather: own.weather} : field;
    const calcField: FieldOpts = {weather: rowField.weather, terrain: rowField.electricTerrain ? 'Electric' : ''};
    const speeds = speedsFor(rowField);
    const tSpeed = effectiveSpeed(threat.set, {weather: rowField.weather, electricTerrain: rowField.electricTerrain}).speed;
    const cells = sets.map((s, i) => {
      const out = bestHit(s, threat.set, calcField);
      const inc = bestHit(threat.set, s, calcField, threat.attacks);
      return {
        out: summarize(out),
        in: summarize(inc),
        faster: speeds[i] === tSpeed ? null : speeds[i] > tSpeed,
      };
    });
    // Danger: how many of my mons it OHKOs/2HKOs vs. how many of mine 2HKO it.
    const ohkos = cells.filter(c => (c.in?.minPct ?? 0) >= 1).length;
    const twohko = cells.filter(c => (c.in?.minPct ?? 0) >= 0.5).length;
    const myAnswers = cells.filter(c => (c.out?.minPct ?? 0) >= 0.5).length;
    const myFastOhko = cells.filter(c => (c.out?.minPct ?? 0) >= 1 && c.faster).length;
    const n = Math.max(1, sets.length);
    const danger = Math.max(0, Math.min(1,
      0.15 + (ohkos * 0.6 + twohko * 0.3) / n - myAnswers * 0.12 - myFastOhko * 0.15));
    return {threat, cells, danger, weather: own && (own.weather !== field.weather || own.why) ? own : undefined};
  });
}

export function speedOf(set: PokemonSet): number {
  return toCalcPokemon(set).stats.spe;
}

// ---------------------------------------------------------------- Teammate suggestions

export interface Suggestion {
  name: string;
  score: number;
  reasons: string[];
  usage: number;
}

export interface SuggestOptions {
  /** Never suggest these (user hid them). */
  hidden?: string[];
  noMegas?: boolean;
}

export function suggestTeammates(
  sets: PokemonSet[], usage: UsageSource, problemThreats: MetaThreat[], limit = 12, opts: SuggestOptions = {},
): Suggestion[] {
  const hidden = new Set(opts.hidden ?? []);
  const taken = new Set(sets.map(s => SPECIES[s.species]?.num));
  const takenItems = sets.map(s => s.item);
  const megaCount = sets.filter(s => SPECIES[battleForme(s)]?.mega).length;
  const roles = roleCoverage(sets);
  const missingRoles = roles.filter(r => r.role.important && r.members.length === 0).map(r => r.role);
  const weakTypes = TYPES.filter(t => {
    const m = sets.map(s => defensiveMult(s, t));
    return m.filter(x => x > 1).length - m.filter(x => x < 1).length >= 2;
  });

  const candidates = Object.entries(usage.mons)
    .sort((a, b) => b[1].usage - a[1].usage)
    .slice(0, 90)
    .filter(([n]) => SPECIES[n] && !taken.has(SPECIES[n].num) && !hidden.has(n) && !(opts.noMegas && SPECIES[n].mega));

  const results: Suggestion[] = [];
  for (const [name, u] of candidates) {
    const sp = SPECIES[name];
    const reasons: string[] = [];
    let score = Math.log10(1 + u.usage * 100) * 1.2;

    // Real-world synergy: how often players pair it with my current members.
    let synergy = 0;
    for (const s of sets) {
      const mine = usage.mons[battleForme(s)] ?? usage.mons[s.species];
      const t = mine?.teammates.find(([n]) => n === name)?.[1] ?? 0;
      synergy += t;
    }
    if (sets.length) {
      synergy /= sets.length;
      score += synergy * 4;
      if (synergy > 0.15) reasons.push(`Common partner · ${Math.round(synergy * 100)}%`);
    }

    // Patch shared weaknesses.
    const fakeSet: PokemonSet = {species: sp.mega ? sp.megaOf ?? sp.base : name, item: sp.requiredItem ?? '', ability: u.abilities[0]?.[0] ?? sp.abilities[0], nature: 'Hardy', sps: {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, moves: []};
    const patched: string[] = [];
    for (const t of weakTypes) {
      const m = defensiveMult(fakeSet, t);
      // Name the ability when it, not the typing, is what covers the weakness (Levitate, Flash Fire …).
      const viaAbility = typeEffect(t, sp.types) >= 1 && m < 1;
      if (m < 1) { score += 0.9; patched.push(viaAbility ? `${t} (${fakeSet.ability})` : t); }
      else if (m > 1) score -= 0.7;
    }
    if (patched.length) reasons.push(`Resists ${patched.join(', ')}`);

    // Fill important missing roles via its common moves/abilities.
    const common = u.moves.filter(([, p]) => p > 0.25).map(([m]) => m);
    const ability = u.abilities[0]?.[0];
    for (const r of missingRoles) {
      const source = (ability && r.abilities?.includes(ability) ? ability : undefined) ?? common.find(m => r.moves?.includes(m));
      if (source) {
        score += 1.1;
        reasons.push(source === r.label || r.label.startsWith(source) ? r.label : `${r.label}: ${source}`);
      }
    }

    // Answers the threats my team struggles with.
    if (problemThreats.length) {
      const candSet = metaSet(name, usage);
      if (candSet) {
        const answered: string[] = [];
        for (const th of problemThreats) {
          // A real answer 2HKOs the threat and survives its best attack comfortably.
          const hit = bestHit(candSet, th.set);
          const taken = bestHit(th.set, candSet, {}, th.attacks);
          if (hit && hit.out.minPct >= 0.5 && (taken?.out.maxPct ?? 0) < 0.6) answered.push(th.name);
        }
        if (answered.length) {
          score += answered.length * 0.8;
          reasons.push(`Answers ${answered.slice(0, 3).join(', ')}`);
        }
      }
    }

    if (sp.mega && megaCount >= 2) { score -= 1; reasons.push('Already 2+ Megas'); }
    if (sp.requiredItem && takenItems.includes(sp.requiredItem)) continue;
    results.push({name, score, reasons, usage: u.usage});
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

