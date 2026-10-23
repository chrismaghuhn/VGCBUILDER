# Teams tab: folders, tags, favourites, search, notes and tournament teams

Date: 2026-10-23 · Issues: #10 (organise teams), #9 (tournament and sample teams)
Status: approved in chat, waiting for spec review

## Goal

Teams are only reachable through a small "Teams (n)" dropdown today, and have no notes, tags or
dates. Showdown users asked for tags, folders, favourites, timestamps and above all a search for
"which of my teams has Pokémon X". The user also brought the VGCPastes repository for Champions M-C
(702 teams, CSV) to offer tournament teams as starting points.

## Navigation

- The **Build** tab becomes **Teams**. It opens on the overview; clicking a team opens the editor
  as it is today (team row and set editor) with "← All teams" to go back.
- Old `#bauen` links land on Teams. The quick team switcher on the other pages stays.

## Overview (cards)

- **Folder sidebar** on the left: All teams, ★ Favorites, the user's folders with counts,
  Unsorted, "+ New folder". Folders can be renamed and deleted; deleting a folder moves its teams to
  Unsorted.
- **Search** by team name, Pokémon or tag. It always searches all folders; teams that don't match
  are hidden, the count reads "2 of 14 teams", and the matching Pokémon is outlined on each card.
- **Tag chips** above the cards filter within the selected folder.
- **Sort**: last edited (default), name, win rate.
- **Card**: ★, name, last edited, the six portraits, tags, record and win rate from the match log,
  the first line of the notes. Hover menu: Move to…, Duplicate, Export, Delete.
- Cards can be **dragged onto a folder** to move them.
- "+ New team" and "Import" as today; new teams go into the selected folder.

## Editor additions

- ★ next to the team name, and the folder as a picker.
- A **tags** field (chips, suggests existing tags) and a **notes** field (game plan, leads,
  thoughts).

## Data

`Team` gains:

| Field | Meaning |
|---|---|
| `folder?: string` | folder id; missing = Unsorted |
| `tags?: string[]` | free tags |
| `favorite?: boolean` | ★ |
| `notes?: string` | team notes |
| `createdAt?: number`, `updatedAt?: number` | ms since epoch; `updatedAt` is set by the store on every change to the team |

The saved state gains `folders: {id, name}[]`. Teams saved before this have no dates and show "–"
until their next change.

## Tournament teams (#9)

- A switch at the top of the Teams tab: **Your teams | Tournament teams (702)**.
- `scripts/import-vgcpastes.mjs <csv>` turns the VGCPastes CSV into
  `src/data/generated/tournament-teams.json`: id, description, player, event, placement, date,
  source link, PokePaste link, whether the paste has spreads, and the six Pokémon with their items.
  Species names are matched to the site's data; unknown ones are reported by the script.
- The file is **loaded on demand** (dynamic import) when the section opens, so the main bundle
  doesn't grow.
- **Cards**: event, placement, player, date, six portraits (items as tooltips).
- **Filters**: event, placement (Champion, Top 4, Top 8, Top 16, other/unplaced), and the same
  Pokémon search as above ("all Top 8 teams with Kingambit").
- **Use this team** fetches the PokePaste (CORS-enabled `/json` endpoint, already used for imports),
  creates a new team in the selected folder (or Unsorted), tags it with the event, and writes the
  source into its notes. Pastes without spreads are filled with meta spreads, as the opponent import
  already does.
- **Credit**: "Source: VGCPastes" with a link on the section, and the original post linked on each
  card.
- Updating: drop a newer CSV and run the script. Fetching the public Google Sheet from the monthly
  workflow is a possible follow-up if the sheet allows CSV export.

## Not in scope

- Syncing teams between devices (everything stays in the browser).
- Nested folders.

## Verification

- `tsc -b` and `vite build` pass; the main bundle doesn't grow by the tournament data.
- In the browser: create teams, move them between folders (drag and menu), tag, star, search by
  Pokémon across folders, sort; open a team and go back; filter tournament teams by event,
  placement and Pokémon; "Use this team" creates a full team with tag and notes.
