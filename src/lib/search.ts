import {ITEM_NAMES, MOVES, SPECIES, TYPES, type UsageSource} from './data';
import {ROLES} from './analysis';
import {ABBREVIATIONS, EXTRA_ALIASES, EXTRA_CONCEPTS} from './concepts';

/** A searchable idea like "speed control": a set of moves and/or abilities. */
export interface Concept {
  key: string;
  label: string;
  aliases: string[];
  moves: string[];
  abilities: string[];
  /** Items count only where the mon actually runs them (usage data). */
  items: string[];
  desc?: string;
}

const SPREAD_TARGETS = ['allAdjacentFoes', 'allAdjacent'];
const allMoves = Object.keys(MOVES);
const role = (key: string) => ROLES.find(r => r.key === key)!;

export const CONCEPTS: Concept[] = [
  {key: 'speed', label: 'Speed Control', aliases: ['speed control', 'speedcontrol', 'speed'], moves: role('speed').moves!, abilities: []},
  {key: 'tailwind', label: 'Tailwind', aliases: ['tailwind', 'rückenwind'], moves: ['Tailwind'], abilities: []},
  {key: 'trickroom', label: 'Trick Room', aliases: ['trick room', 'trickroom', 'tr'], moves: ['Trick Room'], abilities: []},
  {key: 'fakeout', label: 'Fake Out', aliases: ['fake out', 'fakeout', 'mogelhieb'], moves: ['Fake Out'], abilities: []},
  {key: 'pivot', label: 'Pivot', aliases: ['pivot', 'pivoting'], moves: ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport', 'Chilly Reception', 'Shed Tail'], abilities: []},
  {key: 'redirect', label: 'Redirection', aliases: ['redirection', 'redirect', 'follow me'], moves: role('redirect').moves!, abilities: role('redirect').abilities!},
  {key: 'atkdrop', label: 'Atk-Drop', aliases: ['atk-drop', 'atk drop', 'atkdrop'], moves: role('intimidate').moves!, abilities: role('intimidate').abilities!},
  {key: 'spadrop', label: 'SpA-Drop', aliases: ['spa-drop', 'spa drop', 'spadrop'], moves: role('spadrop').moves!, abilities: []},
  {key: 'recovery', label: 'Recovery', aliases: ['recovery', 'heilung', 'heal'], moves: ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Synthesis', 'Moonlight', 'Morning Sun', 'Milk Drink', 'Shore Up', 'Strength Sap', 'Wish', 'Rest', 'Life Dew', 'Jungle Healing', 'Lunar Blessing'], abilities: ['Regenerator']},
  {key: 'setup', label: 'Setup', aliases: ['setup', 'boost'], moves: ['Swords Dance', 'Nasty Plot', 'Calm Mind', 'Dragon Dance', 'Bulk Up', 'Quiver Dance', 'Shell Smash', 'Coil', 'Belly Drum', 'Iron Defense', 'Shift Gear', 'Agility', 'Tidy Up', 'Victory Dance', 'Geomancy', 'Curse', 'Work Up', 'Growth', 'Howl', 'Coaching', 'Cosmic Power', 'Amnesia', 'Autotomize', 'Rock Polish'], abilities: []},
  {key: 'screens', label: 'Screens', aliases: ['screens', 'screen', 'reflect', 'light screen'], moves: ['Reflect', 'Light Screen', 'Aurora Veil'], abilities: []},
  {key: 'protect', label: 'Protect', aliases: ['protect', 'schutzschild'], moves: role('protect').moves!, abilities: []},
  {key: 'guard', label: 'Wide/Quick Guard', aliases: ['wide guard', 'quick guard', 'guard'], moves: role('guard').moves!, abilities: []},
  {key: 'status', label: 'Status', aliases: ['status', 'status spreader'], moves: ['Will-O-Wisp', 'Thunder Wave', 'Spore', 'Sleep Powder', 'Yawn', 'Toxic', 'Glare', 'Nuzzle', 'Hypnosis', 'Dark Void', 'Lovely Kiss', 'Sing', 'Stun Spore', 'Poison Powder'], abilities: []},
  {key: 'disrupt', label: 'Taunt/Encore', aliases: ['disrupt', 'disruption', 'störung'], moves: ['Taunt', 'Encore', 'Disable', 'Imprison', 'Quash'], abilities: []},
  {key: 'helping', label: 'Helping Hand', aliases: ['helping hand', 'helpinghand'], moves: ['Helping Hand'], abilities: []},
  {key: 'spread', label: 'Spread', aliases: ['spread', 'spread move', 'spread moves'], moves: allMoves.filter(m => MOVES[m].cat !== 'Status' && SPREAD_TARGETS.includes(MOVES[m].target)), abilities: []},
  {key: 'priority', label: 'Priority', aliases: ['priority', 'prio', 'priorität'], moves: allMoves.filter(m => (MOVES[m].prio ?? 0) > 0 && MOVES[m].cat !== 'Status').concat('Grassy Glide'), abilities: ['Prankster', 'Gale Wings']},
  {key: 'rain', label: 'Rain', aliases: ['regen', 'rain'], moves: ['Rain Dance'], abilities: ['Drizzle', 'Swift Swim', 'Rain Dish', 'Hydration', 'Dry Skin']},
  {key: 'sun', label: 'Sun', aliases: ['sonne', 'sun'], moves: ['Sunny Day'], abilities: ['Drought', 'Chlorophyll', 'Solar Power', 'Mega Sol', 'Harvest', 'Leaf Guard', 'Flower Gift']},
  {key: 'sand', label: 'Sand', aliases: ['sand', 'sandstorm', 'sandsturm'], moves: ['Sandstorm'], abilities: ['Sand Stream', 'Sand Rush', 'Sand Force', 'Sand Veil']},
  {key: 'snow', label: 'Snow', aliases: ['schnee', 'snow', 'hail', 'hagel'], moves: ['Snowscape', 'Aurora Veil'], abilities: ['Snow Warning', 'Slush Rush', 'Ice Body', 'Snow Cloak']},
  {key: 'terrain', label: 'Terrain', aliases: ['terrain', 'feld'], moves: ['Grassy Terrain', 'Psychic Terrain', 'Electric Terrain', 'Misty Terrain'], abilities: ['Grassy Surge', 'Psychic Surge', 'Electric Surge', 'Misty Surge']},
].map(c => ({...c, items: [] as string[], aliases: [...c.aliases, ...(EXTRA_ALIASES[c.key] ?? [])]}));

const LEGAL_ABILITIES = new Set(Object.values(SPECIES).flatMap(s => s.abilities));
const LEGAL_ITEMS = new Set(ITEM_NAMES);
// Base concepts first: extra concepts with the same alias override them.
for (const c of EXTRA_CONCEPTS) CONCEPTS.push({...c, items: c.items ?? []});
for (const c of CONCEPTS) {
  c.moves = c.moves.filter(m => MOVES[m]);
  c.abilities = c.abilities.filter(a => LEGAL_ABILITIES.has(a));
  c.items = c.items.filter(i => LEGAL_ITEMS.has(i));
}

/** Quick picks shown under the search box. */
export const QUICK_CONCEPTS = ['speed', 'tailwind', 'trickroom', 'fakeout', 'pivot', 'redirect', 'atkdrop', 'recovery', 'setup', 'priority', 'spread', 'guard', 'rain', 'sun', 'sand', 'snow'];

const TYPE_ALIASES: Record<string, string> = {
  feuer: 'Fire', wasser: 'Water', pflanze: 'Grass', elektro: 'Electric', eis: 'Ice', kampf: 'Fighting',
  gift: 'Poison', boden: 'Ground', flug: 'Flying', psycho: 'Psychic', käfer: 'Bug', kaefer: 'Bug',
  gestein: 'Rock', geist: 'Ghost', drache: 'Dragon', unlicht: 'Dark', stahl: 'Steel', fee: 'Fairy',
};
for (const t of TYPES) TYPE_ALIASES[t.toLowerCase()] = t;

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9äöüß\- ]/g, ' ').replace(/\s+/g, ' ').trim();
const ALL_ABILITIES = [...new Set(Object.values(SPECIES).flatMap(s => s.abilities))];
const MOVE_BY_NORM = new Map(allMoves.map(m => [norm(m), m]));
const ABILITY_BY_NORM = new Map(ALL_ABILITIES.map(a => [norm(a), a]));
const ITEM_BY_NORM = new Map(ITEM_NAMES.map(i => [norm(i), i]));
const CONCEPT_BY_ALIAS = new Map(CONCEPTS.flatMap(c => c.aliases.map(a => [norm(a), c] as const)));

/** Abbreviations whose moves/items don't exist in this format ("specs", "hp"). */
export const NOT_IN_FORMAT = new Map<string, string>();

// Abbreviations ("eq", "tw", "lo") become small concepts; existing aliases ("tr", "para") win.
for (const [abbr, names] of Object.entries(ABBREVIATIONS)) {
  const moves = names.filter(n => MOVES[n]);
  const items = names.filter(n => LEGAL_ITEMS.has(n));
  if (!moves.length && !items.length) { NOT_IN_FORMAT.set(abbr, names.join(' / ')); continue; }
  if (CONCEPT_BY_ALIAS.has(abbr) || MOVE_BY_NORM.has(abbr)) continue;
  CONCEPT_BY_ALIAS.set(abbr, {key: `abbr-${abbr}`, label: [...moves, ...items].join(' / '), aliases: [abbr], moves, abilities: [], items});
}

export type Term =
  | {kind: 'concept'; concept: Concept; text: string}
  | {kind: 'type'; type: string; text: string}
  | {kind: 'move'; move: string; text: string}
  | {kind: 'ability'; ability: string; text: string}
  | {kind: 'item'; item: string; text: string}
  | {kind: 'text'; text: string};

/** Recognise the longest known phrase at each position ("speed control", "close combat"). */
function parseGroup(group: string): Term[] {
  const words = norm(group).split(' ').filter(Boolean);
  const terms: Term[] = [];
  let i = 0;
  const knownNames = [...MOVE_BY_NORM.keys(), ...ABILITY_BY_NORM.keys(), ...ITEM_BY_NORM.keys()];
  while (i < words.length) {
    let found: Term | null = null;
    let len = 0;
    // Longest phrase first; per length an exact name beats a half-typed one ("speed con", "close com").
    for (let n = Math.min(4, words.length - i); n >= 1 && !found; n--) {
      const phrase = words.slice(i, i + n).join(' ');
      const concept = CONCEPT_BY_ALIAS.get(phrase);
      const move = MOVE_BY_NORM.get(phrase);
      const ability = ABILITY_BY_NORM.get(phrase);
      const item = ITEM_BY_NORM.get(phrase);
      const type = n === 1 ? TYPE_ALIASES[phrase] : undefined;
      if (concept) found = {kind: 'concept', concept, text: phrase};
      else if (type) found = {kind: 'type', type, text: phrase};
      else if (move) found = {kind: 'move', move, text: phrase};
      else if (ability) found = {kind: 'ability', ability, text: phrase};
      else if (item) found = {kind: 'item', item, text: phrase};
      else if (n >= 2) {
        const partial = [...CONCEPT_BY_ALIAS].find(([alias]) => alias.startsWith(phrase))?.[1];
        if (partial) found = {kind: 'concept', concept: partial, text: phrase};
        else if (knownNames.some(k => k.startsWith(phrase))) found = {kind: 'text', text: phrase};
      }
      if (found) len = n;
    }
    if (found) { terms.push(found); i += len; }
    else { terms.push({kind: 'text', text: words[i]}); i++; }
  }
  return terms;
}

/** "a b | c" / "a b oder c": OR between groups, AND inside a group. */
export function parseQuery(q: string): Term[][] {
  return q.split(/\s*\|\s*|\s+oder\s+|\s+or\s+/i).map(parseGroup).filter(g => g.length);
}

export interface Hit {
  name: string;
  usage: number;
  moves: string[];      // matched moves (learnable)
  abilities: string[];  // matched abilities
  items: string[];      // matched items (only ones the mon runs)
}

/** Share of this mon's sets that run the item (0 when unknown). */
const ITEM_MIN_SHARE = 0.05;
const itemShare = (name: string, item: string, usage: UsageSource) => usage.mons[name]?.items.find(([i]) => i === item)?.[1] ?? 0;

type Match = {ok: boolean; moves: string[]; abilities: string[]; items: string[]};

function matchTerm(name: string, t: Term, usage: UsageSource): Match {
  const sp = SPECIES[name];
  const none: Match = {ok: false, moves: [], abilities: [], items: []};
  const yes = (moves: string[] = [], abilities: string[] = [], items: string[] = []): Match => ({ok: true, moves, abilities, items});
  switch (t.kind) {
    case 'type':
      return sp.types.includes(t.type) ? yes() : none;
    case 'move':
      return sp.moves.includes(t.move) ? yes([t.move]) : none;
    case 'ability':
      return sp.abilities.includes(t.ability) ? yes([], [t.ability]) : none;
    case 'item':
      return itemShare(name, t.item, usage) >= ITEM_MIN_SHARE ? yes([], [], [t.item]) : none;
    case 'concept': {
      const moves = t.concept.moves.filter(m => sp.moves.includes(m));
      const abilities = t.concept.abilities.filter(a => sp.abilities.includes(a));
      const items = t.concept.items.filter(i => itemShare(name, i, usage) >= ITEM_MIN_SHARE);
      return moves.length || abilities.length || items.length ? yes(moves, abilities, items) : none;
    }
    case 'text': {
      if (norm(name).includes(t.text)) return yes();
      // Partial words while typing: "speed con", "close com".
      const moves = t.text.length >= 3 ? sp.moves.filter(m => norm(m).includes(t.text)) : [];
      const abilities = t.text.length >= 3 ? sp.abilities.filter(a => norm(a).includes(t.text)) : [];
      return moves.length || abilities.length ? yes(moves, abilities) : none;
    }
  }
}

export function speciesUsageOf(name: string, usage: UsageSource): number {
  return usage.mons[name]?.usage ?? 0;
}

export function search(groups: Term[][], usage: UsageSource): Hit[] {
  const hits: Hit[] = [];
  for (const name of Object.keys(SPECIES)) {
    let best: Hit | null = null;
    for (const group of groups) {
      const moves = new Set<string>();
      const abilities = new Set<string>();
      const items = new Set<string>();
      let ok = true;
      for (const t of group) {
        const r = matchTerm(name, t, usage);
        if (!r.ok) { ok = false; break; }
        r.moves.forEach(m => moves.add(m));
        r.abilities.forEach(a => abilities.add(a));
        r.items.forEach(i => items.add(i));
      }
      if (ok && !best) best = {name, usage: speciesUsageOf(name, usage), moves: [...moves], abilities: [...abilities], items: [...items]};
    }
    if (best) hits.push(best);
  }
  return hits;
}

/** Moves involved in the query (from concepts and named moves), for the move overview. */
export function queryMoves(groups: Term[][]): string[] {
  const out = new Set<string>();
  for (const g of groups) for (const t of g) {
    if (t.kind === 'concept') t.concept.moves.forEach(m => out.add(m));
    if (t.kind === 'move') out.add(t.move);
  }
  return [...out];
}

/** Autocomplete for the last word(s) typed. */
export function suggestTerms(q: string, limit = 8): {label: string; kind: string; insert: string}[] {
  const tail = norm(q.split(/\s*\|\s*|\s+oder\s+/i).pop() ?? '');
  const lastWords = tail.split(' ');
  const out: {label: string; kind: string; insert: string}[] = [];
  for (let n = Math.min(3, lastWords.length); n >= 1; n--) {
    const frag = lastWords.slice(-n).join(' ');
    if (frag.length < 2) continue;
    const add = (label: string, kind: string) => {
      if (out.length < limit && !out.some(o => o.label === label)) out.push({label, kind, insert: frag});
    };
    for (const c of CONCEPTS) if (c.aliases.some(a => norm(a).startsWith(frag))) add(c.label, 'Concept');
    for (const [alias, t] of Object.entries(TYPE_ALIASES)) if (alias.startsWith(frag)) add(t, 'Type');
    for (const [k, m] of MOVE_BY_NORM) if (k.startsWith(frag)) add(m, 'Move');
    for (const [k, a] of ABILITY_BY_NORM) if (k.startsWith(frag)) add(a, 'Ability');
    for (const [k, i] of ITEM_BY_NORM) if (k.startsWith(frag)) add(i, 'Item');
    if (out.length) break;
  }
  return out;
}
