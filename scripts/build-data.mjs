// Builds trimmed JSON data for the current VGC format (Pokémon Champions, Reg M-C).
// Sources: Showdown's `champions` mod (legality, learnsets) + Smogon usage stats.
// Usage: node scripts/build-data.mjs [YYYY-MM]
import {copyFile, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {transform} from 'esbuild';

const require = createRequire(import.meta.url);
const {Dex: pkmnDex} = require('@pkmn/dex');
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
  {key: 'all-1760', label: 'Bo1+Bo3 · 1760+', merge: ['bo1-1760', 'bo3-1760']},
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

/** GitHub Actions shows these as annotations; locally they are plain warnings. */
const notice = msg => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `Warning: ${msg}`);

async function latestMonth() {
  const html = await (await fetch('https://www.smogon.com/stats/')).text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort().reverse();
  if (!months.length) throw new Error('Smogon stats index has no months: the page layout changed.');
  // A newer Champions VGC format in the newest month means a new regulation: say so instead of
  // quietly keeping old data forever.
  const newest = await (await fetch(`https://www.smogon.com/stats/${months[0]}/chaos/`)).text();
  const formats = [...new Set([...newest.matchAll(/href="(gen9champions[a-z0-9]*vgc[a-z0-9]*)-\d+\.json"/g)].map(m => m[1]))];
  const newer = formats.filter(f => f !== FORMAT.id && f > FORMAT.id);
  if (newer.length) notice(`Newer format(s) in ${months[0]}: ${newer.join(', ')}. A new regulation? Update FORMAT in scripts/build-data.mjs.`);
  if (!newest.includes(`${FORMAT.id}-1760.json`)) {
    throw new Error(`${months[0]} has no stats for ${FORMAT.id}` + (newer.length ? ` but has ${newer.join(', ')}: switch FORMAT to the new regulation.` : '.'));
  }
  for (const m of months) {
    const dir = m === months[0] ? newest : await (await fetch(`https://www.smogon.com/stats/${m}/chaos/`)).text();
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
    // The Champions data only lists what changed for some moves (Anchor Shot: just its new power);
    // everything it leaves out comes from Showdown's dex.
    const dex = pkmnDex.moves.get(m.name);
    moves[m.name] = {
      type: m.type || dex?.type,
      cat: m.category || dex?.category,
      bp: m.basePower ?? dex?.basePower ?? 0,
      // The calc's data only knows spread targets; Showdown's dex has all of them.
      target: m.target || pkmnDex.moves.get(m.name)?.target,
      prio: m.priority || undefined,
      flags: Object.keys(m.flags || {}).length ? Object.keys(m.flags) : undefined,
      multihit: m.multihit,
    };
  }

  // ---- Usage -----------------------------------------------------------
  // Smogon writes "Sirfetch'd", Showdown "Sirfetch’d": match by ID.
  const byId = Object.fromEntries(Object.keys(species).map(n => [toID(n), n]));
  const monName = k => byId[toID(k)] || k;

  // Checks and Counters come as {n, p, d} (older dumps: [n, p, d]).
  const ccTuple = v => (Array.isArray(v) ? v : [v.n, v.p, v.d]);

  /** Trim one chaos dataset into what the app needs. */
  const toSource = ({data, leads, meta, battles}, label) => {
    const mons = {};
    for (const [name, d] of Object.entries(data).sort((a, b) => b[1].usage - a[1].usage)) {
      if (d.usage < 0.0005) continue;
      const total = Object.values(d.Abilities).reduce((a, b) => a + b, 0) || 1;
      const cc = Object.entries(d['Checks and Counters'] || {})
        .map(([k, v]) => [k, ccTuple(v)])
        .filter(([, [n]]) => n >= 20)
        .map(([k, [, p, dd]]) => [k, +(p - 4 * dd).toFixed(3)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      mons[monName(name)] = {
        usage: +d.usage.toFixed(5),
        lead: +(leads[toID(name)] ?? 0).toFixed(4),
        abilities: pct(d.Abilities, total, 4, 0.005, k => gen.abilities.get(k)?.name || k),
        items: pct(d.Items, total, 10, 0.005, k => gen.items.get(k)?.name || k),
        spreads: pct(d.Spreads, total, 8, 0.003),
        moves: pct(d.Moves, total, 18, 0.005, k => gen.moves.get(k)?.name || k),
        teammates: pct(d.Teammates, total, 16, 0.005, monName),
        counters: cc.map(([k, v]) => [monName(k), v]),
      };
    }
    return {label, month, battles, metagame: meta, mons};
  };

  // Team weight of a dataset: chaos usage = mon weight / (sum of mon weights / 6).
  const teamWeight = data => Object.values(data).reduce((a, m) => a + Object.values(m.Abilities).reduce((x, y) => x + y, 0), 0) / 6;
  const addInto = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] ?? 0) + v; };

  /** Merge raw datasets: weighted counts add up, shares are averaged by team weight. */
  const mergeRaw = raws => {
    const weights = raws.map(r => teamWeight(r.data));
    const W = weights.reduce((a, b) => a + b, 0);
    const data = {};
    raws.forEach((r, i) => {
      for (const [name, d] of Object.entries(r.data)) {
        const m = data[name] ??= {usage: 0, Abilities: {}, Items: {}, Spreads: {}, Moves: {}, Teammates: {}, cc: {}};
        m.usage += d.usage * weights[i] / W;
        for (const f of ['Abilities', 'Items', 'Spreads', 'Moves', 'Teammates']) addInto(m[f], d[f]);
        for (const [k, v] of Object.entries(d['Checks and Counters'] || {})) {
          const [n, p, dd] = ccTuple(v);
          const c = m.cc[k] ??= [0, 0, 0];
          c[1] = (c[1] * c[0] + p * n) / (c[0] + n || 1);
          c[2] = (c[2] * c[0] + dd * n) / (c[0] + n || 1);
          c[0] += n;
        }
      }
    });
    for (const m of Object.values(data)) { m['Checks and Counters'] = m.cc; delete m.cc; }
    const avg = key => {
      const out = {};
      raws.forEach((r, i) => { for (const [k, v] of Object.entries(r[key])) out[k] = (out[k] ?? 0) + v * weights[i] / W; });
      return out;
    };
    return {data, leads: avg('leads'), meta: avg('meta'), battles: raws.reduce((a, r) => a + r.battles, 0)};
  };

  const raw = {};
  const usage = {};
  const base = `https://www.smogon.com/stats/${month}`;
  for (const src of SOURCES.filter(s => !s.merge)) {
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
    raw[src.key] = {data: chaos.data, leads, meta, battles: chaos.info['number of battles']};
  }
  for (const src of SOURCES) {
    const r = src.merge ? (src.merge.every(k => raw[k]) ? mergeRaw(src.merge.map(k => raw[k])) : null) : raw[src.key];
    if (!r) continue;
    usage[src.key] = toSource(r, src.label);
    console.log(src.key, Object.keys(usage[src.key].mons).length, 'mons,', r.battles, 'battles');
  }

  await buildPortraits(species);
  await extendShareDict(species, items, moves);
  await buildSprites(species);

  validate({species, items, moves, usage});

  const write = (name, data) => writeFile(join(OUT, name), JSON.stringify(data));
  await write('format.json', {...FORMAT, month, sources: SOURCES.filter(s => usage[s.key]).map(s => ({key: s.key, label: s.label})), builtAt: new Date().toISOString()});
  await write('species.json', species);
  await write('items.json', items);
  await write('moves.json', moves);
  await write('usage.json', usage);
  console.log('Wrote data to', OUT);
}

/**
 * Fail loudly when the sources changed shape, instead of writing broken data the site would choke on.
 * Thresholds are far below today's numbers (≈270 species, ≈520 moves, ≈260 mons per source).
 */
function validate({species, items, moves, usage}) {
  const problems = [];
  const atLeast = (what, n, min) => { if (!(n >= min)) problems.push(`${what}: ${n} (expected at least ${min})`); };
  atLeast('species', Object.keys(species).length, 150);
  atLeast('items', Object.keys(items).length, 50);
  atLeast('moves', Object.keys(moves).length, 300);
  for (const [name, sp] of Object.entries(species)) {
    if (!sp.id || !sp.types?.length || !sp.bs?.spe || !sp.abilities?.length) { problems.push(`species ${name} is missing id/types/stats/abilities`); break; }
  }
  for (const [name, m] of Object.entries(moves)) {
    if (!m.type || !m.cat || typeof m.bp !== 'number') { problems.push(`move ${name} is missing type/category/power`); break; }
  }
  const sources = Object.keys(usage);
  atLeast('usage sources', sources.length, 1);
  for (const key of sources) {
    const u = usage[key];
    const mons = Object.entries(u.mons ?? {});
    atLeast(`${key} mons`, mons.length, 50);
    atLeast(`${key} battles`, u.battles ?? 0, 1000);
    const top = mons.sort((a, b) => b[1].usage - a[1].usage).slice(0, 10);
    for (const [name, m] of top) {
      for (const field of ['moves', 'items', 'abilities', 'spreads', 'teammates']) {
        if (!Array.isArray(m[field]) || !m[field].length) problems.push(`${key}: ${name} has no ${field}`);
      }
      if (typeof m.usage !== 'number' || m.usage <= 0) problems.push(`${key}: ${name} has no usage`);
    }
  }
  if (problems.length) throw new Error('Data check failed (did a source change its format?):\n  ' + problems.slice(0, 20).join('\n  '));
  console.log('Data check passed.');
}

const SPRITES = join(ROOT, 'public', 'sprites');

/**
 * Animated top-down idle sprites (PMD SpriteCollab, CC BY-NC 4.0) for the matchup field.
 * Copies Idle-Anim.png per forme and writes frame size + durations to sprites.json. Formes
 * without their own art (most Megas) fall back to the base forme's sprite (`base: true`).
 */
async function buildSprites(species) {
  if (!existsSync(join(SPRITECOLLAB, 'tracker.json'))) return;
  const tracker = JSON.parse(await readFile(join(SPRITECOLLAB, 'tracker.json'), 'utf8'));
  await mkdir(SPRITES, {recursive: true});
  const idleOf = async dir => {
    const xmlPath = join(dir, 'AnimData.xml');
    if (!existsSync(xmlPath)) return null;
    const xml = await readFile(xmlPath, 'utf8');
    const anims = Object.fromEntries([...xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)].map(m => [m[1].match(/<Name>(\w+)<\/Name>/)?.[1], m[1]]));
    let name = 'Idle';
    for (let i = 0; i < 3 && anims[name]?.includes('<CopyOf>'); i++) name = anims[name].match(/<CopyOf>(\w+)<\/CopyOf>/)[1];
    const body = anims[name];
    const file = join(dir, `${name}-Anim.png`);
    if (!body || !existsSync(file)) return null;
    const num = tag => +body.match(new RegExp(`<${tag}>(\\d+)</${tag}>`))[1];
    const durations = [...body.matchAll(/<Duration>(\d+)<\/Duration>/g)].map(m => +m[1]);
    return {file, w: num('FrameWidth'), h: num('FrameHeight'), d: durations};
  };
  const out = {};
  let own = 0, base = 0;
  for (const [name, sp] of Object.entries(species)) {
    const num = String(sp.num).padStart(4, '0');
    const entry = tracker[num];
    if (!entry) continue;
    const root = join(SPRITECOLLAB, 'sprite', num);
    const suffix = name.slice(sp.base.length + 1);
    const female = /(^|-)F(-|$)/.test(suffix);
    const formName = FORM_ALIASES[suffix] ?? suffix.replace(/-/g, '_');
    const formKey = Object.entries(entry.subgroups).find(([, v]) => v.name && v.name === formName)?.[0];
    const exact = [];
    if (formKey) { if (female) exact.push(join(root, formKey, '0000', '0002')); exact.push(join(root, formKey)); }
    if (female) exact.push(join(root, '0000', '0000', '0002'));
    if (!suffix || female) exact.push(root);
    let idle = null;
    let isBase = false;
    for (const d of exact) if ((idle = await idleOf(d))) break;
    if (!idle) { idle = await idleOf(root); isBase = !!idle; }
    if (!idle) continue;
    await copyFile(idle.file, join(SPRITES, sp.id + '.png'));
    out[sp.id] = {w: idle.w, h: idle.h, d: idle.d, ...(isBase ? {base: true} : {})};
    if (isBase) base++; else own++;
  }
  const keep = new Set(Object.keys(out).map(id => id + '.png'));
  for (const f of await readdir(SPRITES)) if (!keep.has(f)) await rm(join(SPRITES, f));
  await writeFile(join(OUT, 'sprites.json'), JSON.stringify(out));
  console.log(`Sprites: ${own} own, ${base} base-forme fallback, ${Object.keys(species).length - own - base} none`);
}

/**
 * Dictionary for short share links: names are stored as indices into these lists. The lists are
 * append-only (never reordered or shortened) so links made today keep decoding after data
 * updates. Index 0 is reserved for "none".
 */
async function extendShareDict(species, items, moves) {
  const path = join(ROOT, 'src', 'data', 'share-dict.json');
  const dict = existsSync(path)
    ? JSON.parse(await readFile(path, 'utf8'))
    : {species: [''], items: [''], abilities: [''], moves: ['']};
  const add = (list, names) => {
    const known = new Set(list);
    for (const n of [...names].sort()) if (!known.has(n)) list.push(n);
  };
  add(dict.species, Object.keys(species).filter(n => !species[n].mega));
  add(dict.items, items.map(i => i.name));
  add(dict.abilities, new Set(Object.values(species).flatMap(s => s.abilities)));
  add(dict.moves, Object.keys(moves));
  await writeFile(path, JSON.stringify(dict, null, 0) + '\n');
  console.log('Share dict:', Object.entries(dict).map(([k, v]) => `${k} ${v.length - 1}`).join(', '));
}

// Showdown forme suffix -> SpriteCollab subgroup name.
const FORM_ALIASES = {
  'Low-Key': 'Lowkey', 'Paldea-Combat': 'Paldea', 'M-Mega': 'Mega', 'F-Mega': 'Mega',
  'Alola': 'Alola', 'Hisui': 'Hisui', 'Galar': 'Galar',
};

async function buildPortraits(species) {
  if (!existsSync(join(SPRITECOLLAB, 'tracker.json'))) {
    // CI has no SpriteCollab checkout: keep the portraits already in the repo.
    const have = new Set(existsSync(PORTRAITS) ? await readdir(PORTRAITS) : []);
    let kept = 0;
    for (const sp of Object.values(species)) if (have.has(sp.id + '.png')) { sp.portrait = true; kept++; }
    console.warn(`SpriteCollab not found at ${SPRITECOLLAB}: keeping ${kept} existing portraits.`);
    return;
  }
  const tracker = JSON.parse(await readFile(join(SPRITECOLLAB, 'tracker.json'), 'utf8'));
  // Overwrite in place instead of wiping the folder: a running Vite dev server
  // would otherwise lose track of the public files and serve index.html for them.
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
  const keep = new Set(Object.values(species).filter(sp => sp.portrait).map(sp => sp.id + '.png').concat('CREDITS.txt'));
  for (const f of await readdir(PORTRAITS)) if (!keep.has(f)) await rm(join(PORTRAITS, f));
  await writeFile(join(PORTRAITS, 'CREDITS.txt'),
    'Portraits from PMD SpriteCollab (https://github.com/PMDCollab/SpriteCollab), CC BY-NC 4.0.\n' +
    'Credit IDs (see SpriteCollab credit_names.txt):\n' + [...credits].sort().join('\n') + '\n');
  console.log(`Portraits: ${found}/${Object.keys(species).length}`, missing.length ? 'check: ' + missing.join(', ') : '');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
