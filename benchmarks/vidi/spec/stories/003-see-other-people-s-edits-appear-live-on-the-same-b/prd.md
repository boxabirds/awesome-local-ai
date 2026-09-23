# PRD

Everyone on the same board sees each other's sticky-note changes within a second, simultaneous edits merge without conflicts or lost typing, and connection problems are visible and self-healing.

## Problem

After story 2, a board lives only in one person's browser tab. Teams working remotely cannot think together on it.

Pain points:
1. **Working alone** — people in a workshop cannot see what others add, so they share screens or paste screenshots that are stale immediately.
2. **Overwriting each other** — in tools that save "last version wins", two people editing at once silently lose someone's work.
3. **Late joiners are lost** — someone joining halfway needs to see everything already on the board, not a blank page.
4. **Invisible connection problems** — on flaky Wi-Fi people keep working without realising nobody else sees their changes, then discover missing work later.
5. **Wrong expectations about scale** — without a stated capacity, a session might degrade unpredictably as people join.

## Solution

Everyone who opens the same board address works on the same live board.

- **Working alone → live changes.** Creating, moving, recolouring, typing on and deleting notes appear on everyone else's screen within about a second.
- **Overwriting → automatic merging.** When people change the same thing at once, nobody sees a conflict dialog and no typed text is dropped; every screen ends up showing the same result.
- **Late joiners → current board on arrival.** Opening a board shows everything currently on it.
- **Invisible problems → visible, self-healing connection.** A small status indicator shows when the connection is lost; the board keeps working locally and catches up automatically when the connection returns.
- **Scale expectations → stated capacity.** The board is designed and tested for up to 5 people editing at the same time. A 6th person is not turned away.

## User Experience

### Golden path
1. Alex opens a board address (e.g. from a chat message). The board loads and shows the notes already on it.
2. Sam opens the same address on another computer.
3. Alex creates a note and types "Pricing". Sam sees the note appear and the letters arrive as Alex types.
4. Sam drags that note to the right. Alex sees it move.
5. Both type into the same note at the same moment. Both see both people's words in the note; nothing typed disappears.
6. Alex's Wi-Fi drops. A small amber "Reconnecting…" badge appears at the top centre. Alex keeps moving notes.
7. Wi-Fi returns. The badge disappears after a brief green "Connected" confirmation. Sam now sees Alex's changes from while they were offline.

### Structure
- Connection status badge, top centre: hidden while connected normally; amber "Reconnecting…" while disconnected; green "Connected" for 2 seconds after a reconnection; "Connecting…" while first loading.
- No other visual changes; the board looks the same as in story 2.

### Behaviour
- Changes from others appear without any refresh or click.
- Other people's selections and editing state are not shown as data changes (no one else's selection outline appears on my screen — live cursors/presence come in story 6).
- If someone deletes a note while I am typing in it or dragging it, the note disappears for me too and my editing simply ends; there is no error message.
- If two people drag the same note at the same moment, the note may jump briefly, then settles in the same place on all screens.
- A 6th or later person can join and edit normally; the product does not block them, but speed is only guaranteed up to 5.

### Alternate flows
- **First load while offline / server unreachable:** board shows "Connecting…" and a blank board; the user can still create notes locally; they are sent when the connection succeeds.
- **Joining a board nobody is on and nothing has been saved:** the board is empty (saving arrives in story 4).
- **Connection lost while page stays open:** edits made during the outage are delivered when it reconnects.
- **Closing the tab while disconnected:** edits made during the outage are lost (protection for this arrives in story 13).
- **Server restarted during a session (e.g. update deployed):** people briefly see "Reconnecting…", then continue; no notes are lost as long as at least one person still has the board open.

### Explicit non-behaviours
- Does not show other people's cursors, names or avatars (story 6).
- Does not keep the board once everyone has left (story 4).
- Does not provide a way to create a new board or copy its link (story 5); in this story a board is reached by its address.
- Does not ask users to resolve conflicts.
- Does not require sign-in; anyone with the address can edit.
- Does not limit the number of people on a board.

## Changes reach everyone quickly

> Anchor: `live.propagate`

WHEN a person on a board creates, moves, recolours, deletes a sticky note or changes its text THE SYSTEM SHALL show that change on the screen of every other person connected to the same board within 1 second.

Verification: with two people connected on a normal broadband connection, each kind of change appears on the other screen in under 1 second.

## Late joiners see the current board

> Anchor: `live.join_state`

WHEN a person opens a board that other connected people are already editing THE SYSTEM SHALL show every note currently on that board, with its current text, colour and position.

Verification: two people add 20 notes; a third person opens the board and sees the same 20 notes with identical text, colours and positions.

## Simultaneous typing is merged

> Anchor: `live.concurrent_text`

WHEN two or more people type in the same sticky note at the same time THE SYSTEM SHALL keep every character each of them typed and show identical text on all their screens once typing stops.

Verification: Alex types "red " at the start while Sam types " blue" at the end of "green"; all screens show "red green blue".

## Simultaneous changes settle to one result

> Anchor: `live.converge`

WHEN two or more people change the same property of the same note at the same time (position or colour) THE SYSTEM SHALL show the same final value on every connected person's screen within 1 second of the last change.

## Deleting while someone else edits

> Anchor: `live.delete_during_edit`

WHEN a person deletes a note while another person is typing in or dragging that note THE SYSTEM SHALL remove the note from every screen and end the other person's typing or dragging without showing an error.

IF a note has been deleted THEN THE SYSTEM SHALL NOT bring it back because of changes someone else made to it at the same moment.

## Capacity: up to 5 simultaneous editors

> Anchor: `live.capacity`

WHILE up to 5 people (the product's configured simultaneous-editor setting) are connected to the same board and editing THE SYSTEM SHALL meet the 1 second change-delivery requirement for every one of them.

Verification: 5 people connected at once each make changes continuously for one minute; every change appears on all other 4 screens within 1 second and all 5 screens end identical.

## More than 5 people are not blocked

> Anchor: `live.over_capacity`

IF a person opens a board that already has 5 or more people connected THEN THE SYSTEM SHALL NOT refuse the connection or restrict that person's editing.

## Connection status is visible

> Anchor: `live.status`

WHILE the connection to the board is lost THE SYSTEM SHALL show a "Reconnecting…" indicator and keep the board fully editable, and WHEN the connection is restored THE SYSTEM SHALL show "Connected" for 2 seconds and then hide the indicator.

## Offline edits catch up while the page stays open

> Anchor: `live.catch_up`

WHEN the connection is restored after an interruption during which the page stayed open THE SYSTEM SHALL deliver every change made during the interruption to all other connected people and apply every change they made to this person's board.

Verification: disconnect Alex for 30 seconds; Alex and Sam each add 3 notes; on reconnect both screens show all 6 notes.

## Boards stay separate

> Anchor: `live.isolation`

IF people are connected to different boards THEN THE SYSTEM SHALL NOT show changes from one board on the other board.

## Selections stay personal

> Anchor: `live.local_selection`

IF a person selects a note or starts editing it THEN THE SYSTEM SHALL NOT change what is selected or being edited on anyone else's screen.

## Constraints

- **Capacity setting:** the simultaneous-editor capacity (5) is a single named product setting; changing it must not require redesign, and tests must use that setting rather than a hard-coded number.
- **Latency:** 1 second measured from the moment a change appears on the sender's screen to the moment it appears on a receiver's screen, on typical broadband (under 100 ms round trip to the service).
- **Resilience:** a service restart during a session must not lose notes while at least one person keeps the board open.
- **Security (interim):** anyone with a board address can view and edit it. Board addresses must be hard to guess once story 5 introduces board creation. No sign-in until story 14.
- **Browsers:** same as story 1.

## Out of scope

- Keeping boards after everyone leaves (story 4).
- Creating boards and share links (story 5).
- Cursors, names and presence (story 6).
- Guaranteed safety of offline edits across tab closure or reload (story 13).
- Enforcing a maximum number of people.
- Read-only viewers and permissions.
- Undo of other people's changes (story 8 covers undo of your own).

