import {MOVES, SP_MAX, SPECIES, type StatID} from './data';
import {runCalc, type Boosts, type CalcOut, type FieldOpts} from './calc';
import {applySps, natureKeepsLocked} from './speed';
import {battleForme, type PokemonSet} from './team';

export type KoNeed =
  | {kind: 'done'}                                              // already a guaranteed KO
  | {kind: 'sp'; stat: StatID; sp: number; protect: StatID[]}
  | {kind: 'nature'; stat: StatID; sp: number; nature: string; protect: StatID[]}
  /** Only possible by losing KOs the set has now. */
  | {kind: 'conflict'; stat: StatID; sp: number; nature?: string; protect: StatID[]; breaks: string[]}
  | {kind: 'locked'}                                            // only by touching locked stats
  | {kind: 'impossible'};

/** A KO the set has right now and should keep. */
export interface KeptKo {
  name: string;
  target: PokemonSet;
  move: string;
  ctx?: KoContext;
}

export interface KoContext {
  field: FieldOpts;
  /** Boosts on my attacker (e.g. -1 Atk after Intimidate). */
  atkBoosts: Boosts;
  /** 1 = OHKO, 2 = 2HKO. */
  hits: 1 | 2;
}

/** The stat a move's damage scales with on my side (null: not mine to raise, e.g. Foul Play). */
export function attackStat(move: string): StatID | null {
  const mv = MOVES[move];
  if (!mv || mv.cat === 'Status') return null;
  if (move === 'Foul Play') return null;
  if (move === 'Body Press') return 'def';
  return mv.cat === 'Physical' ? 'atk' : 'spa';
}

export function hitOn(me: PokemonSet, target: PokemonSet, move: string, ctx: KoContext): CalcOut | null {
  return runCalc(me, target, move, ctx.field, ctx.atkBoosts);
}

/** Guaranteed KO: even the lowest roll, times the hits, covers the target's HP. */
export function kos(me: PokemonSet, target: PokemonSet, move: string, ctx: KoContext): boolean {
  const out = hitOn(me, target, move, ctx);
  return !!out && out.minPct * ctx.hits >= 1;
}

/** A nature boosting the attacking stat while dropping the one the set doesn't use. */
function offenseNature(stat: StatID, set: PokemonSet): string {
  if (stat === 'atk') return 'Adamant';
  if (stat === 'spa') return 'Modest';
  // Body Press: +Def, drop the unused attacking stat.
  const sp = SPECIES[battleForme(set)];
  return (sp?.bs.atk ?? 0) >= (sp?.bs.spa ?? 0) ? 'Impish' : 'Bold';
}

/**
 * Fewest SP in the attacking stat for a guaranteed KO, without losing any KO in `keep`
 * (mixed attackers would otherwise trade physical KOs for special ones and back).
 * Damage only rises with the stat, so a binary search finds the cheapest value.
 */
export function koNeed(me: PokemonSet, target: PokemonSet, move: string, ctx: KoContext, keep: KeptKo[] = []): KoNeed {
  if (kos(me, target, move, ctx)) return {kind: 'done'};
  const stat = attackStat(move);
  if (!stat) return {kind: 'impossible'};
  const locked = me.locked ?? [];
  const otherAttack: StatID = stat === 'atk' ? 'spa' : 'atk';

  const search = (nature: string): number | null => {
    const at = (sp: number) => kos({...me, nature, sps: {...me.sps, [stat]: sp}}, target, move, ctx);
    if (!at(SP_MAX)) return null;
    let lo = nature === me.nature ? me.sps[stat] : 0;
    let hi = SP_MAX;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(mid)) hi = mid; else lo = mid + 1;
    }
    return lo;
  };
  const broken = (s: PokemonSet) => keep.filter(k => !kos(s, k.target, k.move, k.ctx ?? ctx)).map(k => `${k.name} ${k.move}`);

  let lockedOnly = false;
  let fallback: Extract<KoNeed, {kind: 'conflict'}> | null = null;
  const tryNature = (nature: string): KoNeed | null => {
    const sp = search(nature);
    if (sp === null) return null;
    if (locked.includes(stat) || !natureKeepsLocked(me, nature)) { lockedOnly = true; return null; }
    // Spare the other attacking stat first; take from bulk/speed only if that keeps the KOs.
    for (const protect of [[otherAttack], [otherAttack, 'hp', 'def', 'spd']] as StatID[][]) {
      const res = applySps(me, {[stat]: sp}, nature, protect);
      if (!res.ok) { lockedOnly = true; continue; }
      const breaks = broken(res.set);
      if (!breaks.length) return nature === me.nature ? {kind: 'sp', stat, sp, protect} : {kind: 'nature', stat, sp, nature, protect};
      if (!fallback || breaks.length < fallback.breaks.length) {
        fallback = {kind: 'conflict', stat, sp, nature: nature === me.nature ? undefined : nature, protect, breaks};
      }
    }
    return null;
  };

  const plain = tryNature(me.nature);
  if (plain) return plain;
  const nature = offenseNature(stat, me);
  const withNature = nature !== me.nature ? tryNature(nature) : null;
  if (withNature) return withNature;
  if (fallback) return fallback;
  return lockedOnly ? {kind: 'locked'} : {kind: 'impossible'};
}

/** My strongest damaging move against the target (by max roll). */
export function bestMoveOn(me: PokemonSet, target: PokemonSet, ctx: KoContext): {move: string; out: CalcOut} | null {
  let best: {move: string; out: CalcOut} | null = null;
  for (const m of me.moves) {
    if (!attackStat(m) && m !== 'Foul Play') continue;
    const out = hitOn(me, target, m, ctx);
    if (out && (!best || out.maxPct > best.out.maxPct)) best = {move: m, out};
  }
  return best;
}

