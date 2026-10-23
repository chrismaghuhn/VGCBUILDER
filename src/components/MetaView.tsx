import {Fragment, useDeferredValue, useMemo, useState} from 'react';
import {SPECIES, STAT_LABEL, STATS, pct, type UsageSource} from '../lib/data';
import {metaThreats, teamThreats, threatMatrix, type HitSummary, type MatchupCell, type MetaThreat} from '../lib/calc';
import {metaWeather, oppWeather, teamField, warWeather, type SpeedField} from '../lib/analysis';
import {battleForme, type Opponent, type PokemonSet} from '../lib/team';
import {Empty} from './AnalysisView';
import {Bar, EstBadge, Portrait, Section, TypeBadge, WeatherChip, WeatherControls, dmgColor, type WeatherState} from './ui';

const ARCHETYPES: [string, string, string][] = [
  ['rain', 'Rain', '#3d8fe0'], ['sun', 'Sun', '#e8613a'], ['sand', 'Sand', '#b5a771'],
  ['hail', 'Snow', '#5ccfe6'], ['trickroom', 'Trick Room', '#c78cff'], ['tailwind', 'Tailwind', '#86a8e8'],
];

export function MetaView({sets, usage, opp, onCalc, weather}: {
  sets: PokemonSet[];
  usage: UsageSource;
  /** Threat matrix against this opponent team instead of the top meta. */
  opp?: Opponent;
  onCalc: (atk: PokemonSet, def: PokemonSet) => void;
  weather: WeatherState;
}) {
  const [limit, setLimit] = useState(30);
  const [sort, setSort] = useState<'danger' | 'usage'>('danger');
  const [open, setOpen] = useState<string | null>(null);
  const deferredSets = useDeferredValue(sets);

  const threats = useMemo(() => (opp ? teamThreats(opp.sets) : metaThreats(usage, limit)), [usage, limit, opp]);
  const auto = teamField(deferredSets);
  const field: SpeedField = {weather: weather.pref === 'auto' ? auto.weather : weather.pref, electricTerrain: auto.electricTerrain};
  const rows = useMemo(() => {
    const theirs = opp ? oppWeather(opp.sets) : null;
    const r = threatMatrix(deferredSets, threats, field, opp
      ? () => warWeather(theirs, weather.enemy, deferredSets)
      : n => warWeather(weather.enemy === 'off' ? null : metaWeather(n, usage), weather.enemy, deferredSets, usage));
    return sort === 'danger' ? [...r].sort((a, b) => b.danger - a.danger) : r;
  }, [deferredSets, threats, opp, sort, field.weather, field.electricTerrain, weather.enemy, usage]); // eslint-disable-line react-hooks/exhaustive-deps

  const leads = useMemo(
    () => Object.entries(usage.mons).sort((a, b) => b[1].lead - a[1].lead).slice(0, 12),
    [usage],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Section title="Metagame" right={<span className="num text-xs text-dim">{usage.battles.toLocaleString('en-US')} battles · {usage.month}</span>}>
          <div className="space-y-2">
            {ARCHETYPES.map(([key, label, color]) => (
              <div key={key} className="grid grid-cols-[90px_1fr_52px] items-center gap-3">
                <span className="text-[13px]">{label}</span>
                <Bar value={usage.metagame[key] ?? 0} max={0.4} color={color} />
                <span className="num text-right text-[12.5px]">{pct(usage.metagame[key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Top Leads">
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 2xl:grid-cols-3">
            {leads.map(([name, u], i) => (
              <div key={name} className="flex items-center gap-2">
                <span className="num w-4 text-right text-[11px] text-faint">{i + 1}</span>
                <Portrait name={name} size={26} className="!rounded" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
                <span className="num text-[12px] text-gold">{pct(u.lead)}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {!sets.length ? (
        <Empty />
      ) : (
        <Section
          title={opp ? `Threat Matrix · vs ${opp.name}` : 'Threat Matrix'}
          right={
            <div className="flex items-center gap-2 text-xs">
              <WeatherControls state={weather} auto={auto.weather} />
              <select className="field !w-auto !py-1 text-xs" value={sort} onChange={e => setSort(e.target.value as 'danger' | 'usage')}>
                <option value="danger">By danger</option>
                <option value="usage">{opp ? 'Team order' : 'By usage'}</option>
              </select>
              {!opp && (
                <select className="field !w-auto !py-1 text-xs" value={limit} onChange={e => setLimit(+e.target.value)}>
                  {[20, 30, 50].map(n => <option key={n} value={n}>Top {n}</option>)}
                </select>
              )}
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-line bg-bg/40 px-3 py-2 text-[12px]">
            <span className="flex items-center gap-1.5"><span className="num rounded bg-good/15 px-1 font-bold text-good">2HKO</span> you → threat</span>
            <span className="flex items-center gap-1.5"><span className="num rounded bg-bad/15 px-1 font-bold text-bad">1HKO</span> threat → you</span>
            <span><span className="text-good">▲</span> you outspeed · <span className="text-faint">▼</span> slower · <span className="text-warn">=</span> tie</span>
            <span className="text-dim">— 4+ hits</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-1 text-[12px]">
              <thead>
                <tr className="text-left">
                  <th className="label pb-1 pl-2 text-[10px]">Threat</th>
                  <th className="label pb-1 text-[10px]">Danger</th>
                  {sets.map((s, i) => (
                    <th key={i} className="pb-1 text-center"><Portrait name={battleForme(s)} size={30} className="mx-auto" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <Fragment key={row.threat.name}>
                    <tr className="cursor-pointer bg-bg/40 hover:bg-panel-2/70" onClick={() => setOpen(open === row.threat.name ? null : row.threat.name)}>
                      <td className="rounded-l-lg py-1 pl-2">
                        <div className="flex items-center gap-2">
                          <Portrait name={row.threat.name} size={30} className="!rounded" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5"><span className="truncate font-medium">{row.threat.name}</span>{row.threat.set.estimated && <EstBadge />}</div>
                            <div className="num flex items-center gap-1.5 text-[10.5px] text-faint">
                              {opp ? row.threat.set.item || 'no item' : `${pct(row.threat.usage)} · ${row.threat.set.item}`}
                              {row.weather && (
                                <WeatherChip
                                  weather={row.weather.weather}
                                  title={row.weather.why ?? (row.weather.source === row.threat.name ? 'sets it itself' : opp ? `from ${row.weather.source}` : `${row.weather.source} on ${Math.round(row.weather.share * 100)}% of its teams`)}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="w-24 pr-3">
                        <Bar value={row.danger} color={row.danger > 0.6 ? 'var(--color-bad)' : row.danger > 0.35 ? 'var(--color-warn)' : 'var(--color-good)'} />
                      </td>
                      {row.cells.map((c, i) => <Cell key={i} cell={c} last={i === row.cells.length - 1} />)}
                    </tr>
                    {open === row.threat.name && (
                      <tr>
                        <td colSpan={2 + sets.length} className="pb-2">
                          <ThreatDetail threat={row.threat} usage={usage} own={!!opp} sets={sets} cells={row.cells} onCalc={onCalc} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

/** "1HKO", "2HKO 85%" … from the calc's KO chance; anything slower than 3 hits is "—". */
export function koLabel(hit?: HitSummary): {text: string; ko: string; chance: string; n: number; sure: boolean} {
  if (!hit || hit.koN < 1 || hit.koN > 3 || (hit.koChance === 0 && hit.koN > 1)) return {text: '—', ko: '—', chance: '', n: 0, sure: false};
  // A long-shot KO (e.g. 13% OHKO) that is a guaranteed KO with one more hit reads better as the sure one.
  if (hit.koChance < 0.5 && hit.koN < 3 && hit.minPct * (hit.koN + 1) >= 1) {
    const ko = `${hit.koN + 1}HKO`;
    return {text: ko, ko, chance: '', n: hit.koN + 1, sure: true};
  }
  // A long-shot 3HKO is effectively "4+ hits".
  if (hit.koChance < 0.5 && hit.koN === 3) return {text: '—', ko: '—', chance: '', n: 0, sure: false};
  const sure = hit.koChance >= 0.995;
  const chance = sure ? '' : `${Math.max(1, Math.round(hit.koChance * 100))}%`;
  const ko = `${hit.koN}HKO`;
  return {text: chance ? `${ko} (${chance})` : ko, ko, chance, n: hit.koN, sure};
}

const MY_COLOR = ['#5b6782', '#3ecf8e', '#8fdcb0', '#c9d6c0'];
const THEIR_COLOR = ['#5b6782', '#f0566a', '#f0a33a', '#e6d36a'];

function KoChip({hit, mine}: {hit?: HitSummary; mine: boolean}) {
  const ko = koLabel(hit);
  const color = (mine ? MY_COLOR : THEIR_COLOR)[ko.n];
  return (
    <span
      className={`num block whitespace-nowrap rounded px-1 text-[11px] leading-[18px] ${ko.n === 1 ? 'font-bold' : 'font-semibold'}`}
      style={{color, background: ko.n ? `${color}${ko.sure ? '22' : '12'}` : 'transparent'}}
    >
      {ko.ko}
      {ko.chance && <span className="ml-0.5 text-[9px] font-normal opacity-80">{ko.chance}</span>}
    </span>
  );
}

function Cell({cell, last}: {cell: MatchupCell; last: boolean}) {
  const fmt = (h?: HitSummary) => (h ? `${h.move}: ${Math.round(h.minPct * 100)}–${Math.round(h.maxPct * 100)}% (${h.koText || 'no KO'})` : '—');
  const speed = cell.faster === null ? 'Speed tie' : cell.faster ? 'You outspeed' : 'Threat outspeeds you';
  return (
    <td className={`px-0.5 py-1 text-center ${last ? 'rounded-r-lg' : ''}`} title={`You → threat: ${fmt(cell.out)}\nThreat → you: ${fmt(cell.in)}\n${speed}`}>
      <div className="mx-auto flex w-[86px] flex-col gap-0.5 rounded-md bg-bg/60 p-0.5">
        <div className="flex items-center gap-0.5">
          <span className={`w-3 text-[9px] ${cell.faster ? 'text-good' : cell.faster === null ? 'text-warn' : 'text-faint'}`}>
            {cell.faster === null ? '=' : cell.faster ? '▲' : '▼'}
          </span>
          <span className="flex-1"><KoChip hit={cell.out} mine /></span>
        </div>
        <div className="flex items-center gap-0.5">
          <span className="w-3" />
          <span className="flex-1"><KoChip hit={cell.in} mine={false} /></span>
        </div>
      </div>
    </td>
  );
}

function ThreatDetail({threat, usage, own, sets, cells, onCalc}: {
  threat: MetaThreat; usage: UsageSource; sets: PokemonSet[]; cells: MatchupCell[]; onCalc: (a: PokemonSet, d: PokemonSet) => void;
  /** The threat is an opponent's known set: show it instead of usage shares. */
  own: boolean;
}) {
  const u = usage.mons[threat.name];
  const sp = SPECIES[threat.name];
  return (
    <div className="rise mt-1 grid gap-4 rounded-xl border border-line-2 bg-panel p-4 lg:grid-cols-[1fr_1fr_1.2fr]">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Portrait name={threat.name} size={56} />
          <div>
            <div className="font-display text-lg font-semibold">{threat.name}</div>
            <div className="flex gap-1">{sp?.types.map(t => <TypeBadge key={t} type={t} small />)}</div>
          </div>
        </div>
        <div className="space-y-0.5 text-[12.5px]">
          <div className="flex items-center gap-1.5">
            <span><span className="text-dim">Spread:</span> {threat.set.nature} · {STATS.filter(s => threat.set.sps[s]).map(s => `${threat.set.sps[s]} ${STAT_LABEL[s]}`).join(' / ')}</span>
            {threat.set.estimated && <EstBadge />}
          </div>
          {own
            ? <div><span className="text-dim">Ability:</span> {sp?.mega ? sp.abilities[0] : threat.set.ability}</div>
            : <div><span className="text-dim">Ability:</span> {u?.abilities.map(([a, p]) => `${a} ${pct(p, 0)}`).join(', ')}</div>}
        </div>
      </div>
      {own ? (
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div><div className="label mb-1">Item</div>{threat.set.item || <span className="text-faint">none</span>}</div>
          <div><div className="label mb-1">Moves</div>{threat.set.moves.filter(Boolean).map(m => <div key={m} className="truncate">{m}</div>)}</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <UsageList title="Items" list={u?.items.slice(0, 5) ?? []} />
          <UsageList title="Moves" list={u?.moves.slice(0, 7) ?? []} />
        </div>
      )}
      <div className="text-[12px]">
        <div className="label mb-1.5">Vs. your team</div>
        <div className="space-y-1">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Portrait name={battleForme(s)} size={20} className="!rounded" />
              <span className="w-24 truncate">{s.species}</span>
              <button className="text-left text-dim hover:text-gold" onClick={() => onCalc(s, threat.set)} title="Open in calc">
                {cells[i].out ? `${cells[i].out!.move} ${Math.round(cells[i].out!.minPct * 100)}–${Math.round(cells[i].out!.maxPct * 100)}% · ${koLabel(cells[i].out).text}` : '—'}
              </button>
              <span className="text-faint">/</span>
              <button className="text-left hover:text-gold" style={{color: dmgColor(cells[i].in?.maxPct ?? 0)}} onClick={() => onCalc(threat.set, s)} title="Open in calc">
                {cells[i].in ? `${cells[i].in!.move} ${Math.round(cells[i].in!.minPct * 100)}–${Math.round(cells[i].in!.maxPct * 100)}% · ${koLabel(cells[i].in).text}` : '—'}
              </button>
            </div>
          ))}
        </div>
        {!own && u && u.counters.length > 0 && (
          <div className="mt-3">
            <div className="label mb-1">Checks</div>
            <div className="text-dim">{u.counters.slice(0, 6).map(([n]) => n).join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function UsageList({title, list}: {title: string; list: [string, number][]}) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {list.map(([n, p]) => (
        <div key={n} className="flex justify-between gap-2"><span className="truncate">{n}</span><span className="num text-gold">{pct(p, 0)}</span></div>
      ))}
    </div>
  );
}
