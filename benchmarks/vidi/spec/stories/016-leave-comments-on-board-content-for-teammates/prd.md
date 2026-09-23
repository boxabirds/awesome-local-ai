# PRD

People leave threaded comments attached to board items or spots on the board, reply, resolve and reopen them, and find open discussions in a comments panel. Comments are live, saved, and follow the items they are attached to.

## Problem

Boards are shared and live (stories 3–5), but the only way to discuss something on a board is to write another sticky note next to it.

Pain points:
1. **Discussion pollutes the content** — questions and feedback written as sticky notes clutter the board and get mistaken for real content.
2. **Context is lost** — a remark like "this seems too expensive" is useless once the note it referred to is moved away from it.
3. **Asynchronous teams can't converse** — people working at different times need a back-and-forth that stays attached to the thing being discussed.
4. **Nobody knows what's still open** — without a way to mark a discussion as settled and to list unsettled ones, feedback gets forgotten or re-litigated.
5. **Who said what** — guests without accounts still need to be distinguishable in a discussion.

## Solution

- **Discussion pollutes content → comments live beside the board, not on it.** Comments appear as small markers that open into threads; they are never mistaken for board items and are not part of exports.
- **Context lost → comments attach to items.** A comment placed on an item stays on that item when it is moved or resized. A comment can also be placed on an empty spot of the board.
- **Async conversation → threads with replies.** Anyone on the board can reply; threads are saved with the board and appear live for everyone connected.
- **What's open → resolve, reopen and a comments panel.** Threads can be resolved (hidden from the board) and reopened; a panel lists open threads and jumps to each one.
- **Who said what → names on every message.** Each message shows the writer's name (the guest's random editable name, or their account name) and when it was written.

## User Experience

### Golden path
1. Lee clicks **Comment** in the left toolbar (or presses C). The pointer becomes a speech-bubble cursor.
2. Lee clicks on a sticky note. A small thread box opens next to the note with a text field ("Add a comment…") and a **Post** button (disabled while the field is empty).
3. Lee types "Is this in scope for Q3?" and presses Post (or Ctrl/Cmd + Enter). A round marker with Lee's initial appears on the note's corner; the box now shows the message with "Curious Otter · just now". The tool returns to Select.
4. Mira, on the same board, sees the marker appear within a second, clicks it, types a reply and posts it. The marker shows "2".
5. Lee drags the sticky note elsewhere; the marker moves with it.
6. Mira clicks **Resolve** (tick icon). The marker disappears from the board for everyone.
7. Later, Lee opens the **Comments** panel (speech-bubble button top-right) and switches the filter to Resolved, finds the thread and clicks **Reopen**.

### Structure
- Left toolbar: Comment tool button (tooltip "Comment (C)").
- Top-right: Comments button showing the number of open threads; opens a right-hand panel.
- Board marker: round badge with the first author's initial and the message count when more than one message.
- Thread box: messages in time order (name, relative time, text, "(edited)" where applicable), reply field with Post, and header actions: Resolve / Reopen, close (×). Each of my own messages has a ⋯ menu with Edit and Delete.
- Comments panel: filter tabs **Open** / **Resolved**, list of threads (first line of the first message, author name, reply count, time of latest activity), empty-state text.

### Behaviour
- Clicking an item in comment mode attaches the thread to that spot on the item; clicking empty board attaches it to that board location.
- Markers stay the same size on screen at any zoom level.
- Markers follow their item when it is moved or resized, keeping the same relative spot on the item.
- Clicking a marker opens its thread; clicking elsewhere or pressing Escape closes it. Escape in comment mode with no open thread returns to Select.
- A draft that was never posted is discarded when the thread box is closed; nothing is saved for an empty or unposted comment.
- Comments panel lists newest activity first; clicking a thread moves the view to centre the marker and opens the thread.
- Enter adds a new line in the text field; Ctrl/Cmd + Enter posts.
- Messages longer than 2,000 characters cannot be typed or pasted beyond the limit.
- Names shown are the names the writers had when they wrote each message.
- Undo (Ctrl/Cmd + Z) reverses my own last comment action (post, reply, edit, delete, resolve, reopen), like other board edits.

### Alternate flows
- **Empty state (panel):** Open tab shows "No open comments. Use the Comment tool (C) to start a discussion."; Resolved tab shows "No resolved comments."
- **Attached item deleted:** the marker stays where the item was first commented on, and the thread shows a note "The item this comment was attached to was deleted." If the deletion is undone, the comment is attached to the item again.
- **Deleting my first message when there are replies:** the message is replaced by "This comment was deleted" and the replies stay. Deleting my first message when there are no replies removes the whole thread.
- **Someone resolves a thread I have open:** the thread box stays open for me, shows "Resolved by Mira" and offers Reopen; after closing it the marker is gone.
- **Someone deletes a thread I have open:** my thread box closes, any unposted reply text is lost, and a brief notice "This comment was deleted" appears.
- **Connection lost:** comments can still be written; they reach others when the connection returns (story 3 behaviour).
- **Board could not be loaded (story 4):** the Comment tool and posting are disabled like other editing.

### Explicit non-behaviours
- Does not send email, push or in-app notifications.
- Does not support @mentions, reactions, attachments, rich text or link previews.
- Does not track read/unread status per person.
- Does not include comments or markers in exports (story 17).
- Does not let people edit or delete other people's messages.
- Does not update the author name on old messages when someone renames themselves.

## Comment on an item

> Anchor: `comment.create_on_item`

WHEN a person using the Comment tool clicks a board item THE SYSTEM SHALL open a new comment box attached to the clicked spot on that item.

Verification: with the Comment tool, click the lower-right area of a sticky note; after posting, the marker appears at that spot on the note.

## Comment on an empty spot

> Anchor: `comment.create_on_board`

WHEN a person using the Comment tool clicks empty board space THE SYSTEM SHALL open a new comment box attached to that board location.

## Post a comment

> Anchor: `comment.post`

WHEN a person posts a comment with non-blank text THE SYSTEM SHALL show a marker and the message, with the writer's name and time, to everyone connected to the board within 1 second.

Verification: Lee posts; Mira's screen shows the marker within 1 second and the thread shows Lee's current name and "just now".

## Blank comments are not posted

> Anchor: `comment.blank`

IF the comment or reply text is empty or only spaces and line breaks THEN THE SYSTEM SHALL NOT post it and SHALL keep the Post button disabled.

## Message length limit

> Anchor: `comment.length`

IF typing or pasting would make a message longer than 2,000 characters THEN THE SYSTEM SHALL NOT add the characters beyond 2,000.

## Reply to a thread

> Anchor: `comment.reply`

WHEN a person posts a reply in an open thread THE SYSTEM SHALL add it below the earlier messages, in time order, for everyone connected, and update the marker's message count.

## Comments follow their item

> Anchor: `comment.follow_item`

WHEN an item with attached comments is moved or resized THE SYSTEM SHALL keep each attached marker at the same relative spot on the item.

Verification: attach a comment at the item's top-right corner, move the item 500 units and double its size; the marker is still at its top-right corner.

## Item deleted

> Anchor: `comment.item_deleted`

WHEN the item a thread is attached to is deleted THE SYSTEM SHALL keep the thread at the location where it was first attached and show "The item this comment was attached to was deleted.", and WHEN that item is restored THE SYSTEM SHALL attach the thread to it again.

## Resolve a thread

> Anchor: `comment.resolve`

WHEN a person resolves a thread THE SYSTEM SHALL remove its marker from the board for everyone and list it under Resolved in the comments panel with who resolved it.

## Reopen a thread

> Anchor: `comment.reopen`

WHEN a person reopens a resolved thread THE SYSTEM SHALL show its marker on the board again for everyone and list it under Open in the comments panel.

## Comments panel lists threads

> Anchor: `comment.panel`

THE SYSTEM SHALL list in the comments panel every thread matching the selected filter (Open or Resolved), newest activity first, showing the first line of the first message, its author, reply count and time of latest activity, and THE SYSTEM SHALL show the number of open threads on the Comments button.

## Jump to a thread

> Anchor: `comment.navigate`

WHEN a person clicks a thread in the comments panel THE SYSTEM SHALL move the board view so the thread's location is centred without changing the zoom level, and open the thread.

IF the thread is resolved THEN THE SYSTEM SHALL open it at its location without showing a marker on the board.

## Edit my own message

> Anchor: `comment.edit_own`

WHEN a person edits a message they wrote and saves it THE SYSTEM SHALL replace the text for everyone and mark the message "(edited)".

## Delete my own message

> Anchor: `comment.delete_own`

WHEN a person deletes a message they wrote THE SYSTEM SHALL remove a reply, remove a whole thread whose first message has no replies, or replace a first message that has replies with "This comment was deleted" while keeping the replies.

## Others' messages are protected in the interface

> Anchor: `comment.not_others`

IF a message was written by someone else THEN THE SYSTEM SHALL NOT offer Edit or Delete for that message.

## Names as written

> Anchor: `comment.author_name`

THE SYSTEM SHALL show each message with the name its writer had at the moment of writing, and IF the writer later renames themselves THEN THE SYSTEM SHALL NOT change the name shown on their earlier messages.

## Comments are kept with the board

> Anchor: `comment.persist`

WHEN a person opens a board after everyone has left THE SYSTEM SHALL show every thread, reply, resolved state and edit exactly as they were left.

## Undo my comment actions

> Anchor: `comment.undo`

WHEN a person uses Undo after posting, replying, editing, deleting, resolving or reopening THE SYSTEM SHALL reverse that action of theirs, and IF the most recent comment action was someone else's THEN THE SYSTEM SHALL NOT undo it.

## Markers stay readable at any zoom

> Anchor: `comment.marker_size`

THE SYSTEM SHALL draw comment markers at the same on-screen size at every zoom level.

## Constraints

- **Access model:** anyone with the board link can read, write, resolve and reopen comments (same as board editing). Hiding Edit/Delete for others' messages is an interface safeguard, not a security guarantee; this is acceptable until permissions arrive.
- **Identity:** guests appear with their random editable name; signed-in people with their account name (story 14). A guest who later signs in cannot edit messages written as a guest.
- **Scale:** a board with 200 threads and 2,000 messages total stays responsive (opening the panel and scrolling feel instant). Named product settings: message length limit (2,000), tested thread count (200), tested message count (2,000).
- **Live and offline:** comments behave like other board content for live delivery (story 3), saving (story 4) and offline editing (story 13).
- **Accessibility:** the panel and thread box are keyboard operable; markers are focusable buttons with an accessible label ("Comment thread by Curious Otter, 2 messages").
- **Browsers:** same as story 1.

## Out of scope

- Notifications of any kind (email, push, in-app badges per person).
- @mentions, reactions, emoji picker, attachments, rich text, link previews.
- Read/unread tracking.
- Comment permissions (owner-only resolve, moderation).
- Comments in exports (story 17).
- Searching comment text.
- Moving a thread to a different item after creation.

