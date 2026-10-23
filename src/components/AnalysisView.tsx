import {useDeferredValue, useMemo} from 'react';
import {SPECIES, TYPE_COLOR, type UsageSource} from '../lib/data';
import {defensiveMatrix, offensiveCoverage, roleCoverage, teamField, type SpeedField, type TypeRow} from '../lib/analysis';
import {metaThreats, threatMatrix} from '../lib/calc';
import {battleForme, type Issue, type PokemonSet} from '../lib/team';
import {Portrait, Section, TypeBadge, type WeatherState} from './ui';

const multLabel = (m: number) => (m === 0 ? '0' : m >= 4 ? '4×' : m >= 2 ? '2×' : m === 1.5 || m === 1.25 ? `${m}×` : m <= 0.25 ? '¼' : m < 1 ? '½' : '');
const multStyle = (m: number) => {
  if (m === 0) return {background: 'rgba(90,169,255,.22)', color: '#9cc8ff'};
  if (m >= 4) return {background: 'rgba(240,86,106,.45)', color: '#fff'};
  if (m > 1) return {background: 'rgba(240,86,106,.2)', color: '#ff9aa8'};
  if (m < 1) return {background: 'rgba(62,207,142,.16)', color: '#7ee2b4'};
  return {};
};

export function AnalysisView({sets, usage, issues, weather}: {
  sets: PokemonSet[];
  usage: UsageSource;
  issues: Issue[];
  weather: WeatherState;
}) {
  const auto = teamField(sets);
  const field: SpeedField = {weather: weather.pref === 'auto' ? auto.weather : weather.pref, electricTerrain: auto.electricTerrain};
  const matrix = useMemo(() => defensiveMatrix(sets), [sets]);
  const coverage = useMemo(() => offensiveCoverage(sets), [sets]);
  const roles = useMemo(() => roleCoverage(sets), [sets]);
  const megas = sets.filter(s => SPECIES[battleForme(s)]?.mega);

  if (!sets.length) return <Empty />;

  return (
    <div className="space-y-4">
      <Summary sets={sets} usage={usage} issues={issues} matrix={matrix} roles={roles} megas={megas.length} field={field} enemyWeather={weather.enemy} />

      <div className="grid gap-4 2xl:grid-cols-[1.25fr_1fr]">
        <Section title="Defensive Type Chart">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[3px] text-center text-[12px]">
              <thead>
                <tr>
                  <th />
                  {sets.map((s, i) => (
                    <th key={i} className="px-0.5 pb-1"><Portrait name={battleForme(s)} size={30} className="mx-auto" /></th>
                  ))}
                  <th className="label px-1 text-[10px]">Weak</th>
                  <th className="label px-1 text-[10px]">Res.</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(row => {
                  const bad = row.weak >= 3 || row.weak - row.resist - row.immune >= 2;
                  return (
                    <tr key={row.type} className={bad ? 'outline outline-1 outline-bad/50 rounded' : ''}>
                      <td className="pr-1 text-left"><TypeBadge type={row.type} small /></td>
                      {row.mults.map((m, i) => (
                        <td key={i} className="num h-6 min-w-[30px] rounded font-semibold" style={multStyle(m)}>{multLabel(m)}</td>
                      ))}
                      <td className={`num font-semibold ${row.weak >= 3 ? 'text-bad' : row.weak ? 'text-ink' : 'text-faint'}`}>{row.weak}</td>
                      <td className={`num ${row.resist + row.immune ? 'text-good' : 'text-faint'}`}>{row.resist + row.immune}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="Offensive Coverage">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 2xl:grid-cols-3">
              {coverage.map(c => (
                <div
                  key={c.type}
                  title={c.hitters.length ? `Super effective: ${c.hitters.join(', ')}` : 'Nothing hits it super effectively'}
                  className="rounded-lg border px-2 py-1.5"
                  style={{borderColor: c.best > 1 ? `${TYPE_COLOR[c.type]}88` : 'var(--color-line)', background: c.best > 1 ? `${TYPE_COLOR[c.type]}18` : 'transparent'}}
                >
                  <div className="flex items-center justify-between">
                    <TypeBadge type={c.type} small />
                    <span className={`num text-[11px] font-semibold ${c.best > 1 ? 'text-good' : c.best < 1 ? 'text-bad' : 'text-faint'}`}>
                      {c.best > 1 ? `${c.hitters.length}×SE` : c.best === 1 ? 'neutral' : 'resisted'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Roles">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roles.map(({role, members}) => {
                const ok = role.key === 'protect' ? members.length >= 4 : members.length > 0;
                return (
                  <div key={role.key} className="flex items-start gap-2 rounded-lg border border-line bg-bg/40 px-2.5 py-2" title={role.hint}>
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${ok ? 'bg-good/20 text-good' : role.important ? 'bg-bad/20 text-bad' : 'bg-line text-faint'}`}>
                      {ok ? '✓' : role.important ? '!' : '–'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{role.label}{role.key === 'protect' && <span className="num text-faint"> {members.length}/6</span>}</div>
                      <div className="truncate text-[11.5px] text-dim">{members.length ? members.join(', ') : '—'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

    </div>
  );
}

export function Empty({text = 'No Pokémon in the team yet.'}: {text?: string}) {
  return <div className="panel p-10 text-center text-dim">{text}</div>;
}

function Summary({sets, usage, issues, matrix, roles, megas, field, enemyWeather}: {
  field: SpeedField;
  enemyWeather: boolean;
  sets: PokemonSet[];
  usage: UsageSource;
  issues: Issue[];
  matrix: TypeRow[];
  roles: ReturnType<typeof roleCoverage>;
  megas: number;
}) {
  const deferred = useDeferredValue(sets);
  const threats = useMemo(() => {
    const rows = threatMatrix(deferred, metaThreats(usage, 30), field, enemyWeather ? {usage} : undefined);
    return rows.filter(r => r.danger >= 0.45).sort((a, b) => b.danger - a.danger).slice(0, 5);
  }, [deferred, usage, field.weather, field.electricTerrain, enemyWeather]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn' && i.slot !== undefined);
  const missing = roles.filter(r => r.role.important && !r.members.length).map(r => r.role.label);
  const weak = matrix.filter(r => r.weak >= 3 || r.weak - r.resist - r.immune >= 2);
  const ok = !errors.length && !missing.length && !weak.length && !threats.length;

  return (
    <Section title={ok ? 'No Issues' : 'Issues'}>
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {errors.length > 0 && (
          <Row label="Legality" tone="bad">{errors.map(e => e.text).join(' · ')}</Row>
        )}
        {missing.length > 0 && <Row label="Missing" tone="warn">{missing.join(', ')}</Row>}
        {weak.length > 0 && (
          <Row label="Weak to" tone="warn">
            <span className="flex flex-wrap gap-1.5">{weak.map(w => <span key={w.type} className="flex items-center gap-1"><TypeBadge type={w.type} small /><span className="num text-xs">{w.weak}×</span></span>)}</span>
          </Row>
        )}
        {threats.length > 0 && (
          <Row label="Threats" tone="warn">
            <span className="flex flex-wrap gap-2">
              {threats.map(t => (
                <span key={t.threat.name} className="flex items-center gap-1"><Portrait name={t.threat.name} size={20} className="!rounded" />{t.threat.name}</span>
              ))}
            </span>
          </Row>
        )}
        {warns.length > 0 && <Row label="Notes" tone="dim">{warns.map(w => w.text).join(' · ')}</Row>}
        {megas > 1 && <Row label="Megas" tone="dim">{megas}</Row>}
        {ok && <div className="text-[13px] text-good">Legal, all key roles covered, no stacked weaknesses.</div>}
      </div>
    </Section>
  );
}

function Row({label, tone, children}: {label: string; tone: 'bad' | 'warn' | 'dim'; children: React.ReactNode}) {
  const color = {bad: 'text-bad', warn: 'text-warn', dim: 'text-dim'}[tone];
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className={`label w-20 shrink-0 pt-0.5 ${color}`}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
