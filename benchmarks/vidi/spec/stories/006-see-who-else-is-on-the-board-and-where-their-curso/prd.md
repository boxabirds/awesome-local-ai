# PRD

People on a board see who else is there (named, coloured avatars) and where each person's cursor and selection are, live, with distinct colours for up to 5 people, editable guest names, and prompt removal when someone leaves.

## Problem

After stories 3–5, changes from other people appear on the board, but the people themselves are invisible.

Pain points:
1. **Who is here?** — a facilitator cannot tell whether everyone has joined, or whether someone dropped off.
2. **Where are they looking?** — in a workshop people say "look at this note" and others hunt around a large board to find it.
3. **Changes appear from nowhere** — notes move or vanish with no visible cause, which is disorienting and leads to people undoing each other's work.
4. **Collisions** — two people start editing or dragging the same note without realising someone else is already working on it.
5. **Telling people apart** — without names and distinct colours, cursors and outlines cannot be attributed to anyone.
6. **Ghosts** — people who have left but still appear present make the room look fuller than it is.

## Solution

- **Who is here → avatar stack.** A row of coloured avatars with names shows everyone currently on the board, including a marker for yourself.
- **Where are they looking → live cursors.** Each other person's pointer appears on your board at the exact board location they are pointing at, with their name, whatever your own zoom or position.
- **Changes from nowhere → visible causes.** Because cursors and selections are visible, you see who is moving what.
- **Collisions → selection outlines.** Objects another person has selected are outlined in that person's colour with their name.
- **Telling people apart → names and colours.** Everyone gets a friendly random name (for example "Curious Otter") that they can change, and a colour different from everyone else's for up to 5 people.
- **Ghosts → prompt removal.** People who close the board disappear within a few seconds; people whose connection silently dies disappear within about half a minute.

## User Experience

### Golden path
1. Alex opens a board. Top-right, next to Share, an avatar stack shows one avatar: a coloured circle with Alex's initials and a small "you" marker. Hovering shows "Curious Otter (you)".
2. Sam opens the same board. Within a second, a second avatar appears on Alex's screen in a different colour.
3. Sam moves the pointer over the board. On Alex's screen a pointer arrow in Sam's colour with a name label "Brave Heron" follows Sam's movements smoothly, positioned over the same note Sam is pointing at, even though Alex is zoomed in and Sam is zoomed out.
4. Sam clicks a note to select it. On Alex's screen that note gets an outline in Sam's colour with a small "Brave Heron" tag. Alex's own selection is unaffected.
5. Alex clicks their own avatar, chooses Rename, types "Alex" and presses Enter. On Sam's screen the avatar tooltip, cursor label and selection tag change to "Alex".
6. Sam closes the tab. Within a few seconds Sam's cursor and avatar disappear from Alex's screen.

### Structure
- **Avatar stack** (top-right, left of Share): up to 5 avatars (own avatar first), each a circle in the person's colour with initials; tooltip with full name. If more than 5 people are present, a "+N" circle opens a list of everyone's names and colours.
- **Own avatar menu:** Rename (inline text field, 1–32 characters).
- **Remote cursor:** pointer arrow in the person's colour with a name label; constant on-screen size regardless of zoom.
- **Remote selection outline:** outline in the person's colour around each object they have selected, with a name tag at the top-left corner.

### Behaviour
- Cursors move smoothly (no visible jumping on a normal connection).
- A person's cursor disappears when their pointer leaves the board area or their tab is hidden, and reappears when they return.
- Cursors of people pointing at parts of the board outside my current view are not shown.
- My own cursor and selection are never drawn as remote.
- If the same person has the board open in two tabs, they appear once in the avatar stack.
- Each person keeps the same random name every time they return in the same browser, until they rename.
- Colours: with up to 5 people everyone has a different colour. With more than 5, colours may repeat; names still distinguish people.

### Alternate flows
- **Alone on the board:** only your own avatar is shown; no cursors.
- **Rename with an empty or whitespace-only name, or more than 32 characters:** the field shows "Name must be 1–32 characters" and the previous name is kept.
- **Browser blocks remembering the name** (e.g. strict privacy mode): a random name is used for this visit; renaming works for this visit only.
- **Connection lost (story 3 "Reconnecting…"):** other people's cursors and avatars stay as last seen until reconnection; after reconnecting the stack refreshes to who is actually present.
- **Someone's connection dies silently:** they disappear within about 30 seconds.
- **Joining while others are idle (not moving):** everyone already present appears in the avatar stack within 2 seconds of joining.

### Explicit non-behaviours
- Does not let you follow someone's view or jump to their cursor.
- Does not show off-screen indicators pointing to people outside your view.
- Does not lock objects another person has selected; anyone can still edit them.
- Does not show typing indicators or who last edited an object.
- Does not require sign-in; signed-in names arrive with story 14.

## See who is present

> Anchor: `presence.avatars`

WHILE people are connected to a board THE SYSTEM SHALL show each connected person as an avatar with their colour and initials in the avatar stack of every other connected person, including a marked avatar for the viewer themself.

Verification: with 3 people connected, each screen shows 3 avatars, exactly one marked "you".

## Newcomers see everyone quickly

> Anchor: `presence.join`

WHEN a person joins a board THE SYSTEM SHALL show that person in every other connected person's avatar stack within 1 second, and SHALL show every already-present person in the newcomer's avatar stack within 2 seconds, even if those people are idle.

## Live cursors at the right board location

> Anchor: `presence.cursors`

WHEN a person moves their pointer over the board THE SYSTEM SHALL show their cursor with their name on every other connected person's screen within 500 milliseconds, at the same board location the person is pointing at, regardless of each viewer's own zoom and position.

Verification: Sam at 50% zoom points at a note's top-left corner; on Alex's screen at 200% zoom, Sam's cursor tip is at that corner (within 2 screen pixels).

## Cursor hidden when pointer leaves

> Anchor: `presence.cursor_hide`

WHEN a person's pointer leaves the board area or their tab becomes hidden THE SYSTEM SHALL remove that person's cursor from every other screen within 500 milliseconds, and WHEN the pointer returns THE SYSTEM SHALL show it again.

## Other people's selections are visible

> Anchor: `presence.selection`

WHEN a person selects or deselects objects THE SYSTEM SHALL outline the objects they have selected in that person's colour with their name on every other connected person's screen within 1 second.

IF another person selects an object THEN THE SYSTEM SHALL NOT change what the viewer has selected or prevent the viewer from editing that object.

## Friendly, remembered, renamable names

> Anchor: `presence.names`

WHEN a person opens a board for the first time in a browser THE SYSTEM SHALL give them a random two-word name of the form "Adjective Animal" and remember it for future visits in that browser, and WHEN the person renames themself THE SYSTEM SHALL show the new name on every other connected person's screen within 1 second.

## Invalid names are rejected

> Anchor: `presence.name_validation`

IF a person submits a name that is empty, only whitespace, or longer than 32 characters THEN THE SYSTEM SHALL NOT change their name and SHALL show "Name must be 1–32 characters".

## Distinct colours up to capacity

> Anchor: `presence.colors`

WHILE no more than 5 people (the configured simultaneous-editor capacity) are connected to a board THE SYSTEM SHALL show every connected person in a colour different from every other connected person's colour, on every screen.

WHILE more than 5 people are connected THE SYSTEM SHALL still show every person with a colour and name, allowing colours to repeat.

## Avatar overflow

> Anchor: `presence.overflow`

WHILE more than 5 people are connected THE SYSTEM SHALL show the first 5 avatars (the viewer's own first) and a "+N" indicator, and WHEN the viewer opens the indicator THE SYSTEM SHALL list the names and colours of all connected people.

## People who leave disappear

> Anchor: `presence.leave`

WHEN a person closes the board tab or navigates away THE SYSTEM SHALL remove their avatar, cursor and selection outlines from every other screen within 3 seconds, and IF a person's connection is lost without closing THEN THE SYSTEM SHALL remove them within 35 seconds.

## One avatar per person

> Anchor: `presence.dedupe`

IF the same person has the same board open in more than one tab or window of the same browser THEN THE SYSTEM SHALL NOT show more than one avatar for that person in anyone's avatar stack.

## Own presence not drawn as remote

> Anchor: `presence.self`

IF a cursor or selection belongs to the viewer (in the current tab) THEN THE SYSTEM SHALL NOT draw it as a remote cursor or remote selection outline on the viewer's own screen.

## Constraints

- **Capacity setting:** colour distinctness and avatar count use the same simultaneous-editor capacity setting as story 3 (5). Changing it must not need redesign; tests use the setting, not a literal number.
- **Timing settings:** cursor delivery (500 ms), cursor update rate, leave removal (3 s on close, 35 s on silent loss) are named product settings.
- **Performance:** cursor updates from 5 people must not make dragging or typing feel slower for anyone (manual check with 5 active people).
- **Cost:** presence traffic must not keep boards running when nobody is connected.
- **Accessibility:** avatars have accessible names ("Brave Heron", "Curious Otter, you"); colours are never the only way to identify a person (names always accompany colours); remote cursors are hidden from screen readers.
- **Privacy:** presence reveals only the chosen name, colour, cursor position and selection; no IP address, device or email is shared with other participants.

## Out of scope

- Follow mode, "bring everyone to me", jumping to a person's cursor.
- Off-screen cursor indicators.
- Object locking or edit conflict warnings.
- Signed-in names and profile pictures (story 14).
- Chat, reactions, emotes, voice or video.
- Showing who created or last edited an object.

