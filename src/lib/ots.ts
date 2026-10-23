import type {PokemonSet} from './team';

/** Open Team Sheet entry: what is public at events (species, item, ability, moves) plus the nature, never the SP. */
export function otsSet(set: PokemonSet): string {
  const lines = [`${set.species}${set.item ? ` @ ${set.item}` : ''}`];
  lines.push(`Ability: ${set.ability || '—'}`);
  lines.push('Level: 50');
  lines.push(`${set.nature} Nature`);
  for (const m of set.moves.filter(Boolean)) lines.push(`- ${m}`);
  return lines.join('\n');
}

export const otsTeam = (sets: PokemonSet[]) => sets.map(otsSet).join('\n\n') + '\n';
