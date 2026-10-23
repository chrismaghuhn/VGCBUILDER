import type {Boosts} from '../lib/calc';
import type {PokemonSet} from '../lib/team';

// One side of the Calc tab. Kept apart from CalcView so the app shell can create sides
// (Meta → Calc) without loading the calc page and its library.

export interface Side {
  set: PokemonSet;
  boosts: Boosts;
  hp: number;
  helpingHand: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  friendGuard: boolean;
  /** This Pokémon is burned. */
  burned?: boolean;
  /** Its partner has Steely Spirit. */
  steelySpirit?: boolean;
}

export const makeSide = (set: PokemonSet): Side => ({
  set, boosts: {}, hp: 100, helpingHand: false, reflect: false, lightScreen: false, auroraVeil: false, friendGuard: false,
});
