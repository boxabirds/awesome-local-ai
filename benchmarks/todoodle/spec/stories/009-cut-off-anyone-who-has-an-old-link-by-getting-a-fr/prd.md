# PRD

Replace a workspace's secret link so everyone holding the old one loses access, while the person who replaced it carries on uninterrupted.

## Problem

In Todoodle the workspace link is the only key, and anyone who has it has full access forever. Links leak in ordinary ways: pasted into a group chat, left in a former flatmate's browser history, forwarded by someone who shouldn't have, screenshotted. Today the only remedy is to create a new workspace and retype everything by hand, and even then the old workspace (with all its content) stays reachable by whoever has the leaked link. There is no way to take back access once given.

## Solution

From the Share panel, a user can get a new link for the same workspace. After a clear warning, the old link stops working for everyone, immediately, including people who have the workspace open right now. The tasks, projects and name stay exactly as they were; only the key changes. The person who changed it carries on without interruption and is shown the new link to save and re-send to the people who should keep access. Anyone who comes back with the old link is told plainly that the link was changed and that they need to ask for the new one, rather than being left guessing whether the workspace was deleted.

## User Experience

**Golden path**
1. In a workspace, the user opens Share. Below the link and its actions sits a smaller, separated action: 'Get a new link'.
2. They choose it. A confirmation appears: title 'Get a new link?'; body 'Everyone using the current link, including you on other browsers and devices, will lose access until you send them the new link. This can't be undone.' Buttons: 'Cancel' (focused by default) and 'Get new link'.
3. They confirm. The button shows it is working. Within a second the Share panel shows the new link in its save-your-link form: Copy link & continue, Email it to me, Bookmark this page.
4. The 'Your link isn't saved yet' reminder reappears at the top of the workspace until they copy or email the new link.
5. They carry on working; nothing reloads. Other tabs of the same browser keep working too.
6. A collaborator who had the workspace open with the old link sees, within a few seconds, a full-page message: 'This workspace's link was changed. Ask whoever shares it with you for the new one.' with 'Remove from this browser' and 'Go to my workspaces'. No tasks remain visible to them.

**Alternate flows**
- Cancel or Escape: nothing changes; focus returns to 'Get a new link'.
- The link was changed less than a minute ago: the action is unavailable and says 'You just changed the link. Try again in 45 s' (counting down).
- Two people choose 'Get new link' at the same moment: only one change happens. The other person is now holding the old link, so they see the 'link was changed' page.
- Offline: 'Get a new link' is disabled with the hint 'You're offline'.
- Saving fails for any other reason: 'Couldn't change the link, nothing was changed. Try again.' The current link keeps working.
- Someone opens the most recently replaced link (from a bookmark, chat, or their remembered list): they see the 'link was changed' page, never the workspace.
- A link that was replaced two or more changes ago behaves like any unknown link: 'Workspace not found'.
- On the home page and in the workspace switcher, a remembered workspace whose stored link was replaced is labelled 'Link changed' with a Remove action, and cannot be opened.
- The person who changed the link reloads a tab whose address still shows the old link: the workspace opens normally (this browser already holds the new key) and the address updates to the new link.

**Structure**
- 'Get a new link' sits at the bottom of the Share panel, visually separated from the everyday actions, as a smaller text-style button with a warning icon. It is at least 44 by 44 px on touch.
- The confirmation is a focused alert dialog; on narrow screens it is a bottom sheet.

**Non-behaviours**
- Does not remove access from just one person; everyone except this browser loses access.
- Does not notify former collaborators by email or any channel outside the app.
- Does not keep a history of old links or let anyone restore an old link.
- Does not change the workspace's content, name, or anyone's remembered list other than this browser's.

## Confirmation explains the consequence

> Anchor: `prd.rotate_confirm`

WHEN a user chooses to get a new link THE SYSTEM SHALL ask for confirmation stating that everyone using the current link, including the user on other browsers and devices, will lose access until given the new link, and that this cannot be undone.

## New link replaces the old one

> Anchor: `prd.rotate_new_link`

WHEN a user confirms getting a new link THE SYSTEM SHALL replace the workspace's link with a new unguessable link and show the new link with copy, email and bookmark options.

## Old link grants nothing

> Anchor: `prd.old_link_revoked`

IF a request presents a link that has been replaced THEN THE SYSTEM SHALL NOT grant any access to the workspace or its content.

## The person who changed it carries on

> Anchor: `prd.rotator_keeps_access`

WHEN a user replaces the link THE SYSTEM SHALL keep the workspace usable without reloading in every tab of that browser, including tabs whose address still shows the old link.

## Open sessions with the old link end promptly

> Anchor: `prd.live_sessions_ended`

WHEN a link is replaced THE SYSTEM SHALL end every open session that relies on the old link within 5 seconds.

## Former holders are told what happened

> Anchor: `prd.link_changed_notice`

WHEN someone presents the most recently replaced link THE SYSTEM SHALL show a message that the workspace's link was changed and that they should ask for the new one.

## Older links are simply unknown

> Anchor: `prd.older_links_unknown`

IF someone presents a link that was replaced two or more changes ago THEN THE SYSTEM SHALL treat it exactly like a link that never existed.

## Remembered entries show the change

> Anchor: `prd.remembered_link_changed`

WHILE a browser's remembered link for a workspace has been replaced THE SYSTEM SHALL label that entry 'Link changed' with a Remove action and SHALL NOT open it.

## No rapid repeated changes

> Anchor: `prd.rotation_cooldown`

IF the link was replaced less than 60 seconds ago THEN THE SYSTEM SHALL NOT replace it again and SHALL tell the user how long to wait.

## Simultaneous requests change the link once

> Anchor: `prd.concurrent_rotation`

IF two requests to replace the link arrive at the same time THEN THE SYSTEM SHALL complete exactly one of them.

## New link starts unsaved

> Anchor: `prd.rotation_unsaved_reminder`

WHEN the link is replaced THE SYSTEM SHALL show the save-your-link reminder in that browser until the new link is copied or emailed.

## Unavailable while offline

> Anchor: `prd.rotation_offline`

WHILE Todoodle cannot reach the server THE SYSTEM SHALL disable getting a new link.

## Links never recorded

> Anchor: `prd.rotation_no_leak`

THE SYSTEM SHALL NOT record the old or new link in logs, error reports, page titles, or any third-party service.

## Out of scope

- Removing access for one specific person (there are no identities)
- Scheduled or automatic link expiry
- Notifying former collaborators outside the app
- History of previous links, or restoring an old link
- Read-only links

## Constraints

- The new link carries the same strength as any workspace link (at least 128 bits of randomness; the architecture uses 256).
- The change completes in under 1 second on a normal connection.
- Keyboard and screen-reader operable; touch targets at least 44 by 44 px; the confirmation traps focus and returns it on close.
- Works in current evergreen desktop and mobile browsers.

