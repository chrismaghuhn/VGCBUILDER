import {useState} from 'react';
import {exportTeam, importTeam, type PokemonSet} from '../lib/team';

export function PasteDialog({mode, sets, onImport, onClose}: {
  mode: 'import' | 'export';
  sets: PokemonSet[];
  onImport: (sets: PokemonSet[], asNew: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(mode === 'export' ? exportTeam(sets) : '');
  const [copied, setCopied] = useState(false);
  const parsed = mode === 'import' && text.trim() ? importTeam(text) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="panel rise w-full max-w-2xl p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wider">
            {mode === 'import' ? 'Import' : 'Export'}
          </h2>
          <button className="text-dim hover:text-ink" onClick={onClose}>✕</button>
        </div>
        <textarea
          className="field num h-[380px] resize-none text-[12.5px] leading-relaxed"
          value={text}
          autoFocus
          readOnly={mode === 'export'}
          placeholder={'Rillaboom @ Miracle Seed\nAbility: Grassy Surge\nLevel: 50\nEVs: 32 HP / 32 Atk / 2 SpD\nAdamant Nature\n- Fake Out\n- Grassy Glide\n- Wood Hammer\n- U-turn'}
          onChange={e => setText(e.target.value)}
          onFocus={e => mode === 'export' && e.target.select()}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] text-dim">
            {parsed && <>{parsed.sets.length} Pokémon{parsed.warnings.length > 0 && <span className="text-warn"> · {parsed.warnings.join(' · ')}</span>}</>}
          </div>
          <div className="flex gap-2">
            {mode === 'export' ? (
              <button className="btn btn-gold" onClick={async () => {
                try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked */ }
              }}>{copied ? '✓ Kopiert' : 'Kopieren'}</button>
            ) : (
              <>
                <button className="btn" disabled={!parsed?.sets.length} onClick={() => parsed && onImport(parsed.sets, true)}>Als neues Team</button>
                <button className="btn btn-gold" disabled={!parsed?.sets.length} onClick={() => parsed && onImport(parsed.sets, false)}>Aktuelles ersetzen</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
