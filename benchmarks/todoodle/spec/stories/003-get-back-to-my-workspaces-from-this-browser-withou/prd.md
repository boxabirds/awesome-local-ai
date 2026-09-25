# PRD

The browser remembers workspaces it has opened, so returning users land on a list instead of needing the link.

## Problem

With no accounts, the only way back into a workspace is its link. Most people will not bookmark it. People who use several workspaces (home, work, a shared shopping list) have to juggle several links. Without help, users will lose access on day two and churn.

## Solution

The browser remembers every workspace it has created or opened. Visiting the Todoodle home page in that browser shows 'Your workspaces' with each one's name, so returning is one click. Users can remove a workspace from this browser's list (e.g. on a shared computer) without affecting the workspace itself. The app is honest that this memory is per-browser and can be wiped by clearing site data — the saved link remains the real key.

## User Experience

**Golden path**
1. Returning visitor opens the Todoodle home page.
2. At the top is a large primary button "Continue to <most recently opened workspace>". The page does not jump there by itself; the visitor stays in control.
3. Below it, "Your workspaces on this browser" lists every remembered workspace by name, most recently opened first, each with when it was last opened. "Start a new list" becomes a secondary button beneath the list.
4. Clicking a name (or Continue) opens that workspace. Its name appears in the header instantly; tasks fill in as they load.
5. Inside a workspace, a switcher on the workspace name in the header lists the same remembered workspaces for quick switching.

**Structure**
- Home, returning visitor: Continue button, remembered list, secondary Start a new list.
- Home, first-time visitor: only Start a new list plus the hint "Have a link? Open it to get back in."
- Each list row: name, last-opened time, and a "..." menu with "Forget on this browser".
- Workspace-not-found page: if this browser remembers any workspaces, they are listed above "Start a new list" so a mistyped or cut-off link is not a dead end.

**Behaviour**
- While the list loads, grey placeholder rows show; Start a new list stays usable.
- On touch devices the "..." menu on each row is always visible (there is no hover), and every row, menu item and button is at least 44 by 44 points.
- Forget asks for confirmation: "This only removes it from this browser. Anyone with the link can still open it." If this browser has never copied or emailed that workspace's link, the same dialog also warns: "You haven't saved this link. If you forget it here, you may lose access." and offers a "Copy link" button. After copying, the warning changes to "Link copied" and the user can forget safely.
- Opening a workspace via a shared link automatically adds it to this browser's list.

**Alternate flows**
- First-time visitor or cleared browser data: no Continue button and no list; only Start a new list with the hint.
- A remembered workspace no longer resolves: shown greyed as "Unavailable" with a Remove action (no confirmation, nothing openable is lost). It is never offered by Continue.
- The list fails to load: "Couldn't load your workspaces" with Retry; Start a new list still works.
- Copying the link inside the forget dialog fails (clipboard blocked): the link text is shown pre-selected for manual copying.
- Forgetting the workspace currently open (from the switcher) returns the user to the home page.

**Non-behaviours**
- Does not sync the list across browsers or devices.
- Forgetting a workspace does not delete it or affect other people.
- Home never redirects automatically to a workspace.
- Private/incognito windows remember nothing after closing; the app does not try to work around that.

## Opening a workspace remembers it

> Anchor: `prd.remember_on_open`

WHEN a workspace is created or opened in a browser THE SYSTEM SHALL remember it for that browser.

## Home shows remembered workspaces

> Anchor: `prd.list_remembered`

WHILE a browser has remembered workspaces THE SYSTEM SHALL list them by name, most recently opened first, on the home page and in the in-workspace switcher.

## Forget a workspace on this browser

> Anchor: `prd.forget`

WHEN a user confirms forgetting a workspace THE SYSTEM SHALL remove it from that browser's list and SHALL NOT change the workspace or anyone else's access.

## Remembered links are not readable by page scripts

> Anchor: `prd.protected_memory`

THE SYSTEM SHALL store the browser's remembered workspace links such that they are sent only to Todoodle over secure connections and are not readable by scripts running in the page.

## Empty state guides the user

> Anchor: `prd.empty_home`

WHILE a browser has no remembered workspaces THE SYSTEM SHALL show only the option to start a new list and a hint that an existing link can be opened directly.

## Unavailable workspaces are shown, not opened

> Anchor: `prd.unavailable_entry`

IF a remembered workspace can no longer be opened THEN THE SYSTEM SHALL show it as unavailable with an option to remove it from this browser, and SHALL NOT offer to open it.

## Oldest workspace dropped at the limit, with notice

> Anchor: `prd.remembered_cap`

WHEN remembering a workspace would exceed the number of workspaces a browser can remember THE SYSTEM SHALL drop the least recently opened workspace from that browser's list and SHALL tell the user that the dropped workspace's link still works.

## Continue to the most recent workspace

> Anchor: `prd.continue_recent`

WHILE a browser remembers at least one available workspace THE SYSTEM SHALL show on the home page a prominent option to continue to the most recently opened available workspace, and SHALL NOT navigate there automatically.

## Warn before forgetting an unsaved link

> Anchor: `prd.forget_unsaved_warning`

WHEN a user starts forgetting a workspace whose link this browser has never copied or emailed THE SYSTEM SHALL warn in the confirmation that access may be lost and SHALL offer to copy the link from within that confirmation.

## Not-found page offers remembered workspaces

> Anchor: `prd.not_found_recovery`

WHEN the workspace-not-found page is shown in a browser that remembers workspaces THE SYSTEM SHALL list those workspaces above the option to start a new list.

## Workspace name appears instantly

> Anchor: `prd.instant_name`

WHEN a user opens a workspace from the remembered list, the Continue option or the switcher THE SYSTEM SHALL show that workspace's name immediately, without waiting for the workspace to finish loading.

## Usable on touch devices

> Anchor: `prd.touch_usable`

THE SYSTEM SHALL make every remembered-list, switcher and forget action reachable without hover, with each touch target at least 44 by 44 points.

## Loading and failure states for the list

> Anchor: `prd.list_loading`

WHILE the remembered list is loading or has failed to load THE SYSTEM SHALL show placeholder rows or a retry option respectively, and SHALL keep the option to start a new list usable.

## Out of scope

- Cross-device sync of the list
- Exporting/importing the list
- Pinning or reordering workspaces

## Constraints

- Browser storage limits apply; the app must support at least 20 remembered workspaces per browser and degrade gracefully (oldest dropped, user told) beyond its limit.
- Memory lasts at least one year of inactivity unless the user clears site data.

