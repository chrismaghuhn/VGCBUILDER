# Black & white redesign

Date: 2026-10-23 · Status: approved in chat, waiting for spec review

## Goal

The site felt monotonous: everything blue-grey with gold as the only accent, the same rounded panel
on every page. After comparing several directions (esports broadcast, game UI, pixel art, editorial),
the user picked **the current layout in black and white, with square boxes and the Geist typeface**.

This is a change of look only. Layout, pages and features stay the same.

## Decisions

### Colors

| Token | Old | New |
|---|---|---|
| `--color-bg` | `#0a0e16` | `#000000` |
| `--color-panel` | `#111725` | `#0b0b0b` |
| `--color-panel-2` | `#172033` | `#141414` |
| `--color-line` | `#222d43` | `#262626` |
| `--color-line-2` | `#2e3b57` | `#3a3a3a` |
| `--color-ink` | `#e6ebf5` | `#f5f5f5` |
| `--color-dim` | `#8a96b0` | `#9a9a9a` |
| `--color-faint` | `#5b6782` | `#5e5e5e` |
| `--color-gold` (the accent) | `#f5c542` | `#f5f5f5` (white) |
| `--color-gold-dim` | `#8a6f22` | `#8a8a8a` |

- The accent stays named `gold` in code: about 130 class names use it, and renaming them would be a
  large diff with no visible effect. A comment at the token says it is the accent, now white.
- Dark text on accent backgrounds (`#1a1406`) becomes black (`#000`). The hover of the primary
  button becomes `#ffffff` instead of light gold.
- The coloured radial gradients behind the page are removed; the page background is flat black.
- Hard-coded gold values (`#f5c542`, `rgba(245,197,66,…)`) in components are replaced with the
  accent token or white. The sticky-note colour "gold" on the Playmat stays a warm yellow, since notes
  are colour-coded on purpose.

### Colours that stay

They carry meaning, so they keep their colour:

- type colours;
- good / warn / bad (damage, KO, legality);
- info blue and bad red for "yours" and "theirs" on the Playmat.

The Playmat board itself becomes black with a faint grid instead of dark teal.

### Corners

- All boxes, panels, buttons, inputs, chips and cards become square: radius 0.
- Done centrally through Tailwind's radius tokens (`--radius-xs` … `--radius-4xl` set to 0) plus the
  `.panel`, `.field` and `.btn` classes and the few arbitrary radii (`rounded-[14px]`).
- Things that are actually round keep `rounded-full` and `rounded-[50%]`: dots, HP bar caps and the
  oval platforms on the Playmat.

### Type

- **Geist** for text, headings and navigation (`--font-sans` and `--font-display`).
- **Geist Mono** for numbers (`--font-mono`, used by `.num`).
- Chakra Petch, IBM Plex Sans and JetBrains Mono are removed from `index.html`.
- Uppercase labels keep their letter spacing; sizes stay as they are and are only adjusted where
  Geist reads noticeably larger or smaller.

## Not in scope

- Pixel-art frames and elements (liked earlier, but parked).
- Layout, navigation or feature changes.
- A light theme.

## Verification

- `tsc -b` and `vite build` pass.
- Every page checked in the browser — Build, Search, Analysis, Offense, Speed, Bulk, Meta, Playmat
  (free board, replay, plan), Matches, Calc — plus the share and import dialogs.
- Look specifically for contrast problems where gold on dark is now white: white text on white
  backgrounds, selected states that no longer stand out, focus rings.
