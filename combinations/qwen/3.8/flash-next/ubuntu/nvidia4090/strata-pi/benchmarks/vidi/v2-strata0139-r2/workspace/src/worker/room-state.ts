/**
 * The board room's lifecycle as a pure transition table (`persist.room`).
 *
 * `design.md`'s room lifecycle diagram is the specification; this file is that
 * diagram in code, so every edge and every invalid event is testable without a
 * Durable Object. `BoardRoom` moves through these states by calling
 * `nextRoomState`, so what the unit tests prove is the table the room actually
 * uses.
 *
 * The states:
 *
 *   loading         constructed or woken; the snapshot and log are being read
 *   ready           the document is in memory and the log is writable
 *   compacting      inside one storage transaction replacing snapshot + log
 *   storage-failed  a write failed: sockets closed, document discarded
 *   hibernated      idle, sockets may stay open, no compute in use
 *   load-failed     the saved board could not be read: nothing is served
 *
 * `RoomState` is the subset a client can observe through the room's behaviour;
 * `RoomLifecycleState` is the full diagram.
 */

import { LOAD_RETRY_MIN_INTERVAL_MS } from "../shared/config";

/** The serving states named in the `persist.room` contract. */
export type RoomState = "ready" | "load-failed" | "storage-failed";

/** Every state of the room lifecycle diagram. */
export type RoomLifecycleState = "loading" | RoomState | "compacting" | "hibernated";

/** Everything that can happen to a room. */
export type RoomEvent =
  /** The snapshot and log were read into the document. */
  | { type: "load-succeeded"; quarantined: number }
  /** The snapshot is unreadable, or the SQL itself failed. */
  | { type: "load-failed" }
  /** An update was applied to the document (and, from `ready`, stored). */
  | { type: "update-applied" }
  /** A compaction transaction has begun. */
  | { type: "compact-started" }
  /** The snapshot was replaced and the log truncated. */
  | { type: "compacted" }
  /** The compaction transaction was rolled back; snapshot and log survive. */
  | { type: "compaction-failed" }
  /** An `append` threw: the room cannot be trusted until it reloads. */
  | { type: "append-failed" }
  /** The room went idle; only hibernating sockets keep the board open. */
  | { type: "hibernated" }
  /** A message or a new connection woke a hibernated object. */
  | { type: "woken" }
  /** A client connected; `sinceFailureMs` is how long it has been failing. */
  | { type: "new-connection"; sinceFailureMs: number }
  /** A frame arrived on an already-open socket. */
  | { type: "message-received" };

/**
 * The next state for one (state, event) pair.
 *
 * An event that means nothing in a state leaves that state unchanged: a room
 * that is already failing to load does not become something else because a
 * client tried to connect, and a compaction result cannot arrive while a
 * document is still being read.
 */
export function nextRoomState(
  state: RoomLifecycleState,
  event: RoomEvent,
): RoomLifecycleState {
  switch (state) {
    case "loading":
      switch (event.type) {
        case "load-succeeded":
          return "ready";
        case "load-failed":
          return "load-failed";
        default:
          return state;
      }

    case "ready":
      switch (event.type) {
        case "update-applied":
          return "ready";
        case "compact-started":
          return "compacting";
        case "append-failed":
          return "storage-failed";
        case "hibernated":
          return "hibernated";
        case "new-connection":
          return "ready";
        default:
          return state;
      }

    case "compacting":
      switch (event.type) {
        case "compacted":
        case "compaction-failed":
          return "ready";
        case "append-failed":
          return "storage-failed";
        default:
          return state;
      }

    case "storage-failed":
      switch (event.type) {
        // The document is gone; the next connection reloads it from storage.
        case "new-connection":
        case "woken":
          return "loading";
        default:
          return state;
      }

    case "hibernated":
      switch (event.type) {
        case "woken":
        case "new-connection":
        case "message-received":
          return "loading";
        default:
          return state;
      }

    case "load-failed":
      switch (event.type) {
        // Retry only once the retry interval has passed; before that the room
        // stays broken and answers every connection with 4500.
        case "new-connection":
          return event.sinceFailureMs >= LOAD_RETRY_MIN_INTERVAL_MS ? "loading" : "load-failed";
        default:
          return state;
      }
  }
}

/** True when the room serves documents and stores changes. */
export function roomServes(state: RoomLifecycleState): state is "ready" | "compacting" {
  return state === "ready" || state === "compacting";
}

/**
 * How long a load-failed room must wait before it may try again — the same
 * setting `nextRoomState` uses, exported so the room and its tests read one
 * number.
 */
export const ROOM_LOAD_RETRY_MIN_INTERVAL_MS = LOAD_RETRY_MIN_INTERVAL_MS;
