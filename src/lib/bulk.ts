import {MOVES, NATURES, SP_MAX, SPECIES} from './data';
import {runCalc, type Boosts, type CalcOut, type FieldOpts} from './calc';
import {battleForme, type PokemonSet} from './team';

export type BulkNeed =
  | {kind: 'done'}
  | {kind: 'sp'; hp: number; def: number; stat: 'def' | 'spd'}               // new HP and Def/SpD SP
  | {kind: 'nature'; hp: number; def: number; stat: 'def' | 'spd'; nature: string}
  | {kind: 'impossible'};

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

/**
 * Fewest extra HP + Def/SpD SP that let the set survive the hit. Only adds SP (never lowers the
 * current investment); damage only falls as SP go up, so a binary search per HP value is enough.
 */
export function bulkNeed(attacker: PokemonSet, set: PokemonSet, move: string, ctx: BulkContext): BulkNeed {
  const mv = MOVES[move];
  if (!mv || mv.cat === 'Status') return {kind: 'done'};
  if (survives(attacker, set, move, ctx)) return {kind: 'done'};
  const stat: 'def' | 'spd' = mv.cat === 'Physical' ? 'def' : 'spd';

  const search = (nature: string): {hp: number; def: number} | null => {
    const variant = (hp: number, d: number): PokemonSet => ({...set, nature, sps: {...set.sps, hp, [stat]: d}});
    const ok = (hp: number, d: number) => survives(attacker, variant(hp, d), move, ctx);
    if (!ok(SP_MAX, SP_MAX)) return null;
    let best: {hp: number; def: number} | null = null;
    for (let hp = set.sps.hp; hp <= SP_MAX; hp++) {
      const extraHp = hp - set.sps.hp;
      if (best && extraHp >= best.hp - set.sps.hp + best.def - set.sps[stat]) break;
      if (!ok(hp, SP_MAX)) continue;
      let lo = set.sps[stat];
      let hi = SP_MAX;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ok(hp, mid)) hi = mid; else lo = mid + 1;
      }
      const cost = extraHp + lo - set.sps[stat];
      if (!best || cost < best.hp - set.sps.hp + best.def - set.sps[stat]) best = {hp, def: lo};
    }
    return best;
  };

  const plain = search(set.nature);
  if (plain) return {kind: 'sp', stat, ...plain};
  const nature = bulkNature(set, stat);
  if (nature !== set.nature) {
    const withNature = search(nature);
    if (withNature) return {kind: 'nature', stat, nature, ...withNature};
  }
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
