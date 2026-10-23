import {SPECIES, type UsageSource} from './data';
import {teamField} from './analysis';
import {metaSet} from './calc';
import type {ParsedReplay, PSide} from './replay';
import type {PokemonSet} from './team';

/** One played game, stored with the team. Pokémon are species names so a later team edit doesn't break old games. */
export interface Match {
  id: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  result: 'win' | 'loss' | 'tie';
  opponent: string;
  /** Their six from team preview. */
  oppTeam: string[];
  /** My six in that game (from a replay); missing = the team's own Pokémon. */
  myTeam?: string[];
  archetype: string;
  myLeads: string[];
  myBack: string[];
  oppLeads: string[];
  oppBack: string[];
  notes: string;
  /** Showdown replay id, when the game came from a replay. */
  replay?: string;
  /** My side in that replay. */
  side?: PSide;
  /** The Playmat board saved with it (turn notes, plans). */
  board?: string;
}

export const ARCHETYPES = ['Rain', 'Sun', 'Sand', 'Snow', 'Trick Room', 'Tailwind', 'Balance'];

export const newMatchId = () => Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toISOString().slice(0, 10);

export const emptyMatch = (): Match => ({
  id: newMatchId(), date: today(), result: 'win', opponent: '', oppTeam: [], archetype: '',
  myLeads: [], myBack: [], oppLeads: [], oppBack: [], notes: '',
});

/** Rough archetype from their six (with meta sets): weather first, then Trick Room, then Tailwind. */
export function archetypeOf(team: string[], usage: UsageSource): string {
  const sets = team.filter(s => SPECIES[s]).map(s => metaSet(s, usage));
  if (!sets.length) return '';
  const weather = teamField(sets).weather;
  if (weather) return weather;
  if (sets.some(s => s.moves.includes('Trick Room'))) return 'Trick Room';
  if (sets.some(s => s.moves.includes('Tailwind'))) return 'Tailwind';
  return 'Balance';
}

/** A log entry from a replay, seen from `me`. */
export function matchFromReplay(r: ParsedReplay, me: PSide, usage: UsageSource, mySets: PokemonSet[] = []): Match {
  const them: PSide = me === 'p1' ? 'p2' : 'p1';
  const name = (side: PSide, i: number) => (side === me ? mySpecies(mySets, r.teams[side][i]) : r.teams[side][i]);
  const leads = (side: PSide) => (r.steps[0]?.active[side] ?? []).filter((i): i is number => i !== null).map(i => name(side, i));
  const back = (side: PSide) => r.brought[side].map(i => name(side, i)).filter(s => !leads(side).includes(s));
  return {
    id: newMatchId(),
    date: r.date ?? today(),
    result: !r.winner ? 'tie' : r.winner === r.players[me] ? 'win' : 'loss',
    opponent: r.players[them],
    oppTeam: r.teams[them].slice(0, 6),
    myTeam: r.teams[me].slice(0, 6).map((_, i) => name(me, i)),
    archetype: archetypeOf(r.teams[them], usage),
    myLeads: leads(me),
    myBack: back(me),
    oppLeads: leads(them),
    oppBack: back(them),
    notes: '',
    replay: r.id && r.id !== 'pasted' ? r.id : undefined,
    side: me,
  };
}

// ------------------------------------------------------------------ Stats

export interface Tally {
  key: string;
  /** Pokémon to show for the row (lead pairs, single mons). */
  mons: string[];
  win: number;
  loss: number;
  tie: number;
  games: number;
}

const tally = (map: Map<string, Tally>, key: string, mons: string[], m: Match) => {
  const r = map.get(key) ?? {key, mons, win: 0, loss: 0, tie: 0, games: 0};
  r[m.result]++;
  r.games++;
  map.set(key, r);
};
const sorted = (map: Map<string, Tally>) => [...map.values()].sort((a, b) => b.games - a.games || winrate(b) - winrate(a));

/** Ties count as half a win. */
export const winrate = (r: Pick<Tally, 'win' | 'tie' | 'games'>) => (r.games ? (r.win + r.tie / 2) / r.games : 0);

export function matchStats(matches: Match[]) {
  const total: Tally = {key: 'all', mons: [], win: 0, loss: 0, tie: 0, games: 0};
  const leads = new Map<string, Tally>();
  const archetypes = new Map<string, Tally>();
  const facing = new Map<string, Tally>();
  const brought = new Map<string, Tally>();
  for (const m of matches) {
    total[m.result]++;
    total.games++;
    if (m.myLeads.length) {
      const pair = [...m.myLeads].sort();
      tally(leads, pair.join(' + '), pair, m);
    }
    tally(archetypes, m.archetype || 'Unknown', [], m);
    for (const s of new Set(m.oppTeam)) tally(facing, s, [s], m);
    for (const s of new Set([...m.myLeads, ...m.myBack])) tally(brought, s, [s], m);
  }
  return {total, leads: sorted(leads), archetypes: sorted(archetypes), facing: sorted(facing), brought: sorted(brought)};
}

// ------------------------------------------------------------------ Export

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function matchesCsv(matches: Match[]): string {
  const head = ['date', 'result', 'opponent', 'archetype', 'my_leads', 'my_back', 'opp_leads', 'opp_back', 'opp_team', 'notes', 'replay'];
  const rows = matches.map(m => [
    m.date, m.result, m.opponent, m.archetype, m.myLeads.join(' / '), m.myBack.join(' / '),
    m.oppLeads.join(' / '), m.oppBack.join(' / '), m.oppTeam.join(' / '), m.notes,
    m.replay ? `https://replay.pokemonshowdown.com/${m.replay}` : '',
  ].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}

/** Species on my team, matched loosely (formes) so replay names line up with my sets. */
export const mySpecies = (sets: PokemonSet[], species: string) =>
  sets.find(s => s.species === species || SPECIES[s.species]?.num === SPECIES[species]?.num)?.species ?? species;
