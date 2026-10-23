import {SPECIES, type UsageSource} from './data';
import {effectiveSpeed, teamField, type SpeedField} from './analysis';
import {bestHit, type FieldOpts} from './calc';
import {battleForme, type PokemonSet} from './team';

/** One of my Pokémon against one of theirs. */
export interface Duel {
  /** Hits I need to KO them (0 = 4+ / none). */
  myKo: number;
  myMove?: string;
  theirKo: number;
  theirMove?: string;
  faster: boolean | null;
  /** + good for me, − good for them. */
  value: number;
}

export interface Plan {
  bring: number[];   // my set indices (4)
  lead: number[];    // subset of bring (2)
  score: number;     // 0-100ish, for display
  bringScore: number;
  leadScore: number;
  reasons: string[];
  warnings: string[];
}

const koPoints = (n: number, sure: boolean) => (n === 1 ? (sure ? 3 : 2.3) : n === 2 ? (sure ? 1.5 : 1.1) : n === 3 ? 0.5 : 0);

/** Duel table [mine][theirs] with real damage calcs. */
export function duels(mine: PokemonSet[], theirs: PokemonSet[], field: SpeedField): Duel[][] {
  const calcField: FieldOpts = {weather: field.weather, terrain: field.electricTerrain ? 'Electric' : ''};
  return mine.map(me => theirs.map(them => {
    const out = bestHit(me, them, calcField);
    const inc = bestHit(them, me, calcField);
    const mySpe = effectiveSpeed(me, field, true).speed;
    const theirSpe = effectiveSpeed(them, field).speed;
    const faster = mySpe === theirSpe ? null : mySpe > theirSpe;
    const myKo = out?.out.koN && out.out.koN <= 3 ? out.out.koN : 0;
    const theirKo = inc?.out.koN && inc.out.koN <= 3 ? inc.out.koN : 0;
    const off = koPoints(myKo, (out?.out.koChance ?? 0) >= 0.995);
    const def = koPoints(theirKo, (inc?.out.koChance ?? 0) >= 0.995);
    let value = off - def;
    if (faster && myKo === 1) value += 1;           // I remove them before they act
    if (faster === false && theirKo === 1) value -= 1;
    return {myKo, myMove: out?.move, theirKo, theirMove: inc?.move, faster, value};
  }));
}

/** Probability of each of their lead pairs, from Smogon lead rates. */
export function leadPairs(theirs: PokemonSet[], usage: UsageSource): {pair: [number, number]; p: number}[] {
  const rate = theirs.map(s => (usage.mons[battleForme(s)] ?? usage.mons[s.species])?.lead ?? 0.002);
  const out: {pair: [number, number]; p: number}[] = [];
  for (let i = 0; i < theirs.length; i++) for (let j = i + 1; j < theirs.length; j++) out.push({pair: [i, j], p: rate[i] * rate[j]});
  const sum = out.reduce((a, b) => a + b.p, 0) || 1;
  return out.map(x => ({...x, p: x.p / sum})).sort((a, b) => b.p - a.p);
}

const has = (s: PokemonSet, moves: string[]) => s.moves.some(m => moves.includes(m));
const SPEED_CONTROL = ['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave'];
const WEATHER_ABUSE: Record<string, string> = {'Swift Swim': 'Rain', Chlorophyll: 'Sun', 'Sand Rush': 'Sand', 'Slush Rush': 'Snow'};
const abilityOf = (s: PokemonSet) => {
  const f = SPECIES[battleForme(s)];
  return f?.mega ? f.abilities[0] : s.ability;
};

/** How my two leads fare against one of their lead pairs. */
function duelScore(d: Duel[][], lead: number[], pair: number[]): number {
  // Each of their leads is handled by my better answer; each of my leads suffers their worse threat.
  const answer = pair.reduce((a, j) => a + Math.max(...lead.map(i => d[i][j].value)), 0) / pair.length;
  return answer;
}

/** Score one plan (bring + lead) and explain it. */
export function scorePlan(
  mine: PokemonSet[], theirs: PokemonSet[], d: Duel[][], pairs: {pair: [number, number]; p: number}[],
  bring: number[], lead: number[], expected?: [number, number],
): Plan {
  // Bring: every opponent should have an answer among my four.
  const answers = theirs.map((_, j) => Math.max(...bring.map(i => d[i][j].value)));
  const bringScore = answers.reduce((a, v) => a + v - (v <= 0 ? 1 : 0), 0) / theirs.length;
  // Leads: weighted over their likely lead pairs (or the one the user expects).
  const weights = expected ? [{pair: expected, p: 1}] : pairs.slice(0, 6);
  const wsum = weights.reduce((a, b) => a + b.p, 0) || 1;
  let leadScore = weights.reduce((a, w) => a + w.p * duelScore(d, lead, w.pair), 0) / wsum;

  const leads = lead.map(i => mine[i]);
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (leads.some(s => has(s, ['Fake Out']))) { leadScore += 0.3; reasons.push(`${leads.find(s => has(s, ['Fake Out']))!.species} brings Fake Out pressure`); }
  const sc = leads.find(s => has(s, SPEED_CONTROL));
  if (sc) { leadScore += 0.3; reasons.push(`${sc.species} sets up speed control (${sc.moves.find(m => SPEED_CONTROL.includes(m))})`); }
  const weather = teamField(leads).weather;
  if (weather) {
    const abusers = bring.map(i => mine[i]).filter(s => WEATHER_ABUSE[abilityOf(s)] === weather);
    if (abusers.length) { leadScore += 0.4; reasons.push(`${leads.find(s => teamField([s]).weather)!.species} sets ${weather.toLowerCase()} for ${abusers.map(s => s.species).join(', ')}`); }
  }

  // Facts against their most likely leads.
  const top = expected ?? pairs[0]?.pair;
  if (top) {
    for (const j of top) {
      const best = lead.map(i => ({i, x: d[i][j]})).sort((a, b) => b.x.value - a.x.value)[0];
      const them = theirs[j].species;
      if (best.x.myKo && best.x.myKo <= 2) {
        reasons.push(`${mine[best.i].species} ${best.x.faster ? 'outspeeds and ' : ''}${best.x.myKo === 1 ? 'OHKOs' : '2HKOs'} ${them} (${best.x.myMove})`);
      }
      for (const i of lead) {
        const x = d[i][j];
        if (x.theirKo === 1 && x.faster !== true) warnings.push(`${them} OHKOs ${mine[i].species} first (${x.theirMove})`);
      }
    }
  }
  theirs.forEach((t, j) => {
    if (answers[j] <= 0) warnings.push(`Nothing in your four handles ${t.species}`);
  });

  const raw = bringScore * 0.5 + leadScore * 0.5;
  return {bring, lead, bringScore, leadScore, score: Math.round(50 + raw * 15), reasons: reasons.slice(0, 4), warnings: [...new Set(warnings)].slice(0, 4)};
}

const combos = <T,>(arr: T[], k: number): T[][] =>
  k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map(c => [x, ...c]));

/** Every bring-4 with every lead pair (15 × 6 for a full team), best first. */
export function rankPlans(mine: PokemonSet[], theirs: PokemonSet[], usage: UsageSource, field: SpeedField, expected?: [number, number]) {
  const d = duels(mine, theirs, field);
  const pairs = leadPairs(theirs, usage);
  const idx = mine.map((_, i) => i);
  const plans: Plan[] = [];
  for (const bring of combos(idx, Math.min(4, mine.length))) {
    for (const lead of combos(bring, Math.min(2, bring.length))) plans.push(scorePlan(mine, theirs, d, pairs, bring, lead, expected));
  }
  plans.sort((a, b) => b.score - a.score || b.leadScore - a.leadScore);
  return {plans, duels: d, pairs};
}

/** For their other likely leads: the best lead pair out of the chosen four. */
export function leadAdvice(mine: PokemonSet[], d: Duel[][], pairs: {pair: [number, number]; p: number}[], bring: number[], current: number[]) {
  const options = combos(bring, 2);
  return pairs.slice(0, 4).map(({pair, p}) => {
    const best = options.map(l => ({l, s: duelScore(d, l, pair)})).sort((a, b) => b.s - a.s)[0];
    const same = best.l.every(i => current.includes(i));
    return {pair, p, lead: best.l, same, names: best.l.map(i => mine[i].species)};
  });
}
