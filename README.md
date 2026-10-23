# Teamforge VGC

Teambuilder für das aktuelle VGC-Format: **Pokémon Champions, Regulation M-C**.

- **Bauen**: 6 Slots, Vorschläge mit Begründung direkt im leeren Slot, Editor mit Item/Fähigkeit/Attacken und eingeklapptem Feintuning (Wesen, Stat Points 66/32, Meta-Spreads). Undo mit Strg+Z.
- **Analyse**: Problem-Übersicht, defensive Typ-Matrix (inkl. Fähigkeiten/Megas), Coverage, Rollen-Check, Speed Tiers mit Wetter-Fähigkeiten.
- **Meta**: Threat-Matrix mit echten Damage Calcs (KO-Labels), Wetter inkl. Gegner-Wetter, Leads, Archetypen.
- **Calc**: Champions-Mechanik via `@smogon/calc`.
- Legalitätscheck, Showdown-Import/-Export (klassische EVs werden in Stat Points umgerechnet).

```bash
npm install
npm run dev
```

## Daten aktualisieren

```bash
npm run data   # Legalität/Learnsets (Showdown champions-Mod) + Smogon-Usage + SpriteCollab-Portraits
```

- `npm run data -- 2026-10` lädt einen bestimmten Monat; ohne Argument den neuesten mit M-C-Daten.
- `REFRESH=1 npm run data` ignoriert den Download-Cache in `scripts/.cache`.
- `SPRITECOLLAB=/pfad/zu/SpriteCollab` setzt den Pfad zu einem lokalen SpriteCollab-Checkout. Ohne ihn bleiben die vorhandenen Portraits bzw. es wird auf Showdown-Sprites zurückgegriffen.

Neue Regulation: `FORMAT`/`SOURCES` in `scripts/build-data.mjs` anpassen und `npm run data` laufen lassen.

## Quellen & Lizenzen

- Usage-Daten: [Smogon Stats](https://www.smogon.com/stats/)
- Legalität & Learnsets: [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (`data/mods/champions`)
- Damage Calc: [@smogon/calc](https://github.com/smogon/damage-calc)
- Portraits in `public/portraits/`: [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab), **CC BY-NC 4.0** (nicht kommerziell). Credits in `public/portraits/CREDITS.txt`.

Pokémon und alle zugehörigen Namen sind Marken von Nintendo, Game Freak und The Pokémon Company. Dies ist ein Fanprojekt ohne Verbindung zu diesen Unternehmen.
