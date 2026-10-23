import {decodeShort, encodeShort, fromBase64Url, pipe, shareUrl, toBase64Url} from './share';
import {exportTeam, importTeam, type Playmat, type PokemonSet} from './team';

/**
 * Playmat links: the whole board travels in the URL fragment (after #), which browsers never send
 * to a server. Open links are deflate-compressed; password links are additionally encrypted with
 * AES-GCM, the key derived from the password with PBKDF2, so the link alone reveals nothing.
 */
const OPEN = 'mat=';
const LOCKED = 'matx=';
const VERSION = 1;
const ITERATIONS = 250_000;

interface Payload {
  v: number;
  /** My side and theirs: short-link encoding, or Showdown text when a name isn't in the dictionary. */
  s: string;
  o: string;
  /** Everything else on the board (frames, notes, field …), with replays reduced to their id. */
  b: Omit<Playmat, 'opp' | 'team' | 'replay'> & {replay?: {id: string; me: string; step: number; turnNotes: Record<number, string>}};
}

export interface SharedMat {
  mat: Playmat;
  /** The replay to fetch again, when the board was a replay. */
  replay?: {id: string; me: 'p1' | 'p2'; step: number; turnNotes: Record<number, string>};
  warnings: string[];
}

const packSets = (sets: PokemonSet[]) => encodeShort('', sets) ?? `text:${exportTeam(sets)}`;
const unpackSets = (packed: string): {sets: PokemonSet[]; warnings: string[]} =>
  packed.startsWith('text:') ? importTeam(packed.slice(5)) : decodeShort(packed.slice(2));

async function key(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, [usage]);
}

/** A share link for the board; with a password it's encrypted. `mine` are the sets on my side of this board. */
export async function encodeMat(mat: Playmat, mine: PokemonSet[], password?: string): Promise<string> {
  const {opp, team: _team, replay, ...rest} = mat;
  const b: Payload['b'] = {...rest};
  if (replay && replay.replay.id && replay.replay.id !== 'pasted') {
    b.replay = {id: replay.replay.id, me: replay.me, step: replay.step, turnNotes: replay.turnNotes};
  }
  const payload: Payload = {v: VERSION, s: packSets(mine), o: packSets(opp), b};
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  if (!password) return shareUrl(OPEN + toBase64Url(packed));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await key(password, salt, 'encrypt'), packed));
  return shareUrl(LOCKED + toBase64Url(new Uint8Array([...salt, ...iv, ...cipher])));
}

/** The Playmat payload in a hash or URL: whether it needs a password, and the raw part. */
export function matPayload(input: string): {locked: boolean; data: string} | null {
  const m = /#(matx?)=([A-Za-z0-9_-]+)/.exec(input) ?? /^(matx?)=([A-Za-z0-9_-]+)$/.exec(input.trim());
  return m ? {locked: m[1] === 'matx', data: m[2]} : null;
}

export async function decodeMat(p: {locked: boolean; data: string}, password?: string): Promise<SharedMat> {
  let bytes = fromBase64Url(p.data);
  if (p.locked) {
    if (!password) throw new Error('This board needs a password.');
    const salt = bytes.slice(0, 16), iv = bytes.slice(16, 28);
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv}, await key(password, salt, 'decrypt'), bytes.slice(28)));
    } catch {
      throw new Error('Wrong password.');
    }
  }
  const data = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')))) as Payload;
  if (data.v !== VERSION) throw new Error(`Unsupported board link version ${data.v}`);
  const mine = unpackSets(data.s), opp = unpackSets(data.o);
  const {replay, ...board} = data.b;
  return {
    mat: {...board, opp: opp.sets, team: mine.sets} as Playmat,
    replay: replay as SharedMat['replay'],
    warnings: [...mine.warnings, ...opp.warnings],
  };
}
