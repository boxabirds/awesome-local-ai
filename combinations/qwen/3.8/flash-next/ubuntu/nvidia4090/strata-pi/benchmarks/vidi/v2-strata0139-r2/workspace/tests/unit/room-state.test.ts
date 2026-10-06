/**
 * Unit tests for the room lifecycle transition table (TC-27).
 *
 * Every edge of `design.md`'s room state diagram is one case, and every event
 * that means nothing in a state must leave that state alone. The room uses this
 * exact function, so these cases are the room's own state machine.
 */

import { describe, expect, it } from "vitest";
import { LOAD_RETRY_MIN_INTERVAL_MS } from "../../src/shared/config";
import {
  nextRoomState,
  roomServes,
  type RoomEvent,
  type RoomLifecycleState,
} from "../../src/worker/room-state";

const STATES: RoomLifecycleState[] = [
  "loading",
  "ready",
  "compacting",
  "storage-failed",
  "hibernated",
  "load-failed",
];

const EVENTS: RoomEvent[] = [
  { type: "load-succeeded", quarantined: 0 },
  { type: "load-succeeded", quarantined: 2 },
  { type: "load-failed" },
  { type: "update-applied" },
  { type: "compact-started" },
  { type: "compacted" },
  { type: "compaction-failed" },
  { type: "append-failed" },
  { type: "hibernated" },
  { type: "woken" },
  { type: "new-connection", sinceFailureMs: 0 },
  { type: "message-received" },
];

describe("room lifecycle edges (TC-27)", () => {
  it("Loading → Ready when the snapshot and log are applied", () => {
    expect(nextRoomState("loading", { type: "load-succeeded", quarantined: 0 })).toBe("ready");
  });

  it("Loading → Ready when damaged log rows were quarantined and the rest applied", () => {
    expect(nextRoomState("loading", { type: "load-succeeded", quarantined: 2 })).toBe("ready");
  });

  it("Loading → LoadFailed when the snapshot is unreadable or the SQL fails", () => {
    expect(nextRoomState("loading", { type: "load-failed" })).toBe("load-failed");
  });

  it("Ready → Ready on an applied, stored, broadcast update", () => {
    expect(nextRoomState("ready", { type: "update-applied" })).toBe("ready");
  });

  it("Ready → Compacting → Ready when compaction succeeds", () => {
    const compacting = nextRoomState("ready", { type: "compact-started" });
    expect(compacting).toBe("compacting");
    expect(nextRoomState(compacting, { type: "compacted" })).toBe("ready");
  });

  it("Ready → Compacting → Ready when compaction is rolled back", () => {
    const compacting = nextRoomState("ready", { type: "compact-started" });
    expect(nextRoomState(compacting, { type: "compaction-failed" })).toBe("ready");
  });

  it("Ready → StorageFailed when an insert throws", () => {
    expect(nextRoomState("ready", { type: "append-failed" })).toBe("storage-failed");
  });

  it("Compacting → StorageFailed when an insert throws mid-compaction", () => {
    expect(nextRoomState("compacting", { type: "append-failed" })).toBe("storage-failed");
  });

  it("StorageFailed → Loading on the next connection", () => {
    expect(nextRoomState("storage-failed", { type: "new-connection", sinceFailureMs: 1 })).toBe("loading");
    expect(nextRoomState("storage-failed", { type: "woken" })).toBe("loading");
  });

  it("Ready → Hibernated when the room goes idle", () => {
    expect(nextRoomState("ready", { type: "hibernated" })).toBe("hibernated");
  });

  it("Hibernated → Loading when a message or a new connection wakes the object", () => {
    expect(nextRoomState("hibernated", { type: "message-received" })).toBe("loading");
    expect(nextRoomState("hibernated", { type: "new-connection", sinceFailureMs: 0 })).toBe("loading");
    expect(nextRoomState("hibernated", { type: "woken" })).toBe("loading");
  });

  it("LoadFailed → Loading on a new connection only after LOAD_RETRY_MIN_INTERVAL_MS", () => {
    expect(
      nextRoomState("load-failed", {
        type: "new-connection",
        sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS - 1,
      }),
    ).toBe("load-failed");
    expect(
      nextRoomState("load-failed", {
        type: "new-connection",
        sinceFailureMs: LOAD_RETRY_MIN_INTERVAL_MS,
      }),
    ).toBe("loading");
  });

  it("LoadFailed stays LoadFailed for anything that is not a new connection", () => {
    expect(nextRoomState("load-failed", { type: "message-received" })).toBe("load-failed");
    expect(nextRoomState("load-failed", { type: "update-applied" })).toBe("load-failed");
    expect(nextRoomState("load-failed", { type: "woken" })).toBe("load-failed");
  });

  it("a new connection to a Ready room does not disturb it", () => {
    expect(nextRoomState("ready", { type: "new-connection", sinceFailureMs: 0 })).toBe("ready");
  });
});

describe("invalid events leave the state unchanged (TC-27 negative)", () => {
  const invalid: { state: RoomLifecycleState; event: RoomEvent; why: string }[] = [
    { state: "loading", event: { type: "compacted" }, why: "no compaction can finish mid-load" },
    { state: "loading", event: { type: "compaction-failed" }, why: "no compaction has begun" },
    { state: "loading", event: { type: "append-failed" }, why: "nothing is being written yet" },
    { state: "loading", event: { type: "update-applied" }, why: "load-origin updates are not changes" },
    { state: "loading", event: { type: "hibernated" }, why: "the object is busy loading" },
    { state: "loading", event: { type: "new-connection", sinceFailureMs: 0 }, why: "already loading" },
    { state: "ready", event: { type: "load-succeeded", quarantined: 0 }, why: "already loaded" },
    { state: "ready", event: { type: "load-failed" }, why: "a ready room does not reload" },
    { state: "ready", event: { type: "compacted" }, why: "compaction must start first" },
    { state: "ready", event: { type: "compaction-failed" }, why: "compaction must start first" },
    { state: "ready", event: { type: "woken" }, why: "the object is already awake" },
    { state: "compacting", event: { type: "load-succeeded", quarantined: 0 }, why: "not loading" },
    { state: "compacting", event: { type: "load-failed" }, why: "not loading" },
    { state: "compacting", event: { type: "compact-started" }, why: "already compacting" },
    { state: "compacting", event: { type: "hibernated" }, why: "a transaction is open" },
    { state: "compacting", event: { type: "new-connection", sinceFailureMs: 10 }, why: "already awake" },
    { state: "storage-failed", event: { type: "load-succeeded", quarantined: 0 }, why: "must reload first" },
    { state: "storage-failed", event: { type: "update-applied" }, why: "the document is gone" },
    { state: "storage-failed", event: { type: "message-received" }, why: "sockets were closed" },
    { state: "hibernated", event: { type: "load-succeeded", quarantined: 0 }, why: "must wake first" },
    { state: "hibernated", event: { type: "update-applied" }, why: "no document in memory" },
    { state: "hibernated", event: { type: "hibernated" }, why: "already hibernated" },
    { state: "load-failed", event: { type: "load-succeeded", quarantined: 0 }, why: "must retry first" },
    { state: "load-failed", event: { type: "load-failed" }, why: "nothing is being loaded" },
    { state: "load-failed", event: { type: "append-failed" }, why: "nothing is being written" },
    { state: "load-failed", event: { type: "compact-started" }, why: "there is no document" },
  ];

  for (const testCase of invalid) {
    it(`${testCase.state} + ${testCase.event.type} is ignored: ${testCase.why}`, () => {
      expect(nextRoomState(testCase.state, testCase.event)).toBe(testCase.state);
    });
  }
});

describe("serving states", () => {
  it("only a ready or compacting room serves and stores documents", () => {
    for (const state of STATES) {
      expect(roomServes(state)).toBe(state === "ready" || state === "compacting");
    }
  });
});

describe("the table is total", () => {
  it("every (state, event) pair returns a state and never throws", () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const next = nextRoomState(state, event);
        expect(STATES).toContain(next);
      }
    }
  });
});
