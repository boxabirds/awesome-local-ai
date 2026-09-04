import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toAction } from "../src/actions";
import { createInitialState, reducer } from "../src/rules";
import type { GameState } from "../src/types";

function gameStub(name: string) {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name));
}

describe("GameRoom", () => {
  it("initializes and accepts joins via submit", async () => {
    const stub = gameStub("do-test-1");
    await stub.init("do-test-1");
    const res = await stub.submit({ type: "join", playerId: "a1", name: "Alice" });
    expect(res.error).toBeUndefined();
    expect(res.state?.facilitatorId).toBe("a1");
    expect(res.state?.gameId).toBe("do-test-1");
  });

  it("init is idempotent and does not reset state", async () => {
    const stub = gameStub("do-test-2");
    await stub.init("do-test-2");
    await stub.submit({ type: "join", playerId: "a", name: "A" });
    await stub.init("do-test-2");
    const res = await stub.submit({ type: "addIssue", playerId: "a", title: "x", description: "" });
    expect(res.error).toBeUndefined();
  });

  it("runs a full voting round to consensus", async () => {
    const stub = gameStub("do-test-4");
    await stub.init("do-test-4");
    await stub.submit({ type: "join", playerId: "a", name: "A" });
    await stub.submit({ type: "join", playerId: "b", name: "B" });
    const added = await stub.submit({ type: "addIssue", playerId: "a", title: "T", description: "" });
    const issueId = added.state?.issues[0].id;
    expect(issueId).toBeTruthy();
    await stub.submit({ type: "startRound", playerId: "a", issueId: issueId as string });
    await stub.submit({ type: "vote", playerId: "a", value: 5 });
    const revealed = await stub.submit({ type: "vote", playerId: "b", value: 5 });
    expect(revealed.state?.phase).toBe("revealed");
    expect(revealed.state?.issues[0].estimate).toBe(5);
  });

  it("persists state to DO storage on every change", async () => {
    const stub = gameStub("do-persist-1");
    await stub.init("do-persist-1");
    await stub.submit({ type: "join", playerId: "p1", name: "P1" });
    await stub.submit({ type: "join", playerId: "p2", name: "P2" });

    const persisted = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get<string>("state"),
    );
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted as string) as GameState;
    expect(Object.keys(parsed.players)).toEqual(["p1", "p2"]);
    expect(parsed.facilitatorId).toBe("p1");
  });
});

describe("quick vote (startRound with a null issueId)", () => {
  // The browser's "Start quick vote" button sends exactly this (Game.tsx):
  //   send({ type: "startRound", issueId: null })
  // The server must preserve the null so the reducer starts a quick vote,
  // not report a missing issue. Regression: was "Issue not found".
  it("turns a null issueId into a Quick vote, not 'Issue not found'", () => {
    // Parse the raw wire payload exactly as GameRoom.handleMessage does.
    const raw = JSON.parse('{"type":"startRound","issueId":null}');
    const action = toAction(raw, "alice");
    expect(action).toEqual({ type: "startRound", playerId: "alice", issueId: null });

    // Run that action through the real reducer and confirm the round starts.
    let state = createInitialState("g1");
    state = reducer(state, { type: "join", playerId: "alice", name: "Alice" }).state!;
    state = reducer(state, { type: "join", playerId: "bob", name: "Bob" }).state!;
    const result = reducer(state, action!);
    expect(result.error).toBeUndefined();
    expect(result.state?.phase).toBe("voting");
    expect(result.state?.issues[0].title).toBe("Quick vote");
  });

  it("still starts a round for a real issue id", () => {
    let state = createInitialState("g2");
    state = reducer(state, { type: "join", playerId: "alice", name: "Alice" }).state!;
    state = reducer(state, { type: "join", playerId: "bob", name: "Bob" }).state!;
    state = reducer(state, {
      type: "addIssue",
      playerId: "alice",
      title: "Build login",
      description: "",
    }).state!;
    const issueId = state.issues[0].id;

    const action = toAction({ type: "startRound", issueId }, "alice");
    const result = reducer(state, action!);
    expect(result.error).toBeUndefined();
    expect(result.state?.issues[0].status).toBe("voting");
  });
});
