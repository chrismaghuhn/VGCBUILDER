import {useDeferredValue, useMemo, useState} from 'react';
import {SPECIES, pct, type UsageSource} from '../lib/data';
import {teamField, WEATHER_LABEL} from '../lib/analysis';
import {metaSet} from '../lib/calc';
import {leadAdvice, rankPlans, scorePlan, type Duel, type Plan} from '../lib/matchup';
import {decodeShare, fetchPokepaste, pokepasteId, sharePayload} from '../lib/share';
import {battleForme, importTeam, type Matchup, type PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {speciesOptions} from './SetEditor';
import {Sprite} from './Sprite';
import {Combobox, Section} from './ui';

type Zone = 'lead' | 'back' | 'home';

export function MatchupView({sets, usage, matchup, onChange}: {
  sets: PokemonSet[];
  usage: UsageSource;
  matchup?: Matchup;
  onChange: (m: Matchup | undefined) => void;
}) {
  const opp = matchup?.opp ?? [];
  const field = teamField(sets);
  const deferredOpp = useDeferredValue(opp);
  const deferredSets = useDeferredValue(sets);
  const expected = matchup?.expected ?? null;
  const [picking, setPicking] = useState<number[]>([]);

  const ranked = useMemo(
    () => (deferredOpp.length && deferredSets.length ? rankPlans(deferredSets, deferredOpp, usage, field, expected ?? undefined) : null),
    [deferredSets, deferredOpp, usage, field.weather, field.electricTerrain, expected], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!sets.length) return <Empty />;
  if (!opp.length) return <OpponentPicker usage={usage} onSet={(name, team) => onChange({name, opp: team, expected: null, plan: null})} />;
  if (!ranked) return <div className="panel p-8 text-center text-dim">Calculating …</div>;

  const best = ranked.plans[0];
  const plan: Plan = matchup?.plan
    ? scorePlan(sets, opp, ranked.duels, ranked.pairs, matchup.plan.bring, matchup.plan.lead, expected ?? undefined)
    : best;
  const custom = !!matchup?.plan;
  const theirLeads = expected ?? ranked.pairs[0]?.pair ?? [0, 1];
  const zones: Record<Zone, number[]> = {
    lead: plan.lead,
    back: plan.bring.filter(i => !plan.lead.includes(i)),
    home: sets.map((_, i) => i).filter(i => !plan.bring.includes(i)),
  };
  const update = (m: Partial<Matchup>) => onChange({...matchup!, ...m});

  /** Move my Pokémon `i` into `zone`, swapping with `target` (or the zone's last member) when full. */
  const move = (i: number, zone: Zone, target?: number) => {
    const z = {lead: [...zones.lead], back: [...zones.back], home: [...zones.home]};
    const from = (Object.keys(z) as Zone[]).find(k => z[k].includes(i))!;
    if (from === zone && target === undefined) return;
    const cap = {lead: 2, back: 2, home: 99}[zone];
    z[from] = z[from].filter(x => x !== i);
    if (target !== undefined && target !== i && z[zone].includes(target)) {
      z[zone] = z[zone].map(x => (x === target ? i : x));
      z[from].push(target);
    } else if (z[zone].length >= cap) {
      const out = z[zone].pop()!;
      z[zone].push(i);
      z[from].push(out);
    } else z[zone].push(i);
    update({plan: {bring: [...z.lead, ...z.back], lead: z.lead}});
  };

  // Two clicks set the expected leads; clicking one of the set leads goes back to lead stats.
  const toggleExpected = (j: number) => {
    if (expected?.includes(j)) { update({expected: null}); setPicking([]); return; }
    const next = picking.includes(j) ? picking.filter(x => x !== j) : [...picking, j];
    if (next.length === 2) { update({expected: [next[0], next[1]]}); setPicking([]); }
    else setPicking(next);
  };

  const advice = leadAdvice(sets, ranked.duels, ranked.pairs, plan.bring, plan.lead);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        {/* Their team preview */}
        <Section
          title={`vs ${matchup!.name}`}
          right={
            <div className="flex items-center gap-2 text-xs">
              {field.weather && <span className="text-dim">Your weather: {WEATHER_LABEL[field.weather]}</span>}
              <button className="btn !py-1 text-xs" onClick={() => onChange(undefined)}>Change opponent</button>
            </div>
          }
        >
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {opp.map((s, j) => {
              const isExp = picking.length ? picking.includes(j) : theirLeads.includes(j);
              const rate = (usage.mons[battleForme(s)] ?? usage.mons[s.species])?.lead ?? 0;
              return (
                <button key={j} onClick={() => toggleExpected(j)} title="Click two to set the leads you expect"
                  className={`flex flex-col items-center gap-0.5 rounded-lg border p-1.5 transition ${isExp ? 'border-bad/60 bg-bad/10' : 'border-line hover:border-line-2'}`}>
                  <div className="flex h-[72px] items-end overflow-hidden"><Sprite name={battleForme(s)} facing="down" fit={72} offset={j * 13} /></div>
                  <span className="w-full truncate text-center text-[11.5px]">{s.species}</span>
                  <span className="num text-[10px] text-faint">lead {pct(rate, 0)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">
            {picking.length === 1
              ? 'Now pick their second lead.'
              : expected
                ? 'Planning against the two leads you picked. Click one of them to go back to lead stats.'
                : 'Red = most likely leads (Smogon lead stats). Click two to plan against specific leads.'}
          </p>
        </Section>

        {/* The field, seen from above */}
        <Arena sets={sets} opp={opp} theirLeads={theirLeads} myLeads={zones.lead} duels={ranked.duels} onDrop={(i, t) => move(i, 'lead', t)} />

        {/* My back line and bench */}
        <div className="grid grid-cols-2 gap-3">
          <DropZone label="Back" zone="back" ids={zones.back} sets={sets} onDrop={move} />
          <DropZone label="Stays home" zone="home" ids={zones.home} sets={sets} onDrop={move} dim />
        </div>
      </div>

      {/* Why */}
      <div className="space-y-3">
        <div className="panel p-4">
          <div className="flex items-baseline justify-between">
            <span className="label">{custom ? 'Your plan' : 'Best plan'}</span>
            {custom && <button className="text-[12px] text-gold underline" onClick={() => update({plan: null})}>Use best plan ({best.score})</button>}
          </div>
          <div className="num mt-1 text-3xl font-semibold">{plan.score}</div>
          {plan.reasons.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px]">
              {plan.reasons.map(r => <li key={r} className="flex gap-2"><span className="text-good">✓</span>{r}</li>)}
            </ul>
          )}
          {plan.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px]">
              {plan.warnings.map(w => <li key={w} className="flex gap-2 text-warn"><span>!</span>{w}</li>)}
            </ul>
          )}
        </div>

        <div className="panel p-4">
          <div className="label mb-2">If they lead differently</div>
          <ul className="space-y-1.5 text-[12.5px]">
            {advice.map(a => (
              <li key={a.pair.join()} className="flex flex-wrap items-center gap-x-2">
                <span className="text-dim">{a.pair.map(j => opp[j].species).join(' + ')}</span>
                <span className="num text-[10.5px] text-faint">{pct(a.p, 0)}</span>
                <span className="text-faint">→</span>
                <span className={a.same ? 'text-good' : 'text-gold'}>{a.same ? 'keep your leads' : a.names.join(' + ')}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-4">
          <div className="label mb-2">Alternatives</div>
          <div className="space-y-1">
            {/* Best plan per different lead pair, so alternatives are real alternatives. */}
            {ranked.plans
              .filter((p, k, all) => all.findIndex(q => q.lead.join() === p.lead.join()) === k && p.lead.join() !== plan.lead.join())
              .slice(0, 4)
              .map(p => (
              <button key={p.bring.join() + p.lead.join()} onClick={() => update({plan: {bring: p.bring, lead: p.lead}})}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-panel-2">
                <span className="num w-7 font-semibold">{p.score}</span>
                <span className="truncate">{p.lead.map(i => sets[i].species).join(' + ')}</span>
                <span className="truncate text-faint">| {p.bring.filter(i => !p.lead.includes(i)).map(i => sets[i].species).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11.5px] text-faint">Drag your Pokémon between the field, Back and Stays home. The score updates live.</p>
      </div>
    </div>
  );
}

/** Top-down field: their two leads at the top, mine at the bottom, key facts in between. */
function Arena({sets, opp, theirLeads, myLeads, duels, onDrop}: {
  sets: PokemonSet[]; opp: PokemonSet[]; theirLeads: number[]; myLeads: number[]; duels: Duel[][];
  onDrop: (i: number, target?: number) => void;
}) {
  const facts: {text: string; tone: 'good' | 'bad' | 'dim'}[] = [];
  for (const i of myLeads) for (const j of theirLeads) {
    const d = duels[i][j];
    if (d.myKo && d.myKo <= 2) facts.push({text: `${sets[i].species} ${d.faster ? '▲ ' : ''}${d.myKo}HKO ${opp[j].species}`, tone: 'good'});
    if (d.theirKo === 1) facts.push({text: `${opp[j].species} ${d.faster === false ? '▲ ' : ''}OHKOs ${sets[i].species}`, tone: 'bad'});
  }
  const tone = {good: 'text-good', bad: 'text-bad', dim: 'text-dim'};
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-line-2 p-4"
      style={{
        background:
          'repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 8px, transparent 8px 16px), repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 8px, transparent 8px 16px), #0f1a1b',
      }}
    >
      <div className="flex justify-center gap-16">
        {theirLeads.map((j, k) => <Pad key={j} name={battleForme(opp[j])} label={opp[j].species} facing="down" tone="bad" offset={k * 17} />)}
      </div>
      <div className="my-3 flex min-h-[44px] flex-wrap items-center justify-center gap-x-4 gap-y-1 border-y border-dashed border-white/10 py-2 text-[12px]">
        {facts.length ? facts.slice(0, 6).map(f => <span key={f.text} className={tone[f.tone]}>{f.text}</span>) : <span className="text-faint">No KO in 2 hits either way</span>}
      </div>
      <div className="flex justify-center gap-16">
        {[0, 1].map(k => {
          const i = myLeads[k];
          return (
            <div key={k} onDragOver={e => e.preventDefault()} onDrop={e => { const from = +e.dataTransfer.getData('text/mon'); onDrop(from, i); }}>
              {i !== undefined
                ? <Pad name={battleForme(sets[i])} label={sets[i].species} facing="up" tone="good" draggable id={i} offset={k * 23} />
                : <div className="flex h-[112px] w-24 items-center justify-center rounded-full border border-dashed border-line-2 text-[11px] text-faint">drop a lead</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pad({name, label, facing, tone, draggable, id, offset}: {
  name: string; label: string; facing: 'up' | 'down'; tone: 'good' | 'bad'; draggable?: boolean; id?: number; offset?: number;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={e => id !== undefined && e.dataTransfer.setData('text/mon', String(id))}
      className={`flex flex-col items-center ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="relative flex h-[88px] w-28 items-end justify-center">
        <div className="absolute bottom-0 h-5 w-24 rounded-[50%]"
          style={{background: tone === 'good' ? 'rgba(90,169,255,.18)' : 'rgba(240,86,106,.18)', boxShadow: `inset 0 0 0 2px ${tone === 'good' ? 'rgba(90,169,255,.35)' : 'rgba(240,86,106,.35)'}`}} />
        <div className="relative -mb-1"><Sprite name={name} facing={facing} fit={96} offset={offset} /></div>
      </div>
      <span className="mt-1 text-[12px] font-medium">{label}</span>
    </div>
  );
}

function DropZone({label, zone, ids, sets, onDrop, dim}: {
  label: string; zone: Zone; ids: number[]; sets: PokemonSet[]; onDrop: (i: number, zone: Zone, target?: number) => void; dim?: boolean;
}) {
  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => onDrop(+e.dataTransfer.getData('text/mon'), zone)}
      className={`panel min-h-[120px] p-3 ${dim ? 'opacity-70' : ''}`}
    >
      <div className="label mb-2">{label}</div>
      <div className="flex flex-wrap gap-3">
        {ids.map((i, k) => (
          <div key={i} draggable onDragStart={e => e.dataTransfer.setData('text/mon', String(i))}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.stopPropagation(); onDrop(+e.dataTransfer.getData('text/mon'), zone, i); }}
            className="flex cursor-grab flex-col items-center active:cursor-grabbing">
            <div className="flex h-[64px] items-end overflow-hidden"><Sprite name={battleForme(sets[i])} facing="up" fit={64} offset={k * 11 + 5} /></div>
            <span className="text-[11.5px]">{sets[i].species}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Set the opponent: paste / PokePaste / share link, or build from a meta core. */
function OpponentPicker({usage, onSet}: {usage: UsageSource; onSet: (name: string, team: PokemonSet[]) => void}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const spOpts = useMemo(() => speciesOptions(usage), [usage]);

  /** Open team sheets have no spreads: take the most common meta spread (and item/ability if missing). */
  const fill = (team: PokemonSet[]) => team.map(s => {
    if (Object.values(s.sps).some(v => v > 0)) return s;
    const meta = metaSet(s.species, usage);
    return {...s, nature: meta.nature, sps: meta.sps, item: s.item || meta.item, ability: s.ability || meta.ability, moves: s.moves.length ? s.moves : meta.moves};
  });

  const load = async () => {
    setError('');
    try {
      const id = pokepasteId(text);
      const share = sharePayload(text.trim());
      if (id) { const p = await fetchPokepaste(id); onSet(p.title, fill(importTeam(p.paste).sets)); return; }
      if (share) { const s = await decodeShare(share); onSet(s.name, fill(s.sets)); return; }
      const {sets} = importTeam(text);
      if (!sets.length) { setError('No Pokémon found in that text.'); return; }
      onSet('Opponent', fill(sets));
    } catch (e) { setError((e as Error).message); }
  };

  /** A core Pokémon plus its most common teammates, each with its meta set. */
  const fromCore = (name: string) => {
    const sp = SPECIES[name];
    const team = [name];
    const nums = new Set([sp.num]);
    const forme = Object.keys(usage.mons).find(n => SPECIES[n]?.mega && (SPECIES[n].megaOf ?? SPECIES[n].base) === name && !usage.mons[name]) ?? name;
    for (const [mate] of usage.mons[forme]?.teammates ?? []) {
      const m = SPECIES[mate];
      if (!m || nums.has(m.num)) continue;
      team.push(mate);
      nums.add(m.num);
      if (team.length === 6) break;
    }
    onSet(`${name} core`, team.map(n => metaSet(n, usage)));
  };

  return (
    <Section title="Who are you facing?">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="label mb-1">Paste their team</div>
          <textarea className="field num h-40 resize-none text-[12.5px]" value={text} onChange={e => setText(e.target.value)}
            placeholder={'Showdown text, open team sheet, a pokepast.es link or a Teamforge share link'} />
          <div className="mt-2 flex items-center gap-2">
            <button className="btn btn-gold" onClick={load} disabled={!text.trim()}>Load opponent</button>
            {error && <span className="text-[12px] text-bad">{error}</span>}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Missing spreads are filled with the most common meta spread.</p>
        </div>
        <div>
          <div className="label mb-1">Or start from a meta core</div>
          <Combobox value="" options={spOpts} placeholder="Pick a Pokémon …" onChange={fromCore} />
          <p className="mt-2 text-[11.5px] text-faint">Fills the team with its five most common teammates and their meta sets.</p>
        </div>
      </div>
    </Section>
  );
}
