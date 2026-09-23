# PRD

Changes made without a connection are kept on the device, survive reloads, tab closure and browser restarts, and sync automatically when the connection returns. Boards opened before open offline. People always know whether their changes are safe, are warned and protected when the device cannot store changes, device copies are bounded without ever dropping unsynced work, and a device copy of a board that no longer exists on the service is never re-uploaded.

## Problem

Story 3 delivers edits made during a connection drop only while the page stays open. Real connections fail in ways that also close pages.

Pain points:
1. **Lost work on reload or closure** — a laptop sleeps on a train, the browser discards the background tab or the battery dies; every change made while offline is gone. People discover this hours later.
2. **No board without a connection** — opening a board on a plane shows only "Couldn't reach vidi6", even for the board the person worked on yesterday on the same laptop.
3. **False confidence** — "Reconnecting…" does not say whether changes are safe; people either stop working or keep working unaware of risk.
4. **Not knowing when it is safe to close** — after reconnecting, there is no signal that changes have actually reached everyone.
5. **Devices that cannot store anything** — private browsing, blocked site data or a full disk silently remove the safety net, exactly when people rely on it.
6. **Unbounded device storage** — keeping every board ever opened forever would fill disks on shared or small devices.
7. **Orphaned copies coming back** — a board that no longer exists on the service (removed, or a mistyped local environment reset) could be silently recreated from an old copy on someone's laptop, confusing everyone.
8. **Conflicting offline work** — two people (or two tabs) editing the same board offline must not overwrite each other when they reconnect.

## Solution

- **Lost work → device copy.** Every change is kept on the device the moment it is made, and survives reloads, tab closure and browser restarts.
- **No board offline → open from the device.** Boards opened before on this device open and stay editable without a connection.
- **False confidence → explicit status.** While offline the status says "Offline — changes saved on this device".
- **When is it safe → syncing status.** After reconnecting, "Syncing…" shows until the service has confirmed every change, then the status disappears.
- **Devices that cannot store → red warning and close protection.** People are told plainly that changes can't be saved on this device, and the browser asks before closing or reloading while changes are unsynced.
- **Unbounded storage → bounded copies.** Copies of the 50 most recently opened boards are kept; when space runs short, copies of other boards are cleared first — never a copy with unsynced changes.
- **Orphaned copies → read-only, never re-uploaded.** If the service says the board doesn't exist, the device copy is shown read-only with a clear banner and a way to discard it.
- **Conflicting offline work → automatic merge.** Offline changes from different people and tabs are combined on reconnection with nobody's changes lost, following the same merge behaviour as live editing (story 3).

## User Experience

### Golden path
1. Priya is editing a board on a train. Wi-Fi drops. Within 2 seconds the status badge (story 3 position, top centre) turns amber: "Offline — changes saved on this device".
2. She adds three notes and moves two others. She closes the laptop lid; later the browser discards the tab.
3. Still offline, she opens the board address from her history. The board appears within a second with her three new notes and moved notes, and the same amber status.
4. The connection returns. The status turns grey "Syncing…" and disappears once the service confirms all her changes. Colleagues see her changes; she sees theirs.

### Structure
- **Status badge states** (added to story 3/4 states):
  - Amber "Offline — changes saved on this device"
  - Grey "Syncing…"
  - Red "Offline — changes can't be saved on this device. Don't close this tab."
  - Red (connected but device cannot store) "Changes can't be saved on this device until they sync." shown only while changes are unsynced
- **Orphaned board banner** (top of board, full width): "This board no longer exists. You're viewing the copy saved on this device." with **Discard copy** button.
- **Discard confirmation** (only if the copy has unsynced changes): "Discard this copy? Your unsynced changes will be lost." with **Discard** and **Keep copy**.

### Behaviour
- Boards open from the device copy immediately, then connect; there is no blank loading board when a copy exists.
- Changes made while offline appear to other people after reconnection without any action.
- Up to 50 device copies (most recently opened) are kept; opening a 51st board removes the least recently opened copy that has no unsynced changes.
- When the device reports storage nearly full, copies of other boards without unsynced changes are cleared, oldest first.
- Closing or reloading a page with unsynced changes on a device that cannot store changes triggers the browser's own "Leave site?" confirmation. On devices that can store changes, closing is never blocked.
- In the orphaned state the board cannot be edited, and nothing is sent to the service.

### Alternate flows
- **Offline, board never opened on this device:** story 5's "Couldn't reach vidi6. Retrying…"; no empty editable board.
- **Private browsing or blocked site data:** red warning appears as soon as the person is offline or has unsynced changes; the board still works while the page stays open (story 3 behaviour).
- **Storage becomes full while offline:** the badge switches from amber to red; changes made from that point are protected only while the page is open.
- **Two tabs of the same board edited offline:** after reconnection both tabs and all other people show every change from both tabs.
- **Two people offline editing the same note text:** both people's typing is kept after reconnection (story 3 merge rules).
- **Someone deletes a note online while Priya edits it offline:** after reconnection the note is gone for everyone, including Priya (story 3 delete-wins rule).
- **Orphaned copy, person chooses Keep copy:** banner remains; the copy remains until discarded or evicted by limits (it has no way to sync).

### Explicit non-behaviours
- Does not create new boards while offline.
- Does not show how many changes are unsynced or which ones.
- Does not let people choose which boards are kept on the device.
- Does not clear device copies on sign-out (decided in story 14).
- Does not upload images added while offline (story 12).

## Offline changes survive reload, closure and restart

> Anchor: `offline.survive_reload`

WHEN a person reopens a board on the same device after reloading, closing the tab or restarting the browser while it had unsynced changes THE SYSTEM SHALL show those changes.

Verification: offline, add 3 notes, close the browser completely, reopen the board still offline; the 3 notes are present.

## Offline changes reach others after reconnection

> Anchor: `offline.sync_after_reopen`

WHEN the connection to the service becomes available after a person made changes offline, including changes from before a reload or tab closure, THE SYSTEM SHALL deliver all of those changes to every other person on the board and apply every change others made meanwhile to that person's board.

## Open previously used boards offline

> Anchor: `offline.open_offline`

WHEN a person opens a board that has a copy on this device while the service is unreachable THE SYSTEM SHALL show the device copy within 1 second and allow editing.

## No empty board without a device copy

> Anchor: `offline.no_copy_offline`

IF a person opens a board that has no copy on this device while the service is unreachable THEN THE SYSTEM SHALL NOT show an empty editable board, and THE SYSTEM SHALL show "Couldn't reach vidi6. Retrying…".

## Offline status

> Anchor: `offline.status_offline`

WHILE the connection is lost and the device can store changes THE SYSTEM SHALL show "Offline — changes saved on this device" within 2 seconds of the connection loss.

## Syncing status until confirmed

> Anchor: `offline.status_syncing`

WHILE connected with changes the service has not yet confirmed THE SYSTEM SHALL show "Syncing…", and WHEN the service has confirmed every change THE SYSTEM SHALL hide the status.

IF the service has not confirmed a change THEN THE SYSTEM SHALL NOT hide the status.

## Warning when the device cannot store changes

> Anchor: `offline.storage_unavailable`

IF the device cannot store board changes (site data blocked, private browsing without storage, or storage full) THEN THE SYSTEM SHALL show "Offline — changes can't be saved on this device. Don't close this tab." while offline, and "Changes can't be saved on this device until they sync." while connected with unsynced changes.

## Close protection when changes are at risk

> Anchor: `offline.leave_guard`

WHEN a person closes or reloads a page that has unsynced changes on a device that cannot store changes THE SYSTEM SHALL ask the browser to confirm leaving, and IF the device can store changes or there are no unsynced changes THEN THE SYSTEM SHALL NOT ask for confirmation.

## Bounded device copies

> Anchor: `offline.cache_limit`

THE SYSTEM SHALL keep device copies of at most the 50 most recently opened boards, and IF the least recently opened copy has unsynced changes THEN THE SYSTEM SHALL NOT remove it and SHALL remove the least recently opened copy without unsynced changes instead.

## Freeing space under storage pressure

> Anchor: `offline.storage_pressure`

WHEN the device reports storage use above 90% of its allowance THE SYSTEM SHALL remove device copies of boards other than the open one that have no unsynced changes, least recently opened first, until use falls below that level or no such copies remain.

## Orphaned copies are read-only and never re-uploaded

> Anchor: `offline.orphaned_copy`

WHEN the service reports that a board with a device copy does not exist THE SYSTEM SHALL show the device copy read-only with the "This board no longer exists" banner and a Discard copy button, and THE SYSTEM SHALL NOT send any part of the device copy to the service.

## Discard confirmation for unsynced copies

> Anchor: `offline.discard`

WHEN a person clicks Discard copy THE SYSTEM SHALL remove the device copy and show Board not found, and IF the copy has unsynced changes THEN THE SYSTEM SHALL NOT remove it until the person confirms "Discard this copy? Your unsynced changes will be lost."

## Offline work from several people and tabs merges

> Anchor: `offline.merge`

WHEN two or more people, or two or more tabs of the same board, made changes to the same board while offline THE SYSTEM SHALL, after they reconnect, show every one of those changes on every screen according to the live merge rules of story 3, without asking anyone to resolve conflicts.

## Constraints

- **Settings:** device copy limit (50), storage pressure level (90%), offline status delay (2 s), offline open time (1 s) are named product settings used by tests.
- **Privacy:** device copies contain full board content and remain readable to anyone with access to that browser profile; this matches the share-link access model and is stated in the privacy notes. Clearing on sign-out is decided in story 14.
- **Compatibility:** boards opened before this story shipped have no device copy until next opened online; no migration needed. The device copy format must carry a version.
- **Browsers:** same as story 1. Private browsing behaviour varies by browser and must degrade to the red warning rather than failing silently.
- **Performance:** opening a device copy of a board with 2,000 notes (story 4 tested size) must meet the 1 second offline open target on a mid-range laptop.
- **Service load:** confirmations of received changes must not noticeably increase traffic (at most one small confirmation per change message).

## Out of scope

- Creating or sharing boards while offline.
- Showing counts or lists of unsynced changes; per-change history.
- User control over which boards are stored on the device.
- Clearing device copies on sign-out (story 14).
- Offline image uploads (story 12) and offline comments beyond what the board document already carries (story 16).
- Installable app features (home-screen install, push notifications, background sync while no page is open).

Decision recorded: keeping the application itself available offline (so a board address opens after a full browser restart without a connection) is **in scope**, because requirement "Offline changes survive reload, closure and restart" cannot be met otherwise. It is limited to caching the application files of the current release.

