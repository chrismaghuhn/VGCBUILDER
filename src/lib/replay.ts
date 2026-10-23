import {SPECIES, type UsageSource} from './data';
import {metaSet} from './calc';
import {keyOf} from './playmat';
import {battleForme, blankSet, type MatAction, type MatField, type MatSide, type Playmat, type PokemonSet} from './team';

/**
 * Showdown replays: fetch, parse the battle log into turns, and lay a turn out on the Playmat.
 *
 * A turn's board is the field right before the first move of that turn (after switches and Mega
 * Evolution), so the moves of the turn can be drawn as arrows between the Pokémon that were there.
 */

export type PSide = 'p1' | 'p2';
type Stage = 'atk' | 'def' | 'spa' | 'spd' | 'spe';
const STAGES: Stage[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/** One move in a turn; Pokémon are team indices of their side. */
export interface ReplayMove {
  side: PSide;
  user: number;
  move: string;
  targets: {side: PSide; index: number}[];
  /** What really happened to each target ("−34%", "KO", "Protect", "miss", "immune"), keyed "p2:1". */
  results: Record<string, string>;
}

export interface ReplayLine {
  side: PSide | null;
  text: string;
  kind: 'move' | 'damage' | 'faint' | 'switch' | 'field' | 'info' | 'result';
}

export interface ReplayField {
  weather: MatField['weather'];
  terrain: MatField['terrain'];
  trickRoom: boolean;
  tailwind: Record<PSide, boolean>;
  reflect: Record<PSide, boolean>;
  lightScreen: Record<PSide, boolean>;
}

export interface ReplayStep {
  /** 0 = the leads, then turn 1, 2 … */
  turn: number;
  active: Record<PSide, [number | null, number | null]>;
  /** HP in % and stat stages, keyed "p1:0". */
  hp: Record<string, number>;
  boosts: Record<string, Partial<Record<Stage, number>>>;
  field: ReplayField;
  /** Pokémon that have Mega Evolved by now, "p1:3". */
  megas: string[];
  moves: ReplayMove[];
  log: ReplayLine[];
  /** Pokémon that fainted during this step. */
  faints: number;
}

export interface Revealed {
  moves: string[];
  item?: string;
  ability?: string;
  /** Mega forme it evolved into. */
  mega?: string;
}

export interface ParsedReplay {
  id: string;
  format: string;
  players: Record<PSide, string>;
  winner?: string;
  /** Species from team preview (plus any that only showed up later). */
  teams: Record<PSide, string[]>;
  revealed: Record<PSide, Revealed[]>;
  /** Team indices that came into battle. */
  brought: Record<PSide, number[]>;
  steps: ReplayStep[];
}

// ------------------------------------------------------------------ Fetch

/** The replay id from a replay URL (keeps the password part of private replays), or null. */
export function replayId(input: string): string | null {
  const m = /replay\.pokemonshowdown\.com\/(?:[a-z0-9]+\/)?([a-z0-9]+-[0-9]+(?:-[a-z0-9]+pw)?)/i.exec(input.trim());
  if (m) return m[1].toLowerCase();
  const bare = /^([a-z0-9]+-[0-9]+(?:-[a-z0-9]+pw)?)$/i.exec(input.trim());
  return bare ? bare[1].toLowerCase() : null;
}

/** Which side the link was opened from ("?p2"), if it says. */
export const replayPerspective = (input: string): PSide | null => (/[?&]p2\b/.test(input) ? 'p2' : /[?&]p1\b/.test(input) ? 'p1' : null);

export async function fetchReplay(id: string): Promise<ParsedReplay> {
  const res = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Replay not found.' : `Showdown answered ${res.status}.`);
  const data = await res.json() as {id: string; log: string; format?: string};
  return parseReplay(data.log, data.id, data.format);
}

// ------------------------------------------------------------------ Parse

const WEATHER: Record<string, ReplayField['weather']> = {
  RainDance: 'Rain', PrimordialSea: 'Rain', SunnyDay: 'Sun', DesolateLand: 'Sun', Sandstorm: 'Sand', Snowscape: 'Snow', Snow: 'Snow', Hail: 'Snow', none: '',
};
const TERRAIN: Record<string, ReplayField['terrain']> = {
  'Electric Terrain': 'Electric', 'Grassy Terrain': 'Grassy', 'Psychic Terrain': 'Psychic', 'Misty Terrain': 'Misty',
};
const PROTECTS = /Protect|Detect|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark|Obstruct|Max Guard|Wide Guard|Quick Guard/;
const STATUS: Record<string, string> = {brn: 'burned', par: 'paralyzed', slp: 'asleep', frz: 'frozen', psn: 'poisoned', tox: 'badly poisoned'};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const speciesOf = (details: string) => details.split(',')[0].trim();
const baseOf = (species: string) => species.split('-')[0];
const parseHp = (s: string) => {
  if (!s) return 100;
  if (s.startsWith('0')) return 0;
  const [cur, max] = s.split(' ')[0].split('/').map(v => parseInt(v, 10));
  return max ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 100;
};
const k = (side: PSide, i: number) => `${side}:${i}`;

export function parseReplay(log: string, id = '', format = ''): ParsedReplay {
  const players: Record<PSide, string> = {p1: 'Player 1', p2: 'Player 2'};
  const teams: Record<PSide, string[]> = {p1: [], p2: []};
  const revealed: Record<PSide, Revealed[]> = {p1: [], p2: []};
  const brought: Record<PSide, number[]> = {p1: [], p2: []};
  const active: Record<PSide, [number | null, number | null]> = {p1: [null, null], p2: [null, null]};
  const hp: Record<string, number> = {};
  const boosts: Record<string, Partial<Record<Stage, number>>> = {};
  const field: ReplayField = {weather: '', terrain: '', trickRoom: false, tailwind: {p1: false, p2: false}, reflect: {p1: false, p2: false}, lightScreen: {p1: false, p2: false}};
  const steps: ReplayStep[] = [];
  const megas: string[] = [];
  let winner: string | undefined;

  // The step being read, and the board frozen right before its first move.
  let cur: {turn: number; log: ReplayLine[]; moves: ReplayMove[]; faints: number; board: Omit<ReplayStep, 'turn' | 'moves' | 'log' | 'faints'> | null} | null = null;
  let last: ReplayMove | null = null;

  const teamIndex = (side: PSide, species: string) => {
    let i = teams[side].indexOf(species);
    if (i < 0) i = teams[side].findIndex(s => s.endsWith('-*') ? baseOf(s) === baseOf(species) : false);
    if (i < 0) i = teams[side].findIndex(s => baseOf(s) === baseOf(species) && !teams[side].includes(species));
    if (i < 0) { teams[side].push(species); i = teams[side].length - 1; }
    revealed[side][i] ??= {moves: []};
    return i;
  };
  /** "p2a: Espeon" → side and team index of whoever is on that slot. */
  const who = (ref?: string): {side: PSide; index: number; slot: 0 | 1} | null => {
    const m = /^(p[12])([ab])?:?\s*(.*)$/.exec(ref ?? '');
    if (!m || !m[2]) return null;
    const side = m[1] as PSide, slot = m[2] === 'a' ? 0 : 1;
    const index = active[side][slot];
    return index === null ? null : {side, index, slot};
  };
  const name = (side: PSide, i: number) => {
    return revealed[side][i]?.mega ?? teams[side][i];
  };
  const say = (side: PSide | null, text: string, kind: ReplayLine['kind'] = 'info') => cur?.log.push({side, text, kind});
  const freeze = () => {
    if (!cur || cur.board) return;
    const act = clone(active);
    // Fainted Pokémon that weren't replaced leave an empty spot.
    for (const side of ['p1', 'p2'] as PSide[]) act[side] = act[side].map(i => (i !== null && hp[k(side, i)] === 0 ? null : i)) as [number | null, number | null];
    cur.board = {active: act, hp: clone(hp), boosts: clone(boosts), field: clone(field), megas: [...megas]};
  };
  const finish = () => {
    if (!cur) return;
    freeze();
    steps.push({turn: cur.turn, ...cur.board!, moves: cur.moves, log: cur.log, faints: cur.faints});
    cur = null;
  };
  /** "[from] item: Life Orb" / "[of] p2a: X": who the item or ability belongs to. */
  const reveal = (parts: string[], subject: ReturnType<typeof who>) => {
    const from = parts.find(p => p.startsWith('[from]'));
    if (!from) return;
    const of = parts.find(p => p.startsWith('[of]'));
    const owner = of ? who(of.slice(5).trim()) : subject;
    if (!owner) return;
    const r = revealed[owner.side][owner.index];
    const item = /\[from\] item: (.+)/.exec(from)?.[1];
    const ability = /\[from\] ability: (.+)/.exec(from)?.[1];
    if (item) r.item = item;
    if (ability) r.ability = ability;
  };
  const boost = (key: string, stat: string, by: number, set = false) => {
    if (!STAGES.includes(stat as Stage)) return;
    const b = (boosts[key] ??= {});
    b[stat as Stage] = Math.max(-6, Math.min(6, (set ? 0 : b[stat as Stage] ?? 0) + by));
  };

  for (const raw of log.split('\n')) {
    if (!raw.startsWith('|')) continue;
    const parts = raw.slice(1).split('|');
    const cmd = parts[0];
    const a = parts.slice(1);
    switch (cmd) {
      case 'player':
        if (a[1]) players[a[0] as PSide] = a[1];
        break;
      case 'poke': {
        const side = a[0] as PSide;
        teams[side].push(speciesOf(a[1]));
        revealed[side].push({moves: []});
        break;
      }
      case 'start':
        cur = {turn: 0, log: [], moves: [], faints: 0, board: null};
        break;
      case 'turn':
        finish();
        cur = {turn: +a[0], log: [], moves: [], faints: 0, board: null};
        last = null;
        break;
      case 'win':
        winner = a[0];
        say(null, `${a[0]} won`, 'info');
        break;
      case 'tie':
        say(null, 'Tie', 'info');
        break;
      case 'switch': case 'drag': case 'replace': {
        const m = /^(p[12])([ab])/.exec(a[0]);
        if (!m) break;
        const side = m[1] as PSide, slot = m[2] === 'a' ? 0 : 1;
        const index = teamIndex(side, speciesOf(a[1]));
        const old = active[side][slot];
        if (old !== null) delete boosts[k(side, old)];
        active[side][slot] = index;
        hp[k(side, index)] = parseHp(a[2]);
        if (!brought[side].includes(index)) brought[side].push(index);
        last = null;
        const mega = speciesOf(a[1]);
        if (SPECIES[mega]?.mega) { revealed[side][index].mega = mega; if (!megas.includes(k(side, index))) megas.push(k(side, index)); }
        say(side, cur?.turn === 0 && !cur.board ? `Lead: ${name(side, index)}` : old !== null && hp[k(side, old)] > 0 ? `${name(side, old)} → ${name(side, index)}` : `${name(side, index)} comes in`, 'switch');
        break;
      }
      case 'detailschange': {
        const p = who(a[0]);
        const sp = speciesOf(a[1]);
        if (p && SPECIES[sp]?.mega) {
          revealed[p.side][p.index].mega = sp;
          if (!megas.includes(k(p.side, p.index))) megas.push(k(p.side, p.index));
        }
        break;
      }
      case '-mega': {
        const p = who(a[0]);
        if (!p) break;
        if (a[2]) revealed[p.side][p.index].item = a[2];
        say(p.side, `${teams[p.side][p.index]} Mega Evolved`, 'info');
        break;
      }
      case 'move': {
        freeze();
        const p = who(a[0]);
        if (!p || !cur) break;
        const move = a[1];
        const r = revealed[p.side][p.index];
        const called = a.some(x => /^\[from\]\s*(move:|ability:)/.test(x) && !/lockedmove/.test(x));
        if (!called && move !== 'Struggle' && !r.moves.includes(move)) r.moves.push(move);
        const spread = a.find(x => x.startsWith('[spread]'));
        let targets: {side: PSide; index: number}[] = [];
        if (spread) {
          targets = spread.slice(8).trim().split(',').filter(Boolean).map(s => who(s.trim())).filter((t): t is NonNullable<typeof t> => !!t)
            .map(t => ({side: t.side, index: t.index}));
        } else {
          const t = who(a[2]);
          if (t && !(t.side === p.side && t.index === p.index)) targets = [{side: t.side, index: t.index}];
        }
        last = {side: p.side, user: p.index, move, targets, results: {}};
        // One arrow per Pokémon and turn: the first move (Dancer, Instruct … only go to the log).
        if (!called && !cur.moves.some(x => x.side === p.side && x.user === p.index)) cur.moves.push(last);
        const tn = targets.map(t => name(t.side, t.index)).join(', ');
        say(p.side, `${name(p.side, p.index)}: ${move}${tn ? ` → ${tn}` : ''}${a.includes('[miss]') ? ' (missed)' : ''}`, 'move');
        break;
      }
      case 'cant': {
        freeze();
        const p = who(a[0]);
        if (p) say(p.side, `${name(p.side, p.index)} can't move (${a[1]})`, 'info');
        break;
      }
      case '-damage': case '-heal': case '-sethp': {
        const p = who(a[0]);
        if (!p) break;
        const key = k(p.side, p.index);
        const before = hp[key] ?? 100;
        const after = parseHp(a[1]);
        hp[key] = after;
        reveal(a, p);
        const from = a.find(x => x.startsWith('[from]'))?.replace(/\[from\]\s*(item: |ability: )?/, '');
        if (cmd === '-damage' && !from && last && last.targets.some(t => t.side === p.side && t.index === p.index)) {
          last.results[key] = after === 0 ? 'KO' : `−${before - after}%`;
        }
        if (a.includes('[silent]')) break;
        const diff = after - before;
        say(p.side, `${name(p.side, p.index)} ${diff >= 0 ? '+' : '−'}${Math.abs(diff)}% → ${after}%${from ? ` (${from})` : ''}`, cmd === '-damage' ? 'damage' : 'result');
        break;
      }
      case 'faint': {
        const p = who(a[0]);
        if (!p) break;
        hp[k(p.side, p.index)] = 0;
        if (cur) cur.faints++;
        say(p.side, `${name(p.side, p.index)} fainted`, 'faint');
        break;
      }
      case '-activate': {
        const p = who(a[0]);
        if (p && PROTECTS.test(a[1] ?? '') && last) {
          last.results[k(p.side, p.index)] = 'Protect';
          say(p.side, `${name(p.side, p.index)} protected itself`, 'result');
        }
        if (p) reveal(a, p);
        break;
      }
      case '-miss': {
        const t = who(a[1]);
        if (t && last) last.results[k(t.side, t.index)] = 'miss';
        break;
      }
      case '-immune': {
        const p = who(a[0]);
        if (p && last) last.results[k(p.side, p.index)] = 'immune';
        if (p) say(p.side, `${name(p.side, p.index)} is immune`, 'result');
        break;
      }
      case '-crit': say(null, 'Critical hit!', 'result'); break;
      case '-supereffective': {
        const p = who(a[0]);
        if (p && last) say(p.side, `Super effective on ${name(p.side, p.index)}`, 'result');
        break;
      }
      case '-status': {
        const p = who(a[0]);
        if (p) { say(p.side, `${name(p.side, p.index)} is ${STATUS[a[1]] ?? a[1]}`, 'info'); reveal(a, p); }
        break;
      }
      case '-boost': case '-unboost': {
        const p = who(a[0]);
        if (!p) break;
        const n = +a[2] * (cmd === '-boost' ? 1 : -1);
        boost(k(p.side, p.index), a[1], n);
        reveal(a, p);
        if (n) say(p.side, `${name(p.side, p.index)} ${a[1].toUpperCase()} ${n > 0 ? '+' : ''}${n}`, 'info');
        break;
      }
      case '-setboost': {
        const p = who(a[0]);
        if (p) boost(k(p.side, p.index), a[1], +a[2], true);
        break;
      }
      case '-clearboost': {
        const p = who(a[0]);
        if (p) delete boosts[k(p.side, p.index)];
        break;
      }
      case '-clearallboost':
        for (const key of Object.keys(boosts)) delete boosts[key];
        break;
      case '-clearnegativeboost': {
        const p = who(a[0]);
        const b = p && boosts[k(p.side, p.index)];
        if (b) for (const s of STAGES) if ((b[s] ?? 0) < 0) delete b[s];
        break;
      }
      case '-ability': {
        const p = who(a[0]);
        if (p) { revealed[p.side][p.index].ability = a[1]; reveal(a, p); }
        break;
      }
      case '-item': case '-enditem': {
        const p = who(a[0]);
        if (!p) break;
        // Frisk/Trick reveal or swap items; the holder of the line is who holds it (or held it).
        if (!a.some(x => /\[from\] ability: Frisk/.test(x))) revealed[p.side][p.index].item ??= a[1];
        if (cmd === '-enditem') say(p.side, `${name(p.side, p.index)}: ${a[1]} ${a.includes('[eat]') ? 'eaten' : 'used'}`, 'info');
        break;
      }
      case '-weather': {
        if (a.includes('[upkeep]')) break;
        const w = WEATHER[a[0]];
        if (w === undefined) break;
        field.weather = w;
        const p = who(a.find(x => x.startsWith('[of]'))?.slice(5).trim());
        if (p) reveal(a, p);
        say(null, w ? `${w === 'Snow' ? 'Snow' : w} started` : 'The weather ended', 'field');
        break;
      }
      case '-fieldstart': case '-fieldend': {
        const what = a[0].replace(/^move: /, '');
        const on = cmd === '-fieldstart';
        if (what === 'Trick Room') field.trickRoom = on;
        else if (TERRAIN[what]) field.terrain = on ? TERRAIN[what] : '';
        else break;
        const p = who(a.find(x => x.startsWith('[of]'))?.slice(5).trim());
        if (p) reveal(a, p);
        say(null, `${what} ${on ? 'started' : 'ended'}`, 'field');
        break;
      }
      case '-sidestart': case '-sideend': {
        const side = a[0].slice(0, 2) as PSide;
        const what = a[1].replace(/^move: /, '');
        const on = cmd === '-sidestart';
        if (what === 'Tailwind') field.tailwind[side] = on;
        else if (what === 'Reflect') field.reflect[side] = on;
        else if (what === 'Light Screen') field.lightScreen[side] = on;
        else if (what === 'Aurora Veil') { field.reflect[side] = on; field.lightScreen[side] = on; }
        else break;
        say(side, `${what} ${on ? 'up' : 'ended'} for ${players[side]}`, 'field');
        break;
      }
      case '-message':
        say(null, a[0], 'info');
        break;
    }
  }
  finish();
  return {id, format, players, winner, teams, revealed, brought, steps};
}

// ------------------------------------------------------------------ Onto the mat

export interface ReplayMat {
  replay: ParsedReplay;
  /** Which player is "you" on the mat. */
  me: PSide;
  /** Current step (index into replay.steps). */
  step: number;
  /** Notes per turn number. */
  turnNotes: Record<number, string>;
  /** Their team for the mat's bottom side. */
  mine: PokemonSet[];
}

/** A set for a Pokémon from the replay: my own set if it's on my team, else the meta set, with what the replay revealed. */
function replaySet(species: string, rev: Revealed | undefined, mySets: PokemonSet[], usage: UsageSource): PokemonSet {
  const own = mySets.find(s => s.species === species || baseOf(s.species) === baseOf(species) && SPECIES[s.species]?.num === SPECIES[species]?.num);
  let set: PokemonSet;
  if (own) set = clone(own);
  else if (SPECIES[species]) set = metaSet(species, usage);
  else set = blankSet(species);
  if (!rev) return set;
  if (rev.mega && SPECIES[rev.mega]?.requiredItem) set.item = SPECIES[rev.mega].requiredItem!;
  else if (rev.item && !own) set.item = rev.item;
  if (rev.ability && !own && !SPECIES[battleForme(set)]?.mega) set.ability = rev.ability;
  // Moves it really used come first; the meta set fills the rest.
  const used = rev.moves.filter(m => !set.moves.includes(m));
  if (used.length) set.moves = [...rev.moves, ...set.moves.filter(m => !rev.moves.includes(m))].slice(0, 4);
  return set;
}

/** The side with more of my species is me; then the link's ?p2; then player 1. */
export function guessMe(replay: ParsedReplay, mySets: PokemonSet[], hint: PSide | null): PSide {
  const mine = new Set(mySets.map(s => SPECIES[s.species]?.num));
  const overlap = (side: PSide) => replay.teams[side].filter(sp => mine.has(SPECIES[sp]?.num)).length;
  const p1 = overlap('p1'), p2 = overlap('p2');
  if (Math.max(p1, p2) >= 3 && p1 !== p2) return p1 > p2 ? 'p1' : 'p2';
  return hint ?? 'p1';
}

const other = (s: PSide): PSide => (s === 'p1' ? 'p2' : 'p1');

/** A new Playmat for a replay, showing its first step. */
export function replayPlaymat(replay: ParsedReplay, me: PSide, mySets: PokemonSet[], usage: UsageSource, turnNotes: Record<number, string> = {}): Playmat {
  const them = other(me);
  const mine = replay.teams[me].map((sp, i) => replaySet(sp, replay.revealed[me][i], mySets, usage));
  const opp = replay.teams[them].map((sp, i) => replaySet(sp, replay.revealed[them][i], [], usage));
  const base: Playmat = {
    name: `${replay.players[me]} vs ${replay.players[them]}`,
    opp,
    mine: [null, null],
    theirs: [null, null],
    brought: replay.brought[me],
    hp: {}, boosts: {},
    field: {weather: '', terrain: '', trickRoom: false, tailwind: {mine: false, theirs: false}, reflect: {mine: false, theirs: false}, lightScreen: {mine: false, theirs: false}},
    notes: [],
    replay: {replay, me, step: 0, turnNotes, mine},
  };
  return showStep(base, 0);
}

/** Lay step `n` of the mat's replay out on the board (spots, HP, stages, field, arrows). */
export function showStep(mat: Playmat, n: number): Playmat {
  const r = mat.replay;
  if (!r) return mat;
  const step = r.replay.steps[Math.max(0, Math.min(n, r.replay.steps.length - 1))];
  if (!step) return mat;
  const me = r.me, them = other(me);
  const matSide = (s: PSide): MatSide => (s === me ? 'mine' : 'theirs');
  const key = (s: PSide, i: number) => keyOf(matSide(s), i);
  const hp: Playmat['hp'] = {};
  const boosts: Playmat['boosts'] = {};
  for (const [rk, v] of Object.entries(step.hp)) { const [s, i] = rk.split(':'); hp[key(s as PSide, +i)] = v; }
  for (const [rk, v] of Object.entries(step.boosts)) { const [s, i] = rk.split(':'); boosts[key(s as PSide, +i)] = v; }
  const onBoard = new Set([...step.active[me].map(i => i === null ? '' : key(me, i)), ...step.active[them].map(i => i === null ? '' : key(them, i))]);
  const actions: Record<string, MatAction> = {};
  for (const m of step.moves) {
    const from = key(m.side, m.user);
    if (!onBoard.has(from)) continue;
    const results: Record<string, string> = {};
    for (const [rk, v] of Object.entries(m.results)) { const [s, i] = rk.split(':'); results[key(s as PSide, +i)] = v; }
    actions[from] = {move: m.move, targets: m.targets.map(t => key(t.side, t.index)).filter(t => onBoard.has(t)), results};
  }
  const f = step.field;
  return {
    ...mat,
    mine: step.active[me],
    theirs: step.active[them],
    hp, boosts, actions,
    megas: Object.fromEntries((step.megas ?? []).map(rk => { const [s, i] = rk.split(':'); return [key(s as PSide, +i), true]; })),
    field: {
      weather: f.weather, terrain: f.terrain, trickRoom: f.trickRoom,
      tailwind: {mine: f.tailwind[me], theirs: f.tailwind[them]},
      reflect: {mine: f.reflect[me], theirs: f.reflect[them]},
      lightScreen: {mine: f.lightScreen[me], theirs: f.lightScreen[them]},
    },
    replay: {...r, step: steps(r).indexOf(step)},
  };
}
const steps = (r: ReplayMat) => r.replay.steps;
