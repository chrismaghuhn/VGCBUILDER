# Teamforge VGC

Teambuilder for the current VGC format: **Pokémon Champions, Regulation M-C**.

- **Build**: 6 slots, suggestions with reasons right in the empty slot, an editor for item/ability/moves with collapsible fine-tuning (nature, Stat Points 66/32, meta spreads). Undo with Ctrl+Z.
- **Search**: find Pokémon by function, not just by name. Supports concepts (speed control, pivot, anti-TR, cleric …), moves, abilities, items, types and abbreviations (EQ, TW, HH …). Use spaces for AND and `|` for OR. Results are sorted by how often the matched move/ability/item is actually played.
- **Analysis**: issue overview, defensive type chart (including abilities/Megas), coverage, role check.
- **Spread planning** in three steps, each showing per meta threat what your Pokémon needs, applied with one click:
  1. **Offense**: Atk/SpA SP (and nature) for guaranteed OHKOs/2HKOs.
  2. **Speed**: Spe SP to outspeed, incl. weather abilities, Tailwind, Trick Room, stages, paralysis.
  3. **Bulk**: HP/Def/SpD SP to survive, incl. stat drops and screens.
  Lock what you've settled; suggestions never touch locked stats and never undo a KO, outspeed or survival you already have.
- **Meta**: threat matrix with real damage calcs (KO labels), weather incl. enemy weather, leads, archetypes.
- **Calc**: Champions mechanics via `@smogon/calc`.
- Legality check, Showdown import/export (classic EVs are converted to Stat Points).
- Usage data: Bo1, Bo3 or Bo1+Bo3 combined (1760+), or Bo1 1500+.

```bash
npm install
npm run dev
```

## Updating data

```bash
npm run data   # legality/learnsets (Showdown champions mod) + Smogon usage + SpriteCollab portraits
```

- `npm run data -- 2026-10` loads a specific month; without an argument it uses the latest month with M-C data.
- `REFRESH=1 npm run data` ignores the download cache in `scripts/.cache`.
- `SPRITECOLLAB=/path/to/SpriteCollab` points to a local SpriteCollab checkout. Without it, existing portraits are kept or Showdown sprites are used as a fallback.

New regulation: adjust `FORMAT`/`SOURCES` in `scripts/build-data.mjs` and run `npm run data`.

## Deploying

Live at https://vgcbuilder.duckdns.org (static files served by Caddy on the VPS, HTTPS via Let's Encrypt).

```bash
npm run deploy
```

builds the site and uploads `dist/` with rsync to `duoforge-vps:/var/www/teamforge` (override with
`DEPLOY_HOST` / `DEPLOY_DIR`). No sudo is needed for that.

**Automatic:** every push to `main` (a merged PR) runs `.github/workflows/deploy.yml`, which does the
same from GitHub Actions. Its SSH key (secret `DEPLOY_SSH_KEY`, plus `DEPLOY_HOST` and
`DEPLOY_KNOWN_HOSTS`) is limited on the server with `rrsync` to `/var/www/teamforge`: it can upload
files there and nothing else.

**Monthly data:** `.github/workflows/data.yml` runs on the 3rd of every month (or by hand from the
Actions tab). It fetches the new usage stats, checks them and opens a PR; merging the PR deploys it.
It fails when a source changed its format, or when Smogon only has a newer regulation: then
`FORMAT` in `scripts/build-data.mjs` needs updating. Without a SpriteCollab checkout the script keeps
the portraits and sprites already in the repo.

One-time server setup (Ubuntu 24.04, needs sudo): copy `deploy/` to the server and run
`sudo bash setup-server.sh <domain>`. It installs Caddy, creates the web folder for the deploy user,
writes `/etc/caddy/Caddyfile` from `deploy/Caddyfile` and opens ports 80/443 if ufw is active.
HTTPS is required: password-protected board links use the Web Crypto API, which browsers only
offer on secure origins.

## Sources & licenses

- Usage data: [Smogon Stats](https://www.smogon.com/stats/)
- Legality & learnsets: [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (`data/mods/champions`)
- Damage calc: [@smogon/calc](https://github.com/smogon/damage-calc)
- Portraits in `public/portraits/`: [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab), **CC BY-NC 4.0** (non-commercial). Credits in `public/portraits/CREDITS.txt`.

Pokémon and all related names are trademarks of Nintendo, Game Freak and The Pokémon Company. This is a fan project not affiliated with them.
