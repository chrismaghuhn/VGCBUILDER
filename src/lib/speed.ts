import {NATURES, SP_MAX, SP_TOTAL, SPECIES, STATS, type StatID, type StatTable} from './data';
import {effectiveSpeed, type SpeedField} from './analysis';
import {battleForme, type PokemonSet} from './team';

export type SpeedNeed =
  | {kind: 'done'}                                   // already faster (or slower under Trick Room)
  | {kind: 'tie'}                                    // best you can do is a speed tie
  | {kind: 'sp'; sp: number}                         // change Spe SP, keep nature
  | {kind: 'nature'; sp: number; nature: string}     // needs a different nature too
  | {kind: 'impossible'};

const speedOf = (set: PokemonSet, sp: number, nature: string, field: SpeedField) =>
  effectiveSpeed({...set, nature, sps: {...set.sps, spe: sp}}, field, true).speed;

/** A nature with +Spe (or −Spe for Trick Room) that keeps the set's attacking stat. */
function speedNature(set: PokemonSet, up: boolean): string {
  const [plus] = NATURES[set.nature] ?? [null, null];
  const sp = SPECIES[battleForme(set)];
  const physical = plus === 'atk' || (plus !== 'spa' && (sp?.bs.atk ?? 0) >= (sp?.bs.spa ?? 0));
  if (up) return physical ? 'Jolly' : 'Timid';
  if (plus === 'def') return 'Relaxed';
  if (plus === 'spd') return 'Sassy';
  return physical ? 'Brave' : 'Quiet';
}

/**
 * What a set needs to outspeed `target` (or, under Trick Room, to move before it by being slower).
 * Prefers keeping the nature; only suggests a nature change when SP alone can't do it.
 */
export function speedNeed(set: PokemonSet, target: number, field: SpeedField, trickRoom: boolean): SpeedNeed {
  const beats = (v: number) => (trickRoom ? v < target : v > target);
  const current = speedOf(set, set.sps.spe, set.nature, field);
  if (beats(current)) return {kind: 'done'};

  if (!trickRoom) {
    // Smallest SP that is enough (SP above the current value only).
    for (let sp = set.sps.spe; sp <= SP_MAX; sp++) if (beats(speedOf(set, sp, set.nature, field))) return {kind: 'sp', sp};
    const nature = speedNature(set, true);
    if (nature !== set.nature) for (let sp = 0; sp <= SP_MAX; sp++) if (beats(speedOf(set, sp, nature, field))) return {kind: 'nature', sp, nature};
  } else {
    // Largest SP that still keeps it slower.
    for (let sp = set.sps.spe; sp >= 0; sp--) if (beats(speedOf(set, sp, set.nature, field))) return {kind: 'sp', sp};
    const nature = speedNature(set, false);
    if (nature !== set.nature) for (let sp = SP_MAX; sp >= 0; sp--) if (beats(speedOf(set, sp, nature, field))) return {kind: 'nature', sp, nature};
  }
  // Can it at least tie?
  const best = trickRoom ? speedOf(set, 0, speedNature(set, false), field) : speedOf(set, SP_MAX, speedNature(set, true), field);
  return best === target ? {kind: 'tie'} : {kind: 'impossible'};
}

/** Apply a Spe SP value (and nature); see applySps for how the budget is kept. */
export function applySpeed(set: PokemonSet, sp: number, nature = set.nature) {
  return applySps(set, {spe: sp}, nature);
}

/**
 * Set some stats' SP (and optionally the nature). When the total goes over 66, the extra SP come
 * out of the other stats one point at a time from whichever is highest, so investments even out
 * instead of one stat being emptied. Order of sources: unprotected stats first, then `protect`ed
 * ones, the nature-boosted stat last. The changed stats are never touched.
 */
export function applySps(
  set: PokemonSet, changes: Partial<StatTable>, nature = set.nature, protect: StatID[] = [],
): {set: PokemonSet; taken: [StatID, number][]} {
  const sps = {...set.sps, ...changes};
  let over = STATS.reduce((a, s) => a + sps[s], 0) - SP_TOTAL;
  const taken = new Map<StatID, number>();
  const [plus] = NATURES[nature] ?? [null, null];
  const others = STATS.filter(s => !(s in changes));
  const tiers = [
    others.filter(s => s !== plus && !protect.includes(s)),
    others.filter(s => s !== plus && protect.includes(s)),
    others.filter(s => s === plus),
  ];
  while (over > 0) {
    const tier = tiers.find(t => t.some(s => sps[s] > 0));
    if (!tier) break;
    const from = tier.filter(s => sps[s] > 0).sort((a, b) => sps[b] - sps[a])[0];
    sps[from]--;
    taken.set(from, (taken.get(from) ?? 0) + 1);
    over--;
  }
  return {set: {...set, nature, sps}, taken: [...taken]};
}
