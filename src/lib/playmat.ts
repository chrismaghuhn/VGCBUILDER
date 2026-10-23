import {MOVES, type UsageSource} from './data';
import {effectiveSpeed, teamField, type SpeedField} from './analysis';
import {runCalc, type CalcOut, type FieldOpts} from './calc';
import {rankPlans} from './matchup';
import type {MatSide, Playmat, PokemonSet} from './team';

export const keyOf = (side: MatSide, i: number) => `${side === 'mine' ? 'm' : 't'}${i}`;

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
  mat.mine.forEach(i => { if (i !== null && sets[i]) out.push({side: 'mine', index: i, set: sets[i], key: keyOf('mine', i)}); });
  mat.theirs.forEach(j => { if (j !== null && mat.opp[j]) out.push({side: 'theirs', index: j, set: mat.opp[j], key: keyOf('theirs', j)}); });
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

/** Move order of the Pokémon on the field (Trick Room reverses it). */
export function turnOrder(mat: Playmat, sets: PokemonSet[]) {
  const list = activeFighters(mat, sets).map(f => ({...f, speed: speedOn(mat, f)}));
  list.sort((a, b) => (mat.field.trickRoom ? a.speed - b.speed : b.speed - a.speed));
  return list.map((f, k) => ({...f, tie: list.some((g, m) => m !== k && g.speed === f.speed)}));
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
