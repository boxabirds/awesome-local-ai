# PRD

People create a new board from the home page, copy its hard-to-guess link with one click, and anyone opening the link joins the board without signing in. Unknown links show a clear Board not found page instead of a blank board.

## Problem

After stories 1–4, boards are live and saved, but there is no deliberate way to start one or bring people onto it.

Pain points:
1. **No clear starting point** — there is no "new board" action; boards only exist because someone happened to open an address.
2. **Inviting people is awkward** — users must copy the address bar by hand and are unsure which part matters.
3. **Guessable links are unsafe** — anyone who has a link can edit. If links were short or sequential, strangers could find and vandalise boards.
4. **Mistyped or broken links look like empty boards** — a person following a truncated link sees a blank board, assumes the work was deleted, and may start adding content to the wrong place while colleagues work elsewhere.
5. **Abuse** — without limits, one visitor could create unlimited boards and waste storage.

## Solution

- **No starting point → home page with Create a board.** One click creates a fresh board and opens it.
- **Awkward inviting → Share button.** A Share button on every board copies the board's link, with a clear confirmation; if copying is blocked by the browser, the link is shown ready to copy manually.
- **Guessable links → unguessable links.** Every board link contains a long random code that cannot practically be guessed or derived from another board's link. Anyone with the link can join and edit without signing in.
- **Broken links → Board not found page.** Links to boards that don't exist show a clear message and an offer to create a new board; nothing is created at a mistyped address.
- **Abuse → creation rate limit.** A visitor creating boards unusually fast is asked to wait.

## User Experience

### Golden path
1. Maya goes to the vidi6 home page. She sees the product name, one sentence ("A shared board for thinking together") and a prominent **Create a board** button.
2. She clicks it. The button shows "Creating…" briefly, then the new empty board opens (story 1 hint visible).
3. She clicks **Share** in the top-right corner. A small panel opens showing the board link in a read-only field and a **Copy link** button.
4. She clicks **Copy link**. The button changes to "Link copied" with a tick for 2 seconds.
5. She pastes the link into her team chat. Colleagues click it and land directly on the same board, able to edit immediately (stories 2–4).

### Structure
- **Home page:** product name, one-line description, Create a board button, space for an error message beneath the button.
- **Board page:** Share button (top-right). Share panel: read-only link field, Copy link button, note "Anyone with this link can view and edit this board."
- **Board not found page:** heading "Board not found", text "Check the link, or ask the person who shared it to send it again.", **Create a new board** button, link back to the home page.
- **Loading state (board page):** "Opening board…" while checking the link.

### Behaviour
- Clicking outside the Share panel or pressing Escape closes it.
- Clicking inside the link field selects the whole link.
- The copied link is the full address, ready to paste.
- Opening a board link never asks for sign-in.
- Boards that were already used at an address before this feature shipped keep working at that address.

### Alternate flows
- **Clipboard blocked by the browser:** Copy link selects the link text in the field and shows "Press Ctrl+C (Cmd+C on Mac) to copy".
- **Creation fails (service unavailable):** home page shows "Couldn't create a board. Please try again." under the button; the button becomes available again.
- **Creating too quickly:** after 10 boards within one minute from the same visitor, the home page shows "You're creating boards too quickly. Wait a minute and try again."
- **Link to a board that doesn't exist** (typo, truncated, made up): Board not found page.
- **Link check cannot reach the service:** "Couldn't reach vidi6. Retrying…" and automatic retry; the board opens when the service is reachable.
- **Empty state:** a newly created board is empty; story 1's hint is the empty state.

### Explicit non-behaviours
- Does not list a person's boards (story 15).
- Does not support view-only links, link expiry, or revoking a link.
- Does not require or offer sign-in (story 14).
- Does not send invitations by email.
- Does not create a board when someone opens an unknown link.
- Does not let anyone choose or rename a board's link.

## Create a board

> Anchor: `share.create`

WHEN a person clicks Create a board on the home page THE SYSTEM SHALL create a new empty board and open it within 2 seconds on a typical broadband connection.

## Open a shared link

> Anchor: `share.open_link`

WHEN a person opens the link of an existing board THE SYSTEM SHALL open that board with full editing ability without asking the person to sign in or take any other step.

## Copy the link

> Anchor: `share.copy`

WHEN a person clicks Copy link in the Share panel THE SYSTEM SHALL place the board's full link on the clipboard and show "Link copied" for 2 seconds.

Verification: after clicking, pasting into a new browser window's address bar opens the same board.

## Manual copy when clipboard is blocked

> Anchor: `share.copy_fallback`

IF the browser does not allow the link to be copied automatically THEN THE SYSTEM SHALL select the full link in the link field and show "Press Ctrl+C (Cmd+C on Mac) to copy".

## Links cannot be guessed

> Anchor: `share.unguessable`

THE SYSTEM SHALL give every board a link containing a random code of at least 128 bits of randomness, and THE SYSTEM SHALL NOT derive a board's link from its creation order, time, creator, or any other board's link.

Verification: 10,000 created boards have distinct codes, all of the required length, with no shared prefixes beyond what chance predicts.

## Links are never reused

> Anchor: `share.unique`

IF a newly generated link code is already used by an existing board THEN THE SYSTEM SHALL NOT give it to the new board; THE SYSTEM SHALL generate a different code instead.

## Board not found

> Anchor: `share.not_found`

WHEN a person opens a board link whose code does not belong to an existing board, or is not a valid code THE SYSTEM SHALL show the Board not found page with a Create a new board button, and THE SYSTEM SHALL NOT create a board at that link.

## Creation failure is explained

> Anchor: `share.create_failure`

IF creating a board fails THEN THE SYSTEM SHALL keep the person on the home page and show "Couldn't create a board. Please try again." with the Create a board button available again.

## Creation rate limit

> Anchor: `share.rate_limit`

IF a visitor tries to create more than 10 boards within one minute THEN THE SYSTEM SHALL NOT create the additional boards and SHALL show "You're creating boards too quickly. Wait a minute and try again."

## Service unreachable while opening a link

> Anchor: `share.unreachable`

WHILE the service cannot be reached when a person opens a board link THE SYSTEM SHALL show "Couldn't reach vidi6. Retrying…" and retry automatically, and WHEN the service becomes reachable THE SYSTEM SHALL open the board or show Board not found as appropriate without the person reloading.

## Existing boards keep working

> Anchor: `share.legacy_boards`

WHEN a person opens the address of a board that already has saved content from before this feature shipped THE SYSTEM SHALL open that board rather than showing Board not found.

## Constraints

- **Security model (interim, explicit):** possession of the link is the only access control. The Share panel must say so. This is acceptable until sign-in and permissions arrive (story 14).
- **Settings:** creation limit (10 per minute per visitor), "Link copied" duration (2 seconds) and link code strength (128 bits) are named product settings.
- **Links in chat apps:** links contain only characters that chat and email apps do not break or re-encode (letters, digits, hyphen, underscore).
- **Privacy:** board links must not be sent to third-party analytics or referrer headers from the board page.
- **Browsers:** same as story 1; clipboard fallback required because clipboard permission behaviour differs between browsers.

## Out of scope

- Sign-in, ownership, permissions, view-only access (story 14 and later).
- My boards list / dashboard, naming boards (story 15).
- Revoking or rotating a board's link.
- Email or in-app invitations.
- Board deletion.
- Link previews (unfurl images) in chat apps.

