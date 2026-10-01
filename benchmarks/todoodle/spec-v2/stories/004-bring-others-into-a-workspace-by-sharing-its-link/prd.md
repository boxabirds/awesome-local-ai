# PRD

Sharing the workspace link is how you collaborate; everyone with it sees the same tasks and others' changes.

## Problem

Shared lists (household chores, a trip, a small team's to-dos) are a core reason people use Todoist. Normally that needs invitations, accounts, and permissions. Without accounts we need a collaboration model that is just as simple as creating a workspace, and people need to see each other's changes without confusion or lost edits.

## Solution

The workspace link doubles as the invitation. The single Share action copies the link and reminds the user that it is the key: the recipient gets full edit access. Anyone who opens it lands in the same workspace, and the workspace is remembered in their browser. Everyone sees the same projects and tasks, and changes made by others appear without a manual reload. When two people edit the same thing at once, nobody's work is silently discarded: the person whose edit was replaced chooses whose version to keep. A brief interruption of live updates never stops people working. Editing pauses only when changes genuinely can't be saved, and typed text is kept.

## User Experience

**Golden path**
1. In a workspace, the user clicks **Share** in the header. There is one Share button; the first-run "Save your link" panel from story 2 is this same panel opened automatically.
2. The panel shows the link, a **Copy link** button, the line "This link is the key to this workspace — for you and anyone you send it to.", and the shared access note (constant `SHARE_ACCESS_NOTE`, owned by story 2). Until story 9 ships the note reads "Anyone with it can see and change everything. Access can't be removed yet."; story 9 replaces it with "Anyone with it can see and change everything. To cut off access, get a new link." (Email-to-me and Bookmark actions come from story 2.)
3. The user sends the link to a friend by any means they like.
4. The friend opens the link and is immediately in the workspace, with no prompts and no sign-up. It appears in the friend's remembered workspaces.
5. When the friend adds or completes a task, the original user sees it appear within a few seconds without reloading. Screen-reader users hear a polite summary such as "2 changes made by someone else", at most once every 10 seconds, without interrupting what they are doing.

**Alternate flows**
- **Two people edit the same thing at the same moment:** the later save wins on the server. The person whose edit was replaced sees a notice naming what changed, e.g. "Someone else changed this task just now." (or "…this project…", "…this workspace…"). It shows the other person's value and offers **Use my version**, which saves their own text again, and **Keep theirs**. The notice stays until they choose or close the editor; closing counts as Keep theirs. Their own text is never discarded without their choice.
- **Someone deletes a task another person is editing:** the editor sees "This task was deleted" and the edit is not applied.
- **Live updates drop but saving still works** (laptop wakes, phone changes network, or the server asks the browser to wait because too many connections are being made): a small "Reconnecting…" pill appears after a few seconds. **Editing stays available**, and saves work as normal. When live updates resume, the view refreshes and the pill disappears.
- **Live access is refused while the workspace is open:** if the workspace can no longer be found with this browser's link, live updates stop for good and the Not Found page is shown. If the link has been changed (story 9), the "link changed" page is shown instead. Nothing retries in a loop.
- **Todoodle can't be reached for saving** (a save fails with a network error, or the device reports it's offline): the banner "You're offline — changes can't be saved right now" appears and every change is disabled — creating, editing, completing, deleting, moving, rescheduling, Undo, getting a new link. Anything already typed into an open field stays there (quick add stays typeable; only its submit is disabled).
  - **Still works offline:** moving between views, the sidebar, the workspace switcher and the Home list; the Share panel's Copy link, Email and Bookmark; Finder matches; the "Show completed" toggle; opening a task's details read-only; discarding a failed local task; the `?` shortcuts panel.
  - When the connection returns, the banner disappears, editing re-enables, and the view refreshes.

**Non-behaviours**
- No names, avatars, or presence indicators for collaborators, because no identities exist.
- No per-person permissions; view-only links are out of scope.
- No notifications outside the app.
- No offline editing queue: edits made while offline are not stored for later.

## Share action explains consequences

> Anchor: `prd.share_panel`

WHEN a user opens the share action THE SYSTEM SHALL show the workspace link, a "Copy link" action, and the shared access note stating that anyone with the link has full edit access and whether that access can be removed (until story 9 ships: it cannot; after story 9: by getting a new link).

## Opening a shared link joins instantly

> Anchor: `prd.join_via_link`

WHEN someone opens a valid workspace link THE SYSTEM SHALL show that workspace with full edit ability and no further prompts.

## Others' changes appear without reload

> Anchor: `prd.live_updates`

WHILE two or more people have the same workspace open WHEN one of them changes a project or task THE SYSTEM SHALL show the change to the others within 5 seconds without a manual reload.

## Screen-reader users hear about others' changes

> Anchor: `prd.announce_remote`

WHEN changes made by other people appear THE SYSTEM SHALL announce them to assistive technology politely, as a grouped summary, at most once every 10 seconds.

## Concurrent edits are never silently lost

> Anchor: `prd.conflict_notice`

IF a user's edit is overwritten or invalidated by another person's concurrent change THEN THE SYSTEM SHALL tell that user, naming what was changed (for example "Someone else changed this task just now."), and show the current state.

## User chooses whose version to keep

> Anchor: `prd.conflict_choice`

WHEN a user's edit has been replaced by another person's concurrent change THE SYSTEM SHALL keep the user's own version available until the user chooses either to save their version again or to keep the other person's version.

## Offline is visible and edits are held back

> Anchor: `prd.offline_indicator`

WHILE Todoodle cannot be reached to save changes THE SYSTEM SHALL show an offline indicator, SHALL NOT accept edits that cannot be saved, SHALL keep any text the user has already typed into open fields, and SHALL keep navigation, sharing the link and read-only viewing available.

## Interrupted live updates don't stop work

> Anchor: `prd.live_paused`

WHILE live updates are interrupted but changes can still be saved THE SYSTEM SHALL show a reconnecting indicator and SHALL keep editing available.

## Only link holders receive live changes

> Anchor: `prd.live_access`

IF a browser has not opened a workspace with its valid link THEN THE SYSTEM SHALL NOT deliver that workspace's live changes to it, SHALL NOT reveal whether the workspace exists, and SHALL stop attempting to connect.

## Out of scope

- Revoking access / rotating the link: provided by story 9 ("Get a new link"). Story 4 only reserves the live close code 4410 and hands it to the link-changed page.
- View-only links
- Collaborator identity, presence, assignment, comments, activity history
- Offline editing with later sync

## Constraints

- At least 10 simultaneous people in one workspace must work smoothly.
- Live updates must not require the user to keep a tab focused.

