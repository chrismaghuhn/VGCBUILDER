import {exportTeam, importTeam, type PokemonSet} from './team';

/**
 * Share links carry the team itself, so no server is needed: the Showdown export text plus the
 * team name, deflate-compressed and base64url-encoded into the URL hash (#share=…).
 */
const SHARE_PREFIX = 'share=';
const SHARE_VERSION = 1;

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
  const json = JSON.stringify({v: SHARE_VERSION, n: name, t: exportTeam(sets)});
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return SHARE_PREFIX + toBase64Url(packed);
}

export function shareUrl(hash: string): string {
  return `${location.origin}${location.pathname}#${hash}`;
}

/** The share payload from a hash or a full share URL, if there is one. */
export function sharePayload(input: string): string | null {
  const i = input.indexOf('#' + SHARE_PREFIX);
  if (i >= 0) return input.slice(i + 1 + SHARE_PREFIX.length).trim();
  return input.startsWith(SHARE_PREFIX) ? input.slice(SHARE_PREFIX.length).trim() : null;
}

export async function decodeShare(payload: string): Promise<{name: string; sets: PokemonSet[]; warnings: string[]}> {
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
