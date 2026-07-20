# Document Arena: Redesign Proposal

Spine: **the matchup** (Concept 3). Grafted: the layer flip and coverage-as-geography (Concept 2), the page ribbon and the in-place inspector (Concept 1), manifest-driven run config and fork-a-run (Concept 4). Conflicts are resolved explicitly in §3 and §9, not averaged.

---

## 1. Diagnosis: the six things that actually matter

**1. The vote loop is fiction.** `saveVote` has exactly one caller (`app/ui/ArenaBattle.tsx:96`) and the thing it votes on is hardcoded JSX: a literal `<strong>Attention Is All You Need</strong>` at `ArenaBattle.tsx:405` and a `mini-table` of literal 0.96/0.91 values at `:421`. The "run" is `window.setTimeout(() => setPhase("blind"), 1600)` (`:89`). The escape hatch "Use my own document" is `<Link href="/">` (`:145`), back to upload. `app/ui/Workspace.tsx:995` links out to `/arena`, discarding the document you were working on. **The leaderboard is a graph of opinions about three static divs.** Meanwhile `app/vote-store.ts:5-18` already has the correct schema (`permutation`, `candidateArtifactIds`, `blind`) - it was only ever fed garbage.

**2. Two design systems in one file, and the loser wins the cascade.** `app/globals.css` is 4,401 lines with a hand-written palette (`--canvas`/`--ink`/`--line`/`--surface`) sitting beside the full shadcn oklch set. Stats: 33 font-sizes, 15 font-weights, 22 radii, 54 hex literals, 49 `box-shadow` declarations against 2 shadow tokens. The structural bug: `a { color: inherit }` at `globals.css:129` is **unlayered**, so it beats Tailwind's `@layer utilities` regardless of specificity. `LeaderboardView.tsx:40` and `:65` render `<Link className={buttonVariants({size:"sm"})}>`; `bg-primary` applies, `text-primary-foreground` does not. The leaderboard's only navigation control is a black rectangle with no label. This will recur on every future link-button.

**3. 222px of chrome, then a half-empty pane.** `globals.css:474` = `64px / 1fr / 54px`, plus a 46px result toolbar (`:1153`) and a 58px view toolbar (`:1158`). The 54px `.run-dock` (`:1639`) is a full-width 1440px band holding two chips. In `02-workspace.jpg` the three result cards end at y≈340 of a 780px pane: roughly 55% of the results column is white space, because each block is a bordered, rounded, shadowed card in a single column. To be accurate about what is *not* broken: the source page renders about 445x577 at 92% zoom, which is fine. The problem is the results side and the chrome, not the page size.

**4. The namesake feature is invisible.** `globals.css:44` sets `--evidence-rest-opacity: 0.35`; `:933` sets `border: 1px solid rgb(var(--evidence-rgb) / 0.42)`; `:937` applies the element opacity. 0.42 x 0.35 = 0.147 indigo on white = **1.25:1**. In the screenshot there is not one discernible bounding box on the page. It is also mouse-only: `Workspace.tsx:2324` attaches `onMouseEnter` to plain `<p>`/`<td>` with no `tabIndex`, no `aria-pressed`, no `onFocus` - while the *demo* path at `:2532-2533` does it correctly with real buttons. And `app/workspace-state.ts` `set-page` nulls `activeEvidence` always and `pinnedEvidence` on any navigation, so paging destroys the pin, which removes the reason to pin.

**5. Runs are a one-way door.** `Workspace.tsx:2714-2717`: `executable()` requires `entry.status !== "complete"`, so a finished parser can never be re-run - not with OCR on, not at all, and results are rehydrated on mount so the dead end survives reload. Simultaneously, `:386/:390` short-circuit to `"compare"` the moment `completedParsers.length >= 2`, silently swapping the view and discarding your scroll position without a dispatch. No acknowledgement when you act; an unrequested view change when you do not.

**6. Every non-workspace surface is a marketing page.** Landing, arena intro, and leaderboard all pour content into a 760px column on a 1440px viewport. `checkLocalRunner()` (`app/local-runner.ts:299`) is first called from a Workspace mount effect (`Workspace.tsx:487`), so "local runner offline" is discovered *after* a 50MB upload and a full-page `window.location.assign`.

---

## 2. The direction

**The atomic unit of this product is not a parsed result, it is a matchup: one source page, N candidates, row-aligned by native geometry.** Because every `SourceEvidenceRegion.bbox` is already normalized to `[0..1]` in one shared coordinate space (`app/evidence-regions.ts:1-16`), two parsers' outputs can be matched to each other by IoU and rendered as a single matrix where each row is one region of the page. That one decision does the work: a missed table becomes a visibly ragged row rather than an absence you have to notice; a diff-only filter turns "read 300 blocks twice" into "look at the 14 rows that disagree"; a verdict bar over real artifacts replaces a fake arena; and single-parser inspection is the degenerate one-column case of the same layout, so the product has exactly one screen to learn, build, and maintain.

Principles that follow:

1. **One layout, five states.** Empty, running, single, compare, blind are states of the bench, not routes. Every route that exists today (`/`, `/documents/[id]`, `/arena`, `/leaderboard`) is either the bench or a panel over it.
2. **Alignment beats adjacency.** Two columns side by side make the user do the diffing. Rows matched by geometry do it for them. When alignment is uncertain, say so (`Unaligned (3)`), never force-fit.
3. **Evidence is visible at rest.** Linkage is a permanent visual property of every row and every box, not a hover reveal. Density is bought by deleting chrome, never by shrinking type below 11px.
4. **Nothing is fabricated.** No fake progress, no demo fork, no hardcoded timings, no votes about static markup. The existing "these are the parser's own progress events, nothing is estimated" stance is the whole product's posture, applied everywhere.
5. **One system.** Tailwind 4 `@theme` + shadcn tokens win outright. The hand-written palette is deleted, not layered.
6. **The user changes the view.** No automatic mode swaps. Ever.

---

## 3. The bench: primary surface (`/documents/[id]`)

Shell: `grid-template-rows: 44px minmax(0,1fr) 40px`. **84px of chrome, down from 222.** Shell is `height:100dvh`, work row is `overflow:auto` with `min-width:1100px` on the canvas, so narrow viewports scroll rather than amputate (kills the 768-1100px dead zone where the shell needed 790px inside 768 with `overflow:hidden`).

Canvas: `grid-template-columns: minmax(320px, 420px) 4px minmax(0,1fr)`, divider draggable (reuse `react-resizable-panels`, already a dependency and currently unused outside `components/ui/resizable.tsx`).

At 1440x900: work row = 816px tall. Spine 420 + divider 4 + matrix 1016 = **2 candidates at 507px each** (today: 422px), or 3 at 464px with the spine collapsed.

```
┌ 1440 ──────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ attention-is-all-you-need.pdf · 12p    Bench │ Standings    BLIND ●   ⌘K   ☾   ⋯      44 │
├─────── 420 spine ────────┬─────────────── 1016 matrix = 2 × 507 ──────────────────────────┤
│ SOURCE   3/12  fit-w  B▾ │ ▌A opendataloader 4.2s · 96% bbox   ⋯│▌B mineru 11.4s · 88%  ⋯ │28
│ ┌──────────────────────┐ │──────────────────────────────────────┼──────────────────────────│
│ │╔════════════════════╗│ │▌TITLE                      r1  ●     │▌TITLE                    │
│ │║Attention Is All You║│ │ Attention Is All You Need            │ Attention Is All You Need│
│ │╚════════════════════╝│ │──────────────────────────────────────┼──────────────────────────│
│ │╔════════════════════╗│ │▌PARA                       r2  ◐     │▌PARA                   ◐ │
│ │║Abstract            ║│ │ We compare structured document…      │ We compare structured d… │
│ │║The dominant seq…   ║│ │──────────────────────────────────────┼──────────────────────────│
│ │╚════════════════════╝│ │▌TABLE 3×4                  r3  ○     │  ── missed ──          ○ │
│ │┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│ │ ┌────────┬──────┬──────┐             │  no block claims this   │
│ │  unclaimed region   ││ │ └────────┴──────┴──────┘             │  region                  │
│ │└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│ │──────────────────────────────────────┼──────────────────────────│
│ │╔════════════════════╗│ │▌PARA                       r4  ●     │▌PARA                     │
│ │║Document parsing i… ║│ │ Document parsing is one axis…        │ Document parsing is one… │
│ └──────────────────────┘ │──────────────────────────────────────┴──────────────────────────│
│ ▁▂█▃▁▁▂▅▇▁▁▂  ◂ 3/12 ▸ │ ▸ Unaligned (3)                                                  │40
│  page ribbon, coverage  │ 24 rows · 21 aligned · 6 differ  [D] diff only   [X] expand row │28
├──────────────────────────┴──────────────────────────────────────────────────────────────────┤
│ PAGE 3 VERDICT   [1 A better] [2 B better] [3 tie] [4 both poor]      blind · vote counts 40│
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Spine (420px default, drag 320-680, `S` collapses to a 44px stub).** One page at a time, fit-width by default: at 420px the page renders about 404x523. This is deliberately not a page-hero layout, and that is the main concession the matchup spine makes to Marginalia. The compensation is `F` (§6.5), which promotes the page to full width on demand. 28px head carries page stepper, zoom, fit, native/merged region toggle, and the layer selector.

**Page ribbon (40px, horizontal, bottom of the spine).** This is Concept 1's idea, rotated. At 420px wide the page is width-constrained and leaves about 225px of vertical slack in the spine, so a horizontal ribbon is free while a 56px vertical rail would directly shrink the page. One 26px cell per page: mono page number plus one 3px coverage bar per seated candidate, with a diagonal hatch where candidates diverge most. `PdfThumbnailRail.tsx`'s roving tabindex / Arrow / Home / End / rAF focus restoration transfers verbatim, rotated 90 degrees; `THUMBNAIL_WIDTH = 76` (`PdfThumbnailRail.tsx:7`) is deleted along with the 76x98 previews, which conveyed only a page number the toolbar already shows. Real thumbnails move to a `⌘P` grid overlay at 180px with the same coverage bars.

**Matrix (1fr).** 28px sticky column heads: 3px candidate identity bar, duration, `%bbox`, locality, `⋯` opens the run drawer. Rows are `grid-template-columns: repeat(var(--candidates), 1fr)` with a shared min-height from the tallest cell, 1px hairline separators, `8px 12px` cell padding. **No cards.** No border, radius, gap, or shadow per block. Target 30-40 rows per screen against today's 8-10.

Column body by state: empty = a dashed 28px "Seat a candidate" head; running = the existing `StageChecklist` rendered in-column with its real emitted events; failed = the error plus "Retry *that* parser" in-column (today `LocalFailedResult` hardcodes the string "Retry OpenDataLoader" for every failure).

**Verdict bar (40px, full width).** Replaces the 54px run dock. This is the one thing that earns permanent full-width real estate in an arena-first product.

### Resize and collapse

| Width | Behavior |
|---|---|
| >= 1760 | 3 candidates comfortable; spine 460 |
| 1440-1760 | as drawn; 3rd candidate offered with a "spine will collapse" warning |
| 1100-1440 | candidates `minmax(360px,1fr)`; spine clamps to 320 |
| 900-1100 | spine becomes an overlay sheet (`S`); matrix shows one candidate at a time via a `role="group"` + `aria-pressed` switcher. **Rows stay index-aligned**, so switching is a true A/B flip on the same row - a flicker comparison, which at high zoom is more sensitive than side-by-side |
| < 900 | single-pane review: read one candidate, tap a row to see its region. Compare and vote disabled with an explicit "needs >= 900px" message. Deliberate cliff, not an overflow bug |

### How the evidence link is expressed (four layers, no bezier)

1. **Gutter rule, always on.** Every matrix row carries a 3px left rule in its candidate hue: **solid** = native bbox present, **hollow** = block emitted with no geometry, **✕** = explicitly unmapped on this page. You can see the mapped/unmapped ratio at a glance without moving the pointer. This is the single change that converts linkage from an Easter egg into a property.
2. **The box, visible at rest.** 1.5px solid stroke at 0.55 alpha over a 6% fill, with **no element-opacity multiplier** (~3.4:1, replacing 1.25:1). Region index badges at 11px, always rendered above 1.2x zoom (the current 6px `opacity:0` label is deleted).
3. **Reciprocal focus, both directions, keyboard-equivalent.** Focusing row `r` (pointer, `j`/`k`, or Tab) raises its box to active on the page, outlines the same row in every other candidate column, and pages the spine if needed. Hovering a box does the inverse and scrolls the matrix. Rows are real `<button>`s with `aria-pressed` and `onFocus`/`onBlur` mirroring pointer events: the demo path's implementation (`Workspace.tsx:2532-2533`) is promoted and the demo path is deleted.
4. **Row expansion (`X` or `Enter` on a focused row) is the inspector.** The row expands in place to reveal, per candidate: a real rendered crop of that candidate's claimed region (actual pixels, not an outline), bbox in points, confidence, reading-order index, and the provider's literal raw JSON at its `jsonPointer`, with copy.

**Conflict resolved:** Concept 1's inspector rail is the best answer anyone gave to "is this block right", but a 300px fixed rail costs the matrix 30% of its width, and a rail can only show one candidate at a time. Expanding the aligned row keeps both candidates' crop-plus-JSON in the same horizontal register, which is strictly better for a comparison tool and costs zero permanent pixels.

**Conflict resolved:** Concept 1's SVG tether bezier is rejected. It must recompute across two independently scrolling containers plus zoom plus page change plus virtualized rows, needs a bespoke rAF-batched geometry store with no library behind it, and is the highest jank risk in the entire set. Row alignment already supplies the correspondence the bezier was compensating for. Do not build it.

---

## 4. Design system

**What replaces `app/globals.css` (4,401 lines):** roughly 230 lines. `@theme` (~90), `@layer base` (~40: reset, focus, `.visually-hidden`, reduced-motion kill-switch), `@layer components` (~100) for the seven things that genuinely need real CSS: `.page-canvas`, `.evidence-box`, `.evidence-hatch`, `.matrix-row`, `.gutter-rule`, `.ribbon-cell`, `.agreement-mark`. Everything else is Tailwind utilities against the theme. A stylelint rule bans hex literals outside `@theme`, which is what keeps dark mode from being punctured again.

### Color (oklch, one ramp, both themes)

```css
@theme {
  --color-bg:            oklch(0.985 0.002 265);
  --color-panel:         oklch(1 0 0);
  --color-raised:        oklch(0.965 0.003 265);
  --color-hover:         oklch(0.945 0.004 265);
  --color-ink:           oklch(0.22  0.010 265);  /* 15.9:1 on panel */
  --color-ink-2:         oklch(0.50  0.012 265);  /* 5.0:1  - the only secondary ink */
  --color-line:          oklch(0.905 0.004 265);  /* hairlines */
  --color-line-strong:   oklch(0.82  0.006 265);  /* pane + column dividers */
  --color-c1:            oklch(0.52 0.16 268);    /* indigo  */
  --color-c2:            oklch(0.52 0.11 195);    /* teal    */
  --color-c3:            oklch(0.52 0.17 350);    /* magenta */
  --color-c-blind:       oklch(0.52 0    0);
  --color-ok:            oklch(0.52 0.13 150);
  --color-warn:          oklch(0.55 0.13 75);
  --color-err:           oklch(0.53 0.19 27);
  --color-focus:         oklch(0.55 0.19 262);    /* 4.6:1, passes 2.4.11 */
  --color-paper:         #ffffff;                 /* never themed */
}
.dark {
  --color-bg:          oklch(0.165 0.006 265);
  --color-panel:       oklch(0.205 0.007 265);
  --color-raised:      oklch(0.245 0.008 265);
  --color-hover:       oklch(0.285 0.009 265);
  --color-ink:         oklch(0.965 0.003 265);
  --color-ink-2:       oklch(0.735 0.010 265);   /* 5.2:1 on panel */
  --color-line:        oklch(0.315 0.009 265);
  --color-line-strong: oklch(0.415 0.012 265);
  --color-c1:          oklch(0.74 0.145 268);
  --color-c2:          oklch(0.74 0.105 195);
  --color-c3:          oklch(0.74 0.155 350);
  --color-c-blind:     oklch(0.74 0 0);
  --color-focus:       oklch(0.72 0.17 262);
}
```

**Candidate hues are equal-luminance by construction** (one L, one C per theme, hue only varies), so no candidate ever reads louder than another. This retires `--amber #b76412` (3.90:1 on canvas) which made candidate B structurally less legible than candidate A. Tints derive with `color-mix(in oklab, var(--color-c1) 10%, var(--color-panel))`, never hand-inlined alphas. Blind mode remaps all candidates to `--color-c-blind` and differentiates by letter plus a solid-vs-dashed 3px identity bar, so blindness survives colorblindness.

**The page always renders on `--color-paper` in both themes**, with a 1px `--color-line-strong` edge. You never darken the document.

Evidence tokens: rest `1.5px / 0.55 alpha / 6% fill`; active `2px / 1.0 / 16% fill`; pinned `2px solid + 2px offset halo / 20% fill` plus a persistent 4px tick in the page's left margin; unclaimed area `4px diagonal hatch at ink-2 / 0.10`.

### Type: 7 steps, 3 weights

| Token | rem / px | Role |
|---|---|---|
| `--text-2xs` | 0.6875rem / 11px | mono `tabular-nums` only: durations, %, page indices, bbox, region badges, kind labels (600, 0.06em, uppercase). **Absolute floor.** |
| `--text-xs` | 0.75rem / 12px | column-head stats, secondary metadata |
| `--text-sm` | 0.8125rem / 13px | UI default: buttons, menus, chips, filter fields |
| `--text-base` | 0.875rem / 14px | parsed body text in matrix rows |
| `--text-md` | 1rem / 16px | block headings in results; body text in focus mode |
| `--text-lg` | 1.25rem / 20px | surface titles, drawer headings |
| `--text-xl` | 1.75rem / 28px | the only display step: landing h1, standings h1. **There is no hero type in this codebase.** |

Weights 400 / 500 / 600. Nothing else. The 610/620/630/650/670 half-steps and the 87 declarations at or below 11px are gone. Sans: Geist. Mono: Geist Mono with `font-variant-numeric: tabular-nums`, **mandatory for every number in the product** so columns align across candidates. Line height 1.25 for UI rows, 1.55 for parsed prose.

### Spacing, density, radius, elevation, motion

- **Spacing:** 4px grid, six values: 4 / 8 / 12 / 16 / 24 / 32. Cell padding `8px 12px`; section padding 16px. Replaces 89 padding and 22 gap values.
- **Density:** `--row-h` 32px default / 26px dense (`⌘⇧D`, persisted). `--head-h` 28px, `--bar-h` 40px, `--shell-head` 44px.
- **Radius:** 3 values. 4px (inputs, cells, chips, evidence badges), 8px (panels, sheets, drawers), 999px (status dots only). `components/ui/button.tsx:7`'s `rounded-2xl` is overridden once to 4px, so 18px pills never sit next to 9px controls again.
- **Elevation:** two levels. L0 = flat, `1px solid var(--color-line)`, no shadow: everything on the bench. L1 = overlays only (sheet, drawer, popover, `⌘K`): `0 8px 24px oklch(0 0 0 / 0.14)` plus a hairline. Separation is borders, which is also why dark mode stops breaking. This retires 49 `box-shadow` declarations and every inset-ring and glow hack. No `backdrop-filter` anywhere, which removes the `prefers-reduced-transparency` special case entirely.
- **Focus:** `outline: 2px solid var(--color-focus); outline-offset: 2px`, one rule via `:focus-visible`. Replaces four separate rings at 1.36-1.56:1 (`globals.css:137`, `:2012`, `:3588`, and `focus-visible:ring-ring/30` in `button.tsx:7`), all of which fail WCAG 2.4.11.
- **Motion:** three durations (90 / 160 / 240ms), one easing plus one drawer easing. Permitted for exactly five things: sheet/drawer slide, blind-to-revealed crossfade, vote confirmation, row expansion, layer cross-fade. Never on load, never on scroll, never on the matrix beyond a 90ms hover background. `MotionConfig reducedMotion="user"` and the CSS kill-switch carry over verbatim; reduced motion additionally makes the layer flip a hard swap.

---

## 5. The other surfaces

**`/arena` and `ArenaBattle.tsx` (431 lines) are deleted.** Blind is `?blind=1` on the bench: candidate heads mask name, version, duration, and locality; hues swap to neutral; the run `⋯` drawer is disabled; column order is shuffled once per document and persisted. Voting reveals identities in place with a 160ms crossfade. You never leave the page you were judging. `app/vote-store.ts` needs **no schema change** - it already records `permutation`, `candidateArtifactIds`, and `blind` correctly. Add `documentType` faceting and an optional `regionId` for row-level votes. `/arena` 308-redirects to `/`.

**Landing (`/`) becomes the empty bench.** Kill the `clamp(42px,6.2vw,72px)` hero, the 44px grid-paper background, the radial glow, the rotated decorative document, the three-step proof strip, and the 760px column. Full-bleed two-column at up to 1280px. Left 62%: a drop zone at `min-height: 58vh` with three real sample-document thumbnails under it. Right 38%: (a) **runner status** - `checkLocalRunner()` moves here from `Workspace.tsx:487`, so "Local runner offline, start it with `make runner-serve`" appears *before* a 50MB upload and a full-page `window.location.assign`; (b) **per-component availability** read from `extensions/*/component.json` (`spec.requirements.gpu` / `.network` / `.connection`, `spec.capabilities`) with image digests; (c) **standings, top 5** - arena-first means you see the answer before you upload; (d) recent benches with candidate chips. Headline is one 28px line. Navigation becomes a client-side transition, not `window.location.assign`.

**`/leaderboard` becomes `/standings`**, full width. Left 240px facet rail (document type, page-count band, has-tables, language, locality) because there is never one global score. Center: dense standings table, 48px rows, mono tabular win rate, battle count, tie share, a 120px win-rate bar. Right 360px: **vote ledger** of your recent verdicts with the page thumbnail, each row deep-linking back to `/documents/[id]?candidates=A,B&page=n` - a claim is one click from the evidence that produced it. The single-device-data disclosure stays, as a collapsed footer disclosure. The same component mounts as an `L` drawer over the bench so standings update while you vote.

**Run configuration: one surface, generated from the manifest.** `RunOptionsDialog.tsx` (622 lines, blocking modal, its own duplicate `values`/`invalidReason`/focus-trap, and two dead unreachable "Starting…" states) is deleted. What survives is `LocalParserSheet`'s dossier layout (engine, upstream version, adapter version, hardware, capability chips, image digest, license, upstream link) because options belong next to the provenance that explains them. It opens from a column head, gains real focus management, and its form is **generated from `spec.optionsSchema`** in the component manifest. The "Seat a candidate" menu filters catalog entries by `spec.accepts` / `spec.produces`, and a "needs connection" badge comes from `spec.requirements.connection`. Adding a component becomes a manifest entry with zero core edits, using data the repo already ships on disk today.

---

## 6. The eight defining interactions

**6.1 Seat a candidate (`A`, or click a dashed column head).** The head becomes an inline combobox of named profiles from the manifest. Picking one starts the run in that column immediately; other columns stay live and readable. `⌥`-select opens the dossier sheet with the schema-generated form first. **A completed column also offers `Run again` and `Fork with one change`** - the `executable()` guard at `Workspace.tsx:2714-2717` is deleted. A fork appends a new column labelled `A2 · Δ ocr:on`, ghosting the shared upstream state so you can see what was reused versus recomputed (Concept 4's best idea, without its pipeline metaphor). "Is OCR worth it on *this* document" becomes a one-click controlled comparison instead of an impossibility.

**6.2 Row alignment and the diff-only filter (`D`).** New `lib/align.ts`: greedy IoU matching (threshold 0.5) over per-page `SourceEvidenceRegion.bbox` values. Cheap because all geometry is already normalized `[0..1]` in one space. Unmatched blocks with geometry render as a row where the other cells read `── missed ──`; blocks with no geometry drop into an explicit collapsed `Unaligned (N)` bucket rather than being force-fit. `D` collapses the matrix to rows where candidates disagree (one missed it, block types differ, table dimensions differ, or normalized-text distance exceeds threshold). The foot bar always shows `24 rows · 21 aligned · 6 differ` so the filter's value is visible before you press it. Match confidence shows on hover; `U` breaks a row the matcher got wrong. An `Aligned / Free` toggle degrades to today's independent columns, because this algorithm can be wrong on multi-column layouts and merged cells and must never present itself as ground truth.

**6.3 Row focus drives everything.** `j`/`k` or hover or Tab. Focus draws the region at full strength on the spine, outlines the corresponding cell in every column, and pages the spine if needed. `Enter` pins. **`Esc` unpins and does nothing else** - the current handler at `Workspace.tsx:450-461` fires `clear-evidence` + close-picker + close-details together, so dismissing a sheet destroys a pin set ten minutes ago. **Paging preserves the pin**: `set-page` in `app/workspace-state.ts` stops nulling `pinnedEvidence`, and a pinned region on another page shows a `pinned on p.3 ↩` return chip.

**6.4 Row expansion is the inspector (`X`).** Source crop, bbox in points, confidence, reading order, and raw provider JSON at `jsonPointer`, per candidate, inside the aligned row. See §3.

**6.5 Focus mode and the layer flip (`F`, then `B`/`R`/`X`).** `F` collapses the matrix to a 96px agreement ribbon and gives the page about 1180px. In focus mode the three layers share pixel-identical coordinates with a 140ms cross-fade: **Boxes** (structure outlined on the scan, the always-on default everywhere), **Reading** (the raster fades out and the parser's own text is typeset into its own boxes, styled by block type), **X-ray** (both candidates' geometry over a dimmed page in their hues). Flipping B to R is the fastest correctness check in the product: a table that lost its columns is visibly narrower than the box it claims, and drift shows up as motion rather than as a number you have to interpret. **Reading mode requires focus mode** and is scoped: one measure-and-scale pass per block, cached by `(blockId, zoomBucket)`, overflow clipped with a visible indicator because "the text did not fit its own box" is diagnostic information, not a rendering bug. No binary-search typesetting engine. If Reading does not clear the quality bar, Boxes and X-ray ship without it and the design still stands.

**6.6 Coverage as geography.** In Boxes mode, every pixel of the page not claimed by any block is drawn as a dashed hatched region (rectangle subtraction over normalized bboxes, cheap). Geometry-less blocks stack in the `Unaligned` bucket with a count. The page ribbon's per-candidate coverage bars show the same ratio at document scale, so "pages 8-10 are where this parser fell apart" is visible before you scroll there. `%bbox` is promoted from a `<small>` inside a run chip to a first-class column-head statistic, because it is the most decision-relevant number the product computes.

**6.7 Blind and the verdict bar.** `1`/`2`/`3`/`4` vote A / B / tie / both-poor; `b` toggles blind. **Blind auto-arms only when a second candidate is seated and you have not yet voted on this document** - single-candidate inspection is never blinded, which removes the friction of blind-by-default without giving up the methodology stance. The bar states plainly whether the vote will count (only blind votes aggregate). Voting writes a real `BlindVote` with actual `candidateArtifactIds` and the displayed permutation, reveals identities in place over 160ms, and advances to the next page. `⌥1`/`⌥2` cast a row-level micro-vote carrying a `regionId`.

**6.8 Adding a candidate never steals your view.** A new run's column appears immediately with live stage events. When it completes, the layout **does not** swap: the `completedParsers.length >= 2` short-circuit at `Workspace.tsx:386/:390` is deleted. The new column simply becomes readable. A third candidate auto-collapses the spine only with a toast explaining why.

---

## 7. Migration

Ordered so that **user-visible value ships before any visual rewrite**. Phases 0-2 land on the current layout.

**P0 - unbreak (half a day, 2 files, ships alone).** Wrap the hand-written stylesheet in `@layer legacy` so Tailwind utilities stop losing, or move the base reset (`globals.css:129`) into `@layer base`. Replace all four focus rings with `2px solid var(--color-focus)` at full opacity. Raise the evidence box to `1.5px @ 0.55` with no element-opacity multiplier and swap the 6px region label for an 11px badge. Add `aria-valuenow/min/max` to the `role="separator"` divider. Three critical WCAG failures repaired in about 40 lines, and the leaderboard's invisible black button becomes legible.

**P1 - `lib/align.ts` (2-3 days, no redesign).** Pure, unit-testable IoU matching against the existing `tests/` suite, with the `Unaligned` bucket and a diff count. Wire it into **today's** two-column compare view plus a `D` filter. The current compare becomes genuinely useful before a single pixel of the new layout exists. This also de-risks the concept's one novel algorithm in isolation.

**P2 - real voting (3-4 days).** Move the vote into the existing compare view as a bottom bar over real runs; `saveVote` gets real artifact ids. Delete `app/ui/ArenaBattle.tsx` and `app/arena/`, redirect `/arena`. Discard the existing vote records (they describe hardcoded markup) and reset standings with a note. **The product's missing loop closes here, on the old design.**

**P3 - token layer (2-3 days).** New `@theme` block, delete the hand-written palette and the 12 dead `--chart-*`/`--sidebar-*` tokens, resolve the 35 duplicated selectors by keeping the later declaration, codemod the 54 hex literals / 33 font sizes / 22 radii / 89 paddings onto the scale. Override `button.tsx`'s `rounded-2xl` to 4px. `globals.css` drops to roughly 2,400 lines with no layout change; old class names keep working through one release of alias mappings.

**P4 - decompose the bench (1-2 weeks, the real work).** `Workspace.tsx` (3,005 lines) becomes a ~180-line route shell plus `bench/BenchShell.tsx`, `SourceSpine.tsx` (wraps `PdfSourceViewer` + `SourceEvidenceOverlay` unchanged), `PageRibbon.tsx` (rotated `PdfThumbnailRail` logic), `CandidateColumn.tsx` (absorbs `LocalParserSheet`, gains manifest-driven options), `Matrix.tsx` / `MatrixRow.tsx` / `RowExpansion.tsx`, `VerdictBar.tsx`. `workspace-state.ts` gains `candidates: CandidateSlot[]`, `alignMode`, `diffOnly`, `blind`, `focusedRow`, and loses the destructive `set-page` pin clearing and the bundled `Esc`. **Delete in this phase:** the `demo` fork (53 branches), `RunOptionsDialog.tsx` (622 lines), the 54px run dock, the 46px and 58px toolbars, per-block cards, the `executable()` re-run guard, the auto-swap to compare. Rows become real `<button>`s with `aria-pressed`. Add an `h1`. Introduce a virtualizer for the matrix (not currently a dependency).

**P5 - focus mode, layer flip, coverage geography (1 week).** `F`, Boxes/X-ray, dashed unclaimed regions, the ribbon's divergence hatch. Reading mode last, behind a quality gate, shippable-or-not without invalidating the design.

**P6 - surfaces and CSS burndown (1 week).** Rebuild `UploadLanding.tsx` as the empty bench with the runner probe hoisted from `Workspace.tsx:487`; rebuild `LeaderboardView.tsx` as `/standings` with the facet rail, dense table, and vote ledger, plus the `L` drawer. Then delete `globals.css` in order: landing/arena/leaderboard rules, workspace rules, legacy token block. **Target: 4,401 to about 230 lines.** `⌘K` command palette last, with the rule that every action it exposes also has a visible control.

**Net:** `app/globals.css` 4,401 to ~230. `app/ui/Workspace.tsx` 3,005 to ~180 plus eight focused components. `ArenaBattle.tsx` + `RunOptionsDialog.tsx` (1,053 lines) deleted. One route removed.

**Carried across untouched:** the `LocalParserRun` discriminated union and honest stage-event progress reducer with its "nothing is estimated" line; the remote-consent boundary with focus capture and restore; the bidirectional page-sync loop-breaker (`pageSyncSource`, extended to three participants); `PdfSourceViewer`'s layered error handling and detached-ArrayBuffer workaround; `PdfThumbnailRail`'s roving tabindex; `evidence-regions.ts`; `local-runner.ts`; `vote-store.ts`; the modal focus traps; `MotionConfig reducedMotion="user"`; the `prefers-contrast: more` branch; and provider-native honesty (native/merged toggle, per-page mapping status, rendered/raw).

---

## 8. What we deliberately do NOT do

1. **No marketing surface.** There is no page explaining what Document Arena is. The landing page is the empty bench with a runner probe and live standings. If acquisition ever matters, that is a separate site on a separate domain.
2. **No SVG tether.** Rejected on jank risk and redundancy with row alignment. See §3.
3. **No continuous multi-page scroll and no virtualized PDF canvases.** One page at a time stays. This preserves the react-pdf performance safety the current design has for free, and it is what makes the redesign tractable.
4. **No typesetting engine.** Reading mode is one cached measure-and-scale pass per block with honest clipping. No per-box binary-search font fitting, no RTL or vertical script support in v1.
5. **No pipeline DAG, no lanes, no horizontally scrolling rail.** All three shipped components declare `role: "parser"`; there is no chunker or embedder, so a pipeline metaphor would cost permanent chrome for artifacts that do not exist. We take the manifest-driven config and fork-a-run from that concept and leave the metaphor.
6. **No generic media-type viewer registry yet.** There is exactly one media type (`document-arena/parsed-document@v1alpha1`). The parsed-document view must be excellent, not pluggable.
7. **No positional-only candidate color.** Identity is keyed to the component and stable across sessions; blind mode is the only thing that neutralizes it.
8. **No mobile or tablet parity.** Below 900px the bench is a single-pane reviewer with compare and vote disabled and an explicit message. This is a cliff, not a bug, and it replaces the current 768-1100px overflow dead zone.
9. **No type below 11px, no font weight outside 400/500/600, no shadow used as structure, no `backdrop-filter`, no hex literal outside `@theme`.** Enforced by stylelint.
10. **No automatic view changes.** Completing a second run does not swap the layout. Seating a third candidate does not silently collapse the spine without telling you.
11. **No AI judge column and no revival of `/settings/connections`.** Connection state surfaces as a per-candidate badge from `spec.requirements.connection`, per the existing decision.
12. **No migration of existing votes.** They describe three hardcoded `<div>`s. Delete them and reset standings with a visible note.