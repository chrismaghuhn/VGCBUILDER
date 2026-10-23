import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {SPECIES, TYPE_COLOR, MOVES, pct, type UsageSource} from '../lib/data';
import {WEATHER_LABEL, teamField} from '../lib/analysis';
import {metaSet} from '../lib/calc';
import {leadAdvice, rankPlans} from '../lib/matchup';
import {activeFighters, autoTargets, keyOf, matCalc, matHits, newPlaymat, planMove, turnOrder, type Fighter} from '../lib/playmat';
import {decodeShare, fetchPokepaste, pokepasteId, sharePayload} from '../lib/share';
import {battleForme, importTeam, type MatAction, type MatField, type MatNote, type MatSide, type Playmat, type PokemonSet} from '../lib/team';
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
  const [drag, setDrag] = useState<Drag | null>(null);
  // Moves: 1-4 / Shift+1-4 pick for the left / right Pokémon of `aimSide`, Tab switches sides.
  const [aimSide, setAimSide] = useState<MatSide>('mine');
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const {anchors, obstacles} = useAnchors(fieldRef);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  keyRef.current = () => {};
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
  /**
   * Pointer drag (mouse and touch): the sprite follows the cursor, the spots of that side light up and
   * the nearest one catches it. Dropping on the bench takes a Pokémon off the field. A press without
   * movement stays a click (select).
   */
  const startDrag = (side: MatSide, index: number, fromSpot: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      active = true;
      setDrag({side, index, fromSpot, x: ev.clientX, y: ev.clientY, over: dropTarget(side, ev.clientX, ev.clientY)});
    };
    const end = (ev: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc);
      setDrag(null);
      if (!active) return;
      // Swallow the click that follows a drag so it doesn't select or deselect anything.
      const eat = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', eat, {capture: true, once: true});
      setTimeout(() => window.removeEventListener('click', eat, {capture: true}), 0);
      if (!ev) return;
      const t = dropTarget(side, ev.clientX, ev.clientY);
      if (t === 'bench') { if (fromSpot) unplace(side, index); }
      else if (t !== null) place(side, index, t);
    };
    const up = (ev: PointerEvent) => end(ev);
    const cancel = () => end(null);
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc);
  };

  const toggleBrought = (i: number) => {
    const b = mat.brought.includes(i) ? mat.brought.filter(x => x !== i) : [...mat.brought, i];
    set({brought: b.slice(-4)});
  };

  /** Pick move `n` (0-3) for the Pokémon on `spot` of `side`; picking it again clears it. */
  const chooseMove = (side: MatSide, spot: 0 | 1, n: number) => {
    const idx = mat[side][spot];
    const f = idx === null ? null : fighterByKey(mat, sets, keyOf(side, idx));
    const move = f?.set.moves[n];
    if (!f || !move) return;
    const actions = {...mat.actions};
    if (actions[f.key]?.move === move) delete actions[f.key];
    else actions[f.key] = planMove(mat, sets, f, move);
    setLastPicked(f.key);
    set({actions});
  };

  keyRef.current = e => {
    if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') { e.preventDefault(); setAimSide(s => (s === 'mine' ? 'theirs' : 'mine')); return; }
    const m = /^Digit([1-4])$/.exec(e.code);
    if (!m) return;
    e.preventDefault();
    chooseMove(aimSide, e.shiftKey ? 1 : 0, +m[1] - 1);
  };

  /** The Pokémon under the cursor, else the nearest one within reach. */
  const fighterAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-fighter]') as HTMLElement | null;
    if (el?.dataset.fighter) return el.dataset.fighter;
    const box = fieldRef.current?.getBoundingClientRect();
    if (!box) return null;
    let best: string | null = null, dist = 110;
    for (const [k, p] of Object.entries(anchors)) {
      const d = Math.hypot(x - box.left - p.x, y - box.top - p.y);
      if (d < dist) { dist = d; best = k; }
    }
    return best;
  };

  /** Right-drag from a Pokémon (or from the one whose move was just picked) onto its target. */
  const startAim = (e: React.PointerEvent) => {
    if (e.button !== 2) return;
    const box = fieldRef.current?.getBoundingClientRect();
    const onField = new Set(fighters.map(f => f.key));
    const from = fighterAt(e.clientX, e.clientY) ?? (lastPicked && onField.has(lastPicked) ? lastPicked : null);
    const f = from ? fighterByKey(mat, sets, from) : null;
    if (!box || !f || !onField.has(f.key)) return;
    e.preventDefault();
    const target = (ev: {clientX: number; clientY: number}) => {
      const t = fighterAt(ev.clientX, ev.clientY);
      return t && t !== f.key && onField.has(t) ? t : null;
    };
    const move = (ev: PointerEvent) => setAim({from: f.key, x: ev.clientX - box.left, y: ev.clientY - box.top, over: target(ev)});
    move(e.nativeEvent);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setAim(null);
      const to = target(ev);
      const tf = to ? fighterByKey(mat, sets, to) : null;
      let mv = mat.actions?.[f.key]?.move;
      // No move yet, or one that can't be aimed (Protect …): aiming at a foe picks the hardest hit.
      if (tf && tf.side !== f.side && (!mv || autoTargets(mat, sets, f, mv)?.length === 0)) mv = matHits(mat, f, tf)[0]?.move ?? mv;
      if (!mv) return;
      const auto = autoTargets(mat, sets, f, mv);
      setLastPicked(f.key);
      set({actions: {...mat.actions, [f.key]: {move: mv, targets: auto ?? (to ? [to] : [])}}});
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
        aimSide={aimSide}
        onAimSide={() => setAimSide(aimSide === 'mine' ? 'theirs' : 'mine')}
        onClearMoves={Object.keys(mat.actions ?? {}).length ? () => set({actions: {}}) : undefined}
      />

      {/* Everything below the toolbar; floating cards anchor here */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <Bench side="theirs" ids={mat.opp.map((_, j) => j)} mat={mat} sets={sets} selected={selected} onSelect={setSelected}
        drag={drag} onGrab={startDrag} />

      <div ref={fieldRef} className="relative flex flex-1 flex-col" onClick={() => { setSelected(null); setPanel(null); }}
        onPointerDown={startAim} onContextMenu={e => e.preventDefault()}>
        <div className="grid flex-1 grid-cols-2 items-end px-6">
          {([0, 1] as const).map(spot => (
            <Spot key={spot} side="theirs" spot={spot} index={mat.theirs[spot]} mat={mat} sets={sets} selected={selected}
              onSelect={setSelected} drag={drag} onGrab={startDrag} offset={spot * 17}
              hot={aimSide === 'theirs' ? (spot ? '⇧' : '') : null} onPick={n => chooseMove('theirs', spot, n)} />
          ))}
        </div>

        {/* Turn order across the middle */}
        <div className="mx-6 my-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-y border-dashed border-white/10 py-2 text-[12px]">
          <span data-obstacle className="label mr-1">{mat.field.trickRoom ? 'Order (Trick Room)' : 'Order'}</span>
          {order.map((f, k) => (
            <span key={f.key} data-obstacle className="flex items-center gap-1">
              {k > 0 && <span className="text-faint">›</span>}
              <span className={f.side === 'mine' ? 'text-info' : 'text-bad'}>{f.set.species}</span>
              {f.move && <span className="text-dim">{f.move}</span>}
              {f.prio !== 0 && <span className="num text-gold">{f.prio > 0 ? '+' : ''}{f.prio}</span>}
              <span className="num text-faint">{f.speed}{f.tie ? '=' : ''}</span>
            </span>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-2 items-start px-6">
          {([0, 1] as const).map(spot => (
            <Spot key={spot} side="mine" spot={spot} index={mat.mine[spot]} mat={mat} sets={sets} selected={selected}
              onSelect={setSelected} drag={drag} onGrab={startDrag} offset={spot * 23}
              hot={aimSide === 'mine' ? (spot ? '⇧' : '') : null} onPick={n => chooseMove('mine', spot, n)} />
          ))}
        </div>

        <Arrows mat={mat} sets={sets} fighters={fighters} anchors={anchors} obstacles={obstacles} aim={aim}
          onLabel={(from, to, t) => {
            const a = mat.actions?.[from];
            if (!a) return;
            const labels = {...a.labels};
            if (t === null) delete labels[to]; else labels[to] = t;
            set({actions: {...mat.actions, [from]: {...a, labels}}}, t === null ? undefined : `label-${from}-${to}`);
          }} />

        {/* Sticky notes float over the field */}
        {mat.notes.map(n => (
          <Note key={n.id} note={n} onChange={(p, key) => updateNote(n.id, p, key)} onDelete={() => set({notes: mat.notes.filter(x => x.id !== n.id)})} />
        ))}
      </div>

      <Bench side="mine" ids={sets.map((_, i) => i)} mat={mat} sets={sets} selected={selected} onSelect={setSelected}
        drag={drag} onGrab={startDrag} onToggleBrought={toggleBrought} />

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
            <li><b className="text-ink">1–4</b> picks a move for the left Pokémon, <b className="text-ink">Shift+1–4</b> for the right one, <b className="text-ink">Tab</b> switches to the other side.</li>
            <li><b className="text-ink">Right-drag</b> from a Pokémon onto its target draws the attack with its damage. Spread moves aim themselves. Drag a damage label along its arrow, double-click it to reset.</li>
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

      {drag && <DragGhost drag={drag} set={drag.side === 'mine' ? sets[drag.index] : mat.opp[drag.index]} />}
    </section>
  );
}

interface Drag {
  side: MatSide;
  index: number;
  fromSpot: boolean;
  x: number;
  y: number;
  /** Spot (0/1) or 'bench' under the cursor. */
  over: 0 | 1 | 'bench' | null;
}
type Grab = (side: MatSide, index: number, fromSpot: boolean) => (e: React.PointerEvent) => void;

/** Where a Pokémon of `side` would land: the element under the cursor, else the nearest spot within reach. */
function dropTarget(side: MatSide, x: number, y: number): 0 | 1 | 'bench' | null {
  const parse = (v?: string) => {
    if (!v) return null;
    const [s, w] = v.split(':');
    if (s !== side) return null;
    return w === 'bench' ? 'bench' as const : (+w as 0 | 1);
  };
  const hit = parse((document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop);
  if (hit !== null) return hit;
  let best: 0 | 1 | null = null, dist = 200;
  document.querySelectorAll<HTMLElement>(`[data-drop^="${side}:"]`).forEach(el => {
    const t = parse(el.dataset.drop);
    if (t === null || t === 'bench') return;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < dist) { dist = d; best = t; }
  });
  return best;
}

/** The sprite under the cursor while dragging. */
function DragGhost({drag, set}: {drag: Drag; set: PokemonSet}) {
  return (
    <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[70%]" style={{left: drag.x, top: drag.y}}>
      <div className="rotate-[-4deg] scale-110 drop-shadow-[0_10px_12px_rgba(0,0,0,.6)]">
        <Sprite name={battleForme(set)} facing={drag.side === 'mine' ? 'up' : 'down'} scale={2.5} fit={110} />
      </div>
    </div>
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

function Toolbar({name, field, onField, onNote, onChangeOpponent, panel, onPanel, aimSide, onAimSide, onClearMoves}: {
  aimSide: MatSide;
  onAimSide: () => void;
  onClearMoves?: () => void;
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
      <button className={chip(false)} onClick={onAimSide} title="Which side 1–4 picks moves for (Tab)">
        moves: <span className={aimSide === 'mine' ? 'text-info' : 'text-bad'}>{aimSide === 'mine' ? 'you' : 'them'}</span> <kbd className="text-faint">⇥</kbd>
      </button>
      {onClearMoves && <button className="text-[11.5px] text-faint underline hover:text-ink" onClick={onClearMoves}>clear moves</button>}
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

function Bench({side, ids, mat, sets, selected, onSelect, drag, onGrab, onToggleBrought}: {
  side: MatSide; ids: number[]; mat: Playmat; sets: PokemonSet[]; selected: string | null;
  onSelect: (k: string) => void; drag: Drag | null; onGrab: Grab; onToggleBrought?: (i: number) => void;
}) {
  const list = side === 'mine' ? sets : mat.opp;
  const onField = mat[side];
  // Only a Pokémon dragged off the field can go back to the bench.
  const target = drag?.side === side && drag.fromSpot;
  return (
    <div data-drop={`${side}:bench`}
      className={`flex items-end gap-2 px-4 py-1.5 transition ${side === 'mine' ? 'border-t' : 'border-b'} ${
        target && drag.over === 'bench' ? 'border-gold/60 bg-gold/10' : target ? 'border-white/20 bg-white/[.04]' : 'border-white/5 bg-black/20'}`}>
      <span className={`label w-16 shrink-0 self-center ${side === 'mine' ? 'text-info' : 'text-bad/80'}`}>{side === 'mine' ? 'Your team' : 'Their team'}</span>
      <div className="flex flex-1 flex-wrap items-end gap-1">
        {ids.map((i, k) => {
          const key = keyOf(side, i);
          const active = onField.includes(i);
          const brought = side === 'mine' && mat.brought.includes(i);
          return (
            <div key={i} className="flex flex-col items-center">
              <button onPointerDown={onGrab(side, i, active)}
                onClick={e => { e.stopPropagation(); onSelect(key); }}
                className={`flex cursor-grab touch-none select-none flex-col items-center rounded-lg px-1.5 pt-1 transition active:cursor-grabbing ${selected === key ? 'bg-gold/15' : 'hover:bg-white/5'} ${active || (drag?.side === side && drag.index === i) ? 'opacity-40' : ''}`}
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

function Spot({side, spot, index, mat, sets, selected, onSelect, drag, onGrab, offset, hot, onPick}: {
  side: MatSide; spot: 0 | 1; index: number | null; mat: Playmat; sets: PokemonSet[]; selected: string | null;
  onSelect: (k: string) => void; drag: Drag | null; onGrab: Grab; offset: number;
  /** Hotkey prefix when 1-4 picks for this side ('' left, '⇧' right), else null. */
  hot: string | null; onPick: (n: number) => void;
}) {
  const set = index === null ? null : side === 'mine' ? sets[index] : mat.opp[index];
  const ring = side === 'mine' ? '90,169,255' : '240,86,106';
  const key = index === null ? '' : keyOf(side, index);
  const hp = mat.hp[key] ?? 100;
  // While dragging: this side's spots light up, the one that would catch the drop glows.
  const valid = drag?.side === side;
  const over = valid && drag.over === spot;
  const self = valid && drag.fromSpot && drag.index === index;
  const pad = over ? `rgba(245,197,66,.28)` : `rgba(${ring},${valid ? '.26' : '.16'})`;
  const edge = over ? `inset 0 0 0 2px rgba(245,197,66,.9), 0 0 24px rgba(245,197,66,.35)` : `inset 0 0 0 2px rgba(${ring},${valid ? '.75' : '.4'})`;
  return (
    <div data-drop={`${side}:${spot}`} className={`flex justify-center transition ${drag && !valid ? 'opacity-50' : ''}`}>
      {set ? (
        <div className="group/spot flex flex-col items-center">
        <button data-fighter={key} onPointerDown={e => e.button === 0 && onGrab(side, index!, true)(e)}
          onClick={e => { e.stopPropagation(); onSelect(key); }}
          className={`flex cursor-grab touch-none select-none flex-col items-center rounded-2xl p-1 transition active:cursor-grabbing ${selected === key && !drag ? 'bg-gold/10 outline outline-1 outline-gold/50' : ''}`}>
          <div data-anchor className="relative flex h-[150px] w-44 items-end justify-center">
            <div className="absolute bottom-0 h-8 w-40 rounded-[50%] transition" style={{background: pad, boxShadow: edge}} />
            {over && !self && drag.fromSpot && <span className="absolute top-1 rounded bg-black/60 px-1.5 text-[10.5px] text-gold">swap</span>}
            {over && !self && !drag.fromSpot && <span className="absolute top-1 rounded bg-black/60 px-1.5 text-[10.5px] text-gold">replace</span>}
            <div data-obstacle className={`relative -mb-1.5 transition ${self ? 'opacity-30' : over ? 'opacity-50' : ''}`}><Sprite name={battleForme(set)} facing={side === 'mine' ? 'up' : 'down'} scale={3} fit={140} offset={offset} /></div>
          </div>
          <span data-obstacle className="mt-1.5 font-display text-[15px] font-semibold">{set.species}</span>
          <div data-obstacle className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full" style={{width: `${hp}%`, background: hp > 50 ? 'var(--color-good)' : hp > 20 ? 'var(--color-warn)' : 'var(--color-bad)'}} />
          </div>
        </button>
        <MoveChips set={set} action={mat.actions?.[key]} hot={hot} onPick={onPick} side={side} />
        </div>
      ) : (
        <div className="flex h-[190px] w-44 items-center justify-center">
          <div className={`flex h-16 w-40 items-center justify-center rounded-[50%] border border-dashed text-[11.5px] transition ${
            over ? 'scale-105 border-gold bg-gold/15 text-gold' : valid ? 'border-white/40 bg-white/5 text-dim' : 'border-white/15 text-faint'}`}>drop here</div>
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

interface Aim {
  from: string;
  x: number;
  y: number;
  over: string | null;
}
type Point = {x: number; y: number};

type Rect = {x: number; y: number; w: number; h: number};

/**
 * Centers of the Pokémon on the field and the boxes arrow labels should keep clear of (names, HP bars,
 * move chips, sprites, the turn order), relative to the field box; re-measured on layout changes.
 */
function useAnchors(ref: React.RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<{anchors: Record<string, Point>; obstacles: Rect[]}>({anchors: {}, obstacles: []});
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const next: Record<string, Point> = {};
      box.querySelectorAll<HTMLElement>('[data-fighter]').forEach(el => {
        const r = (el.querySelector('[data-anchor]') ?? el).getBoundingClientRect();
        next[el.dataset.fighter!] = {x: Math.round(r.left - b.left + r.width / 2), y: Math.round(r.top - b.top + r.height / 2)};
      });
      const obstacles = [...box.querySelectorAll<HTMLElement>('[data-obstacle]')].map(el => {
        const r = el.getBoundingClientRect();
        return {x: Math.round(r.left - b.left), y: Math.round(r.top - b.top), w: Math.round(r.width), h: Math.round(r.height)};
      }).filter(r => r.w && r.h);
      const value = {anchors: next, obstacles};
      setState(prev => (JSON.stringify(prev) === JSON.stringify(value) ? prev : value));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  });
  return state;
}

const ARROW = {mine: '#5aa9ff', theirs: '#f0566a', ally: '#3ecf8e'};

/** A curved arrow from a to b, its ends pulled back so the sprites stay visible. */
function curve(a: Point, b: Point, bend: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = {x: (a.x + b.x) / 2 - (dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend};
  const pull = (p: Point, by: number) => {
    const l = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const k = Math.min(by, l * 0.4) / l;
    return {x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k};
  };
  const s = pull(a, 46), e = pull(b, 58);
  const at = (t: number) => ({
    x: (1 - t) ** 2 * s.x + 2 * (1 - t) * t * c.x + t ** 2 * e.x,
    y: (1 - t) ** 2 * s.y + 2 * (1 - t) * t * c.y + t ** 2 * e.y,
  });
  return {d: `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`, at};
}

let measureCtx: CanvasRenderingContext2D | null = null;
const textWidth = (text: string) => {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 6.5;
  measureCtx.font = '11px ui-sans-serif, system-ui, sans-serif';
  return measureCtx.measureText(text).width;
};
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Slide a label along its arrow to the spot that covers the least (names, chips, other labels). */
function placeLabel(at: (t: number) => Point, w: number, h: number, taken: Rect[]): Point {
  let best = at(0.5), cost = Infinity;
  // On the line first, then a little above/below it if the line is crowded.
  for (const dy of [0, -(h + 4), h + 4]) {
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const q = at(t), p = {x: q.x, y: q.y + dy};
      const r = {x: p.x - w / 2 - 3, y: p.y - h / 2 - 3, w: w + 6, h: h + 6};
      // A little nudge towards the middle of the line so equally free spots keep the label centred.
      const c = taken.reduce((sum, o) => sum + overlap(r, o), 0) + Math.abs(t - 0.5) * 40 + Math.abs(dy) * 1.5;
      if (c < cost) { cost = c; best = p; }
      if (c < 20) return best;
    }
  }
  return best;
}

/** The planned attacks as arrows, labelled with the move and its damage; plus the one being drawn. */
function Arrows({mat, sets, fighters, anchors, obstacles, aim, onLabel}: {
  mat: Playmat; sets: PokemonSet[]; fighters: Fighter[]; anchors: Record<string, Point>; obstacles: Rect[]; aim: Aim | null;
  /** Move a label along its arrow (t 0-1), or null to let it place itself again. */
  onLabel: (from: string, to: string, t: number | null) => void;
}) {
  // While dragging, the label follows the cursor locally; the board is updated as it moves.
  const [dragT, setDragT] = useState<{id: string; t: number} | null>(null);
  const byKey = Object.fromEntries(fighters.map(f => [f.key, f]));
  const targetsOf = (f: Fighter) => {
    const a = mat.actions?.[f.key];
    if (!a) return [];
    return (autoTargets(mat, sets, f, a.move) ?? a.targets).filter(t => byKey[t] && anchors[t] && t !== f.key);
  };
  const aimed = Object.fromEntries(fighters.map(f => [f.key, targetsOf(f)]));
  const taken = [...obstacles];
  const arrows: {id: string; from: string; to: string; at: (t: number) => Point; color: string; d: string; mid: Point; move: string; out: ReturnType<typeof matCalc>}[] = [];
  for (const f of fighters) {
    const a = mat.actions?.[f.key];
    if (!a || !anchors[f.key]) continue;
    for (const t of aimed[f.key]) {
      const ally = byKey[t].side === f.side;
      // Two Pokémon hitting each other: bend both arrows wider so they don't lie on top of each other.
      const mutual = aimed[t]?.includes(f.key);
      const {d, at} = curve(anchors[f.key], anchors[t], ally ? 46 : mutual ? 62 : 34);
      const out = !ally && MOVES[a.move]?.cat !== 'Status' ? matCalc(mat, f, byKey[t], a.move) : null;
      const ko = out ? koLabel({move: a.move, minPct: out.minPct, maxPct: out.maxPct, koText: out.koText, koN: out.koN, koChance: out.koChance}) : null;
      const text = `${a.move}  ${out ? `${pct(out.minPct, 0)}–${pct(out.maxPct, 0)}  ${ko && ko.ko !== '—' ? ko.ko + (ko.chance ? ' ' + ko.chance : '') : ''}` : ''}`;
      const w = textWidth(text) + 16, h = 20;
      const id = `${f.key}-${t}`;
      const manual = dragT?.id === id ? dragT.t : a.labels?.[t];
      const mid = manual !== undefined ? at(manual) : placeLabel(at, w, h, taken);
      taken.push({x: mid.x - w / 2, y: mid.y - h / 2, w, h});
      arrows.push({id, from: f.key, to: t, at, color: ally ? ARROW.ally : ARROW[f.side], d, mid, move: a.move, out});
    }
  }
  /** Drag a label: it slides to the point of its arrow nearest to the cursor. */
  const grabLabel = (e: React.PointerEvent, a: (typeof arrows)[number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const nearest = (ev: PointerEvent) => {
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      let best = 0.5, dist = Infinity;
      for (let t = 0.08; t <= 0.92; t += 0.01) {
        const p = a.at(t);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < dist) { dist = d; best = t; }
      }
      return Math.round(best * 100) / 100;
    };
    let last: number | null = null;
    const move = (ev: PointerEvent) => { last = nearest(ev); setDragT({id: a.id, t: last}); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last !== null) onLabel(a.from, a.to, last);
      setDragT(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const live = aim && anchors[aim.from] ? curve(anchors[aim.from], aim.over ? anchors[aim.over] : {x: aim.x, y: aim.y}, aim.over ? 34 : 0) : null;
  const liveColor = aim ? ARROW[byKey[aim.from]?.side ?? 'mine'] : '';
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
        <defs>
          {Object.entries(ARROW).map(([k, c]) => (
            <marker key={k} id={`head-${k}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {arrows.map(a => (
          <path key={a.id} d={a.d} fill="none" stroke={a.color} strokeWidth={3.5} strokeLinecap="round" opacity={0.9}
            markerEnd={`url(#head-${Object.entries(ARROW).find(([, c]) => c === a.color)![0]})`} style={{filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))'}} />
        ))}
        {live && (
          <path d={live.d} fill="none" stroke={liveColor} strokeWidth={3.5} strokeDasharray="7 6" strokeLinecap="round"
            markerEnd={`url(#head-${byKey[aim!.from]?.side ?? 'mine'})`} />
        )}
      </svg>
      {arrows.map(a => {
        const ko = a.out ? koLabel({move: a.move, minPct: a.out.minPct, maxPct: a.out.maxPct, koText: a.out.koText, koN: a.out.koN, koChance: a.out.koChance}) : null;
        return (
          <div key={a.id} onPointerDown={e => grabLabel(e, a)} onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); onLabel(a.from, a.to, null); }}
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none select-none whitespace-nowrap rounded-md border bg-black/80 px-1.5 py-0.5 text-[11px] shadow-lg active:cursor-grabbing ${dragT?.id === a.id ? 'ring-1 ring-white/40' : ''}`}
            style={{left: a.mid.x, top: a.mid.y, borderColor: `${a.color}99`}}
            title={`${a.out?.desc ? a.out.desc + '\n' : ''}Drag along the arrow · double-click to reset`}>
            <span style={{color: a.color}}>{a.move}</span>
            {a.out && (
              <>
                <span className="num ml-1.5" style={{color: dmgColor(a.out.maxPct)}}>{pct(a.out.minPct, 0)}–{pct(a.out.maxPct, 0)}</span>
                {ko && ko.ko !== '—' && <span className="num ml-1 text-dim">{ko.ko}{ko.chance && ` ${ko.chance}`}</span>}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The four moves under a Pokémon on the hotkey side; elsewhere just the planned one. */
function MoveChips({set, action, hot, onPick, side}: {set: PokemonSet; action?: MatAction; hot: string | null; onPick: (n: number) => void; side: MatSide}) {
  const tint = side === 'mine' ? 'border-info/70 bg-info/15 text-ink' : 'border-bad/70 bg-bad/15 text-ink';
  const picked = action ? <span data-obstacle className={`mt-1.5 rounded-md border px-2 py-0.5 text-[11px] ${tint}`}>{action.move}</span> : null;
  if (hot === null) return picked ?? <span className="mt-1.5 h-[22px]" />;
  // Once a move is picked only it shows; hovering the Pokémon brings back all four.
  return (
    <div className="relative flex flex-col items-center">
      {picked && <div className="group-hover/spot:invisible">{picked}</div>}
    <div data-obstacle={picked ? undefined : ''} onPointerDown={e => e.stopPropagation()}
      className={`mt-1.5 grid w-max grid-cols-[104px_104px] gap-1 ${
        picked ? 'invisible absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded-lg border border-white/10 bg-[#0b1413]/95 p-1 shadow-xl group-hover/spot:visible' : ''}`}>
      {set.moves.slice(0, 4).map((m, n) => (
        <button key={m + n} onClick={e => { e.stopPropagation(); onPick(n); }}
          className={`flex w-[104px] items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-[10.5px] transition ${
            action?.move === m ? tint : 'border-white/10 bg-black/30 text-dim hover:text-ink'}`}>
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{background: TYPE_COLOR[MOVES[m]?.type] ?? '#555'}} />
          <span className="num shrink-0 text-faint">{hot}{n + 1}</span>
          <span className="truncate">{m}</span>
        </button>
      ))}
    </div>
    </div>
  );
}
