import {useMemo, useRef, useState} from 'react';
import {SPECIES, TYPE_COLOR, MOVES, pct, type UsageSource} from '../lib/data';
import {WEATHER_LABEL, teamField} from '../lib/analysis';
import {metaSet} from '../lib/calc';
import {leadAdvice, rankPlans} from '../lib/matchup';
import {activeFighters, keyOf, matHits, newPlaymat, turnOrder, type Fighter} from '../lib/playmat';
import {decodeShare, fetchPokepaste, pokepasteId, sharePayload} from '../lib/share';
import {battleForme, importTeam, type MatField, type MatNote, type MatSide, type Playmat, type PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {koLabel} from './MetaView';
import {speciesOptions} from './SetEditor';
import {Sprite} from './Sprite';
import {Combobox, Section, dmgColor} from './ui';

const BOARD_BG =
  'repeating-linear-gradient(0deg, rgba(255,255,255,.022) 0 8px, transparent 8px 16px), repeating-linear-gradient(90deg, rgba(255,255,255,.022) 0 8px, transparent 8px 16px), #0e1918';

const NOTE_COLORS: Record<MatNote['color'], string> = {gold: '#f5c542', blue: '#5aa9ff', red: '#f0566a', green: '#3ecf8e'};

export function PlaymatView({sets, usage, mat, onChange}: {
  sets: PokemonSet[];
  usage: UsageSource;
  mat?: Playmat;
  onChange: (m: Playmat | undefined, coalesceKey?: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'suggest' | 'help' | null>(null);
  const ranked = useMemo(
    () => (mat && sets.length ? rankPlans(sets, mat.opp, usage, {weather: teamField(sets).weather}) : null),
    [sets, mat?.opp, usage], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!sets.length) return <Empty />;
  if (!mat) return <OpponentPicker usage={usage} onSet={(name, opp) => onChange(newPlaymat(name, opp, sets, usage))} />;

  const set = (patch: Partial<Playmat>, key?: string) => onChange({...mat, ...patch}, key);
  const setField = (patch: Partial<MatField>) => set({field: {...mat.field, ...patch}});
  const fighters = activeFighters(mat, sets);
  const sel = selected ? fighterByKey(mat, sets, selected) : null;

  /** Put Pokémon `index` of `side` on spot `spot` (swap if it's already on the other spot). */
  const place = (side: MatSide, index: number, spot: 0 | 1) => {
    const spots = [...mat[side]] as [number | null, number | null];
    const other = spot === 0 ? 1 : 0;
    if (spots[other] === index) spots[other] = spots[spot];
    spots[spot] = index;
    const patch: Partial<Playmat> = {[side]: spots};
    // A lead of mine is always one of the four I bring.
    if (side === 'mine' && !mat.brought.includes(index)) {
      // Make room by dropping a brought Pokémon that isn't on the field.
      const brought = [...mat.brought];
      if (brought.length >= 4) brought.splice(brought.findIndex(b => !spots.includes(b)), 1);
      patch.brought = [...brought, index];
    }
    set(patch);
  };
  const unplace = (side: MatSide, index: number) => set({[side]: mat[side].map(x => (x === index ? null : x)) as [number | null, number | null]});
  const onDropSpot = (side: MatSide, spot: 0 | 1) => (e: React.DragEvent) => {
    const [s, i] = e.dataTransfer.getData('text/mat').split(':');
    if (s === side) place(side, +i, spot);
  };
  const onDropBench = (side: MatSide) => (e: React.DragEvent) => {
    const [s, i] = e.dataTransfer.getData('text/mat').split(':');
    if (s === side) unplace(side, +i);
  };

  const toggleBrought = (i: number) => {
    const b = mat.brought.includes(i) ? mat.brought.filter(x => x !== i) : [...mat.brought, i];
    set({brought: b.slice(-4)});
  };

  const addNote = () => {
    const note: MatNote = {id: Math.random().toString(36).slice(2, 9), x: 40 + Math.random() * 10, y: 42 + Math.random() * 6, text: '', color: 'gold'};
    set({notes: [...mat.notes, note]});
  };
  const updateNote = (id: string, patch: Partial<MatNote>, key?: string) =>
    set({notes: mat.notes.map(n => (n.id === id ? {...n, ...patch} : n))}, key);

  const best = ranked?.plans[0];
  const advice = ranked && best ? leadAdvice(sets, ranked.duels, ranked.pairs, best.bring, best.lead) : [];
  const order = turnOrder(mat, sets);

  return (
    // The mat is the whole page; everything else floats on top of it when needed.
    <section className="relative flex h-[calc(100vh-88px)] min-h-[620px] flex-col overflow-hidden rounded-2xl border border-line-2" style={{background: BOARD_BG}}>
      <Toolbar
        name={mat.name}
        field={mat.field}
        onField={setField}
        onNote={addNote}
        onChangeOpponent={() => onChange(undefined)}
        panel={panel}
        onPanel={p => setPanel(panel === p ? null : p)}
      />

      {/* Everything below the toolbar; floating cards anchor here */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <Bench side="theirs" ids={mat.opp.map((_, j) => j)} mat={mat} sets={sets} selected={selected} onSelect={setSelected}
        onDrop={onDropBench('theirs')} />

      <div className="relative flex flex-1 flex-col" onClick={() => { setSelected(null); setPanel(null); }}>
        <div className="grid flex-1 grid-cols-2 items-end px-6">
          {([0, 1] as const).map(spot => (
            <Spot key={spot} side="theirs" index={mat.theirs[spot]} mat={mat} sets={sets} selected={selected}
              onSelect={setSelected} onDrop={onDropSpot('theirs', spot)} offset={spot * 17} />
          ))}
        </div>

        {/* Turn order across the middle */}
        <div className="mx-6 my-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-y border-dashed border-white/10 py-2 text-[12px]">
          <span className="label mr-1">{mat.field.trickRoom ? 'Order (Trick Room)' : 'Order'}</span>
          {order.map((f, k) => (
            <span key={f.key} className="flex items-center gap-1">
              {k > 0 && <span className="text-faint">›</span>}
              <span className={f.side === 'mine' ? 'text-info' : 'text-bad'}>{f.set.species}</span>
              <span className="num text-faint">{f.speed}{f.tie ? '=' : ''}</span>
            </span>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-2 items-start px-6">
          {([0, 1] as const).map(spot => (
            <Spot key={spot} side="mine" index={mat.mine[spot]} mat={mat} sets={sets} selected={selected}
              onSelect={setSelected} onDrop={onDropSpot('mine', spot)} offset={spot * 23} />
          ))}
        </div>

        {/* Sticky notes float over the field */}
        {mat.notes.map(n => (
          <Note key={n.id} note={n} onChange={(p, key) => updateNote(n.id, p, key)} onDelete={() => set({notes: mat.notes.filter(x => x.id !== n.id)})} />
        ))}
      </div>

      <Bench side="mine" ids={sets.map((_, i) => i)} mat={mat} sets={sets} selected={selected} onSelect={setSelected}
        onDrop={onDropBench('mine')} onToggleBrought={toggleBrought} />

      {/* Floating cards */}
      {panel === 'suggest' && best && (
        <Floating side="left" title="Suggested" onClose={() => setPanel(null)}>
          <div className="text-[12.5px]">
            <div><span className="text-dim">Lead</span> {best.lead.map(i => sets[i].species).join(' + ')}</div>
            <div><span className="text-dim">Back</span> {best.bring.filter(i => !best.lead.includes(i)).map(i => sets[i].species).join(' · ')}</div>
            <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-dim">{best.reasons.slice(0, 4).map(r => <li key={r}>✓ {r}</li>)}</ul>
            {best.warnings.length > 0 && <ul className="mt-1 space-y-0.5 text-[11.5px] text-warn">{best.warnings.slice(0, 3).map(w => <li key={w}>! {w}</li>)}</ul>}
            <button className="btn mt-2 !py-1 text-xs" onClick={() => set({mine: [best.lead[0], best.lead[1]], brought: best.bring})}>Put on the mat</button>
          </div>
          {advice.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="label mb-1">If they lead …</div>
              <ul className="space-y-0.5 text-[12px]">
                {advice.map(a => (
                  <li key={a.pair.join()}>
                    <button className="w-full rounded-md px-1.5 py-1 text-left hover:bg-panel-2" title="Put these leads on the mat"
                      onClick={() => set({theirs: [a.pair[0], a.pair[1]], mine: [a.lead[0], a.lead[1]]})}>
                      <span className="text-dim">{a.pair.map(j => mat.opp[j].species).join(' + ')}</span>
                      <span className="num ml-1 text-[10px] text-faint">{pct(a.p, 0)}</span>
                      <span className={`block ${a.same ? 'text-good' : 'text-gold'}`}>→ {a.names.join(' + ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Floating>
      )}
      {panel === 'help' && (
        <Floating side="left" title="How it works" onClose={() => setPanel(null)}>
          <ul className="space-y-1.5 text-[12.5px] text-dim">
            <li>Drag Pokémon from the benches onto the four spots.</li>
            <li>Click one to see its calcs against the other side, set HP and stat stages.</li>
            <li>Toggle weather, terrain, Tailwind, Trick Room and screens in the bar on top.</li>
            <li>Add notes and drag them anywhere on the field.</li>
            <li>The dot under your bench Pokémon marks the four you bring.</li>
          </ul>
        </Floating>
      )}
      {sel && (
        <Floating side="right" title="Calcs" onClose={() => setSelected(null)}>
          <Inspector mat={mat} me={sel} foes={fighters.filter(f => f.side !== sel.side)}
            onHp={v => set({hp: {...mat.hp, [sel.key]: v}}, `hp-${sel.key}`)}
            onBoost={(stat, v) => set({boosts: {...mat.boosts, [sel.key]: {...mat.boosts[sel.key], [stat]: v}}})} />
        </Floating>
      )}
      </div>
    </section>
  );
}

/** A card floating over the mat, below the toolbar. */
function Floating({side, title, onClose, children}: {side: 'left' | 'right'; title: string; onClose: () => void; children: React.ReactNode}) {
  return (
    <div onClick={e => e.stopPropagation()}
      className={`rise absolute top-3 z-30 flex max-h-[calc(100%-24px)] w-[340px] flex-col rounded-xl border border-line-2 bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur ${side === 'left' ? 'left-3' : 'right-3'}`}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="label">{title}</span>
        <button className="text-faint hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="min-h-0 overflow-y-auto p-3">{children}</div>
    </div>
  );
}

function fighterByKey(mat: Playmat, sets: PokemonSet[], key: string): Fighter | null {
  const side: MatSide = key[0] === 'm' ? 'mine' : 'theirs';
  const index = +key.slice(1);
  const s = side === 'mine' ? sets[index] : mat.opp[index];
  return s ? {side, index, set: s, key} : null;
}

function Toolbar({name, field, onField, onNote, onChangeOpponent, panel, onPanel}: {
  name: string;
  field: MatField;
  onField: (p: Partial<MatField>) => void;
  onNote: () => void;
  onChangeOpponent: () => void;
  panel: 'suggest' | 'help' | null;
  onPanel: (p: 'suggest' | 'help') => void;
}) {
  const chip = (on: boolean) => `rounded-md border px-2 py-0.5 text-[11.5px] transition ${on ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 text-dim hover:text-ink'}`;
  const sideToggle = (label: string, key: 'tailwind' | 'reflect' | 'lightScreen') => (
    <span className="flex items-center gap-1">
      <span className="text-faint">{label}</span>
      {(['mine', 'theirs'] as const).map(side => (
        <button key={side} className={chip(field[key][side])} onClick={() => onField({[key]: {...field[key], [side]: !field[key][side]}})}>
          {side === 'mine' ? 'you' : 'them'}
        </button>
      ))}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-white/5 bg-black/25 px-4 py-2 text-[12px]">
      <span className="flex items-center gap-2">
        <span className="font-display text-[14px] font-semibold">vs {name}</span>
        <button className="text-[11.5px] text-faint underline hover:text-ink" onClick={onChangeOpponent}>change</button>
      </span>
      <button className={chip(panel === 'suggest')} onClick={() => onPanel('suggest')}>Suggest</button>
      <span className="h-4 w-px bg-white/10" />
      <select className="field !w-auto !py-0.5 text-xs" value={field.weather} onChange={e => onField({weather: e.target.value as MatField['weather']})}>
        {(['', 'Rain', 'Sun', 'Sand', 'Snow'] as const).map(w => <option key={w} value={w}>{WEATHER_LABEL[w]}</option>)}
      </select>
      <select className="field !w-auto !py-0.5 text-xs" value={field.terrain} onChange={e => onField({terrain: e.target.value as MatField['terrain']})}>
        {(['', 'Electric', 'Grassy', 'Psychic', 'Misty'] as const).map(t => <option key={t} value={t}>{t ? `${t} Terrain` : 'No terrain'}</option>)}
      </select>
      <button className={chip(field.trickRoom)} onClick={() => onField({trickRoom: !field.trickRoom})}>Trick Room</button>
      {sideToggle('Tailwind', 'tailwind')}
      {sideToggle('Reflect', 'reflect')}
      {sideToggle('Light Screen', 'lightScreen')}
      <span className="ml-auto flex items-center gap-2">
        <button className="btn !py-0.5 text-xs" onClick={onNote}>+ Note</button>
        <button className={chip(panel === 'help')} onClick={() => onPanel('help')} aria-label="How it works">?</button>
      </span>
    </div>
  );
}

function Bench({side, ids, mat, sets, selected, onSelect, onDrop, onToggleBrought}: {
  side: MatSide; ids: number[]; mat: Playmat; sets: PokemonSet[]; selected: string | null;
  onSelect: (k: string) => void; onDrop: (e: React.DragEvent) => void; onToggleBrought?: (i: number) => void;
}) {
  const list = side === 'mine' ? sets : mat.opp;
  const onField = mat[side];
  return (
    <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
      className={`flex items-end gap-2 bg-black/20 px-4 py-1.5 ${side === 'mine' ? 'border-t' : 'border-b'} border-white/5`}>
      <span className={`label w-16 shrink-0 self-center ${side === 'mine' ? 'text-info' : 'text-bad/80'}`}>{side === 'mine' ? 'Your team' : 'Their team'}</span>
      <div className="flex flex-1 flex-wrap items-end gap-1">
        {ids.map((i, k) => {
          const key = keyOf(side, i);
          const active = onField.includes(i);
          const brought = side === 'mine' && mat.brought.includes(i);
          return (
            <div key={i} className="flex flex-col items-center">
              <button draggable onDragStart={e => e.dataTransfer.setData('text/mat', `${side}:${i}`)}
                onClick={e => { e.stopPropagation(); onSelect(key); }}
                className={`flex cursor-grab flex-col items-center rounded-lg px-1.5 pt-1 transition active:cursor-grabbing ${selected === key ? 'bg-gold/15' : 'hover:bg-white/5'} ${active ? 'opacity-40' : ''}`}
                title={active ? 'On the field' : 'Drag onto a spot'}>
                <div className="flex h-14 items-end"><Sprite name={battleForme(list[i])} facing={side === 'mine' ? 'up' : 'down'} fit={56} offset={k * 13} /></div>
                <span className="text-[11px] text-dim">{list[i].species}</span>
              </button>
              {side === 'mine' && (
                <button onClick={() => onToggleBrought?.(i)} title={brought ? 'Brought (click to leave home)' : 'Stays home (click to bring)'}
                  className={`mt-0.5 h-2 w-2 rounded-full ${brought ? 'bg-info' : 'bg-white/15'}`} />
              )}
            </div>
          );
        })}
      </div>
      {side === 'mine' && <span className="num shrink-0 self-center text-[11px] text-faint">bring {mat.brought.length}/4</span>}
    </div>
  );
}

function Spot({side, index, mat, sets, selected, onSelect, onDrop, offset}: {
  side: MatSide; index: number | null; mat: Playmat; sets: PokemonSet[]; selected: string | null;
  onSelect: (k: string) => void; onDrop: (e: React.DragEvent) => void; offset: number;
}) {
  const set = index === null ? null : side === 'mine' ? sets[index] : mat.opp[index];
  const ring = side === 'mine' ? '90,169,255' : '240,86,106';
  const key = index === null ? '' : keyOf(side, index);
  const hp = mat.hp[key] ?? 100;
  return (
    <div className="flex justify-center" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      {set ? (
        <button draggable onDragStart={e => e.dataTransfer.setData('text/mat', `${side}:${index}`)}
          onClick={e => { e.stopPropagation(); onSelect(key); }}
          className={`flex cursor-grab flex-col items-center rounded-2xl p-1 transition active:cursor-grabbing ${selected === key ? 'bg-gold/10 outline outline-1 outline-gold/50' : ''}`}>
          <div className="relative flex h-[150px] w-44 items-end justify-center">
            <div className="absolute bottom-0 h-8 w-40 rounded-[50%]" style={{background: `rgba(${ring},.16)`, boxShadow: `inset 0 0 0 2px rgba(${ring},.4)`}} />
            <div className="relative -mb-1.5"><Sprite name={battleForme(set)} facing={side === 'mine' ? 'up' : 'down'} scale={3} fit={140} offset={offset} /></div>
          </div>
          <span className="mt-1.5 font-display text-[15px] font-semibold">{set.species}</span>
          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full" style={{width: `${hp}%`, background: hp > 50 ? 'var(--color-good)' : hp > 20 ? 'var(--color-warn)' : 'var(--color-bad)'}} />
          </div>
        </button>
      ) : (
        <div className="flex h-[190px] w-44 items-center justify-center">
          <div className="flex h-16 w-40 items-center justify-center rounded-[50%] border border-dashed border-white/15 text-[11.5px] text-faint">drop here</div>
        </div>
      )}
    </div>
  );
}

function Inspector({mat, me, foes, onHp, onBoost}: {
  mat: Playmat; me: Fighter; foes: Fighter[];
  onHp: (v: number) => void; onBoost: (stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', v: number) => void;
}) {
  const hp = mat.hp[me.key] ?? 100;
  const boosts = mat.boosts[me.key] ?? {};
  const sp = SPECIES[battleForme(me.set)];
  return (
    <>
      <div className="panel p-4">
        <div className="flex items-center gap-3">
          <Sprite name={battleForme(me.set)} facing="down" fit={64} />
          <div className="min-w-0">
            <div className={`label ${me.side === 'mine' ? 'text-info' : 'text-bad'}`}>{me.side === 'mine' ? 'Yours' : 'Theirs'}</div>
            <div className="truncate font-display text-lg font-semibold">{me.set.species}</div>
            <div className="truncate text-[11.5px] text-dim">{me.set.item} · {sp?.mega ? sp.abilities[0] : me.set.ability}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px]">
          <span className="label w-8">HP</span>
          <input type="range" min={1} max={100} value={hp} onChange={e => onHp(+e.target.value)} className="sp flex-1"
            style={{background: `linear-gradient(90deg, var(--color-good) ${hp}%, var(--color-line) 0)`}} />
          <span className="num w-10 text-right">{hp}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
          {(['atk', 'def', 'spa', 'spd', 'spe'] as const).map(s => (
            <span key={s} className="flex items-center gap-1 rounded-md border border-line px-1 py-0.5">
              <span className="w-7 text-dim">{s === 'spa' ? 'SpA' : s === 'spd' ? 'SpD' : s[0].toUpperCase() + s.slice(1)}</span>
              <button className="px-1 text-faint hover:text-ink" onClick={() => onBoost(s, Math.max(-6, (boosts[s] ?? 0) - 1))}>−</button>
              <span className={`num w-5 text-center ${(boosts[s] ?? 0) > 0 ? 'text-good' : (boosts[s] ?? 0) < 0 ? 'text-bad' : ''}`}>{boosts[s] ? (boosts[s]! > 0 ? `+${boosts[s]}` : boosts[s]) : 0}</span>
              <button className="px-1 text-faint hover:text-ink" onClick={() => onBoost(s, Math.min(6, (boosts[s] ?? 0) + 1))}>+</button>
            </span>
          ))}
        </div>
      </div>

      {!foes.length && <div className="panel p-4 text-[13px] text-dim">Put Pokémon on the other side to see calcs.</div>}
      {foes.map(foe => (
        <div key={foe.key} className="panel p-4">
          <div className="label mb-2">vs {foe.set.species}</div>
          <HitList title={`${me.set.species} →`} hits={matHits(mat, me, foe)} />
          <div className="mt-2" />
          <HitList title={`← ${foe.set.species}`} hits={matHits(mat, foe, me)} incoming />
        </div>
      ))}
    </>
  );
}

function HitList({title, hits, incoming}: {title: string; hits: ReturnType<typeof matHits>; incoming?: boolean}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-faint">{title}</div>
      {hits.length === 0 && <div className="text-[12px] text-faint">no damaging moves</div>}
      {hits.slice(0, 4).map(({move, out}) => {
        const ko = koLabel({move, minPct: out.minPct, maxPct: out.maxPct, koText: out.koText, koN: out.koN, koChance: out.koChance});
        return (
          <div key={move} className="flex items-center gap-2 py-0.5 text-[12px]" title={out.desc}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{background: TYPE_COLOR[MOVES[move]?.type] ?? '#555'}} />
            <span className="min-w-0 flex-1 truncate">{move}</span>
            <span className="num" style={{color: incoming ? dmgColor(out.maxPct) : out.maxPct >= 1 ? '#3ecf8e' : 'var(--color-dim)'}}>
              {pct(out.minPct, 0)}–{pct(out.maxPct, 0)}
            </span>
            <span className="num w-14 text-right text-[11px] text-dim">{ko.ko}{ko.chance && <span className="text-[9.5px]"> {ko.chance}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A sticky note; drag it by its top bar. */
function Note({note, onChange, onDelete}: {note: MatNote; onChange: (p: Partial<MatNote>, key?: string) => void; onDelete: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  const startDrag = (e: React.PointerEvent) => {
    const board = ref.current?.parentElement?.getBoundingClientRect();
    if (!board) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(92, ((ev.clientX - board.left) / board.width) * 100 - 6));
      const y = Math.max(0, Math.min(90, ((ev.clientY - board.top) / board.height) * 100 - 2));
      onChange({x, y}, `note-${note.id}`);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const color = NOTE_COLORS[note.color];
  return (
    <div ref={ref} onClick={e => e.stopPropagation()} className="absolute z-20 w-48 rounded-lg shadow-xl shadow-black/40"
      style={{left: `${note.x}%`, top: `${note.y}%`, background: `${color}22`, border: `1px solid ${color}88`, backdropFilter: 'blur(2px)'}}>
      <div onPointerDown={startDrag} className="flex cursor-move items-center gap-1 rounded-t-lg px-2 py-1" style={{background: `${color}33`}}>
        {(Object.keys(NOTE_COLORS) as MatNote['color'][]).map(c => (
          <button key={c} onPointerDown={e => e.stopPropagation()} onClick={() => onChange({color: c})}
            className={`h-2.5 w-2.5 rounded-full ${c === note.color ? 'ring-1 ring-white' : ''}`} style={{background: NOTE_COLORS[c]}} />
        ))}
        <button onPointerDown={e => e.stopPropagation()} onClick={onDelete} className="ml-auto text-[12px] text-faint hover:text-bad" title="Delete note">×</button>
      </div>
      <textarea value={note.text} autoFocus={!note.text} onChange={e => onChange({text: e.target.value}, `note-text-${note.id}`)}
        placeholder="Note …" className="h-20 w-full resize-none bg-transparent px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint" />
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
