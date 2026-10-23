import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {TYPE_COLOR, portraitUrl} from '../lib/data';
import {WEATHER_LABEL, type Weather} from '../lib/analysis';

export type WeatherPref = 'auto' | Weather;

export const WEATHER_COLOR: Record<Weather, string> = {'': '#5b6782', Rain: '#5aa9ff', Sun: '#f0a33a', Sand: '#c9a86a', Snow: '#9fe3f0'};

export interface WeatherState {
  pref: WeatherPref;
  setPref: (w: WeatherPref) => void;
  /** Threats use the weather their own team usually brings. */
  enemy: boolean;
  setEnemy: (on: boolean) => void;
}

/** "Auto" follows the weather my team sets itself. */
export function WeatherControls({state, auto}: {state: WeatherState; auto: Weather}) {
  return (
    <>
      <select className="field !w-auto !py-1 text-xs" value={state.pref} onChange={e => state.setPref(e.target.value as WeatherPref)} title="Weather">
        <option value="auto">Auto · {WEATHER_LABEL[auto]}</option>
        {(Object.keys(WEATHER_LABEL) as Weather[]).map(w => <option key={w} value={w}>{WEATHER_LABEL[w]}</option>)}
      </select>
      <button
        className={`btn !py-1 text-xs ${state.enemy ? '!border-warn !bg-warn/15 text-warn' : ''}`}
        onClick={() => state.setEnemy(!state.enemy)}
        title="Threats play under the weather their team usually brings (rain, sun, sand, snow)"
      >
        Enemy weather {state.enemy ? 'on' : 'off'}
      </button>
    </>
  );
}

export function WeatherChip({weather, title}: {weather: Weather; title?: string}) {
  return (
    <span className="rounded px-1 text-[9.5px] font-semibold uppercase tracking-wide" title={title}
      style={{color: WEATHER_COLOR[weather], background: `${WEATHER_COLOR[weather]}1f`}}>
      {WEATHER_LABEL[weather]}
    </span>
  );
}

export function TypeBadge({type, small}: {type: string; small?: boolean}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded font-display font-semibold uppercase tracking-wide text-white/95 ${small ? 'h-4 px-1.5 text-[9px]' : 'h-5 px-2 text-[10px]'}`}
      style={{background: TYPE_COLOR[type] ?? '#666', textShadow: '0 1px 1px rgba(0,0,0,.35)'}}
    >
      {type}
    </span>
  );
}

export function Portrait({name, size = 48, className = ''}: {name: string; size?: number; className?: string}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name]);
  if (!name || failed)
    return <div className={`rounded-lg bg-panel-2 ${className}`} style={{width: size, height: size}} />;
  return (
    <img
      src={portraitUrl(name)}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`portrait rounded-lg bg-panel-2 object-cover ${className}`}
      style={{width: size, height: size}}
      loading="lazy"
    />
  );
}

export interface Option {
  value: string;
  hint?: string;
  hintColor?: string;
  group?: string;
  render?: ReactNode;
}

/** Searchable select: typing filters, arrows + enter pick. */
export function Combobox({
  value, options, onChange, placeholder, className = '', autoFocus,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!q) return options.slice(0, 200);
    const starts: Option[] = [];
    const contains: Option[] = [];
    for (const o of options) {
      const id = o.value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (id.startsWith(q)) starts.push(o);
      else if (id.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, 200);
  }, [options, query]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        className="field"
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(filtered.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open && filtered[active]) { e.preventDefault(); pick(filtered[active].value); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          else if (e.key === 'Tab') setOpen(false);
        }}
      />
      {open && (
        <div ref={listRef} className="absolute z-40 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-lg border border-line-2 bg-panel shadow-2xl shadow-black/50">
          {filtered.length === 0 && <div className="px-3 py-2 text-dim">No results</div>}
          {filtered.map((o, i) => {
            const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
            return (
              <div key={o.value + i}>
                {showGroup && <div className="label sticky top-0 bg-panel px-3 pb-1 pt-2 text-[10px] text-gold/80">{o.group}</div>}
                <div
                  data-idx={i}
                  onMouseDown={e => { e.preventDefault(); pick(o.value); }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${i === active ? 'bg-panel-2 text-white' : 'text-ink/90'} ${o.value === value ? 'font-semibold text-gold' : ''}`}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">{o.render ?? o.value}</span>
                  {o.hint && <span className="num shrink-0 text-xs" style={{color: o.hintColor ?? 'var(--color-dim)'}}>{o.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({tabs, value, onChange}: {tabs: {key: T; label: string; badge?: ReactNode}[]; value: T; onChange: (t: T) => void}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-bg/60 p-1">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-1.5 font-display text-[13px] font-semibold uppercase tracking-wider transition ${value === t.key ? 'bg-gold text-black' : 'text-dim hover:bg-panel-2 hover:text-ink'}`}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Bar({value, color = 'var(--color-gold)', max = 1}: {value: number; color?: string; max?: number}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full transition-all" style={{width: `${Math.min(100, (value / max) * 100)}%`, background: color}} />
    </div>
  );
}

export function Section({title, children, right, className = ''}: {title: string; children: ReactNode; right?: ReactNode; className?: string}) {
  return (
    <section className={`panel p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-semibold uppercase tracking-wider text-ink">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Color for a damage percentage: green small, red big. */
export function dmgColor(p: number): string {
  if (p >= 1) return '#f0566a';
  if (p >= 0.5) return '#f0a33a';
  if (p >= 0.25) return '#e6d36a';
  return '#5b6782';
}

/** Marks an opponent set whose nature and SP were guessed from usage data. */
export function EstBadge({className = ''}: {className?: string}) {
  return (
    <span className={`shrink-0 border border-dashed border-line-2 px-1 text-[9.5px] font-semibold uppercase leading-[14px] text-faint ${className}`}
      title="Spread estimated: the most common nature and Stat Points from usage data">est.</span>
  );
}
