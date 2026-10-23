import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {SPECIES, STAT_LABEL, STATS, TYPE_COLOR, MOVES, pct, type UsageSource} from '../lib/data';
import {WEATHER_LABEL, teamField} from '../lib/analysis';
import {fillSpreads, metaSet} from '../lib/calc';
import {leadAdvice, rankPlans} from '../lib/matchup';
import {encodeMat} from '../lib/matshare';
import {
  activePlan, addFrame, commitFrame, deleteFrame, deletePlan, gotoFrame, newPlan, setFrameNote, switchPlan, updatePlan,
} from '../lib/playmat';
import {activeFighters, autoTargets, canMega, keyOf, matSet, toggleMega, matCalc, matHits, newPlaymat, planMove, turnOrder, type Fighter} from '../lib/playmat';
import {matchFromReplay, type Match} from '../lib/matches';
import {fetchReplay, guessMe, parseReplay, replayId, replayPerspective, replayPlaymat, showStep, type ParsedReplay, type PSide} from '../lib/replay';
import {decodeShare, fetchPokepaste, pokepasteId, sharePayload} from '../lib/share';
import {battleForme, importTeam, type SavedBoard, type MatPlan, type MatAction, type MatField, type MatNote, type MatSide, type Playmat, type PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {koLabel} from './MetaView';
import {speciesOptions} from './SetEditor';
import {Sprite} from './Sprite';
import {Combobox, EstBadge, Portrait, Section, dmgColor} from './ui';

const BOARD_BG =
  'repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 24px), #050505';

const NOTE_COLORS: Record<MatNote['color'], string> = {gold: '#f5c542', blue: '#5aa9ff', red: '#f0566a', green: '#3ecf8e'};

type Panel = 'suggest' | 'help' | 'replay' | 'log' | 'plan' | 'share' | 'boards';

export function PlaymatView({sets: mySets, usage, mat, onChange, onSaveMatch, savedReplays = [], boards = [], onRenameBoard, onDeleteBoard}: {
  /** All boards of this team, newest first (the open one included). */
  boards?: SavedBoard[];
  onRenameBoard: (id: string, name: string) => void;
  onDeleteBoard: (id: string) => void;
  sets: PokemonSet[];
  usage: UsageSource;
  mat?: Playmat;
  onChange: (m: Playmat | undefined, coalesceKey?: string) => void;
  /** Add the replay on the mat to the team's match log. */
  onSaveMatch?: (m: Match) => void;
  savedReplays?: string[];
}) {
  // A replay (or a board branched from one, or opened from a link) brings its own team for the bottom side.
  const sets = mat?.team ?? (mat?.replay ? mat.replay.mine : mySets);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(mat?.replay ? 'log' : null);
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

  const openReplay = (r: ParsedReplay, hint: PSide | null) => {
    onChange(replayPlaymat(r, guessMe(r, mySets, hint), mySets, usage));
    setPanel('log');
    setSelected(null);
  };

  if (!mat) {
    return (
      <div className="space-y-4">
        {mySets.length ? <OpponentPicker usage={usage} onSet={(name, opp) => onChange(newPlaymat(name, opp, sets, usage))} /> : <Empty />}
        <Section title="Or watch a Showdown replay">
          <ReplayImport onLoad={openReplay} />
        </Section>
        {boards.length > 0 && (
          <Section title={`Your boards (${boards.length})`}>
            <BoardList boards={boards} onOpen={b => onChange(b.mat)} onRename={onRenameBoard} onDelete={onDeleteBoard} />
          </Section>
        )}
      </div>
    );
  }

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
    if (mat.replay && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      goto(mat.replay.step + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (plan && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      frame(plan.at + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    const m = /^Digit([1-4])$/.exec(e.code);
    if (!m) return;
    e.preventDefault();
    chooseMove(aimSide, e.shiftKey ? 1 : 0, +m[1] - 1);
  };

  const plan = mat.replay ? undefined : activePlan(mat);
  /** Storyboard: show frame n. */
  const frame = (n: number) => { setSelected(null); onChange(gotoFrame(mat, n), 'plan-step'); };
  /** Toolbar "Plan": open the last plan, or start one from the board as it is. */
  const openPlan = () => {
    if (plan) { setPanel(panel === 'plan' ? null : 'plan'); return; }
    onChange(mat.plans?.length ? switchPlan(mat, mat.plans.length - 1) : newPlan(mat));
    setPanel('plan');
  };
  /** Replay: carry on from this turn as a storyboard of your own. */
  const branch = () => {
    const r = mat.replay!;
    const turn = r.replay.steps[r.step].turn;
    const them = r.me === 'p1' ? 'p2' : 'p1';
    // Keep the moves of that turn as a starting point, but not what really happened: this is the alternative.
    const actions = Object.fromEntries(Object.entries(mat.actions ?? {}).map(([k, a]) => [k, {move: a.move, targets: a.targets}]));
    const free: Playmat = {...mat, id: undefined, actions, replay: undefined, team: r.mine, name: `${r.replay.players[them]} · from ${turnTitle(turn).toLowerCase()}`};
    onChange(newPlan(free, `Alt from ${turnTitle(turn).toLowerCase()}`, Math.max(1, turn), r.turnNotes[turn] ?? ''));
    setPanel('plan');
  };

  /** Replay: show step n (stepping coalesces into one undo entry). */
  const goto = (n: number) => {
    if (!mat.replay || n < 0 || n >= mat.replay.replay.steps.length) return;
    setSelected(null);
    onChange(showStep(mat, n), 'replay-step');
  };
  const exitReplay = () => {
    const r = mat.replay!;
    const them = r.me === 'p1' ? 'p2' : 'p1';
    // Keep practising against their team with your own.
    onChange(mySets.length ? newPlaymat(`${r.replay.players[them]}`, mat.opp, mySets, usage) : undefined);
    setPanel(null);
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
        name={mat.replay ? mat.name : `vs ${mat.name}`}
        field={mat.field}
        onField={setField}
        onNote={addNote}
        onChangeOpponent={() => onChange(undefined)}
        panel={panel}
        onPanel={p => setPanel(panel === p ? null : p)}
        replay={!!mat.replay}
        planOpen={!!plan}
        boardCount={boards.length}
        onPlan={openPlan}
        aimSide={aimSide}
        onAimSide={() => setAimSide(aimSide === 'mine' ? 'theirs' : 'mine')}
        onClearMoves={Object.keys(mat.actions ?? {}).length ? () => set({actions: {}}) : undefined}
      />

      {mat.replay && (
        <ReplayBar mat={mat} onStep={goto} onBranch={branch}
          saved={!!mat.replay.replay.id && savedReplays.includes(mat.replay.replay.id)}
          onSave={onSaveMatch && (() => {
            const r = mat.replay!;
            const m = matchFromReplay(r.replay, r.me, usage, mySets);
            // Turn notes go along into the match notes.
            m.notes = r.replay.steps.map(s => s.turn).filter((t, i, a) => a.indexOf(t) === i)
              .filter(t => r.turnNotes[t]?.trim()).map(t => `${turnTitle(t)}: ${r.turnNotes[t].trim()}`).join('\n');
            m.board = mat.id;
            onSaveMatch(m);
          })} onLog={() => setPanel(panel === 'log' ? null : 'log')} logOpen={panel === 'log'} onExit={exitReplay}
          onSwap={() => {
            const r = mat.replay!;
            onChange(showStep(replayPlaymat(r.replay, r.me === 'p1' ? 'p2' : 'p1', mySets, usage, r.turnNotes), r.step));
          }} />
      )}

      {plan && (
        <PlanBar mat={mat} plan={plan} onFrame={frame} notesOpen={panel === 'plan'}
          onNotes={() => setPanel(panel === 'plan' ? null : 'plan')}
          onAdd={() => onChange(addFrame(mat))}
          onDelete={() => onChange(deleteFrame(mat))}
          onRename={name => onChange(updatePlan(mat, {name}), `plan-name-${plan.id}`)}
          onSwitch={i => onChange(switchPlan(mat, i))}
          onNew={() => onChange(newPlan(mat))}
          onDeletePlan={() => { if (confirm(`Delete "${plan.name}"?`)) onChange(deletePlan(mat)); }}
          onClose={() => { onChange(switchPlan(mat, undefined)); setPanel(null); }} />
      )}

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
              hot={aimSide === 'theirs' ? (spot ? '⇧' : '') : null} onPick={n => chooseMove('theirs', spot, n)}
              onMega={() => { const i = mat.theirs[spot]; if (i !== null) set({megas: toggleMega(mat, sets, keyOf('theirs', i))}); }} />
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
              hot={aimSide === 'mine' ? (spot ? '⇧' : '') : null} onPick={n => chooseMove('mine', spot, n)}
              onMega={() => { const i = mat.mine[spot]; if (i !== null) set({megas: toggleMega(mat, sets, keyOf('mine', i))}); }} />
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
      {panel === 'plan' && plan && (
        <Floating side="left" title={`${plan.name} · ${frameTitle(plan, plan.at)}`} onClose={() => setPanel(null)}>
          <PlanNotes plan={plan} onNote={(text, n) => onChange(setFrameNote(mat, text, n), `frame-note-${plan.id}-${n ?? plan.at}`)} onFrame={frame} />
        </Floating>
      )}
      {panel === 'boards' && (
        <Floating side="right" title={`Boards (${boards.length})`} onClose={() => setPanel(null)}>
          <BoardList boards={boards} current={mat.id} onRename={onRenameBoard} onDelete={onDeleteBoard}
            onOpen={b => { setSelected(null); setPanel(b.mat.replay ? 'log' : null); onChange(b.mat); }} />
          <button className="btn mt-3 w-full justify-center" onClick={() => { setPanel(null); onChange(undefined); }}>+ New board</button>
        </Floating>
      )}
      {panel === 'share' && (
        <Floating side="right" title="Share this board" onClose={() => setPanel(null)}>
          <ShareBoard mat={mat} sets={sets} />
        </Floating>
      )}
      {panel === 'replay' && (
        <Floating side="left" title="Import a Showdown replay" onClose={() => setPanel(null)}>
          <ReplayImport onLoad={openReplay} />
        </Floating>
      )}
      {panel === 'log' && mat.replay && (
        <Floating side="left" title={turnTitle(mat.replay.replay.steps[mat.replay.step]?.turn ?? 0)} onClose={() => setPanel(null)}>
          <TurnLog mat={mat} onNote={text => {
            const r = mat.replay!;
            const turn = r.replay.steps[r.step].turn;
            set({replay: {...r, turnNotes: {...r.turnNotes, [turn]: text}}}, `turn-note-${turn}`);
          }} />
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
            <li><b className="text-ink">Plan</b> turns the board into a storyboard: one frame per turn with its own board and notes; <b className="text-ink">← →</b> flip through it.</li>
            <li><b className="text-ink">Share</b> makes a link to this board, open or with a password.</li>
            <li><b className="text-ink">Replay</b> loads a Showdown replay; <b className="text-ink">← →</b> step through its turns, each with its own notes.</li>
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

      {drag && <DragGhost drag={drag} set={matSet(mat, keyOf(drag.side, drag.index), drag.side === 'mine' ? sets[drag.index] : mat.opp[drag.index])} />}
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

function Toolbar({name, field, onField, onNote, onChangeOpponent, panel, onPanel, replay, planOpen, onPlan, boardCount, aimSide, onAimSide, onClearMoves}: {
  replay: boolean;
  boardCount: number;
  planOpen: boolean;
  onPlan: () => void;
  aimSide: MatSide;
  onAimSide: () => void;
  onClearMoves?: () => void;
  name: string;
  field: MatField;
  onField: (p: Partial<MatField>) => void;
  onNote: () => void;
  onChangeOpponent: () => void;
  panel: Panel | null;
  onPanel: (p: Panel) => void;
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
        <button className={chip(panel === 'boards')} onClick={() => onPanel('boards')} title="All boards of this team">Boards{boardCount > 1 ? ` · ${boardCount}` : ''}</button>
        <span className="font-display text-[14px] font-semibold">{name}</span>
        <button className="text-[11.5px] text-faint underline hover:text-ink" onClick={onChangeOpponent}>change</button>
      </span>
      <button className={chip(panel === 'suggest')} onClick={() => onPanel('suggest')}>Suggest</button>
      {!replay && <button className={chip(panel === 'replay')} onClick={() => onPanel('replay')}>Replay</button>}
      {!replay && <button className={chip(planOpen)} onClick={onPlan} title="Plan the game turn by turn">Plan</button>}
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
        <button className={chip(panel === 'share')} onClick={() => onPanel('share')} title="Share this board as a link">Share</button>
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
                <div className="flex h-14 items-end"><Sprite name={battleForme(matSet(mat, key, list[i]))} facing={side === 'mine' ? 'up' : 'down'} fit={56} offset={k * 13} /></div>
                <span className="flex items-center gap-1 text-[11px] text-dim">{list[i].species}{list[i].estimated && <span className="text-faint" title="Spread estimated from usage data">*</span>}</span>
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

function Spot({side, spot, index, mat, sets, selected, onSelect, drag, onGrab, offset, hot, onPick, onMega}: {
  side: MatSide; spot: 0 | 1; index: number | null; mat: Playmat; sets: PokemonSet[]; selected: string | null;
  onSelect: (k: string) => void; drag: Drag | null; onGrab: Grab; offset: number;
  /** Hotkey prefix when 1-4 picks for this side ('' left, '⇧' right), else null. */
  hot: string | null; onPick: (n: number) => void; onMega: () => void;
}) {
  const raw = index === null ? null : side === 'mine' ? sets[index] : mat.opp[index];
  const set = raw && index !== null ? matSet(mat, keyOf(side, index), raw) : null;
  const ring = side === 'mine' ? '90,169,255' : '240,86,106';
  const key = index === null ? '' : keyOf(side, index);
  const hp = mat.hp[key] ?? 100;
  // While dragging: this side's spots light up, the one that would catch the drop glows.
  const valid = drag?.side === side;
  const over = valid && drag.over === spot;
  const self = valid && drag.fromSpot && drag.index === index;
  const pad = over ? `rgba(245,245,245,.28)` : `rgba(${ring},${valid ? '.26' : '.16'})`;
  const edge = over ? `inset 0 0 0 2px rgba(245,245,245,.9), 0 0 24px rgba(245,245,245,.35)` : `inset 0 0 0 2px rgba(${ring},${valid ? '.75' : '.4'})`;
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
          <span data-obstacle className="mt-1.5 flex items-center gap-1.5 font-display text-[15px] font-semibold">
            {set.species}
            {canMega(raw!) && (
              <span role="button" tabIndex={0} onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onMega(); }}
                title={set.unevolved ? 'Mega Evolve (one per side and battle)' : 'Mega Evolved: click to undo'}
                className={`rounded px-1 font-display text-[10px] font-bold leading-[15px] transition ${
                  set.unevolved ? 'border border-gold/50 text-gold/80 hover:bg-gold/15' : 'border border-gold bg-gold text-black'}`}>M</span>
            )}
          </span>
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
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
              <span className="truncate">{me.set.nature} · {STATS.filter(s => me.set.sps[s]).map(s => `${me.set.sps[s]} ${STAT_LABEL[s]}`).join(' / ') || 'no SP'}</span>
              {me.set.estimated && <EstBadge />}
            </div>
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
          <div className="mb-2 flex items-center gap-1.5"><span className="label">vs {foe.set.species}</span>{foe.set.estimated && <EstBadge />}</div>
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
  const fill = (team: PokemonSet[]) => fillSpreads(team, usage);

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
    onSet(`${name} core`, team.map(n => ({...metaSet(n, usage), estimated: true})));
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
          <p className="mt-2 text-[11.5px] text-faint">Missing spreads are filled with the most common meta spread and marked <EstBadge className="inline-block align-middle" />.</p>
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
  const arrows: {id: string; from: string; to: string; at: (t: number) => Point; color: string; d: string; mid: Point; move: string; out: ReturnType<typeof matCalc>; real?: string}[] = [];
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
      const real = a.results?.[t];
      const text = `${real ? real + '   ' : ''}${a.move}  ${out ? `${pct(out.minPct, 0)}–${pct(out.maxPct, 0)}  ${ko && ko.ko !== '—' ? ko.ko + (ko.chance ? ' ' + ko.chance : '') : ''}` : ''}`;
      const w = textWidth(text) + 16, h = 20;
      const id = `${f.key}-${t}`;
      const manual = dragT?.id === id ? dragT.t : a.labels?.[t];
      const mid = manual !== undefined ? at(manual) : placeLabel(at, w, h, taken);
      taken.push({x: mid.x - w / 2, y: mid.y - h / 2, w, h});
      arrows.push({id, real, from: f.key, to: t, at, color: ally ? ARROW.ally : ARROW[f.side], d, mid, move: a.move, out});
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
            {a.real && <span className="num ml-1.5 rounded bg-white/10 px-1 text-ink" title="What really happened">{a.real}</span>}
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

const turnTitle = (turn: number) => (turn === 0 ? 'Leads' : `Turn ${turn}`);

/** Load a replay from its link (or a pasted battle log). */
function ReplayImport({onLoad}: {onLoad: (r: ParsedReplay, hint: PSide | null) => void}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    const input = text.trim();
    try {
      if (input.includes('\n|') || input.startsWith('|')) { onLoad(parseReplay(input, 'pasted'), null); return; }
      const id = replayId(input);
      if (!id) { setError('That is not a replay link.'); return; }
      setBusy(true);
      const r = await fetchReplay(id);
      if (!r.steps.length) { setError('No turns found in that replay.'); return; }
      onLoad(r, replayPerspective(input));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <input className="field text-[12.5px]" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
        placeholder="https://replay.pokemonshowdown.com/gen9…" />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn btn-gold" onClick={load} disabled={!text.trim() || busy}>{busy ? 'Loading …' : 'Load replay'}</button>
        {error && <span className="text-[12px] text-bad">{error}</span>}
      </div>
      <p className="mt-2 text-[11.5px] text-faint">
        Plays the battle turn by turn on the mat. Your side is the one with your team (or the link's ?p2). Unrevealed sets use the meta spread; moves, items and abilities seen in the battle are filled in. You can also paste the raw battle log.
      </p>
    </div>
  );
}

/** Players, side swap and the turn strip of a replay. */
function ReplayBar({mat, onStep, onLog, logOpen, onSwap, onExit, onSave, saved, onBranch}: {
  mat: Playmat; onStep: (n: number) => void; onLog: () => void; logOpen: boolean; onSwap: () => void; onExit: () => void; onBranch: () => void;
  onSave?: () => void; saved: boolean;
}) {
  const r = mat.replay!;
  const {steps, players, winner} = r.replay;
  const them: PSide = r.me === 'p1' ? 'p2' : 'p1';
  const ref = useRef<HTMLDivElement>(null);
  // Keep the current turn in view on long games.
  useEffect(() => { ref.current?.querySelector('[data-current]')?.scrollIntoView({block: 'nearest', inline: 'center'}); }, [r.step]);
  const btn = 'rounded-md border border-white/10 px-2 py-0.5 text-[12px] text-dim hover:text-ink disabled:opacity-30';
  return (
    <div className="flex items-center gap-3 border-b border-white/5 bg-black/30 px-4 py-1.5 text-[12px]">
      <span className="shrink-0">
        <span className="text-info">{players[r.me]}</span>
        <span className="text-faint"> vs </span>
        <span className="text-bad">{players[them]}</span>
        {winner && <span className="ml-1.5 text-faint">· {winner} won</span>}
      </span>
      <button className="shrink-0 text-[11.5px] text-faint underline hover:text-ink" onClick={onSwap} title="Watch from the other side">swap sides</button>
      <span className="h-4 w-px shrink-0 bg-white/10" />
      <button className={btn} onClick={() => onStep(r.step - 1)} disabled={r.step === 0} title="Previous turn (←)">◀</button>
      <div ref={ref} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
        {steps.map((s, i) => {
          const note = r.turnNotes[s.turn]?.trim();
          return (
            <button key={i} data-current={i === r.step ? '' : undefined} onClick={() => onStep(i)}
              title={`${turnTitle(s.turn)}${s.faints ? ` · ${s.faints} fainted` : ''}${note ? ` · ${note}` : ''}`}
              className={`relative min-w-[30px] shrink-0 rounded-md border px-1.5 py-0.5 text-center num text-[11.5px] transition ${
                i === r.step ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 text-dim hover:text-ink'}`}>
              {s.turn === 0 ? 'L' : s.turn}
              <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                {s.faints > 0 && <span className="h-1 w-1 rounded-full bg-bad" />}
                {note && <span className="h-1 w-1 rounded-full bg-gold" />}
              </span>
            </button>
          );
        })}
      </div>
      <button className={btn} onClick={() => onStep(r.step + 1)} disabled={r.step >= steps.length - 1} title="Next turn (→)">▶</button>
      <span className="h-4 w-px shrink-0 bg-white/10" />
      <button className={`${btn} ${logOpen ? '!border-gold !text-gold' : ''}`} onClick={onLog}>Log</button>
      <button className={btn} onClick={onBranch} title="Play on from this turn as your own plan (try what you should have done)">Branch</button>
      {onSave && (saved
        ? <span className="shrink-0 text-[11.5px] text-good" title="This replay is in the Matches tab">✓ in match log</span>
        : <button className={btn} onClick={onSave} title="Add this game to the Matches tab (turn notes included)">Save to log</button>)}
      <button className="shrink-0 text-[11.5px] text-faint underline hover:text-ink" onClick={onExit} title="Leave the replay and keep their team on the mat">exit replay</button>
    </div>
  );
}

/** What happened in the current turn, and the notes for it. */
function TurnLog({mat, onNote}: {mat: Playmat; onNote: (text: string) => void}) {
  const r = mat.replay!;
  const step = r.replay.steps[r.step];
  if (!step) return null;
  const color = (side: PSide | null) => (side === null ? 'text-dim' : side === r.me ? 'text-info' : 'text-bad');
  return (
    <div>
      <ul className="space-y-0.5 text-[12px]">
        {step.log.map((l, i) => (
          <li key={i} className={`${color(l.side)} ${l.kind === 'move' ? 'mt-1 font-medium' : l.kind === 'faint' ? 'font-medium' : 'pl-3 opacity-80'}`}>
            {l.kind === 'faint' ? '✕ ' : ''}{l.text}
          </li>
        ))}
        {step.log.length === 0 && <li className="text-faint">Nothing happened.</li>}
      </ul>
      <div className="label mb-1 mt-3">Notes for {turnTitle(step.turn).toLowerCase()}</div>
      <textarea className="field h-20 resize-none text-[12.5px]" value={r.turnNotes[step.turn] ?? ''} onChange={e => onNote(e.target.value)}
        placeholder="What should have happened? What did you learn?" />
    </div>
  );
}

const frameTitle = (plan: MatPlan, i: number) => `Turn ${plan.start + i}`;

/** Plan picker, name, the turn strip and frame controls of a storyboard. */
function PlanBar({mat, plan, onFrame, onAdd, onDelete, onRename, onSwitch, onNew, onDeletePlan, onClose, onNotes, notesOpen}: {
  mat: Playmat; plan: MatPlan; onFrame: (n: number) => void; onAdd: () => void; onDelete: () => void; onRename: (name: string) => void;
  onSwitch: (i: number) => void; onNew: () => void; onDeletePlan: () => void; onClose: () => void; onNotes: () => void; notesOpen: boolean;
}) {
  const btn = 'shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[12px] text-dim hover:text-ink disabled:opacity-30';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[data-current]')?.scrollIntoView({block: 'nearest', inline: 'center'}); }, [plan.at]);
  return (
    <div className="flex items-center gap-2 border-b border-white/5 bg-black/30 px-4 py-1.5 text-[12px]">
      {(mat.plans?.length ?? 0) > 1 && (
        <select className="field !w-auto shrink-0 !py-0.5 text-xs" value={mat.plan} onChange={e => onSwitch(+e.target.value)} title="Switch plan">
          {mat.plans!.map((p, i) => <option key={p.id} value={i}>{p.name}</option>)}
        </select>
      )}
      <input className="w-36 shrink-0 bg-transparent font-display text-[13px] font-semibold text-gold outline-none focus:underline" value={plan.name}
        onChange={e => onRename(e.target.value)} aria-label="Plan name" />
      <button className="shrink-0 text-[11.5px] text-faint underline hover:text-ink" onClick={onNew} title="New plan from the board as it is now">+ plan</button>
      <span className="h-4 w-px shrink-0 bg-white/10" />
      <button className={btn} onClick={() => onFrame(plan.at - 1)} disabled={plan.at === 0} title="Previous turn (←)">◀</button>
      <div ref={ref} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
        {plan.frames.map((f, i) => (
          <button key={i} data-current={i === plan.at ? '' : undefined} onClick={() => onFrame(i)}
            title={`${frameTitle(plan, i)}${f.note.trim() ? ` · ${f.note.trim()}` : ''}`}
            className={`relative min-w-[34px] shrink-0 rounded-md border px-1.5 py-0.5 text-center num text-[11.5px] transition ${
              i === plan.at ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 text-dim hover:text-ink'}`}>
            T{plan.start + i}
            {f.note.trim() && <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gold" />}
          </button>
        ))}
        <button className={btn} onClick={onAdd} title="Next turn: copies this board without its moves">+ turn</button>
      </div>
      <button className={btn} onClick={() => onFrame(plan.at + 1)} disabled={plan.at >= plan.frames.length - 1} title="Next turn (→)">▶</button>
      <span className="h-4 w-px shrink-0 bg-white/10" />
      <button className={`${btn} ${notesOpen ? '!border-gold !text-gold' : ''}`} onClick={onNotes}>Notes</button>
      <button className={btn} onClick={onDelete} disabled={plan.frames.length < 2} title="Delete this turn">− turn</button>
      <button className="shrink-0 text-[11.5px] text-faint underline hover:text-bad" onClick={onDeletePlan}>delete plan</button>
      <button className="shrink-0 text-[11.5px] text-faint underline hover:text-ink" onClick={onClose} title="Back to the free board (the plan stays saved)">close</button>
    </div>
  );
}

/** The note of the current turn, and the whole plan at a glance. */
function PlanNotes({plan, onNote, onFrame}: {plan: MatPlan; onNote: (text: string, n?: number) => void; onFrame: (n: number) => void}) {
  return (
    <div>
      <textarea className="field h-28 resize-none text-[12.5px]" value={plan.frames[plan.at].note} onChange={e => onNote(e.target.value)}
        placeholder="What happens this turn, and why? What if they do something else?" autoFocus />
      <div className="label mb-1 mt-3">Game plan</div>
      <ol className="space-y-1 text-[12px]">
        {plan.frames.map((f, i) => (
          <li key={i}>
            <button className={`w-full rounded-md px-1.5 py-1 text-left hover:bg-panel-2 ${i === plan.at ? 'bg-gold/10' : ''}`} onClick={() => onFrame(i)}>
              <span className={`num mr-1.5 ${i === plan.at ? 'text-gold' : 'text-faint'}`}>T{plan.start + i}</span>
              <span className={f.note.trim() ? 'text-dim' : 'text-faint italic'}>{f.note.trim() || 'no notes'}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Make a link to the board: open for anyone with it, or encrypted with a password. */
function ShareBoard({mat, sets}: {mat: Playmat; sets: PokemonSet[]}) {
  const [mode, setMode] = useState<'open' | 'password'>('open');
  const [password, setPassword] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const make = async () => {
    setError(''); setCopied(false); setBusy(true);
    try {
      // The live board is the current frame: store it into its plan first.
      setLink(await encodeMat(commitFrame(mat), sets, mode === 'password' ? password : undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Copy failed: select the link and copy it by hand.'); }
  };
  const opt = (m: typeof mode, label: string, hint: string) => (
    <label className={`flex cursor-pointer gap-2 rounded-lg border p-2 ${mode === m ? 'border-gold/60 bg-gold/5' : 'border-line'}`}>
      <input type="radio" className="mt-0.5 accent-white" checked={mode === m} onChange={() => { setMode(m); setLink(''); }} />
      <span><span className="block text-[12.5px] text-ink">{label}</span><span className="block text-[11.5px] text-faint">{hint}</span></span>
    </label>
  );
  return (
    <div className="space-y-2.5">
      {opt('open', 'Anyone with the link', 'The board is packed into the link itself.')}
      {opt('password', 'Password', 'The link is encrypted in your browser; it only opens with the password.')}
      {mode === 'password' && (
        <input type="password" className="field text-[12.5px]" value={password} onChange={e => { setPassword(e.target.value); setLink(''); }}
          placeholder="Password (share it separately)" autoComplete="new-password" />
      )}
      <button className="btn btn-gold w-full" onClick={make} disabled={busy || (mode === 'password' && password.length < 4)}>
        {busy ? 'Packing …' : 'Create link'}
      </button>
      {link && (
        <div>
          <div className="flex gap-1.5">
            <input className="field num text-[11.5px]" readOnly value={link} onFocus={e => e.target.select()} />
            <button className="btn shrink-0" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
          <p className="mt-1 text-[11px] text-faint">{link.length.toLocaleString('en')} characters · a snapshot: later changes need a new link.</p>
        </div>
      )}
      {error && <p className="text-[12px] text-bad">{error}</p>}
      <p className="text-[11px] text-faint">Everything after the # stays in the browser and is never sent to a server.</p>
    </div>
  );
}

/** The team's saved boards: open, rename, delete. */
function BoardList({boards, current, onOpen, onRename, onDelete}: {
  boards: SavedBoard[]; current?: string; onOpen: (b: SavedBoard) => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const when = (t: number) => new Date(t).toLocaleString(undefined, {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  return (
    <ul className="divide-y divide-line">
      {boards.map(b => {
        const notes = b.mat.notes.length + (b.mat.plans ?? []).reduce((n, p) => n + p.frames.filter(f => f.note.trim()).length, 0)
          + Object.values(b.mat.replay?.turnNotes ?? {}).filter(t => t.trim()).length;
        const tags = [
          b.mat.replay && 'Replay',
          b.mat.plans?.length && `${b.mat.plans.length} plan${b.mat.plans.length > 1 ? 's' : ''}`,
          notes > 0 && `${notes} note${notes > 1 ? 's' : ''}`,
        ].filter(Boolean) as string[];
        return (
          <li key={b.id} className={`py-2 ${b.id === current ? 'bg-white/[.04] -mx-1 px-1' : ''}`}>
            <div className="flex items-center gap-2">
              {editing === b.id ? (
                <input className="field !py-0.5 text-[12.5px]" autoFocus defaultValue={b.mat.name}
                  onBlur={e => { onRename(b.id, e.target.value.trim() || b.mat.name); setEditing(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
              ) : (
                <button className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:underline" onClick={() => onOpen(b)} title="Open">
                  {b.mat.name || 'Board'}
                </button>
              )}
              {b.id === current && <span className="text-[11px] text-faint">open</span>}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="flex gap-0.5">{b.mat.opp.slice(0, 6).map((s, i) => <Portrait key={i} name={battleForme(s)} size={20} />)}</span>
              <span className="num text-[11px] text-faint">{when(b.savedAt)}</span>
              {tags.map(t => <span key={t} className="border border-line px-1 text-[10.5px] text-dim">{t}</span>)}
              <span className="ml-auto flex gap-2 text-[11.5px]">
                <button className="text-faint underline hover:text-ink" onClick={() => setEditing(b.id)}>rename</button>
                <button className="text-faint underline hover:text-bad" onClick={() => { if (confirm(`Delete "${b.mat.name}"?`)) onDelete(b.id); }}>delete</button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
