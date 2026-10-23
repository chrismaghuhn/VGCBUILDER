import {useEffect, useState} from 'react';
import {decodeShare, encodeShare, fetchPokepaste, pokepasteId, sharePayload, shareUrl, uploadPokepaste} from '../lib/share';
import {otsTeam} from '../lib/ots';
import {exportTeam, importTeam, type PokemonSet} from '../lib/team';

export function PasteDialog({mode, sets, teamName, onImport, onClose}: {
  mode: 'import' | 'export';
  sets: PokemonSet[];
  teamName: string;
  onImport: (sets: PokemonSet[], asNew: boolean, name?: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(mode === 'export' ? exportTeam(sets) : '');
  const [format, setFormat] = useState<'showdown' | 'ots'>('showdown');
  const [copied, setCopied] = useState<'text' | 'link' | null>(null);
  const [status, setStatus] = useState<{tone: 'dim' | 'good' | 'bad'; msg: string} | null>(null);
  const [importName, setImportName] = useState<string | undefined>();
  const parsed = mode === 'import' && text.trim() && !pokepasteId(text) && !sharePayload(text.trim()) ? importTeam(text) : null;

  // Import: a pasted PokePaste or Teamforge share link is loaded and replaced by its team text.
  useEffect(() => {
    if (mode !== 'import') return;
    const input = text.trim();
    const id = pokepasteId(input);
    const share = sharePayload(input);
    if (!id && !share) return;
    let cancelled = false;
    setStatus({tone: 'dim', msg: id ? 'Loading PokePaste …' : 'Reading share link …'});
    (async () => {
      try {
        if (id) {
          const {title, paste} = await fetchPokepaste(id);
          if (cancelled) return;
          setText(paste);
          setImportName(title);
          setStatus({tone: 'good', msg: `Loaded "${title}" from PokePaste`});
        } else if (share) {
          const {name, sets: shared} = await decodeShare(share);
          if (cancelled) return;
          setText(exportTeam(shared));
          setImportName(name);
          setStatus({tone: 'good', msg: `Loaded "${name}" from a share link`});
        }
      } catch (e) {
        if (!cancelled) setStatus({tone: 'bad', msg: `Couldn't load it: ${(e as Error).message}`});
      }
    })();
    return () => { cancelled = true; };
  }, [text, mode]);

  const copy = async (what: 'text' | 'link') => {
    try {
      const value = what === 'text' ? text : shareUrl(await encodeShare(teamName, sets));
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setStatus(what === 'link' ? {tone: 'good', msg: `Share link copied (${value.length} characters)`} : null);
    } catch {
      setStatus({tone: 'bad', msg: 'Clipboard is blocked in this browser'});
    }
  };

  const tone = {dim: 'text-dim', good: 'text-good', bad: 'text-bad'};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="panel rise w-full max-w-2xl p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wider">
            {mode === 'import' ? 'Import' : 'Export'}
          </h2>
          <button className="text-dim hover:text-ink" onClick={onClose}>✕</button>
        </div>
        {mode === 'export' && (
          <div className="mb-2 flex gap-2">
            {([['showdown', 'Showdown'], ['ots', 'Open Team Sheet']] as const).map(([f, label]) => (
              <button key={f} className={`btn ${format === f ? 'btn-gold' : ''}`} onClick={() => {
                setFormat(f);
                setText(f === 'ots' ? otsTeam(sets) : exportTeam(sets));
                setCopied(null);
              }}>{label}</button>
            ))}
          </div>
        )}
        <textarea
          className="field num h-[360px] resize-none text-[12.5px] leading-relaxed"
          value={text}
          autoFocus
          readOnly={mode === 'export'}
          placeholder={'Paste a Showdown team, a pokepast.es link or a Teamforge share link\n\nRillaboom @ Miracle Seed\nAbility: Grassy Surge\nLevel: 50\nEVs: 32 HP / 32 Atk / 2 SpD\nAdamant Nature\n- Fake Out\n- Grassy Glide\n- Wood Hammer\n- U-turn'}
          onChange={e => { setText(e.target.value); setImportName(undefined); setStatus(null); }}
          onFocus={e => mode === 'export' && e.target.select()}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-[12px]">
            {status && <span className={tone[status.tone]}>{status.msg}</span>}
            {!status && parsed && (
              <span className="text-dim">
                {parsed.sets.length} Pokémon{parsed.warnings.length > 0 && <span className="text-warn"> · {parsed.warnings.join(' · ')}</span>}
              </span>
            )}
            {status?.tone === 'good' && mode === 'import' && parsed && (
              <span className="text-dim">
                {' '}· {parsed.sets.length} Pokémon{parsed.warnings.length > 0 && <span className="text-warn"> · {parsed.warnings.join(' · ')}</span>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === 'export' ? (
              <>
                <button className="btn" onClick={() => copy('text')}>{copied === 'text' ? '✓ Copied' : 'Copy text'}</button>
                <button className="btn" onClick={() => uploadPokepaste(teamName, text)} title="Opens the new paste in a new tab">
                  Upload to PokePaste ↗
                </button>
                {format === 'showdown' && <button className="btn btn-gold" onClick={() => copy('link')}>{copied === 'link' ? '✓ Link copied' : 'Copy share link'}</button>}
              </>
            ) : (
              <>
                <button className="btn" disabled={!parsed?.sets.length} onClick={() => parsed && onImport(parsed.sets, true, importName)}>As new team</button>
                <button className="btn btn-gold" disabled={!parsed?.sets.length} onClick={() => parsed && onImport(parsed.sets, false)}>Replace current</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
