import {useDeferredValue, useMemo, useState} from 'react';
import {MOVES, SPECIES, STAT_LABEL, TYPE_COLOR, pct, type UsageSource} from '../lib/data';
import {metaSet} from '../lib/calc';
import {CONCEPTS, NOT_IN_FORMAT, QUICK_CONCEPTS, parseQuery, queryMoves, search, suggestTerms, type Term} from '../lib/search';
import type {PokemonSet} from '../lib/team';
import {Portrait, Section, TypeBadge} from './ui';

type Sort = 'relevance' | 'usage' | 'spe' | 'name';
const PAGE = 60;

export function SearchView({sets, usage, onAdd, query, setQuery}: {
  sets: PokemonSet[];
  usage: UsageSource;
  onAdd: (s: PokemonSet) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const [sort, setSort] = useState<Sort>('relevance');
  const [metaOnly, setMetaOnly] = useState(false);
  const [playedOnly, setPlayedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [focused, setFocused] = useState(false);
  const deferred = useDeferredValue(query);

  const groups = useMemo(() => parseQuery(deferred), [deferred]);
  const hits = useMemo(() => {
    let h = deferred.trim() ? search(groups, usage) : Object.keys(SPECIES).map(name => ({name, usage: usage.mons[name]?.usage ?? 0, moves: [] as string[], abilities: [] as string[], items: [] as string[]}));
    if (metaOnly) h = h.filter(x => x.usage >= 0.005);
    // "Played": the matched move/ability actually shows up in this mon's usage data.
    if (playedOnly && deferred.trim()) h = h.filter(x => {
      const u = usage.mons[x.name];
      if (!u) return false;
      return x.moves.some(m => (u.moves.find(([n]) => n === m)?.[1] ?? 0) >= 0.05)
        || x.abilities.some(a => (u.abilities.find(([n]) => n === a)?.[1] ?? 0) >= 0.05)
        || x.items.length > 0
        || (!x.moves.length && !x.abilities.length);
    });
    // Relevance: share of all teams that actually run the matched move/ability on this mon.
    const share = (x: typeof h[0]) => {
      const u = usage.mons[x.name];
      if (!u || (!x.moves.length && !x.abilities.length && !x.items.length)) return 1;
      const m = Math.max(0, ...x.moves.map(n => u.moves.find(([k]) => k === n)?.[1] ?? 0));
      const a = Math.max(0, ...x.abilities.map(n => u.abilities.find(([k]) => k === n)?.[1] ?? 0));
      const i = Math.max(0, ...x.items.map(n => u.items.find(([k]) => k === n)?.[1] ?? 0));
      return Math.max(m, a, i);
    };
    const rel = new Map(h.map(x => [x.name, x.usage * share(x)]));
    const by = {
      relevance: (a: typeof h[0], b: typeof h[0]) => rel.get(b.name)! - rel.get(a.name)! || b.usage - a.usage || a.name.localeCompare(b.name),
      usage: (a: typeof h[0], b: typeof h[0]) => b.usage - a.usage || a.name.localeCompare(b.name),
      spe: (a: typeof h[0], b: typeof h[0]) => SPECIES[b.name].bs.spe - SPECIES[a.name].bs.spe,
      name: (a: typeof h[0], b: typeof h[0]) => a.name.localeCompare(b.name),
    }[sort];
    return [...h].sort(by);
  }, [groups, deferred, usage, sort, metaOnly, playedOnly]);

  const moveList = useMemo(() => {
    const moves = queryMoves(groups);
    return moves
      .map(m => ({move: m, learners: hits.filter(h => h.moves.includes(m)).length}))
      .filter(x => x.learners > 0)
      .sort((a, b) => b.learners - a.learners);
  }, [groups, hits]);

  const suggestions = focused ? suggestTerms(query) : [];
  const full = sets.length >= 6;
  const takenItems = sets.map(s => s.item);
  const inTeam = new Set(sets.map(s => SPECIES[s.species]?.num));
  const stale = deferred !== query;

  const applySuggestion = (insert: string, label: string) => {
    const idx = query.toLowerCase().lastIndexOf(insert);
    setQuery((idx >= 0 ? query.slice(0, idx) : query + ' ') + label.toLowerCase() + ' ');
  };
  const addConcept = (label: string) => setQuery(query.trim() ? `${query.trim()} ${label.toLowerCase()}` : label.toLowerCase());

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="relative">
          <input
            className="field !py-3 !pl-4 text-[16px]"
            placeholder="Search: speed control, pivot fire, close combat, tw hh, intimidate | fake out …"
            value={query}
            autoFocus
            onChange={e => { setQuery(e.target.value); setShown(PAGE); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
          />
          {query && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink" onClick={() => setQuery('')} title="Clear">✕</button>
          )}
          {suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-w-md rounded-lg border border-line-2 bg-panel p-1 shadow-2xl shadow-black/50">
              {suggestions.map(s => (
                <button key={s.kind + s.label} onMouseDown={e => { e.preventDefault(); applySuggestion(s.insert, s.label); }}
                  className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left hover:bg-panel-2">
                  <span>{s.label}</span><span className="text-[11px] text-faint">{s.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_CONCEPTS.map(k => CONCEPTS.find(c => c.key === k)!).map(c => (
            <button key={c.key} onClick={() => addConcept(c.label)}
              className="rounded-md border border-line bg-bg/50 px-2 py-1 text-[12px] text-dim hover:border-gold-dim hover:text-ink">
              {c.label}
            </button>
          ))}
        </div>
        <TermLine groups={groups} />
      </div>

      {moveList.length > 0 && (
        <Section title="Moves" right={<span className="num text-xs text-dim">{moveList.length}</span>}>
          <div className="flex flex-wrap gap-1.5">
            {moveList.map(({move, learners}) => {
              const mv = MOVES[move];
              return (
                <button key={move} onClick={() => setQuery(move.toLowerCase())}
                  className="flex items-center gap-2 rounded-md border border-line bg-bg/40 px-2 py-1 text-[12.5px] hover:border-gold-dim"
                  title={`${mv.type} · ${mv.cat}${mv.bp ? ` · ${mv.bp} BP` : ''}${mv.prio ? ` · Prio +${mv.prio}` : ''}`}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{background: TYPE_COLOR[mv.type]}} />
                  {move}
                  <span className="num text-[11px] text-faint">{learners}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[15px] font-semibold uppercase tracking-wider">{hits.length} Pokémon</span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button className={`btn !py-1 text-xs ${playedOnly ? '!border-gold !bg-gold/15 text-gold' : ''}`} onClick={() => setPlayedOnly(m => !m)}
            title="Only Pokémon that actually run the matched move, ability or item in the meta">
            Played
          </button>
          <button className={`btn !py-1 text-xs ${metaOnly ? '!border-gold !bg-gold/15 text-gold' : ''}`} onClick={() => setMetaOnly(m => !m)}>
            Meta only
          </button>
          <select className="field !w-auto !py-1 text-xs" value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="relevance">By relevance</option>
            <option value="usage">By usage</option>
            <option value="spe">By speed</option>
            <option value="name">By name</option>
          </select>
        </div>
      </div>

      <div className={`grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 ${stale ? 'opacity-60' : ''}`}>
        {hits.slice(0, shown).map(h => {
          const sp = SPECIES[h.name];
          const u = usage.mons[h.name];
          const usedMoves = new Map((u?.moves ?? []).map(([m, p]) => [m, p]));
          // Matched moves first (meta-used ones on top); otherwise its most used moves.
          const moves = h.moves.length
            ? [...h.moves].sort((a, b) => (usedMoves.get(b) ?? 0) - (usedMoves.get(a) ?? 0))
            : (u?.moves ?? []).slice(0, 4).map(([m]) => m);
          const taken = inTeam.has(sp.num);
          return (
            <div key={h.name} className="rise flex gap-3 rounded-xl border border-line bg-panel/80 p-3">
              <Portrait name={h.name} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-display text-[15px] font-semibold">{h.name}</span>
                  {h.usage > 0 && <span className="num shrink-0 text-[11px] text-gold">{pct(h.usage)}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {sp.types.map(t => <TypeBadge key={t} type={t} small />)}
                  <span className="num ml-1 text-[10.5px] text-faint">{STAT_LABEL.spe} {sp.bs.spe}</span>
                </div>
                <div className="mt-1 truncate text-[11.5px] text-dim">
                  {sp.abilities.map((a, i) => (
                    <span key={a} className={h.abilities.includes(a) ? 'font-semibold text-gold' : ''}>
                      {i ? ' · ' : ''}{a}
                      {h.abilities.includes(a) && u?.abilities.find(([n]) => n === a) && (
                        <span className="num ml-0.5 text-[10px] font-normal text-gold/80">{Math.round(u.abilities.find(([n]) => n === a)![1] * 100)}%</span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {h.items.map(i => (
                    <span key={i} className="flex items-center gap-1 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[11px]">
                      @ {i}<span className="num text-[10px] text-gold/80">{Math.round((u?.items.find(([n]) => n === i)?.[1] ?? 0) * 100)}%</span>
                    </span>
                  ))}
                  {moves.slice(0, 6).map(m => {
                    const mv = MOVES[m];
                    const p = usedMoves.get(m);
                    return (
                      <span key={m} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${h.moves.includes(m) ? 'border-gold/40 bg-gold/10 text-ink' : 'border-line text-dim'}`}>
                        <span className="h-2 w-2 rounded-sm" style={{background: TYPE_COLOR[mv?.type] ?? '#555'}} />
                        {m}
                        {p ? <span className="num text-[10px] text-gold/80">{Math.round(p * 100)}%</span> : null}
                      </span>
                    );
                  })}
                  {moves.length > 6 && <span className="px-1 text-[11px] text-faint">+{moves.length - 6}</span>}
                </div>
              </div>
              <button
                className="btn h-fit shrink-0 !px-2 !py-1 text-xs disabled:cursor-not-allowed disabled:opacity-35"
                disabled={full || taken}
                title={taken ? 'Already in team' : full ? 'Team is full' : 'Add with meta set'}
                onClick={() => onAdd(metaSet(h.name, usage, takenItems))}
              >
                + Team
              </button>
            </div>
          );
        })}
      </div>
      {hits.length > shown && (
        <div className="flex justify-center">
          <button className="btn" onClick={() => setShown(s => s + PAGE)}>Show more ({hits.length - shown})</button>
        </div>
      )}
    </div>
  );
}

/** Shows how the query was understood, so users can see why something matches. */
function TermLine({groups}: {groups: Term[][]}) {
  if (!groups.length) return null;
  const color: Record<Term['kind'], string> = {concept: 'text-gold', type: 'text-info', move: 'text-good', ability: 'text-[#c78cff]', item: 'text-warn', text: 'text-dim'};
  const label = (t: Term) => t.kind === 'concept' ? t.concept.label : t.kind === 'type' ? t.type : t.kind === 'move' ? t.move : t.kind === 'ability' ? t.ability : t.kind === 'item' ? `@ ${t.item}` : `"${t.text}"`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      {groups.map((g, gi) => (
        <span key={gi} className="flex flex-wrap items-center gap-1.5">
          {gi > 0 && <span className="text-faint">or</span>}
          {g.map((t, ti) => (
            <span key={ti} className="flex items-center gap-1.5">
              {ti > 0 && <span className="text-faint">+</span>}
              <span className={color[t.kind]}>{label(t)}</span>
              {t.kind === 'text' && NOT_IN_FORMAT.has(t.text) && (
                <span className="text-bad">({NOT_IN_FORMAT.get(t.text)}: not in Reg M-C)</span>
              )}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
