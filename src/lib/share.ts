import dict from '../data/share-dict.json';
import {NATURE_NAMES, STATS} from './data';
import {emptySps, exportTeam, importTeam, type PokemonSet} from './team';

/**
 * Share links carry the team itself, so no server is needed.
 * - Short links (#t=…): every name is an index into an append-only dictionary
 *   (src/data/share-dict.json), packed into bits, about 14 bytes per Pokémon.
 * - Long links (#share=…): the Showdown export text, deflate-compressed. Still decoded, and used
 *   as a fallback if a name isn't in the dictionary.
 */
const SHORT_PREFIX = 't=';
const SHARE_PREFIX = 'share=';
const SHARE_VERSION = 1;
const SHORT_VERSION = 1;

// Fixed bit widths with headroom for future regulations (index 0 = none).
const BITS = {species: 10, items: 9, abilities: 9, moves: 11, nature: 5, sp: 6, count: 3, nameLen: 6};
const DICT = dict as {species: string[]; items: string[]; abilities: string[]; moves: string[]};
const INDEX = Object.fromEntries(
  Object.entries(DICT).map(([k, list]) => [k, new Map(list.map((n, i) => [n, i]))]),
) as Record<keyof typeof DICT, Map<string, number>>;

class BitWriter {
  private bits: number[] = [];
  write(value: number, width: number) {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

class BitReader {
  private pos = 0;
  private data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  read(width: number): number {
    let v = 0;
    for (let i = 0; i < width; i++, this.pos++) {
      if (this.pos >> 3 >= this.data.length) throw new Error('Share link is cut off');
      v = (v << 1) | ((this.data[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }
}

/** Short binary encoding, or null when something isn't in the dictionary. */
function encodeShort(name: string, sets: PokemonSet[]): string | null {
  const w = new BitWriter();
  w.write(SHORT_VERSION, 4);
  w.write(sets.length, BITS.count);
  const nameBytes = new TextEncoder().encode(name).slice(0, 63);
  w.write(nameBytes.length, BITS.nameLen);
  nameBytes.forEach(b => w.write(b, 8));
  const idx = (kind: keyof typeof DICT, value: string) => (value ? INDEX[kind].get(value) : 0);
  for (const s of sets) {
    const parts = [idx('species', s.species), idx('items', s.item), idx('abilities', s.ability)];
    const moves = [0, 1, 2, 3].map(i => idx('moves', s.moves[i] ?? ''));
    const nature = NATURE_NAMES.indexOf(s.nature);
    if ([...parts, ...moves].some(v => v === undefined) || nature < 0) return null;
    w.write(parts[0]!, BITS.species);
    w.write(parts[1]!, BITS.items);
    w.write(parts[2]!, BITS.abilities);
    w.write(nature, BITS.nature);
    for (const st of STATS) w.write(Math.min(s.sps[st], 63), BITS.sp);
    for (const m of moves) w.write(m!, BITS.moves);
  }
  return SHORT_PREFIX + toBase64Url(w.bytes());
}

function decodeShort(payload: string): {name: string; sets: PokemonSet[]; warnings: string[]} {
  const r = new BitReader(fromBase64Url(payload));
  const version = r.read(4);
  if (version !== SHORT_VERSION) throw new Error(`Unsupported share link version ${version}`);
  const count = r.read(BITS.count);
  const nameBytes = Uint8Array.from({length: r.read(BITS.nameLen)}, () => r.read(8));
  const name = new TextDecoder().decode(nameBytes) || 'Shared Team';
  const look = (kind: keyof typeof DICT, i: number) => {
    if (i >= DICT[kind].length) throw new Error('Share link is from a newer version of Teamforge');
    return DICT[kind][i];
  };
  const sets: PokemonSet[] = [];
  for (let n = 0; n < count; n++) {
    const species = look('species', r.read(BITS.species));
    const item = look('items', r.read(BITS.items));
    const ability = look('abilities', r.read(BITS.abilities));
    const nature = NATURE_NAMES[r.read(BITS.nature)] ?? 'Hardy';
    const sps = emptySps();
    for (const st of STATS) sps[st] = r.read(BITS.sp);
    const moves = [0, 1, 2, 3].map(() => look('moves', r.read(BITS.moves))).filter(Boolean);
    sets.push({species, item, ability, nature, sps, moves});
  }
  // Re-validate through the normal import path (legality warnings, name normalisation).
  const {sets: checked, warnings} = importTeam(exportTeam(sets));
  return {name, sets: checked, warnings};
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(name: string, sets: PokemonSet[]): Promise<string> {
  const short = encodeShort(name, sets);
  if (short) return short;
  const json = JSON.stringify({v: SHARE_VERSION, n: name, t: exportTeam(sets)});
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return SHARE_PREFIX + toBase64Url(packed);
}

export function shareUrl(hash: string): string {
  return `${location.origin}${location.pathname}#${hash}`;
}

/** The share payload (with its prefix) from a hash or a full share URL, if there is one. */
export function sharePayload(input: string): string | null {
  for (const prefix of [SHORT_PREFIX, SHARE_PREFIX]) {
    const i = input.indexOf('#' + prefix);
    if (i >= 0) return input.slice(i + 1).trim();
    if (input.startsWith(prefix)) return input.trim();
  }
  return null;
}

export async function decodeShare(payload: string): Promise<{name: string; sets: PokemonSet[]; warnings: string[]}> {
  if (payload.startsWith(SHORT_PREFIX)) return decodeShort(payload.slice(SHORT_PREFIX.length));
  if (payload.startsWith(SHARE_PREFIX)) payload = payload.slice(SHARE_PREFIX.length);
  const bytes = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
  const data = JSON.parse(new TextDecoder().decode(bytes)) as {v: number; n: string; t: string};
  if (data.v !== SHARE_VERSION) throw new Error(`Unsupported share link version ${data.v}`);
  const {sets, warnings} = importTeam(data.t);
  return {name: data.n || 'Shared Team', sets, warnings};
}

// ---------------------------------------------------------------- PokePaste

const PASTE_URL = /pokepast\.es\/([0-9a-f]{8,})/i;

/** The PokePaste id in a URL, if the input is (or contains) one. */
export const pokepasteId = (input: string) => input.match(PASTE_URL)?.[1] ?? null;

/** pokepast.es/<id>/json is CORS-enabled, so the browser can load pastes directly. */
export async function fetchPokepaste(id: string): Promise<{title: string; paste: string}> {
  const res = await fetch(`https://pokepast.es/${id}/json`);
  if (!res.ok) throw new Error(`PokePaste returned ${res.status}`);
  const data = (await res.json()) as {title?: string; paste?: string};
  if (!data.paste) throw new Error('PokePaste has no team text');
  return {title: data.title?.trim() || 'PokePaste Team', paste: data.paste.replace(/\r\n/g, '\n')};
}

/**
 * Upload via a normal form POST in a new tab, like Showdown does: pokepast.es answers with a
 * redirect to the new paste. Only runs when the user clicks the button.
 */
export function uploadPokepaste(title: string, paste: string, notes = 'Made with Teamforge VGC (Pokémon Champions, Reg M-C)') {
  const form = document.createElement('form');
  form.action = 'https://pokepast.es/create';
  form.method = 'post';
  form.target = '_blank';
  for (const [name, value] of Object.entries({title, paste, author: '', notes})) {
    const input = document.createElement('textarea');
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
