# PRD

Boards are saved automatically and continuously; reopening a board after everyone has left, or after a service restart, shows it exactly as it was left. A board that cannot be loaded says so instead of pretending to be empty.

## Problem

After story 3, a board exists only while at least one person has it open. The moment the last person leaves, or the service restarts with nobody connected, the board is gone.

Pain points:
1. **Work vanishes** — a team finishes a workshop, closes their laptops, and the board is lost. This makes the product useless for anything beyond a single sitting.
2. **Asynchronous work is impossible** — people in different time zones add to a board over several days and never overlap.
3. **Fear of closing the tab** — if users don't trust that work is kept, they keep tabs open, take screenshots, or copy notes elsewhere.
4. **Save buttons are forgotten** — any manual save step will be skipped and cause losses.
5. **Silent data loss is worse than an error** — if a saved board fails to load and shows up empty, people assume their work was deleted, or start over on top of it.

## Solution

Boards are kept automatically.

- **Work vanishes → automatic saving.** Every change is kept without any action; a board looks the same the next time anyone opens it.
- **Asynchronous work → boards persist without anyone present.** A board survives everyone leaving and service restarts.
- **Fear of closing the tab → a clear guarantee.** Once a change has appeared on someone else's screen, it is saved.
- **Forgotten save buttons → no save button.** There is nothing to remember.
- **Silent loss → honest failure.** If a saved board cannot be loaded, users see a clear message and the product keeps trying, instead of showing a misleading empty board.

## User Experience

### Golden path
1. A team works on a board (stories 2–3) and everyone closes their browser.
2. The next morning Priya opens the same board address.
3. The board shows "Connecting…" briefly and then every note appears exactly as it was left: same text, colours, positions and stacking.
4. Priya adds a note and leaves. A colleague opens the board in the afternoon and sees Priya's note.

### Structure
- No new controls. There is no save button and no "saved" indicator.
- The connection badge from story 3 gains one new message: "This board couldn't be loaded. Retrying…" (red).

### Behaviour
- Saving happens continuously in the background as people edit.
- A board with no notes that was never edited opens as an empty board, exactly as before.
- A large board (up to 2,000 notes) opens and shows all its notes within 3 seconds on a typical broadband connection.
- Boards are kept indefinitely; there is no automatic expiry.

### Alternate flows
- **Everyone leaves immediately after a change:** the change is still there next time, provided it had appeared on another person's screen or the person who made it saw the board reconnect successfully.
- **Service restart while nobody is connected:** nothing is lost.
- **Service restart while people are connected:** people see "Reconnecting…" briefly (story 3) and continue; nothing is lost.
- **Saved board cannot be loaded:** the red message appears, the board stays empty and cannot be edited, and the product keeps retrying automatically. If loading succeeds later, the board appears and editing becomes available.
- **A single damaged change inside an otherwise healthy board:** the board opens with everything else intact; only that one change is missing.
- **Saving fails while people are editing (service-side problem):** people see "Reconnecting…"; their unsaved changes are kept in their open page and saved when the connection is re-established.

### Explicit non-behaviours
- Does not offer version history or restoring older versions of a board.
- Does not offer board deletion (later story).
- Does not show a "last saved" time.
- Does not save anything the person did while their connection was down if they close the tab before reconnecting (story 13).
- Does not save anyone's view position, selection or editing state.

## Board is intact after everyone leaves

> Anchor: `persist.reopen`

WHEN a person opens a board that nobody currently has open THE SYSTEM SHALL show every note that existed when the board was last edited, with identical text, colour, position and stacking order.

Verification: create 25 varied notes, close all browsers, wait 5 minutes, reopen; all 25 notes are identical.

## Anything others have seen is saved

> Anchor: `persist.seen_is_saved`

IF a change has appeared on another connected person's screen THEN THE SYSTEM SHALL NOT lose that change, even if every person leaves immediately afterwards or the service restarts immediately afterwards.

Verification: Sam sees Alex's new note appear; both close their browsers within one second and the service is restarted; on reopening, the note is there.

## Survives restarts with nobody connected

> Anchor: `persist.restart`

WHEN the service restarts while nobody has a board open THE SYSTEM SHALL show that board unchanged the next time anyone opens it.

## No save action required

> Anchor: `persist.automatic`

THE SYSTEM SHALL save every change to a board without any save button, prompt or other action by the person making the change.

## Large boards open quickly

> Anchor: `persist.large_board`

WHEN a person opens a saved board containing up to 2,000 notes THE SYSTEM SHALL show all of its notes within 3 seconds on a typical broadband connection.

Verification: a saved board with 2,000 notes of realistic text opens with all notes visible (after zooming out) within 3 seconds of navigating to its address.

## Honest message when a board cannot be loaded

> Anchor: `persist.load_failure`

IF a saved board cannot be loaded THEN THE SYSTEM SHALL NOT present it as an empty editable board; THE SYSTEM SHALL show "This board couldn't be loaded. Retrying…" and keep retrying automatically until it loads.

## One damaged change does not lose the board

> Anchor: `persist.partial_damage`

IF one saved change on a board is damaged and cannot be read THEN THE SYSTEM SHALL open the board with all other saved content intact.

## Saving problems do not lose open work

> Anchor: `persist.save_failure`

IF the service cannot save a change THEN THE SYSTEM SHALL NOT show that change to other people as if it were saved, and WHEN saving works again THE SYSTEM SHALL save the changes still held in each connected person's open page.

## Constraints

- **Retention:** boards are kept indefinitely until a deletion feature exists.
- **Scale settings:** the tested board size (2,000 notes) and the open-time target (3 seconds) are named product settings used by tests.
- **Cost:** idle boards (nobody connected) must not consume ongoing compute; storage cost only.
- **Compatibility:** boards created before this story shipped have no saved state and simply open empty; no migration is needed. The saved format must carry a version so future stories can migrate it.
- **Privacy (interim):** saved boards are readable by anyone with the address, as in story 3.

## Out of scope

- Version history, snapshots users can restore, or undo across sessions.
- Deleting or archiving boards.
- Export and backup (story 17).
- Offline edits surviving tab closure (story 13).
- Creating boards and share links (story 5).
- Boards larger than 2,000 notes (not prevented, but not tested or guaranteed).

