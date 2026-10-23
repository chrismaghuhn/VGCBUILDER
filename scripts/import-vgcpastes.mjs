#!/usr/bin/env node
// Turn the VGCPastes repository export (Google Sheet → CSV) into src/data/generated/tournament-teams.json.
// Usage: node scripts/import-vgcpastes.mjs "path/to/VGCPastes Repository - Champions M-C.csv"
// Source: VGCPastes (https://x.com/VGCPastes), a community collection of public team sheets.
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data', 'generated', 'tournament-teams.json');

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = {Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12};
/** "18 Oct 2026" → "2026-10-18". */
const isoDate = s => {
  const m = /^(\d{1,2}) (\w{3}) (\d{4})$/.exec(s.trim());
  return m && MONTHS[m[2]] ? `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/import-vgcpastes.mjs <csv>');
  const rows = parseCsv(await readFile(file, 'utf8'));
  const head = rows.findIndex(r => r[0] === 'Team ID');
  if (head < 0) throw new Error('No "Team ID" header row: did the sheet layout change?');
  const h = rows[head];
  const col = name => {
    const i = h.findIndex(c => c.trim().startsWith(name));
    if (i < 0) throw new Error(`Column "${name}" not found: did the sheet layout change?`);
    return i;
  };
  const C = {
    id: 0, desc: col('Team Description'), name: col('Full Name'), paste: col('Pokepaste'), evs: col('EVs'),
    date: col('Date Shared'), event: col('Tournament'), rank: col('Rank'), source: col('Link to Source'),
    owner: col('Owner'), mons: col('Pokemon Text'),
  };
  // Items sit in the cell after each numbered slot header ("1" … "6").
  const itemCols = ['1', '2', '3', '4', '5', '6'].map(n => h.indexOf(n) + 2);
  const species = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'generated', 'species.json'), 'utf8'));
  const unknown = new Set();
  // Match names loosely ("Sirfetch'd" vs "Sirfetch’d"); anything still unknown keeps its name.
  const toId = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byId = Object.fromEntries(Object.keys(species).map(n => [toId(n), n]));
  // VGCPastes names some Megas differently from Showdown.
  const ALIASES = {'Floette-Eternal-Mega': 'Floette-Mega', 'Meowstic-Mega': 'Meowstic-M-Mega'};
  const resolve = n => (species[n] ? n : species[ALIASES[n]] ? ALIASES[n] : byId[toId(n)] ?? n);

  const teams = [];
  for (const r of rows.slice(head + 1)) {
    if (!/^[A-Z]+\d+$/.test(r[C.id] ?? '')) continue;
    const mons = r.slice(C.mons, C.mons + 6).map(s => resolve(s.trim())).filter(Boolean);
    if (mons.length !== 6) continue;
    mons.forEach(m => { if (!species[m]) unknown.add(m); });
    const paste = /pokepast\.es\/([0-9a-f]+)/i.exec(r[C.paste] ?? '')?.[1];
    if (!paste) continue;
    const source = (r[C.source] ?? '').trim();
    teams.push({
      id: r[C.id],
      title: r[C.desc].trim(),
      player: (r[C.name] || r[C.owner] || '').trim(),
      event: (r[C.event] ?? '').trim().replace(/^-$/, ''),
      rank: (r[C.rank] ?? '').trim().replace(/^-$/, ''),
      date: isoDate(r[C.date] ?? ''),
      source: /^https?:\/\//.test(source) ? source : '',
      paste,
      spreads: /^yes/i.test(r[C.evs] ?? ''),
      mons: mons.map((m, i) => [m, (r[itemCols[i]] ?? '').trim()]),
    });
  }
  teams.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, undefined, {numeric: true}));
  await writeFile(OUT, JSON.stringify(teams));
  console.log(`${teams.length} teams → ${OUT}`);
  if (unknown.size) console.warn('Species not in the site data (shown without portrait):', [...unknown].join(', '));
}

main().catch(e => { console.error(e.message); process.exit(1); });
