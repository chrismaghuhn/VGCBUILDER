// Builds trimmed JSON data for the current VGC format (Pokémon Champions, Reg M-C).
// Sources: Showdown's `champions` mod (legality, learnsets) + Smogon usage stats.
// Usage: node scripts/build-data.mjs [YYYY-MM]
import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {transform} from 'esbuild';

const require = createRequire(import.meta.url);
const {Generations} = require('@smogon/calc');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const OUT = join(ROOT, 'src', 'data', 'generated');

const FORMAT = {
  id: 'gen9championsvgc2026regmc',
  name: 'VGC 2026 Reg M-C',
  game: 'Pokémon Champions',
  period: '9. Sep – 2. Dez 2026',
};
const SOURCES = [
  {key: 'bo1-1760', label: 'Bo1 · 1760+', file: `${FORMAT.id}-1760`},
  {key: 'bo3-1760', label: 'Bo3 · 1760+', file: `${FORMAT.id}bo3-1760`},
  {key: 'bo1-1500', label: 'Bo1 · 1500+', file: `${FORMAT.id}-1500`},
];
// PMD SpriteCollab checkout (CC BY-NC 4.0). Override with SPRITECOLLAB=/path.
const SPRITECOLLAB = process.env.SPRITECOLLAB || '/home/chris/Apps/pokemon-roguelike/raw/SpriteCollab';
const PORTRAITS = join(ROOT, 'public', 'portraits');
const SD = 'https://raw.githubusercontent.com/smogon/pokemon-showdown/master';

const toID = s => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');

async function fetchText(url, name) {
  const path = join(CACHE, name);
  if (existsSync(path) && !process.env.REFRESH) return readFile(path, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const text = await res.text();
  await writeFile(path, text);
  return text;
}

// Showdown data files are TS modules exporting plain object literals.
async function loadTS(url, name) {
  const src = await fetchText(url, name + '.ts');
  const {code} = await transform(src, {loader: 'ts', format: 'esm'});
  const file = join(CACHE, name + '.mjs');
  await writeFile(file, code);
  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  return Object.values(mod)[0];
}

async function latestMonth() {
  const html = await (await fetch('https://www.smogon.com/stats/')).text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort();
  for (const m of months.reverse()) {
    const dir = await (await fetch(`https://www.smogon.com/stats/${m}/chaos/`)).text();
    if (dir.includes(`${FORMAT.id}-1760.json`)) return m;
  }
  throw new Error('No usage stats found for ' + FORMAT.id);
}

const pct = (obj, total, n, minPct = 0.005, name = k => k) =>
  Object.entries(obj)
    .filter(([k]) => k && k !== 'nothing' && k !== '')
    .map(([k, v]) => [name(k), v / total])
    .filter(([, p]) => p >= minPct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, p]) => [k, +p.toFixed(4)]);

function parseLeads(txt) {
  const leads = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*([\d.]+)%/);
    if (m) leads[m[1]] = +(+m[2] / 100).toFixed(4);
  }
  return leads;
}

function parseMetagame(txt) {
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([a-z]+)\.+\s*([\d.]+)%/);
    if (m) out[m[1]] = +(+m[2] / 100).toFixed(4);
  }
  return out;
}

async function main() {
  await mkdir(CACHE, {recursive: true});
  await mkdir(OUT, {recursive: true});
  const month = process.argv[2] || (await latestMonth());
  console.log('Usage month:', month);

  const [formatsData, learnsets, pokedex] = await Promise.all([
    loadTS(`${SD}/data/mods/champions/formats-data.ts`, 'champions-formats-data'),
    loadTS(`${SD}/data/mods/champions/learnsets.ts`, 'champions-learnsets'),
    loadTS(`${SD}/data/pokedex.ts`, 'pokedex'),
  ]);

  const gen = Generations.get(0);

  // ---- Species ---------------------------------------------------------
  const species = {};
  // A forme without its own tier (Meowstic-F, Toxtricity-Low-Key…) inherits from its base.
  const isLegal = sid => {
    const fd = formatsData[sid];
    const dex = pokedex[sid];
    if (!dex || fd?.isNonstandard || fd?.tier === 'Illegal') return false;
    if (fd?.tier) return true;
    return !dex.battleOnly && !!dex.baseSpecies && isLegal(toID(dex.baseSpecies));
  };
  for (const sid of Object.keys(pokedex)) {
    if (!isLegal(sid)) continue;
    const dex = pokedex[sid];
    // The calc names a few formes differently (Aegislash-Shield, Sirfetch’d).
    const s = gen.species.get(sid) || gen.species.get(sid + 'shield');
    if (!s) {
      console.warn('no calc data for', sid);
      continue;
    }
    const tags = dex.tags || [];
    if (tags.includes('Mythical') || tags.includes('Restricted Legendary')) continue;
    const base = dex.baseSpecies || dex.name;
    const abilities = [...new Set(Object.values(dex.abilities || s.abilities || {}))];
    // Learnset: own entry, else the base forme / pre-mega forme, plus prevos.
    const moves = new Set();
    const addLearnset = id => {
      const ls = learnsets[id]?.learnset;
      if (ls) for (const m of Object.keys(ls)) moves.add(m);
    };
    addLearnset(sid);
    const outOfBattle = typeof dex.battleOnly === 'string' ? dex.battleOnly : dex.changesFrom;
    if (!moves.size && outOfBattle) addLearnset(toID(outOfBattle));
    if (!moves.size) addLearnset(toID(base));
    let prevo = dex.prevo;
    while (prevo) {
      addLearnset(toID(prevo));
      prevo = pokedex[toID(prevo)]?.prevo;
    }
    const moveNames = [...moves].map(id => gen.moves.get(id)?.name).filter(Boolean).sort();
    const isMega = /-Mega/.test(dex.name);
    species[dex.name] = {
      id: sid,
      calcName: s.name !== dex.name ? s.name : undefined,
      num: dex.num,
      types: s.types,
      bs: s.baseStats,
      weight: s.weightkg,
      abilities,
      base,
      mega: isMega || undefined,
      // The forme a Mega evolves from (Floette-Mega <- Floette-Eternal).
      megaOf: isMega ? (typeof dex.battleOnly === 'string' ? dex.battleOnly : base) : undefined,
      requiredItem: dex.requiredItem || undefined,
      moves: moveNames,
    };
  }
  // Megas are selected via their base forme + stone; keep them for stats lookups.
  console.log('Legal species/formes:', Object.keys(species).length);

  // ---- Items / Moves / Abilities ---------------------------------------
  const items = [...gen.items].map(i => ({
    name: i.name,
    mega: i.megaStone ? Object.values(i.megaStone)[0] : undefined,
    megaBase: i.megaStone ? Object.keys(i.megaStone)[0] : undefined,
  }));
  const moves = {};
  for (const m of gen.moves) {
    if (m.id === 'nomove' || m.isMax || m.isZ) continue;
    moves[m.name] = {
      type: m.type,
      cat: m.category,
      bp: m.basePower,
      target: m.target,
      prio: m.priority || undefined,
      flags: Object.keys(m.flags || {}).length ? Object.keys(m.flags) : undefined,
      multihit: m.multihit,
    };
  }

  // ---- Usage -----------------------------------------------------------
  const usage = {};
  for (const src of SOURCES) {
    const base = `https://www.smogon.com/stats/${month}`;
    let chaos;
    try {
      chaos = JSON.parse(await fetchText(`${base}/chaos/${src.file}.json`, `${month}-${src.file}.json`));
    } catch (e) {
      console.warn('skip', src.key, e.message);
      continue;
    }
    const leadsRaw = parseLeads(await fetchText(`${base}/leads/${src.file}.txt`, `${month}-leads-${src.file}.txt`).catch(() => ''));
    const leads = {};
    for (const [k, v] of Object.entries(leadsRaw)) leads[toID(k)] = v;
    const meta = parseMetagame(await fetchText(`${base}/metagame/${src.file}.txt`, `${month}-meta-${src.file}.txt`).catch(() => ''));
    const mons = {};
    // Smogon writes "Sirfetch'd", Showdown "Sirfetch’d": match by ID.
    const byId = Object.fromEntries(Object.keys(species).map(n => [toID(n), n]));
    const monName = k => byId[toID(k)] || k;
    const ranked = Object.entries(chaos.data).sort((a, b) => b[1].usage - a[1].usage);
    for (const [name, d] of ranked) {
      if (d.usage < 0.0005) continue;
      const total = Object.values(d.Abilities).reduce((a, b) => a + b, 0) || 1;
      const cc = Object.entries(d['Checks and Counters'] || {})
        .filter(([, v]) => v[0] >= 20)
        .map(([k, v]) => [k, +(v[1] - 4 * v[2]).toFixed(3)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      mons[monName(name)] = {
        usage: +d.usage.toFixed(5),
        lead: leads[toID(name)] ?? 0,
        abilities: pct(d.Abilities, total, 4, 0.005, k => gen.abilities.get(k)?.name || k),
        items: pct(d.Items, total, 10, 0.005, k => gen.items.get(k)?.name || k),
        spreads: pct(d.Spreads, total, 8, 0.003),
        moves: pct(d.Moves, total, 18, 0.005, k => gen.moves.get(k)?.name || k),
        teammates: pct(d.Teammates, total, 16, 0.005, monName),
        counters: cc.map(([k, v]) => [monName(k), v]),
      };
    }
    usage[src.key] = {
      label: src.label,
      month,
      battles: chaos.info['number of battles'],
      metagame: meta,
      mons,
    };
    console.log(src.key, Object.keys(mons).length, 'mons,', chaos.info['number of battles'], 'battles');
  }

  await buildPortraits(species);

  const write = (name, data) => writeFile(join(OUT, name), JSON.stringify(data));
  await write('format.json', {...FORMAT, month, sources: SOURCES.filter(s => usage[s.key]).map(s => ({key: s.key, label: s.label})), builtAt: new Date().toISOString()});
  await write('species.json', species);
  await write('items.json', items);
  await write('moves.json', moves);
  await write('usage.json', usage);
  console.log('Wrote data to', OUT);
}

// Showdown forme suffix -> SpriteCollab subgroup name.
const FORM_ALIASES = {
  'Low-Key': 'Lowkey', 'Paldea-Combat': 'Paldea', 'M-Mega': 'Mega', 'F-Mega': 'Mega',
  'Alola': 'Alola', 'Hisui': 'Hisui', 'Galar': 'Galar',
};

async function buildPortraits(species) {
  if (!existsSync(join(SPRITECOLLAB, 'tracker.json'))) {
    console.warn('SpriteCollab not found at', SPRITECOLLAB, '- falling back to Showdown sprites');
    return;
  }
  const tracker = JSON.parse(await readFile(join(SPRITECOLLAB, 'tracker.json'), 'utf8'));
  await rm(PORTRAITS, {recursive: true, force: true});
  await mkdir(PORTRAITS, {recursive: true});
  const credits = new Set();
  let found = 0;
  const missing = [];
  for (const [name, sp] of Object.entries(species)) {
    const num = String(sp.num).padStart(4, '0');
    const entry = tracker[num];
    if (!entry) { missing.push(name); continue; }
    const suffix = name.slice(sp.base.length + 1);
    const female = /(^|-)F(-|$)/.test(suffix);
    const formName = FORM_ALIASES[suffix] ?? suffix.replace(/-/g, '_');
    const formKey = Object.entries(entry.subgroups).find(([, v]) => v.name && v.name === formName)?.[0];
    const root = join(SPRITECOLLAB, 'portrait', num);
    const candidates = [];
    if (formKey) {
      if (female) candidates.push(join(root, formKey, '0000', '0002'));
      candidates.push(join(root, formKey));
    }
    if (female) candidates.push(join(root, '0000', '0000', '0002'));
    candidates.push(root);
    const dir = candidates.find(d => existsSync(join(d, 'Normal.png')));
    if (!dir) { missing.push(name); continue; }
    // Exact forme art counts as found; base-forme fallback for an alt forme gets flagged.
    if (suffix && !formKey && !female && !sp.mega) missing.push(name + ' (base art)');
    await copyFile(join(dir, 'Normal.png'), join(PORTRAITS, sp.id + '.png'));
    sp.portrait = true;
    found++;
    const credit = join(dir, 'credits.txt');
    if (existsSync(credit)) {
      for (const line of (await readFile(credit, 'utf8')).split('\n')) {
        const author = line.split('\t')[1];
        if (author) credits.add(author);
      }
    }
  }
  await writeFile(join(PORTRAITS, 'CREDITS.txt'),
    'Portraits from PMD SpriteCollab (https://github.com/PMDCollab/SpriteCollab), CC BY-NC 4.0.\n' +
    'Credit IDs (see SpriteCollab credit_names.txt):\n' + [...credits].sort().join('\n') + '\n');
  console.log(`Portraits: ${found}/${Object.keys(species).length}`, missing.length ? 'check: ' + missing.join(', ') : '');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
