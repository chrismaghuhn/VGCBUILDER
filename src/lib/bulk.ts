import {MOVES, NATURES, SP_MAX, SPECIES, type StatID} from './data';
import {runCalc, type Boosts, type CalcOut, type FieldOpts} from './calc';
import {battleForme, type PokemonSet} from './team';
import {applySps} from './speed';

interface Spread {
  hp: number;
  def: number;                // new SP in the needed defense (`stat`)
  stat: 'def' | 'spd';
  /** Stats to take extra SP from last when the budget overflows (see applySps). */
  protect: StatID[];
}

export type BulkNeed =
  | {kind: 'done'}
  | ({kind: 'sp'} & Spread)
  | ({kind: 'nature'; nature: string} & Spread)
  /** Only possible by giving up hits the set survives now. */
  | ({kind: 'conflict'; nature?: string; breaks: string[]} & Spread)
  | {kind: 'impossible'};

/** A hit the set currently survives and should keep surviving. */
export interface KeptHit {
  name: string;
  attacker: PokemonSet;
  move: string;
  /** The hit's own field (e.g. the threat's weather); defaults to the current context. */
  ctx?: BulkContext;
}

export interface BulkContext {
  field: FieldOpts;
  atkBoosts: Boosts;
  /** How many hits the set must take: 1 = no OHKO, 2 = no 2HKO. */
  hits: 1 | 2;
}

const hitRoll = (out: CalcOut | null) => (out ? out.max : 0);

/** Damage of one hit and the defender's max HP for a SP variant of the set. */
function hit(attacker: PokemonSet, set: PokemonSet, move: string, ctx: BulkContext) {
  return runCalc(attacker, set, move, ctx.field, ctx.atkBoosts);
}

export function survives(attacker: PokemonSet, set: PokemonSet, move: string, ctx: BulkContext): boolean {
  const out = hit(attacker, set, move, ctx);
  if (!out) return true;
  // Max roll below the HP pool (max HP = max / maxPct).
  const maxHp = out.max / (out.maxPct || 1);
  return hitRoll(out) * ctx.hits < maxHp;
}

/** A nature boosting the needed defense while dropping the attacking stat the set doesn't use. */
function bulkNature(set: PokemonSet, stat: 'def' | 'spd'): string {
  const sp = SPECIES[battleForme(set)];
  const [plus] = NATURES[set.nature] ?? [null, null];
  const special = plus === 'spa' || (plus !== 'atk' && (sp?.bs.spa ?? 0) > (sp?.bs.atk ?? 0));
  if (stat === 'def') return special ? 'Bold' : 'Impish';
  return special ? 'Calm' : 'Careful';
}

/** How many cheapest candidate spreads to check against the kept hits before giving up. */
const MAX_CANDIDATES = 12;

/**
 * Fewest extra HP + Def/SpD SP that let the set survive the hit, without losing any hit in `keep`
 * (hits it survives right now). Only adds SP to HP and the needed defense; damage only falls as SP
 * go up, so a binary search per HP value finds the cheapest defense. When the 66-SP budget
 * overflows, SP come from the other stats (first evenly, then sparing the other defense).
 */
export function bulkNeed(attacker: PokemonSet, set: PokemonSet, move: string, ctx: BulkContext, keep: KeptHit[] = []): BulkNeed {
  const mv = MOVES[move];
  if (!mv || mv.cat === 'Status') return {kind: 'done'};
  if (survives(attacker, set, move, ctx)) return {kind: 'done'};
  const stat: 'def' | 'spd' = mv.cat === 'Physical' ? 'def' : 'spd';
  const other: StatID = stat === 'def' ? 'spd' : 'def';

  /** Cheapest (hp, def) per HP value that survives this hit, sorted by extra SP. */
  const candidates = (nature: string): {hp: number; def: number}[] => {
    const variant = (hp: number, d: number): PokemonSet => ({...set, nature, sps: {...set.sps, hp, [stat]: d}});
    const ok = (hp: number, d: number) => survives(attacker, variant(hp, d), move, ctx);
    if (!ok(SP_MAX, SP_MAX)) return [];
    const out: {hp: number; def: number; cost: number}[] = [];
    for (let hp = set.sps.hp; hp <= SP_MAX; hp++) {
      if (!ok(hp, SP_MAX)) continue;
      let lo = set.sps[stat];
      let hi = SP_MAX;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ok(hp, mid)) hi = mid; else lo = mid + 1;
      }
      out.push({hp, def: lo, cost: hp - set.sps.hp + lo - set.sps[stat]});
    }
    return out.sort((a, b) => a.cost - b.cost);
  };

  const broken = (s: PokemonSet) => keep.filter(k => !survives(k.attacker, s, k.move, k.ctx ?? ctx)).map(k => `${k.name} ${k.move}`);

  /** First candidate (cheapest first) whose applied spread keeps every kept hit. */
  const pick = (nature: string) => {
    const list = candidates(nature);
    let fallback: (Spread & {breaks: string[]}) | null = null;
    for (const c of list.slice(0, MAX_CANDIDATES)) {
      for (const protect of [[], [other]] as StatID[][]) {
        const applied = applySps(set, {hp: c.hp, [stat]: c.def}, nature, protect).set;
        const breaks = broken(applied);
        if (!breaks.length) return {spread: {...c, stat, protect}, breaks: []};
        if (!fallback || breaks.length < fallback.breaks.length) fallback = {...c, stat, protect, breaks};
      }
    }
    return fallback ? {spread: fallback, breaks: fallback.breaks} : null;
  };

  const plain = pick(set.nature);
  if (plain && !plain.breaks.length) return {kind: 'sp', ...plain.spread};
  const nature = bulkNature(set, stat);
  const withNature = nature !== set.nature ? pick(nature) : null;
  if (withNature && !withNature.breaks.length) return {kind: 'nature', nature, ...withNature.spread};
  // Only reachable by trading away other hits: say which ones.
  const best = [plain && {...plain, nature: undefined}, withNature && {...withNature, nature}]
    .filter(x => x !== null)
    .sort((a, b) => a!.breaks.length - b!.breaks.length)[0];
  if (best) return {kind: 'conflict', ...best.spread, nature: best.nature, breaks: best.breaks};
  return {kind: 'impossible'};
}

/** The threat's most damaging attack against the set (by max roll). */
export function strongestMove(attacker: PokemonSet, set: PokemonSet, moves: string[], ctx: BulkContext): {move: string; out: CalcOut} | null {
  let best: {move: string; out: CalcOut} | null = null;
  for (const m of moves) {
    const out = hit(attacker, set, m, ctx);
    if (out && (!best || out.maxPct > best.out.maxPct)) best = {move: m, out};
  }
  return best;
}
