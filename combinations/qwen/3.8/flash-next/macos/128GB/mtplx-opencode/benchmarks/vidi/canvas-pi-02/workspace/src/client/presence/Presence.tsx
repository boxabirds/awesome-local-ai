import { useState } from 'react';
import { MAX_AVATARS_SHOWN } from '../../shared/config';
import { type Camera, worldToScreen } from '../canvas/camera';
import { type Person, cursorVisible, nameLabel } from './people';

/** How thick a remote selection's frame is, in screen pixels at any zoom. */
const SELECTION_OUTLINE_PX = 2;

/** A note's box, in world coordinates, for the outline layer to draw around. */
export interface OutlineTarget {
  id: string;
  x: number;
  y: number;
}


/**
 * Where the other people are, and who they are (story 6, task 5).
 *
 * Two surfaces, one file, because they are the same information read two ways:
 *
 *  - `RemoteCursors` is a pointer triangle plus a name label in that person's
 *    colour, sitting at their pointer and gone two seconds after the last word
 *    about them;
 *  - `PresenceStack` is the row of overlapping avatars in the corner, initial
 *    and colour each, collapsing into `+N` past the configured limit.
 *
 * Both are *pure*: they are given the people and the current time and they
 * draw. Nothing here opens a socket, reads a clock or owns a timer, which is
 * what makes the two-second rule testable at all — a component with its own
 * `setInterval` can only be tested by waiting.
 *
 * Cursors are drawn in *screen* coordinates: the caller applies the camera,
 * because the alternative is a component that has to know what a camera is.
 */

/** One person's cursor: a triangle and a label, in their colour. */
export function RemoteCursor({ person }: { person: Person }) {
  const label = nameLabel(person.name);
  return (
    <div
      data-testid="remote-cursor"
      data-client={person.clientId}
      style={{
        position: 'absolute',
        left: person.x ?? 0,
        top: person.y ?? 0,
        transform: 'translate(-2px, -2px)',
        pointerEvents: 'none',
      }}
    >
      <svg aria-hidden width="12" height="18" viewBox="0 0 12 18">
        <path d="M1 1 L11 9 L6 10 L8 16 L6 17 L4 11 L1 13 Z" fill={person.color} />
      </svg>
      <span
        data-testid="cursor-label"
        style={{
          background: person.color,
          color: '#fff',
          borderRadius: 4,
          padding: '1px 4px',
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Every remote cursor that should be on screen right now.
 *
 * The filter lives here rather than in the caller so that "hidden two seconds
 * after their last update" is one rule with one home, and so a caller that
 * forgets to filter still gets the right picture.
 *
 * `viewport` is the size of the board area, and a cursor outside it is *left
 * out* rather than clipped: a label drawn a hundred pixels past the edge still
 * costs a paint, and an arrow that is technically off-screen but half-drawn is
 * a pointer pointing at nothing.
 */
export function RemoteCursors({
  people,
  now,
  viewport = null,
}: {
  people: readonly Person[];
  now: number;
  viewport?: { width: number; height: number } | null;
}) {
  const visible = people.filter((person) => {
    if (!cursorVisible(person, now)) return false;
    if (viewport === null || person.x === null || person.y === null) return true;
    return (
      person.x >= 0 && person.y >= 0 && person.x <= viewport.width && person.y <= viewport.height
    );
  });
  if (visible.length === 0) return null;
  return (
    <div
      data-testid="remote-cursors"
      // The layer covers the whole board, so it must not intercept a single
      // click: a curtain you cannot click through is a board you cannot use.
      data-pointer-events="none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {visible.map((person) => (
        <RemoteCursor key={person.clientId} person={person} />
      ))}
    </div>
  );
}

/** How long ago that was, in the words a tooltip is allowed to use. */function activeAgo(seconds: number): string {
  if (seconds < 1) return 'active now';
  if (seconds < 60) return `active ${Math.floor(seconds)}s ago`;
  if (seconds < 3_600) return `active ${Math.floor(seconds / 60)}m ago`;
  return `active ${Math.floor(seconds / 3_600)}h ago`;
}

/**
 * The participant stack: you and everyone else, overlapping, colour-coded.
 *
 * `MAX_AVATARS_SHOWN` avatars at most; the rest collapse into a `+N` chip that
 * still says how many. The tooltip carries the full name and how long ago that
 * person was last heard of, which is the part a row of circles cannot say.
 *
 * `selfId` marks which of them is *you*. It is a parameter rather than a rule
 * inside because only the caller knows which end of the wire it is on, and
 * because a stack that cannot say which dot is yours shows you a stranger where
 * you should be — the same reason your own pointer is drawn as an arrow.
 */
export function PresenceStack({
  people,
  now,
  selfId = null,
}: {
  people: readonly Person[];
  now: number;
  selfId?: number | null;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_AVATARS_SHOWN);
  const hidden = people.length - shown.length;
  return (
    <div data-testid="presence-stack" style={{ display: 'flex' }}>
      {/* The dots get a track of their own, as wide as the most of them that
          ever fit. Without it the `+N` chip slides sideways every time somebody
          arrives or leaves, and a marker that will not sit still is harder to
          open than one that does — nobody hunts for a person by their position. */}
      <div
        data-testid="avatar-track"
        style={{ display: 'flex', width: MAX_AVATARS_SHOWN * 20 + 8 }}
      >
      {shown.map((person, index) => (
        <span
          key={person.clientId}
          data-testid="avatar"
          data-client={person.clientId}
          // The colour a person is drawn in, readable without unpicking a
          // computed style. Story 6's whole claim is that five people are five
          // *different* colours, and a test has to be able to count that.
          data-color={person.color}
          data-name={nameLabel(person.name)}
          data-self={person.clientId === selfId ? 'true' : undefined}
          role="img"
          // The accessible name says the same thing the dot says: who, and
          // whether it is you. A screen reader otherwise hears "C" five times.
          aria-label={`${nameLabel(person.name)}${person.clientId === selfId ? ', you' : ''}`}
          title={`${person.clientId === selfId ? 'You · ' : ''}${nameLabel(person.name)} · ${activeAgo((now - person.lastActive) / 1_000)}`}
          style={{
            marginLeft: index === 0 ? 0 : -8,
            background: person.color,
            color: '#fff',
            borderRadius: '50%',
            width: 28,
            height: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
          }}
        >
          {person.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      </div>
      {hidden > 0 ? (
        <details data-testid="avatar-overflow" style={{ marginLeft: 4, fontSize: 11 }}>
          {/* A count you cannot open is a rumour. The chip is the door to a list of
              *everyone* on the board rather than only the people who did not fit:
              a list that hides five of the six is a list that still cannot answer
              "who is on this board", which is the question the stack is for. */}
          <summary style={{ cursor: 'pointer' }}>{`+${hidden}`}</summary>
          <ul data-testid="avatar-overflow-list" style={{ listStyle: 'none', margin: 0, padding: 4 }}>
            {people.map((person) => (
              <li
                key={person.clientId}
                data-testid="overflow-person"
                data-color={person.color}
                data-name={nameLabel(person.name)}
              >
                <span
                  aria-hidden
                  style={{
                    background: person.color,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    display: 'inline-block',
                    marginRight: 4,
                  }}
                />
                {nameLabel(person.name)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * What you are called, and the one way to change it.
 *
 * The name in the stack is a preference, not a fact: a person who has been
 * `Curious Otter` for an hour and would rather be `Alex` is the case the design
 * bothers about. Refusal is shown rather than swallowed — an over-long name is
 * reported as "Name must be 1–32 characters" and the old name stays, because a
 * field that silently chops your input teaches you not to trust it.
 */
export function PresenceIdentity({
  name,
  onRename,
}: {
  name: string;
  onRename: (raw: string) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (raw: string): void => {
    const refusal = onRename(raw);
    setError(refusal);
    if (refusal === null) setDraft(null);
  };
  return (
    <div data-testid="presence-identity" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span data-testid="self-name">{nameLabel(name)}</span>
      {draft === null ? (
        <button type="button" onClick={() => setDraft(name)}>
          Rename
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <input
            aria-label="Your name"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
          <button type="submit">Save</button>
          {error !== null ? <span data-testid="rename-error">{error}</span> : null}
        </form>
      )}
    </div>
  );
}

/**
 * What the other people have picked up.
 *
 * A rectangle around the note, in their colour, with their name on it. This is
 * the half of the story that stops two people typing in the same note, and it
 * works by *showing* rather than by locking: nothing here prevents an edit, and
 * nothing here may, because a board that quietly refuses my keystroke because
 * somebody else is in a note is a board I cannot use.
 *
 * Drawn in screen coordinates out of world coordinates, which is what keeps the
 * line two pixels thick at every zoom — the note grows with the zoom, the
 * outline around it does not, and an eight-pixel pink frame at 400% is a wall
 * rather than a hint.
 *
 * A selection whose note is gone is not drawn. That is not a corner we cut: a
 * rectangle around nothing at all is a claim about a note that does not exist,
 * and it is exactly the kind of confident lie a stale byte would tell.
 */
export function RemoteSelections({
  people,
  objects,
  camera,
  size,
}: {
  people: readonly Person[];
  objects: readonly OutlineTarget[];
  camera: Camera;
  size: number;
}) {
  const outlines: { key: string; person: Person; target: OutlineTarget }[] = [];
  // Reversed so the first person listed is painted last, and therefore on top:
  // the stack's "earliest first" order is the same order the outlines stack in.
  for (const person of [...people].reverse()) {
    for (const id of person.selection) {
      const target = objects.find((object) => object.id === id);
      if (target === undefined) continue;
      outlines.push({ key: `${person.clientId}:${id}`, person, target });
    }
  }
  if (outlines.length === 0) return null;
  return (
    <div
      data-testid="remote-selections"
      data-pointer-events="none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {outlines.map(({ key, person, target }) => {
        const corner = worldToScreen(camera, { x: target.x, y: target.y });
        return (
          <div
            key={key}
            data-testid="selection-outline"
            data-client={person.clientId}
            data-target={target.id}
            style={{
              position: 'absolute',
              left: corner.x,
              top: corner.y,
              width: size * camera.zoom,
              height: size * camera.zoom,
              border: `${SELECTION_OUTLINE_PX}px solid ${person.color}`,
              borderRadius: 6,
              pointerEvents: 'none',
            }}
          >
            <span
              data-testid="selection-tag"
              style={{
                position: 'absolute',
                top: -SELECTION_OUTLINE_PX,
                left: 0,
                transform: 'translateY(-100%)',
                background: person.color,
                color: '#fff',
                borderRadius: 4,
                padding: '1px 4px',
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              {nameLabel(person.name)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
