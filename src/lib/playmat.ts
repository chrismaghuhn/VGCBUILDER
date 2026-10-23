import {MOVES, megaForme, type UsageSource} from './data';
import {abilityOf, effectiveSpeed, teamField, type SpeedField} from './analysis';
import {runCalc, type CalcOut, type FieldOpts} from './calc';
import {rankPlans} from './matchup';
import type {MatAction, MatSide, Playmat, PokemonSet} from './team';

export const keyOf = (side: MatSide, i: number) => `${side === 'mine' ? 'm' : 't'}${i}`;

/** Holds a Mega Stone for its species. */
export const canMega = (set: PokemonSet) => !!megaForme(set.species, set.item);

/** A set as it stands on the mat: a stone holder that hasn't Mega Evolved yet keeps its base forme. */
export function matSet(mat: Playmat, key: string, set: PokemonSet): PokemonSet {
  if (!canMega(set)) return set;
  const evolved = mat.megas ? !!mat.megas[key] : true;
  return evolved ? set : {...set, unevolved: true};
}

/** Mega Evolve (or undo) `key`; only one Mega per side and battle. */
export function toggleMega(mat: Playmat, sets: PokemonSet[], key: string): Record<string, boolean> {
  const prefix = key[0];
  // Older mats without the record: every stone holder counted as evolved.
  const megas: Record<string, boolean> = mat.megas ? {...mat.megas} : Object.fromEntries([
    ...sets.map((s, i) => [keyOf('mine', i), canMega(s)] as const),
    ...mat.opp.map((s, i) => [keyOf('theirs', i), canMega(s)] as const),
  ]);
  const on = !megas[key];
  if (on) for (const k of Object.keys(megas)) if (k[0] === prefix) megas[k] = false;
  megas[key] = on;
  return megas;
}

/** A fresh board: their most likely leads vs my best plan, my team's weather. */
export function newPlaymat(name: string, opp: PokemonSet[], sets: PokemonSet[], usage: UsageSource): Playmat {
  const weather = teamField(sets).weather;
  const ranked = sets.length && opp.length ? rankPlans(sets, opp, usage, {weather}) : null;
  const best = ranked?.plans[0];
  const theirLeads = ranked?.pairs[0]?.pair ?? [0, 1];
  return {
    name,
    opp,
    mine: [best?.lead[0] ?? 0, best?.lead[1] ?? (sets.length > 1 ? 1 : null)],
    theirs: [theirLeads[0] ?? null, theirLeads[1] ?? null],
    brought: best?.bring ?? sets.map((_, i) => i).slice(0, 4),
    hp: {},
    boosts: {},
    field: {
      weather, terrain: '', trickRoom: false,
      tailwind: {mine: false, theirs: false}, reflect: {mine: false, theirs: false}, lightScreen: {mine: false, theirs: false},
    },
    notes: [],
    // The first lead holding a stone Mega Evolves; anyone else waits.
    megas: Object.fromEntries([
      ...[best?.lead[0] ?? 0, best?.lead[1] ?? 1].filter(i => sets[i] && canMega(sets[i])).slice(0, 1).map(i => [keyOf('mine', i), true]),
      ...theirLeads.filter(j => opp[j] && canMega(opp[j])).slice(0, 1).map(j => [keyOf('theirs', j), true]),
    ]),
  };
}

export interface Fighter {
  side: MatSide;
  index: number;
  set: PokemonSet;
  key: string;
}

/** The (up to) four Pokémon on the battle spots. */
export function activeFighters(mat: Playmat, sets: PokemonSet[]): Fighter[] {
  const out: Fighter[] = [];
  mat.mine.forEach(i => { if (i !== null && sets[i]) out.push({side: 'mine', index: i, set: matSet(mat, keyOf('mine', i), sets[i]), key: keyOf('mine', i)}); });
  mat.theirs.forEach(j => { if (j !== null && mat.opp[j]) out.push({side: 'theirs', index: j, set: matSet(mat, keyOf('theirs', j), mat.opp[j]), key: keyOf('theirs', j)}); });
  return out;
}

const speedField = (mat: Playmat, f: Fighter): SpeedField => ({
  weather: mat.field.weather,
  electricTerrain: mat.field.terrain === 'Electric',
  tailwind: mat.field.tailwind.mine,
  enemyTailwind: mat.field.tailwind.theirs,
  myStage: f.side === 'mine' ? mat.boosts[f.key]?.spe ?? 0 : 0,
  enemyStage: f.side === 'theirs' ? mat.boosts[f.key]?.spe ?? 0 : 0,
});

export function speedOn(mat: Playmat, f: Fighter): number {
  return effectiveSpeed(f.set, speedField(mat, f), f.side === 'mine').speed;
}

/** Priority of a planned move, with the abilities that change it. */
export function priorityOf(mat: Playmat, f: Fighter, move?: string): number {
  const m = move ? MOVES[move] : undefined;
  if (!m) return 0;
  const ability = abilityOf(f.set);
  let prio = m.prio ?? 0;
  if (ability === 'Prankster' && m.cat === 'Status') prio += 1;
  if (ability === 'Gale Wings' && m.type === 'Flying' && (mat.hp[f.key] ?? 100) >= 100) prio += 1;
  if (ability === 'Triage' && m.flags?.includes('heal')) prio += 3;
  if (move === 'Grassy Glide' && mat.field.terrain === 'Grassy') prio += 1;
  return prio;
}

/** Move order of the Pokémon on the field: priority first, then speed (Trick Room reverses speed). */
export function turnOrder(mat: Playmat, sets: PokemonSet[]) {
  const list = activeFighters(mat, sets).map(f => {
    const move = mat.actions?.[f.key]?.move;
    return {...f, speed: speedOn(mat, f), move, prio: priorityOf(mat, f, move)};
  });
  list.sort((a, b) => b.prio - a.prio || (mat.field.trickRoom ? a.speed - b.speed : b.speed - a.speed));
  return list.map((f, k) => ({...f, tie: list.some((g, m) => m !== k && g.speed === f.speed && g.prio === f.prio)}));
}

/** Move targets that need no aiming. */
const NO_AIM = new Set(['self', 'allySide', 'foeSide', 'all', 'allies', 'allyTeam', 'adjacentAllyOrSelf']);

/**
 * Whom a move hits without aiming: spread moves both foes (and the partner), Helping Hand the partner,
 * self/field moves nobody. null = a single target that the player aims.
 */
export function autoTargets(mat: Playmat, sets: PokemonSet[], f: Fighter, move: string): string[] | null {
  const target = MOVES[move]?.target ?? 'normal';
  const field = activeFighters(mat, sets);
  const foes = field.filter(g => g.side !== f.side).map(g => g.key);
  const ally = field.filter(g => g.side === f.side && g.key !== f.key).map(g => g.key);
  if (target === 'allAdjacentFoes') return foes;
  if (target === 'allAdjacent') return [...foes, ...ally];
  if (target === 'adjacentAlly') return ally;
  if (NO_AIM.has(target)) return [];
  return null;
}

/** Plan `move` for `f`: spread/self moves aim themselves, single targets keep their old aim if it still stands. */
export function planMove(mat: Playmat, sets: PokemonSet[], f: Fighter, move: string): MatAction {
  const auto = autoTargets(mat, sets, f, move);
  if (auto) return {move, targets: auto};
  const onField = new Set(activeFighters(mat, sets).map(g => g.key));
  const prev = (mat.actions?.[f.key]?.targets ?? []).filter(k => onField.has(k) && k !== f.key);
  return {move, targets: prev.slice(0, 1)};
}

/** One attack with the board's field state, boosts and the defender's current HP. */
export function matCalc(mat: Playmat, atk: Fighter, def: Fighter, move: string): CalcOut | null {
  const defSide = def.side;
  const opts: FieldOpts = {
    weather: mat.field.weather,
    terrain: mat.field.terrain,
    reflect: mat.field.reflect[defSide],
    lightScreen: mat.field.lightScreen[defSide],
  };
  return runCalc(atk.set, def.set, move, opts, mat.boosts[atk.key] ?? {}, mat.boosts[def.key] ?? {}, mat.hp[def.key] ?? 100);
}

/** All damaging moves of `atk` against `def`, strongest first. */
export function matHits(mat: Playmat, atk: Fighter, def: Fighter) {
  return atk.set.moves
    .filter(m => MOVES[m] && MOVES[m].cat !== 'Status' && MOVES[m].bp > 0)
    .map(m => ({move: m, out: matCalc(mat, atk, def, m)}))
    .filter((x): x is {move: string; out: CalcOut} => !!x.out)
    .sort((a, b) => b.out.maxPct - a.out.maxPct);
}
