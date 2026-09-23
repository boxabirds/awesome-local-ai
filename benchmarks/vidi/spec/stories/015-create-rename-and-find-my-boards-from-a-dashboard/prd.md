# PRD

A My boards dashboard lists every board a person created or opened, most recently opened first, with search by title, a New board button and renaming. Titles are shown on the board and update live for everyone; anyone with the link can rename.

## Problem

Story 14 remembers boards per account but only shows the 10 most recent, all titled "Untitled board".

Pain points:
1. **Everything looks the same** — a list of identical "Untitled board" entries is useless once someone has more than two or three boards.
2. **Older boards are unreachable** — anything beyond the 10 most recent cannot be found without the original link.
3. **Finding a specific board is slow** — people remember a board as "the Q3 retro", not by when they last opened it.
4. **Boards have no name in the room** — when several boards are open in tabs, or a link is shared in chat, nobody can tell which board is which.
5. **Renaming must not become a permission fight** — boards have no owners (anyone with the link can edit), so restricting renaming to the creator would contradict how the product works and block teams when the creator is absent.
6. **Failures must not lose context** — a failed rename or a list that won't load should not leave people guessing what happened.

## Solution

- **Identical entries → board titles.** Every board has a title that anyone on the board can change; new boards start as "Untitled board".
- **Unreachable boards → full My boards list.** A dashboard lists every board the person created or opened, most recently opened first, loading more as they go.
- **Slow finding → search.** Typing in a search box narrows the list to boards whose titles contain the text.
- **No name in the room → title on the board.** The title is shown at the top of the board and in the browser tab, and changes appear for everyone on the board straight away.
- **Permission fights → anyone with the link can rename.** Consistent with editing, renaming needs no sign-in and no ownership. This is an explicit product decision.
- **Failures → clear messages.** Failed renames keep the previous title with an explanation; lists that fail to load offer a retry.
- **Signed-out visitors → boards on this browser.** Without sign-in, the dashboard shows boards opened in this browser and invites sign-in to see them everywhere.

## User Experience

### Golden path
1. Priya (signed in) clicks **My boards** in the top bar or "See all boards" under Your recent boards on the home page.
2. The dashboard shows a **New board** button, a **Search boards** box, and a list of boards: title, "Opened 3 days ago", and a "Created by you" label where applicable.
3. She types "retro". Within a moment the list shows only "Q3 retro" and "Retro – onboarding squad".
4. She opens "Q3 retro". The title "Q3 retro" is shown top-left on the board and in the browser tab.
5. She clicks the title, changes it to "Q3 retro – actions", and presses Enter. Everyone else on the board sees the new title within a second.
6. Back on the dashboard, the board appears first with its new title.

### Structure
- **Top bar (every page):** My boards link (next to the account menu from story 14).
- **Dashboard (`My boards`):** heading, New board button, search box, board list, Show more button when more boards exist.
- **Board row:** title (link), last opened relative time, "Created by you" label, ⋯ menu with **Rename**.
- **Board page:** title at top-left; clicking it turns it into a text field.

### Behaviour
- The list is sorted by when the person last opened each board, newest first; 50 boards load at a time with **Show more** for the rest.
- Search matches any part of the title, ignoring upper/lower case, and updates as the person types (after a short pause); clearing the search restores the full list.
- Renaming on the board: Enter or clicking away saves; Escape cancels and restores the previous title.
- Renaming from the dashboard opens a small dialog with the current title selected, Save and Cancel.
- Titles are 1–100 characters; leading and trailing spaces are removed.
- New board creates a board titled "Untitled board" and opens it.
- Renaming is available to anyone on the board, signed in or not.

### Alternate flows
- **Empty state (signed in, no boards):** "No boards yet" with a New board button.
- **No search results:** "No boards match “xyz”" with a Clear search link.
- **Signed out:** the dashboard shows "On this browser" boards (opened here while signed out) with titles, plus "Sign in to see your boards on every device" and the Sign in with Google button; if there are none, "Boards you open will appear here."
- **List fails to load:** "Couldn't load your boards." with **Retry**; New board still works.
- **Rename fails** (service error or too many renames): previous title restored with "Couldn't rename the board. Please try again."
- **Empty or too-long title:** "Titles need 1–100 characters."; the field stays open.
- **Offline on a board:** the title can't be edited; hovering shows "Renaming needs a connection."

### Explicit non-behaviours
- Does not delete boards or remove them from the list (see Out of scope).
- Does not restrict renaming to the creator or to signed-in people.
- Does not search board contents (notes, text), only titles.
- Does not offer folders, favourites, sorting options or thumbnails.
- Does not include renames in undo/redo.

## List of my boards

> Anchor: `dash.list`

WHEN a signed-in person opens My boards THE SYSTEM SHALL list every board they created or opened, most recently opened first, each showing its title, when they last opened it, and "Created by you" if they created it, within 2 seconds on a typical broadband connection.

## Long lists load in pages

> Anchor: `dash.paginate`

WHILE a person has more than 50 boards in the list THE SYSTEM SHALL show the first 50 and a Show more button, and WHEN Show more is clicked THE SYSTEM SHALL append the next 50 in the same order without duplicates or gaps.

## Empty dashboard

> Anchor: `dash.empty`

WHEN a signed-in person with no boards opens My boards THE SYSTEM SHALL show "No boards yet" with a New board button.

## New board from the dashboard

> Anchor: `dash.create`

WHEN a person clicks New board on My boards THE SYSTEM SHALL create a board titled "Untitled board", open it, and include it at the top of their list the next time My boards loads.

## Rename on the board

> Anchor: `dash.rename_on_board`

WHEN a person edits the title on a board page and presses Enter or clicks away THE SYSTEM SHALL save the new title, and WHEN they press Escape THE SYSTEM SHALL restore the previous title without saving.

## Rename from the dashboard

> Anchor: `dash.rename_from_dashboard`

WHEN a person chooses Rename for a board on My boards and saves a new title THE SYSTEM SHALL save it and show the new title in that row immediately.

## Anyone with the link can rename

> Anchor: `dash.rename_anyone`

IF a person is not signed in or did not create the board THEN THE SYSTEM SHALL NOT prevent them from renaming a board they have opened through its link.

## Title rules

> Anchor: `dash.title_rules`

IF a new title is empty or longer than 100 characters after removing leading and trailing spaces THEN THE SYSTEM SHALL NOT save it and SHALL show "Titles need 1–100 characters." with the field still open.

## Title changes appear live

> Anchor: `dash.title_live`

WHEN a board's title is changed THE SYSTEM SHALL show the new title to every person currently on that board within 1 second, and WHEN two people rename the same board close together THE SYSTEM SHALL show the same final title to everyone, both on the board and on My boards.

## Title shown on the board and tab

> Anchor: `dash.title_shown`

THE SYSTEM SHALL show a board's current title at the top-left of the board page and as the browser tab title ("<title> – vidi6").

## Search by title

> Anchor: `dash.search`

WHEN a person types in Search boards THE SYSTEM SHALL show, within 1 second of them pausing, only boards from their list whose titles contain the typed text, ignoring upper and lower case, in the same most-recently-opened order.

## No search results

> Anchor: `dash.search_no_results`

WHEN a search matches no boards THE SYSTEM SHALL show "No boards match “<text>”" with a Clear search link that restores the full list.

## Signed-out dashboard

> Anchor: `dash.signed_out`

WHILE a person is not signed in THE SYSTEM SHALL show on My boards the boards opened in this browser with their current titles, and an invitation to sign in to see boards on every device.

## List load failure

> Anchor: `dash.load_failure`

IF the board list cannot be loaded THEN THE SYSTEM SHALL show "Couldn't load your boards." with a Retry button and keep New board available.

## Rename failure

> Anchor: `dash.rename_failure`

IF a rename cannot be saved (service error, too many renames, or no connection) THEN THE SYSTEM SHALL NOT show the new title as saved; THE SYSTEM SHALL restore the previous title and show "Couldn't rename the board. Please try again.", and WHILE a board page has no connection THE SYSTEM SHALL prevent title editing and explain "Renaming needs a connection."

## Constraints

- **Settings:** page size (50), title length (1–100), search pause (250 ms), list load target (2 seconds), live title target (1 second), renames per visitor per minute (30) and boards looked up for the signed-out view (50) are named product settings.
- **Access model:** renaming follows story 5's model — possession of the link is the only access control; repeated renames from one visitor are rate limited to limit vandalism.
- **Consistency:** the dashboard and the board must agree on the final title after concurrent renames.
- **Privacy:** the list shows only the person's own boards; other people's visits are never revealed.
- **International text:** case-insensitive search must work for non-English letters (e.g. "Équipe" matches "équipe").
- **Compatibility:** boards created before this story show "Untitled board" until renamed.

## Out of scope

- **Deleting boards or removing them from My boards.** Flagged for product review: lists will accumulate boards opened once from shared links; a "Remove from my boards" action is likely needed soon but is not added here.
- Searching board contents; tags, folders, favourites, sort options, thumbnails.
- Rename history or undoing a rename.
- Ownership or permission to restrict renaming.
- Showing who renamed a board.

