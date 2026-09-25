# PRD

One click creates a workspace whose secret link is the only key. No accounts.

## Problem

Todo apps demand sign-up before you can write a single task. For someone who wants to jot down five things right now, an account, a password, and an email confirmation are friction that loses them. People also don't want to hand over an email address just to keep a list.

## Solution

A visitor presses one button and is immediately inside a new, empty workspace. The workspace's address is a long secret link that is the only way in. The app tells them plainly — once, prominently, and in a way they must acknowledge — that this link is the key: save it or lose access, and anyone they give it to gets full access. A one-click copy action makes saving easy.

## User Experience

**Golden path**
1. Visitor lands on the Todoodle home page: product name, one-line pitch, a primary 'Start a new list' button.
2. They press it. Within a second they are in a new workspace named 'My Todoodle' with an empty Inbox.
3. The **Save your link** panel opens over the workspace. It shows:
   - the full link in a read-only field;
   - the message: 'This link is the key to this workspace — for you and anyone you send it to. It's the only way back in: if you lose it, you lose access. Anyone with it can see and change everything. Access can't be removed yet.';
   - a primary button **Copy link & continue**, which copies the link and closes the panel in one click;
   - **Email it to me**, which opens the visitor's own mail app with the link already in a new message;
   - **Bookmark this page**, which shows the keyboard shortcut for the visitor's device (⌘D on Mac, Ctrl+D elsewhere);
   - a quieter **Skip for now** button.
4. After copying or emailing, the panel is closed and the workspace is ready to use.
5. The workspace header always shows a **Share** button that reopens the same panel titled 'Share'. In Share mode the primary button is 'Copy link' (shows 'Copied' and leaves the panel open) and the secondary is 'Done'. There is no separate 'Link' button: saving the link for yourself and sharing it with others is the same thing.

**Unsaved-link reminder**
- Until this browser has copied or emailed a workspace's link at least once, a slim banner sits under the header: 'Your link isn't saved yet — you'll lose access if you clear this browser.' with a **Copy link** button and a **Remind me later** button.
- Copying (from the banner or the panel) or emailing hides the banner for good in this browser. 'Remind me later' hides it until the next visit.

**Loading and failure**
- While a workspace is loading, the header, sidebar and list show grey placeholder shapes in their final positions (no blank page, no lone spinner). If the name is already known (just created), it shows immediately.
- If loading fails for a reason other than 'not found' (network, server error), the page says 'Couldn't load this workspace.' with a **Try again** button.

**Alternate flows**
- Workspace creation fails (network/server): the home page shows 'Couldn't create your list — try again' and the button remains usable; no half-created workspace is shown.
- Visitor opens a link that doesn't match any workspace (typo, truncated, or never existed): a 'Workspace not found' page with the tip 'Links are long — check it wasn't cut off when it was copied.' and a 'Start a new list' button. The page does not reveal whether a similar link exists. (Story 3 adds this browser's remembered workspaces to this page.)
- Clipboard access denied by the browser: the link text is pre-selected so the user can copy manually; copying it by hand also counts as saved.
- Visitor renames the workspace from the header (inline edit). If they leave the name empty, the previous name comes back and 'Name can't be empty' is shown briefly under the field.
- The site follows the device's light or dark appearance setting.
- On a phone the panel fills the width of the screen and its buttons are full-width and easy to tap.

**Non-behaviours**
- No email, password, or account of any kind. 'Email it to me' uses the visitor's own mail app; Todoodle never sends or sees the email.
- No recovery of a lost link. Ever. The app says so.
- The link is never shown in page titles or sent to third-party services.
- The reminder banner cannot be permanently dismissed without saving the link.

## One-click workspace creation

> Anchor: `prd.create_workspace`

WHEN a visitor chooses to start a new list THE SYSTEM SHALL create a new empty workspace with an Inbox and take the visitor into it.

## Link is an unguessable credential

> Anchor: `prd.unguessable_link`

THE SYSTEM SHALL give each workspace a secret link that cannot practically be guessed or enumerated, and SHALL grant access to the workspace only to requests presenting that link.

## User is told the link is the key

> Anchor: `prd.save_link_prompt`

WHEN a workspace is first created THE SYSTEM SHALL show the full link with a copy action and a warning that the link is the only way back in, grants full access to anyone who has it, and that access cannot currently be removed.

## Unknown links reveal nothing

> Anchor: `prd.not_found`

IF a link does not match an existing workspace THEN THE SYSTEM SHALL show a not-found page that suggests checking the link was not cut off and offers to start a new list, and SHALL NOT disclose whether any other workspace exists.

## Rename workspace

> Anchor: `prd.rename_workspace`

WHEN a user renames the workspace to a non-empty name THE SYSTEM SHALL save and display the new name to everyone using that workspace.

IF a user submits an empty workspace name THEN THE SYSTEM SHALL keep the previous name and briefly tell the user that the name cannot be empty.

## Link does not leak to third parties

> Anchor: `prd.no_link_leak`

THE SYSTEM SHALL NOT send the workspace link to any third party, including via referrer information, analytics, or error reporting.

## Link stays bookmarkable

> Anchor: `prd.bookmarkable_link`

WHILE a user is inside a workspace THE SYSTEM SHALL keep the full workspace link in the browser address bar so that bookmarking or reloading the page returns to the same workspace.

## Saving the link is one click

> Anchor: `prd.save_link_actions`

WHEN the save-your-link panel is shown after creation THE SYSTEM SHALL offer, as the primary action, a single control that copies the link and closes the panel, together with actions to email the link to oneself using the user's own mail app and to see how to bookmark the page, and a secondary control to skip.

## One Share control for the link

> Anchor: `prd.share_entry`

WHILE a user is inside a workspace THE SYSTEM SHALL provide a single Share control in the workspace header that opens the same link panel used after creation, and SHALL NOT offer a second, separate control for the same link.

## Reminder until the link is saved

> Anchor: `prd.unsaved_link_reminder`

WHILE this browser has neither copied nor emailed a workspace's link THE SYSTEM SHALL show a reminder in that workspace that access will be lost if the browser is cleared, with an action to copy the link.

## Loading shows the page shape

> Anchor: `prd.loading_state`

WHILE a workspace is loading THE SYSTEM SHALL show placeholder shapes where the header, sidebar and list will appear, and SHALL show the workspace name immediately when it is already known.

## Failed loads can be retried

> Anchor: `prd.load_failure`

IF a workspace fails to load for a reason other than the workspace not existing THEN THE SYSTEM SHALL say the workspace could not be loaded and offer a way to try again, and SHALL NOT show the not-found page.

## Light and dark appearance

> Anchor: `prd.colour_scheme`

THE SYSTEM SHALL follow the device's light or dark appearance setting, with text and controls meeting WCAG 2.2 AA contrast in both.

## Out of scope

- Accounts, email, passwords, OAuth
- Link recovery
- Revoking or rotating a link (flagged as a likely follow-up story)
- Workspace deletion
- Rate limiting of workspace creation (flagged as a follow-up; abuse risk acknowledged)

## Constraints

- Link secret must carry at least 128 bits of randomness.
- Workspace creation perceived as instant (target under 1 second on a normal connection).
- Must work on current evergreen desktop and mobile browsers.

