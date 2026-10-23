import {SPECIES, type UsageSource} from './data';
import {parseSpread, popularSet, type PokemonSet} from './team';

// Set helpers that need usage stats but not the damage calc, so pages that only build teams
// don't have to load @smogon/calc.

/** Most common set for a usage-stats entry (Mega entries come back holding their stone). */
export function metaSet(name: string, usage: UsageSource, takenItems: string[] = []): PokemonSet {
  const sp = SPECIES[name];
  const u = usage.mons[name];
  if (!sp?.mega || !u) return popularSet(name, usage, takenItems);
  const baseName = sp.megaOf ?? sp.base;
  const set = popularSet(baseName, usage);
  set.item = sp.requiredItem ?? set.item;
  set.ability = SPECIES[baseName]?.abilities[0] ?? set.ability;
  set.moves = u.moves.map(([m]) => m).filter(m => sp.moves.includes(m)).slice(0, 4);
  const spread = u.spreads[0]?.[0];
  if (spread) Object.assign(set, parseSpread(spread));
  return set;
}

/** Sets without spreads (open team sheets, many pastes) get the most common meta spread, marked as estimated. */
export const fillSpreads = (team: PokemonSet[], usage: UsageSource): PokemonSet[] => team.map(s => {
  if (Object.values(s.sps).some(v => v > 0)) return s;
  const meta = metaSet(s.species, usage);
  return {...s, nature: meta.nature, sps: meta.sps, item: s.item || meta.item, ability: s.ability || meta.ability, moves: s.moves.length ? s.moves : meta.moves, estimated: true};
});
