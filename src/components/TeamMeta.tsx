import {useState} from 'react';
import type {Folder, Team} from '../lib/team';

/** Star and folder next to the team name in the editor. */
export function TeamHeaderMeta({team, folders, onMeta}: {
  team: Team; folders: Folder[]; onMeta: (patch: Partial<Pick<Team, 'favorite' | 'folder'>>) => void;
}) {
  return (
    <>
      <button onClick={() => onMeta({favorite: !team.favorite})} title={team.favorite ? 'Remove from favorites' : 'Add to favorites'}
        className={`text-[17px] leading-none ${team.favorite ? 'text-gold' : 'text-line-2 hover:text-dim'}`}>★</button>
      <select className="field !w-auto !py-1 text-xs text-dim" value={team.folder ?? ''} onChange={e => onMeta({folder: e.target.value || undefined})}
        title="Folder" aria-label="Folder">
        <option value="">Unsorted</option>
        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </>
  );
}

/** Tags and notes of the open team. */
export function TeamNotes({team, allTags, onMeta}: {
  team: Team; allTags: string[]; onMeta: (patch: Partial<Pick<Team, 'tags' | 'notes'>>, key?: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const tags = team.tags ?? [];
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !tags.includes(t)) onMeta({tags: [...tags, t]});
    setDraft('');
  };
  return (
    // One centred column as wide as the set editor below: notes first, tags underneath.
    <div className="mt-3 border-t border-line pt-3">
      <div className="mx-auto max-w-[980px] space-y-2">
        <div>
          <div className="label mb-1.5">Notes</div>
          <textarea className="field h-20 resize-y text-[12.5px]" value={team.notes ?? ''} onChange={e => onMeta({notes: e.target.value}, `team-notes-${team.id}`)}
            placeholder="Game plan, leads, what to bring against what …" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Tags</span>
          {tags.map(t => (
            <span key={t} className="flex items-center gap-1 border border-line-2 px-1.5 text-[12px] text-dim">
              {t}
              <button className="text-faint hover:text-bad" onClick={() => onMeta({tags: tags.filter(x => x !== t)})} aria-label={`Remove tag ${t}`}>×</button>
            </span>
          ))}
          <input className="field !w-32 !py-0.5 text-[12px]" list="team-tags" value={draft} placeholder="+ tag"
            onChange={e => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') add(draft); if (e.key === 'Backspace' && !draft && tags.length) onMeta({tags: tags.slice(0, -1)}); }}
            onBlur={() => draft && add(draft)} aria-label="Add tag" />
          <datalist id="team-tags">{allTags.filter(t => !tags.includes(t)).map(t => <option key={t} value={t} />)}</datalist>
        </div>
      </div>
    </div>
  );
}
