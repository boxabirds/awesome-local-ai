# PRD

People export the whole board, the current view or a selection as a PNG or single-page PDF, produced entirely in their browser, with images and text faithfully drawn, clear handling of very large areas, missing images, browser failures and cancellation, and without affecting the board.

## Problem

The results of a board session need to leave the board: into slide decks, documents, tickets, wikis and emails, and into the hands of people who never open vidi6.

Pain points:
1. **Screenshots are the only option** — they capture only what fits on screen, at screen resolution, and need several attempts to frame.
2. **Screenshots are noisy** — they include the dot grid, toolbars, other people's cursors, selection outlines and comment markers.
3. **Big boards don't fit** — a workshop board is far larger than any screen; zooming out enough to screenshot it makes text unreadable.
4. **Different destinations need different formats** — slides want an image; documents and printing want a PDF.
5. **Silent failure is costly** — an export that quietly drops images or crashes on a huge board is discovered only when someone presents it.

## Solution

- **Screenshots only → an Export dialog.** Choose what to export (whole board, current view, or selection) and how (PNG or PDF).
- **Noise → clean output.** Exports contain only board items on a white background.
- **Big boards → resolution control and honest limits.** PNG exports at 1× or 2× resolution. If the result would exceed the maximum image size, resolution is reduced automatically and the person is told; if even the lowest readable resolution is too large, the person is told to export a view or selection instead.
- **Formats → PNG and PDF.** Both look the same; PDF is a single page.
- **Silent failure → visible outcomes.** Missing images become labelled placeholders with a warning; browser failures show an error; long exports show progress and can be cancelled.

## User Experience

### Golden path
1. Ana clicks **Export** in the top-right bar (next to Share).
2. The Export dialog opens with: **Format** (PNG selected, PDF), **Area** (Whole board selected, Current view, Selection — disabled with hint "Select items first" when nothing is selected), **Resolution** (1×, 2× selected; shown for PNG only) and a size hint ("About 4,820 × 3,260 pixels").
3. Ana clicks **Export**. The dialog shows "Preparing export…" with a progress bar and **Cancel**.
4. The browser downloads `Q3 planning-2026-09-17.png` (or `vidi6-board-2026-09-17.png` for boards without a name). The dialog closes.

### Structure
- Top bar: Export button (icon + "Export").
- Export dialog: Format radio group, Area radio group, Resolution radio group (PNG only), size hint, notice area, Export and Close buttons; during export: progress bar and Cancel.

### Behaviour
- Whole board = all items plus a small margin. Current view = exactly what is visible in the board area. Selection = the selected items plus a small margin.
- 2× produces an image twice as wide and twice as tall as 1×.
- PDF uses the same rendering and produces a single page sized to the exported area's proportions.
- Items appear with their on-screen colours, text, positions and stacking; the dot grid, cursors, selection outlines, comment markers and toolbars never appear.
- The board stays usable while exporting; other people see no change.

### Alternate flows
- **Empty area:** "Nothing to export — this area is empty." Export button disabled; no download.
- **Too large at chosen resolution:** export proceeds at reduced resolution; after download the dialog shows "Reduced to 63% to fit the maximum image size." and stays open.
- **Too large even at minimum readable resolution:** "This board is too large to export. Export the current view or a selection instead." No download.
- **Image couldn't be loaded** (offline, deleted asset, slow network): a grey placeholder with an image icon and "Image unavailable" is drawn; after download: "2 images couldn't be included."
- **Browser can't create the file:** "Export failed: your browser couldn't create a file this large. Try Current view or 1×." Dialog stays open; nothing downloads.
- **Cancel during export:** progress stops, nothing downloads, dialog returns to options.
- **Selection changes while the dialog is open:** Selection area uses the selection at the moment Export is clicked.
- **Offline:** export works; images not already available become placeholders.

### Explicit non-behaviours
- Text in PDFs is not selectable or searchable (the page is a picture of the board).
- No multi-page PDFs, SVG export, transparent backgrounds or custom sizes.
- Comments, cursors and selection outlines are never exported.
- Exporting never modifies the board, the view or anyone else's screen.

## Open export options

> Anchor: `export.open`

WHEN a person clicks Export THE SYSTEM SHALL open the Export dialog offering Format (PNG, PDF), Area (Whole board, Current view, Selection) and, for PNG, Resolution (1×, 2×), with PNG, Whole board and 2× preselected and the expected pixel size shown.

## PNG export

> Anchor: `export.png`

WHEN a person exports as PNG THE SYSTEM SHALL download a PNG image of the chosen area on a white background.

Verification: exporting a board with 10 items produces a PNG file that opens in an image viewer and shows all 10 items.

## PDF export

> Anchor: `export.pdf`

WHEN a person exports as PDF THE SYSTEM SHALL download a single-page PDF whose page shows the chosen area with the same appearance and proportions as the PNG export.

## Whole board area

> Anchor: `export.area_whole`

WHEN a person exports the Whole board THE SYSTEM SHALL include every item on the board plus a margin of 40 board units on each side, regardless of the current view.

## Current view area

> Anchor: `export.area_view`

WHEN a person exports the Current view THE SYSTEM SHALL include exactly the part of the board visible in the board area at that moment, cutting through items at its edges.

## Selection area

> Anchor: `export.area_selection`

WHEN a person exports the Selection THE SYSTEM SHALL include the selected items plus a 40-unit margin and SHALL NOT draw unselected items, and IF nothing is selected THEN THE SYSTEM SHALL NOT offer the Selection option.

## Resolution

> Anchor: `export.scale`

WHEN a person exports PNG at 2× THE SYSTEM SHALL produce an image with twice the width and twice the height of the 1× export of the same area, where 1× is one pixel per board unit.

## Faithful drawing

> Anchor: `export.fidelity`

THE SYSTEM SHALL draw sticky notes, text, shapes, connectors, pen strokes and images in the export with the same colours, text content, line breaks, positions, sizes and stacking order as on screen at 100% zoom.

Verification: sampled pixel colours at the centre of each item match on-screen colours; overlapping items appear in the same order.

## Nothing but board items

> Anchor: `export.excludes`

IF the board has a dot grid, other people's cursors, a selection outline or comment markers on screen THEN THE SYSTEM SHALL NOT draw any of them in the export.

## Missing images

> Anchor: `export.images`

IF an image on the board cannot be loaded within 15 seconds during export THEN THE SYSTEM SHALL NOT fail the export; THE SYSTEM SHALL draw a labelled placeholder in its place and report how many images were not included.

## Automatic resolution reduction

> Anchor: `export.large_reduce`

IF the chosen area at the chosen resolution would exceed 8,192 pixels on either side or the maximum image area THEN THE SYSTEM SHALL export at the largest resolution that fits and SHALL tell the person the percentage of the chosen resolution used.

## Too large to export

> Anchor: `export.too_large`

IF fitting the chosen area would require less than 25% of 1× resolution THEN THE SYSTEM SHALL NOT export and SHALL show "This board is too large to export. Export the current view or a selection instead."

## Empty area

> Anchor: `export.empty`

IF the chosen area contains no items THEN THE SYSTEM SHALL NOT download a file and SHALL show "Nothing to export — this area is empty."

## Browser failure

> Anchor: `export.browser_failure`

IF the browser cannot create the image or PDF THEN THE SYSTEM SHALL show "Export failed: your browser couldn't create a file this large. Try Current view or 1×.", keep the dialog open and download nothing.

## Progress and cancel

> Anchor: `export.cancel`

WHILE an export is being prepared THE SYSTEM SHALL show progress and a Cancel button, and WHEN the person clicks Cancel THE SYSTEM SHALL stop and SHALL NOT download a file.

## File name

> Anchor: `export.filename`

THE SYSTEM SHALL name the downloaded file "<board name>-<YYYY-MM-DD>.png" or ".pdf" using the local date, using "vidi6-board" when the board has no name and replacing characters not allowed in file names with "-".

## Export changes nothing

> Anchor: `export.read_only`

IF a person exports THEN THE SYSTEM SHALL NOT change the board's content, the person's view or selection, or anything other people see.

## Works offline

> Anchor: `export.offline`

WHILE the person has no connection THE SYSTEM SHALL still export the board, drawing placeholders for images that cannot be loaded.

## Constraints

- **Client-side only:** exports are produced in the person's browser; no board content is sent to a server for export.
- **Named product settings:** resolutions (1×, 2×), default resolution (2×), maximum side (8,192 px), maximum image area, minimum readable resolution (25% of 1×), margin (40 units), image load timeout (15 s).
- **Performance:** a board of 500 mixed items exports as a 2× PNG within 10 seconds on a mid-range laptop (named tested size and budget; checked by a scripted run).
- **Fonts:** text in exports uses the same fonts as the board; export waits until those fonts are available.
- **Browsers:** same as story 1. Maximum image sizes are chosen conservatively so they work in all supported browsers.
- **Accessibility:** the dialog is keyboard operable; progress and outcome messages are announced.

## Out of scope

- Vector PDF or selectable/searchable text in PDF.
- Multi-page or tiled PDF, custom page sizes, print layouts.
- SVG, JPEG or transparent-background exports.
- Exporting comments, cursors or selection outlines.
- Server-side or scheduled export, sharing an export by link.
- Exporting boards larger than the minimum-resolution limit (people export views or selections instead).

