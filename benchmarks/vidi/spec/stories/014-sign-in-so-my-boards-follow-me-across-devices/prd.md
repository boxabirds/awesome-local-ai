# PRD

People sign in with one click using Google (or, in local development builds only, by typing an email address) so the boards they create or open follow them to every device, and others see their real name. Share links keep working for everyone without sign-in.

## Problem

After stories 1–5, boards live at unguessable links, and the only record of which boards a person uses is their browser history and chat messages.

Pain points:
1. **Lost boards** — people cannot find a board they used last week unless they saved the link somewhere. Switching from a laptop to a desktop loses the trail completely.
2. **Anonymous collaborators** — a random guest name ("Curious Otter") is fine in a quick workshop, but teammates who work together regularly cannot tell who is who.
3. **Work done before signing in disappears from view** — someone who creates several boards as a guest and signs in later expects those boards to be in their list.
4. **Sign-in friction kills adoption** — passwords and multi-step forms make people skip sign-in and keep losing boards.
5. **Developers need to test sign-in locally** — real Google sign-in needs registered domains and real accounts, which makes local development and automated tests painful. But a shortcut that skips verification must never be usable on the real service, or anyone could sign in as anyone.
6. **Security risks of accounts** — once accounts exist, other websites could try to trigger actions in a signed-in person's browser, and stolen or stale sessions could linger.

## Solution

- **Lost boards → boards follow the person.** When signed in, every board a person creates or opens is remembered on their account and listed on the home page on any device.
- **Anonymous collaborators → real names.** Signed-in people appear to others under their Google name and picture instead of a guest name.
- **Guest work disappears → claiming on sign-in.** Boards created or opened in this browser before signing in are added to the account at sign-in.
- **Friction → one click.** On the real service, sign-in is Google's one-click sign-in (a prompt on the home page, and a Sign in with Google button everywhere). No passwords.
- **Local testing → email-only sign-in in local builds only.** A local development build shows a simple email field instead of Google. The real service never offers or accepts it.
- **Security → sessions and protection by design.** Sessions end after 30 days without use or on sign-out; requests that come from other websites are refused; failed or unavailable Google sign-in leaves the person safely signed out and still able to use boards.

What does not change: anyone with a board link can still open and edit it without signing in.

## User Experience

### Golden path (real service)
1. Lena opens the vidi6 home page while signed into Google in her browser.
2. A small Google prompt appears in the top-right corner: "Sign in to vidi6 as Lena Park" with her picture.
3. She clicks Continue. Within a few seconds the prompt closes, her picture and first name appear in the top-right account menu, and a **Your recent boards** list appears under Create a board.
4. The list already contains two boards she created as a guest earlier that day on this laptop.
5. She opens one of them. Her teammates on the board see "Lena Park" instead of "Curious Otter".
6. At home on her desktop she opens vidi6, clicks **Sign in with Google**, and sees the same recent boards.

### Golden path (local development build)
1. A developer runs the app locally and opens the home page.
2. Instead of Google, the account area shows **Sign in (local build)** with an email field and a note "Local build only — no verification".
3. They type `alex@example.com` and press Sign in. They are signed in as "alex" with an initial-letter avatar.

### Structure
- **Account menu (top-right, every page):** when signed out, a Sign in with Google button (or the local-build email form); when signed in, avatar + first name opening a menu with the full name, email and **Sign out**.
- **Home page:** Create a board (story 5), then **Your recent boards** (signed in only): up to 10 boards with title and "Opened 2 hours ago", most recent first.
- **Sign-in page (`Sign in` from a board):** a dedicated page with the Google button that returns the person to the board afterwards.
- **Messages:** "Sign-in didn't work. Please try again."; "Google sign-in couldn't load. Check that accounts.google.com isn't blocked, then reload."; "You've been signed out. Sign in again to see your boards."

### Behaviour
- The automatic one-click prompt appears only on the home page, never on a board page, so it never interrupts a workshop.
- Signing in or out on a board page does not reload or interrupt the board; only the name others see changes.
- A board is added to "Your recent boards" when it is created or opened while signed in; reopening moves it to the top.
- After signing out, the automatic prompt does not immediately sign the person back in on that page.
- Boards opened as a guest in this browser are claimed at the next sign-in, then no longer tracked locally.
- Board titles show as "Untitled board" until renaming arrives (story 15).

### Alternate flows
- **Empty state:** signed in with no boards → "Boards you create or open will appear here."
- **Google declines / person closes the prompt:** nothing changes; the button remains.
- **Verification fails** (expired or invalid sign-in, unverified Google email): the person stays signed out with "Sign-in didn't work. Please try again."
- **Google blocked or unreachable** (ad blocker, company firewall, offline): the button area shows the "couldn't load" message; boards remain fully usable as a guest.
- **Session expired** (30 days without use) or signed out on the server: on next page load the person is a guest again and sees "You've been signed out…" once.
- **Service unavailable while listing boards:** "Couldn't load your recent boards." with a Retry button; the rest of the page works.

### Explicit non-behaviours
- Does not require sign-in to open or edit any board.
- Does not add permissions, owners, private boards or invitations.
- Does not offer passwords, other identity providers, or account deletion.
- Does not show the local-build email form on the real service under any configuration.
- Does not sync a guest's random name into the account; the Google name replaces it.
- Does not provide search, rename or a full board list (story 15).

## Sign in with Google

> Anchor: `auth.google_sign_in`

WHEN a signed-out person on the real service chooses Sign in with Google and Google confirms their identity THE SYSTEM SHALL sign them in and show their Google name and picture in the account menu within 3 seconds.

Verification: click the button, choose an account; the account menu shows that account's name and picture.

## One-click prompt on the home page

> Anchor: `auth.one_tap`

WHEN a signed-out person opens the home page of the real service in a browser where Google can offer a one-click sign-in THE SYSTEM SHALL offer that prompt so the person can sign in with a single click without leaving the page.

## No automatic prompt on boards

> Anchor: `auth.no_prompt_on_board`

IF a person is on a board page THEN THE SYSTEM SHALL NOT show the automatic one-click sign-in prompt.

## Email-only sign-in in local builds

> Anchor: `auth.dev_email`

WHERE the app is running as a local development build THE SYSTEM SHALL let a person sign in by entering only a valid email address, without any verification, and SHALL show the note "Local build only — no verification".

## Email-only sign-in never on the real service

> Anchor: `auth.dev_email_never_production`

IF the app is not running as a local development build THEN THE SYSTEM SHALL NOT show the email-only sign-in form and SHALL NOT sign anyone in from an email address alone, even if a local-build setting is present by mistake.

Verification: on a deployed service, the email-only sign-in request is refused as if it did not exist, and the account menu offers only Google.

## Recent boards on the home page

> Anchor: `auth.recent_boards`

WHILE a person is signed in THE SYSTEM SHALL show on the home page up to 10 boards they created or opened, most recently opened first, each with its title and when it was last opened.

## Boards follow the person across devices

> Anchor: `auth.cross_device`

WHEN a signed-in person creates or opens a board on one device THE SYSTEM SHALL include that board in their recent boards the next time they load the home page on any other device where they are signed in to the same account.

## Guest boards are claimed at sign-in

> Anchor: `auth.claim_guest`

WHEN a person signs in THE SYSTEM SHALL add to their account every board they created or opened in the same browser while signed out, keeping each board's most recent opened time.

Verification: as a guest create board A and open board B; sign in; both appear in recent boards.

## Links still work without sign-in

> Anchor: `auth.link_access_unchanged`

IF a person is not signed in THEN THE SYSTEM SHALL NOT prevent them from opening, creating or editing a board.

## Real name on boards

> Anchor: `auth.identity`

WHILE a person is signed in THE SYSTEM SHALL show their Google name (or, in local builds, the part of their email before the @) to other people on the same board instead of a guest name, and WHEN they sign in or out while on a board THE SYSTEM SHALL update the name others see within 2 seconds without reloading the board.

## Sign out

> Anchor: `auth.sign_out`

WHEN a person chooses Sign out THE SYSTEM SHALL end their session on that device, stop showing their recent boards, show them under a new guest name, and SHALL NOT automatically sign them back in on that page.

## Sessions expire

> Anchor: `auth.session_expiry`

WHEN a person has not used vidi6 on a device for 30 days THE SYSTEM SHALL treat them as signed out on that device, and WHEN they next open vidi6 THE SYSTEM SHALL show "You've been signed out. Sign in again to see your boards." once.

## Failed sign-in

> Anchor: `auth.failure`

IF Google sign-in completes in the browser but cannot be confirmed by vidi6 (invalid or expired sign-in, or an unverified Google email) THEN THE SYSTEM SHALL NOT sign the person in; THE SYSTEM SHALL show "Sign-in didn't work. Please try again." and keep the page usable.

## Google unavailable

> Anchor: `auth.google_unavailable`

IF Google sign-in cannot be loaded within 8 seconds THEN THE SYSTEM SHALL show "Google sign-in couldn't load. Check that accounts.google.com isn't blocked, then reload." in place of the button and keep every board fully usable.

## Other websites cannot act for a signed-in person

> Anchor: `auth.cross_site`

IF a request to sign in, sign out, claim boards or record a board visit is sent from a website other than vidi6 THEN THE SYSTEM SHALL NOT perform it.

## Constraints

- **Settings:** session lifetime (30 days since last use), recent boards shown (10), Google load timeout (8 seconds), sign-in time target (3 seconds), and guest boards remembered per browser (200) are named product settings.
- **Security:** session identifiers are never readable by page scripts; sessions can be ended server-side; email-only sign-in is impossible outside local builds even if misconfigured; repeated sign-in attempts from one visitor are rate limited.
- **Privacy:** only name, email, picture and Google account identifier are stored. Board links must not be sent to Google (story 5 privacy constraint still holds): Google may learn that vidi6 is being used, never which board.
- **Compatibility:** boards created before this story keep working and are claimable. Guest names from story 6 remain for signed-out people.
- **Browsers:** same as story 1. Google's one-click prompt may be suppressed by the browser or Google (e.g. after dismissals); the Sign in with Google button must always be available as the fallback.

## Out of scope

- Board ownership, permissions, private or view-only boards.
- Full board list, search and renaming (story 15).
- Other sign-in methods (passwords, Microsoft, GitHub, passkeys) and email magic links on the real service.
- Account settings, changing name or picture inside vidi6, account deletion and data export.
- Signing out of all devices at once.
- Removing a board from "recent boards".

