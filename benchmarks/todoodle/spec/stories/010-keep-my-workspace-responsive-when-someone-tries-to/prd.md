# PRD

Protect Todoodle from floods of workspace creation, link-guessing noise, runaway changes and connection storms, without accounts, without third-party scripts, and with friendly, self-resolving messages for real people who hit a limit.

## Problem

Todoodle has no accounts: anyone can create a workspace with one click, and anyone with a link can change it. That openness is the product, but it also means:

- **Floods of new workspaces.** A script can create thousands of workspaces an hour, filling storage and slowing the service for everyone.
- **Link-guessing noise.** Links cannot practically be guessed, but automated guessing still costs capacity and fills logs.
- **Runaway changes.** A broken or malicious script holding a shared link can hammer one workspace with changes, making it unusable for the real people sharing it.
- **Connection storms.** Thousands of live connections to one workspace, or a client stuck reconnecting in a tight loop, can starve genuine collaborators of live updates.

At the same time, real people must not be punished: a classroom or office sharing one internet connection may legitimately create many workspaces at once, and anyone who does hit a limit today would see a bare error and could lose what they typed.

## Solution

Todoodle quietly caps how fast any one network can create workspaces (per minute and per day), how many failed link attempts it can make, how many changes a single workspace accepts per minute, and how many live connections a workspace holds. The limits sit well above what real people do, so they are invisible in normal use.

When a real person does hit one, the app explains it in plain words ('You're creating workspaces very quickly'), says exactly when they can continue, counts down, and carries on by itself when the wait ends. Nothing they typed is lost and they are never left on a dead-end screen.

Protection is built into Todoodle itself, with no third-party verification widgets, and without keeping anyone's network address in a readable form.

## User Experience

**Golden path (the common case)**
- Nobody notices anything. Creating a workspace, opening links, editing tasks and live updates behave exactly as in stories 2–8.

**Creating workspaces too quickly (Home page)**
1. Visitor presses 'Start a new list' after their network has already created many workspaces in the last minute.
2. Instead of opening a workspace, an inline message appears under the button: 'You're creating workspaces very quickly — you can start another in 45 seconds.' The seconds count down.
3. The button is disabled during the countdown and re-enables itself at zero; the message disappears.
4. The 'Your workspaces on this browser' list and 'Continue to…' button (story 3) remain fully usable throughout.

**Daily limit reached (Home page)**
- Message: 'This network has created a lot of workspaces today. You can create more after 01:00 (your time).' with the local time of the reset. Remembered workspaces remain usable. No countdown ticking for hours; the time is shown instead.

**Too many failed link attempts (opening a link)**
- The page shows 'Too many attempts from your network. Trying again in 30 seconds…' with a countdown, then retries automatically. The remembered-workspaces list (story 3) is shown below so the person can go elsewhere meanwhile. Opening a correct link is never slowed down by this.

**A workspace receiving too many changes (inside a workspace)**
- The change the person just made stays on screen marked 'Waiting to save…' (not discarded, not rolled back). A toast says 'Lots of changes happening in this workspace — saving again in 20 seconds.' When the wait ends, the change saves automatically and the marker disappears. If it still cannot save, the normal 'Couldn't save — Retry / Discard' state from stories 5–6 applies.

**Too many live connections to one workspace**
- The person sees the existing 'Reconnecting…' pill (story 4); editing stays on; live updates resume automatically once a slot is free. No separate error screen.

**Structure**
- No new screens or navigation. Messages appear inline where the action was attempted, or as a toast inside a workspace.
- Every message says what happened in plain words, when the person can continue, and does not blame them.

**Explicit non-behaviours**
- No CAPTCHA, puzzle or third-party 'are you human' widget.
- No accounts, email or phone verification introduced.
- Never discards typed text or pending changes because of a limit.
- Never reveals whether a link exists, even when refusing link attempts.
- Limits are never switched off in production.

## Workspace creation per minute is capped per network

> Anchor: `prd.create_burst`

WHEN a single network attempts to create more than 20 workspaces within one minute THE SYSTEM SHALL refuse further workspace creation from that network until the minute has passed.

## Workspace creation per day is capped per network

> Anchor: `prd.create_daily`

WHEN a single network attempts to create more than 200 workspaces within one calendar day (UTC) THE SYSTEM SHALL refuse further workspace creation from that network until the next day begins.

## Failed link attempts are capped per network

> Anchor: `prd.open_attempts`

WHEN a single network makes more than 20 unsuccessful workspace-link attempts within one minute THE SYSTEM SHALL refuse further link attempts from that network until the minute has passed, without revealing whether any link exists.

## Valid links are never slowed

> Anchor: `prd.open_success_unlimited`

THE SYSTEM SHALL NOT count opening a valid workspace link toward any limit.

## Changes per workspace are capped

> Anchor: `prd.workspace_change_rate`

WHEN a single workspace receives more than 600 changes within one minute THE SYSTEM SHALL refuse further changes to that workspace until the minute has passed.

## Live connections per workspace are bounded

> Anchor: `prd.live_capacity`

THE SYSTEM SHALL accept at least 100 simultaneous live connections to one workspace and SHALL refuse live connections beyond that number.

## Reconnect storms are capped per network

> Anchor: `prd.live_connect_rate`

WHEN a single network attempts more than 60 live connections within one minute THE SYSTEM SHALL refuse further live connection attempts from that network until the minute has passed.

## People are told what happened and when to continue

> Anchor: `prd.clear_message`

WHEN an action is refused because a limit was reached THE SYSTEM SHALL tell the person, in plain words, what happened and when they can continue.

## Actions resume on their own

> Anchor: `prd.auto_resume`

WHEN the waiting time for a refused action ends THE SYSTEM SHALL re-enable that action, and SHALL automatically retry any change that was waiting to save, without the person reloading the page.

## Limits never lose work

> Anchor: `prd.no_work_lost`

IF a change is refused because a limit was reached THEN THE SYSTEM SHALL NOT discard or roll back that change on screen.

## Network identities are not kept

> Anchor: `prd.network_privacy`

THE SYSTEM SHALL NOT store any visitor's network address in a form that can be read back, and SHALL delete any network-derived counting data within 2 days.

## Limits always apply in production

> Anchor: `prd.always_enforced`

WHILE running in production THE SYSTEM SHALL enforce every limit in this story, regardless of any testing configuration.

## Out of scope

- CAPTCHA / Cloudflare Turnstile or any third-party human-verification widget (documented as an escalation option only; it would break the no-third-party-scripts rule).
- Per-person limits (there are no identities).
- Blocking or allow-listing specific networks, countries or organisations.
- An admin dashboard of abuse activity (limit hits are visible in platform logs).
- Request size and field length caps: already delivered by story 1 (request limits) and stories 2, 5 and 7 (field limits); this story does not change them.
- Account-level Cloudflare firewall rules: recommended in operations notes, configured outside the codebase.

## Constraints

- Limits are generous on purpose: a shared connection such as a classroom of 20 people starting lists at the same moment must succeed. The trade-off is that a determined attacker spread across many networks is slowed, not stopped.
- Counting is approximate by design (it may allow a little more than the stated number in bursts, never meaningfully less).
- Checking a limit must add no noticeable delay to normal actions.
- No new third-party scripts or services visible to the browser.
- Limits are named, configurable values; test environments may use isolated counters so automated tests don't interfere with each other, but production always enforces the stated values.
- A failure of the counting service itself must not take Todoodle down: real people keep working, and the failure is logged.

