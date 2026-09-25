import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CURSOR_VISIBLE_AFTER_MS, cursorVisible, distinguish } from './people';
import type { Person } from './people';
import { createPresenceChannel, type PresenceChannel } from './transport';
import { readIdentity, validateName, writeIdentity, type Identity } from './identity';
import type { BoardSession } from '../sync/boardSession';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

/**
 * The board's view of the other people (story 6, tasks 3 and 5).
 *
 * The hook owns three small things and nothing else: who this browser is, the
 * channel that carries presence, and a clock. Drawing is left to
 * `presence/Presence.tsx`, which is why a component test can pin a cursor to an
 * age instead of waiting for one.
 *
 * Three things are worth the comment:
 *
 *  - the clock only ticks while there is somebody to time, so an idle board
 *    runs no timers (and the render-cost tests stay honest);
 *  - a tick *re-renders*, so the two-second rule is applied by the same pure
 *    function a test calls rather than by a paint somewhere else;
 *  - what a person is *called* and what they are *drawn in* are settled here,
 *    at the last moment, from the whole board — see `distinguish`. They used to
 *    be settled by each browser re-publishing itself when it noticed a clash,
 *    which five people arriving at once turn into a race that never ends.
 */

/** How often the presence clock advances while people are on screen. */
const CLOCK_TICK_MS = 100;

export interface PresenceView {
  /** The other people, in world coordinates, exactly as they reported themselves. */
  people: readonly Person[];
  /** The clock the overlay is drawn against. */
  now: number;
  /** Who this browser is, before the board has been made to tell people apart. */
  self: Identity;
  /** This browser's awareness id, which is the key the uniqueness pass is ordered by. */
  selfId: number;
  /**
   * The whole board — this browser included — with a name and a colour per
   * person. `people` plus `self`, through `distinguish`.
   */
  board: readonly Person[];
  /** The people who get a cursor: the board, minus the pointer this screen already has. */
  cursors: readonly Person[];
  /**
   * Who is holding what, for the outline layer.
   *
   * Read, never written into this board's selection: the whole point of the
   * outline is to say *somebody else is editing here* without taking the note
   * away from me.
   */
  selections: readonly Person[];
  /** Report what this screen has picked up (`null` clears it). */
  setSelection(id: string | null): void;
  /** Report a pointer position, in *screen* pixels relative to the board area. */
  publish(point: Point): void;
  /**
   * Take this screen's pointer out of the way (cursor left the board, or the
   * tab went to the background).
   */
  hide(): void;
  /**
   * Call this browser something else, for as long as this browser lasts.
   *
   * Returns the reason it was refused, or `null` when it stuck. A name that is
   * too long, empty or all spaces is not silently shortened: the field says why
   * and the old name stays, because a name you did not agree to is not yours.
   */
  rename(raw: string): string | null;
}

/** Where a name and colour are kept, when a store exists at all. */
function identityStore(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/**
 * What the others already answer to, and already wear.
 *
 * Only used to *arrive*: a browser that walks onto a board where the first name
 * and the first colour are taken starts somewhere else, which is the ordinary
 * case and costs nothing. Keeping people apart once they are here is
 * `distinguish`'s job, because that is the part five simultaneous arrivals
 * cannot settle one browser at a time.
 */
function takenFrom(session: BoardSession): { names: string[]; colors: string[] } {
  const taken = { names: [] as string[], colors: [] as string[] };
  const awareness = session.connection?.provider.awareness;
  if (awareness === undefined || awareness === null) return taken;
  const me = awareness.clientID ?? null;
  for (const [clientId, state] of awareness.states) {
    // My own state is not somebody else's name, and my own colour is not somebody
    // else's colour. Reading it as taken is what sent a board here looking for a
    // colour to change to on every single update.
    if (me !== null && clientId === me) continue;
    const presence = state['presence'];
    if (presence === null || typeof presence !== 'object') continue;
    const record = presence as { name?: unknown; color?: unknown };
    if (typeof record.name === 'string') taken.names.push(record.name);
    if (typeof record.color === 'string') taken.colors.push(record.color);
  }
  return taken;
}

/**
 * This browser's place in the order people are told apart by.
 *
 * The awareness client id, which is also the key the other people are stored
 * under, and which two tabs of the same browser disagree about precisely
 * because each has its own document. `0` when there is no connection at all: a
 * board with nobody on it has nobody to be distinguished from.
 */
function ownClientId(session: BoardSession): number {
  return session.connection?.provider.awareness?.clientID ?? 0;
}

/**
 * The presence for one board session.
 *
 * `cameraRef` is read rather than taken as a value so a pan or a zoom does not
 * resubscribe anything: cursors live in world coordinates precisely so that
 * moving *my* view does not move *their* arrows.
 */
export function usePresence(
  session: BoardSession,
  cameraRef: { current: { camera: Camera } },
): PresenceView {
  const [identity, setIdentity] = useState<Identity>(() =>
    readIdentity(identityStore(), takenFrom(session)),
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const channelRef = useRef<PresenceChannel | null>(null);
  const selfId = useMemo(() => ownClientId(session), [session]);

  useEffect(() => {
    const provider = session.connection?.provider ?? null;
    const channel = createPresenceChannel({
      // A getter, not a snapshot: a name changed in the settings panel has to
      // reach the wire, and a captured value would keep announcing the old one.
      identity: () => identityRef.current,
      provider,
      now: () => Date.now(),
      onChange: () => {
        setPeople(channel.people());
        setNow(Date.now());
      },
    });
    channelRef.current = channel;
    // Ask who is here, and say who we are, before the first pointer move: a
    // person sitting still is still a person on the board.
    channel.query();
    channel.announce();
    return () => {
      channel.destroy();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [session]);

  /**
   * A tick only while a cursor is actually on screen, so an idle board runs no
   * timers and a board that is merely *occupied* renders twice a second rather
   * than ten times.
   *
   * The clock exists to fade arrows that have gone quiet. It is not a clock for
   * the avatar stack, which no longer fades anybody, and a board that repaints
   * every 100 ms while six people sit and read it costs a page nothing to look
   * at and everything to a hit-test that wants to know where a button was.
   */
  const hasVisibleCursor = people.some((person) => cursorVisible(person, now));
  useEffect(() => {
    if (!hasVisibleCursor) return;
    const interval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [hasVisibleCursor]);

  const publish = useCallback(
    (point: Point) => {
      const channel = channelRef.current;
      if (channel === null) return;
      const camera = cameraRef.current?.camera;
      if (camera === undefined) return;
      const world = screenToWorld(camera, point);
      channel.publish(world.x, world.y);
    },
    [cameraRef],
  );

  const hide = useCallback(() => {
    channelRef.current?.hide();
  }, []);

  const setSelection = useCallback((id: string | null) => {
    channelRef.current?.publishSelection(id === null ? [] : [id]);
  }, []);

  const rename = useCallback((raw: string): string | null => {
    const check = validateName(raw);
    if (!check.ok) return check.error;
    const store = identityStore();
    const next = { ...identityRef.current, name: check.name };
    // Remembered before anything else: a rename that reaches the other four
    // boards but not storage is a name you have to type again tomorrow.
    writeIdentity(store, next);
    identityRef.current = next;
    setIdentity(next);
    // And said again out loud, or the other screens go on drawing the name you
    // arrived with: nothing else pushes a state change on a board you are not
    // pointing at.
    channelRef.current?.announce();
    return null;
  }, []);

  // Settled once per (people, clock) change rather than per pointer: with five
  // people moving this runs twenty times a second, and it is a pass over at most
  // a handful of people, which is why it can afford to be a function rather than
  // a protocol.
  const board = useMemo(
    () =>
      distinguish([
        {
          // This browser, first in the list and under its real id: the pass that
          // makes people distinguishable has to see everybody, or the person
          // looking at the board is the one person it gets wrong.
          clientId: selfId,
          name: identity.name,
          color: identity.color,
          id: identity.id,
          x: null,
          y: null,
          selection: [],
          lastActive: now,
          sentAt: now,
        },
        ...people,
      ]),
    [people, selfId, identity, now],
  );

  return {
    people,
    now,
    self: identity,
    selfId,
    board,
    cursors: board.filter((person) => person.clientId !== selfId),
    selections: board.filter((person) => person.clientId !== selfId && person.selection.length > 0),
    publish,
    hide,
    setSelection,
    rename,
  };
}

/** The same people, in the screen coordinates the overlay draws in. */
export function toScreenPeople(
  people: readonly Person[],
  camera: Camera,
): readonly Person[] {
  return people.map((person) => {
    if (person.x === null || person.y === null) return person;
    const point = worldToScreen(camera, { x: person.x, y: person.y });
    return { ...person, x: point.x, y: point.y };
  });
}

export { CURSOR_VISIBLE_AFTER_MS };

/** Kept for the effect above: the store is only consulted through these. */
export const __identityStoreForTests = identityStore;
