import { describe, expect, it } from "vitest";
import { createInitialState, reducer } from "../src/rules";
import type { Action, GameState } from "../src/types";

function boot() {
  let state: GameState = createInitialState("g1");
  function act(action: Action): GameState {
    const res = reducer(state, action);
    if (res.error !== undefined) throw new Error(res.error);
    state = res.state;
    return state;
  }
  function actError(action: Action): string {
    const res = reducer(state, action);
    if (res.error === undefined) throw new Error("expected an error");
    return res.error;
  }
  return { act, actError, get: () => state };
}

function joinTwo() {
  const g = boot();
  g.act({ type: "join", playerId: "alice", name: "Alice" });
  g.act({ type: "join", playerId: "bob", name: "Bob" });
  return g;
}

function addIssue(g: ReturnType<typeof boot>) {
  const s = g.act({ type: "addIssue", playerId: "alice", title: "Build login", description: "OAuth flow" });
  return s.issues[0].id;
}

describe("join / leave", () => {
  it("first joiner becomes facilitator", () => {
    const g = joinTwo();
    expect(g.get().facilitatorId).toBe("alice");
  });

  it("rejects empty or overlong names", () => {
    const g = boot();
    expect(g.actError({ type: "join", playerId: "a", name: "   " })).toContain("Name");
    expect(g.actError({ type: "join", playerId: "a", name: "x".repeat(41) })).toContain("Name");
  });

  it("rejoin with same player id keeps the seat", () => {
    const g = boot();
    g.act({ type: "join", playerId: "alice", name: "Alice" });
    const s = g.act({ type: "join", playerId: "alice", name: "Alice B" });
    expect(Object.keys(s.players)).toEqual(["alice"]);
    expect(s.players.alice.name).toBe("Alice B");
    expect(s.facilitatorId).toBe("alice");
  });

  it("facilitator transfers to next player when they leave", () => {
    const g = joinTwo();
    const s = g.act({ type: "leave", playerId: "alice" });
    expect(s.facilitatorId).toBe("bob");
  });

  it("empty game leaves no players and no facilitator", () => {
    const g = boot();
    g.act({ type: "join", playerId: "alice", name: "Alice" });
    const s = g.act({ type: "leave", playerId: "alice" });
    expect(Object.keys(s.players)).toEqual([]);
    expect(s.facilitatorId).toBeNull();
  });
});

describe("issues", () => {
  it("only the facilitator can add issues", () => {
    const g = joinTwo();
    expect(g.actError({ type: "addIssue", playerId: "bob", title: "x", description: "" })).toContain("facilitator");
  });

  it("adding an issue while voting is rejected", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    expect(g.actError({ type: "addIssue", playerId: "alice", title: "y", description: "" })).toContain("round");
  });

  it("removing the active issue is rejected", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    expect(g.actError({ type: "removeIssue", playerId: "alice", issueId })).toContain("active");
  });
});

describe("rounds", () => {
  it("startRound with null issueId creates a quick vote issue", () => {
    const g = joinTwo();
    const s = g.act({ type: "startRound", playerId: "alice", issueId: null });
    expect(s.phase).toBe("voting");
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].title).toBe("Quick vote");
    expect(s.issues[0].status).toBe("voting");
    expect(s.currentIssueId).toBe(s.issues[0].id);
  });

  it("quick votes can follow each other", () => {
    const g = joinTwo();
    g.act({ type: "startRound", playerId: "alice", issueId: null });
    g.act({ type: "vote", playerId: "alice", value: 1 });
    g.act({ type: "vote", playerId: "bob", value: 1 });
    const s = g.act({ type: "nextIssue", playerId: "alice" });
    expect(s.issues[0].status).toBe("done");
    const again = g.act({ type: "startRound", playerId: "alice", issueId: null });
    expect(again.issues).toHaveLength(2);
    expect(again.phase).toBe("voting");
  });

  it("requires at least 2 players to start", () => {
    const g = boot();
    g.act({ type: "join", playerId: "alice", name: "Alice" });
    const issueId = addIssue(g);
    expect(g.actError({ type: "startRound", playerId: "alice", issueId })).toContain("2 players");
  });

  it("reveals automatically when everyone has voted and sets estimate on consensus", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    const s1 = g.act({ type: "vote", playerId: "alice", value: 5 });
    expect(s1.phase).toBe("voting");
    const s2 = g.act({ type: "vote", playerId: "bob", value: 5 });
    expect(s2.phase).toBe("revealed");
    expect(s2.issues[0].estimate).toBe(5);
    expect(s2.issues[0].status).toBe("revealed");
  });

  it("no consensus leaves estimate null; revote works", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 3 });
    const s = g.act({ type: "vote", playerId: "bob", value: 8 });
    expect(s.phase).toBe("revealed");
    expect(s.issues[0].estimate).toBeNull();
    const again = g.act({ type: "revote", playerId: "alice" });
    expect(again.phase).toBe("voting");
    expect(again.players.alice.vote).toBeNull();
    const s2 = g.act({ type: "vote", playerId: "alice", value: 8 });
    const s3 = g.act({ type: "vote", playerId: "bob", value: 8 });
    expect(s3.issues[0].estimate).toBe(8);
  });

  it("nextIssue marks done/skipped and returns to waiting", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 2 });
    g.act({ type: "vote", playerId: "bob", value: 2 });
    const s = g.act({ type: "nextIssue", playerId: "alice" });
    expect(s.phase).toBe("waiting");
    expect(s.currentIssueId).toBeNull();
    expect(s.issues[0].status).toBe("done");

    const issue2 = g.act({ type: "addIssue", playerId: "alice", title: "Second", description: "" }).issues[1].id;
    g.act({ type: "startRound", playerId: "alice", issueId: issue2 });
    g.act({ type: "vote", playerId: "alice", value: 1 });
    g.act({ type: "vote", playerId: "bob", value: 13 });
    const s2 = g.act({ type: "nextIssue", playerId: "alice" });
    expect(s2.issues[1].status).toBe("skipped");
  });

  it("rejects invalid card values and voting outside a round", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    expect(g.actError({ type: "vote", playerId: "alice", value: 4 })).toContain("round");
    g.act({ type: "startRound", playerId: "alice", issueId });
    expect(g.actError({ type: "vote", playerId: "alice", value: 4 })).toContain("card");
    const s = g.act({ type: "vote", playerId: "alice", value: 13 });
    expect(s.players.alice.vote).toBe(13);
  });

  it("non-facilitator cannot start, advance, or revote", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    expect(g.actError({ type: "startRound", playerId: "bob", issueId })).toContain("facilitator");
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 1 });
    g.act({ type: "vote", playerId: "bob", value: 1 });
    expect(g.actError({ type: "nextIssue", playerId: "bob" })).toContain("facilitator");
    expect(g.actError({ type: "revote", playerId: "bob" })).toContain("facilitator");
  });

  it("a player leaving during voting re-triggers reveal if rest have voted", () => {
    const g = boot();
    g.act({ type: "join", playerId: "alice", name: "Alice" });
    g.act({ type: "join", playerId: "bob", name: "Bob" });
    g.act({ type: "join", playerId: "carol", name: "Carol" });
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 3 });
    g.act({ type: "vote", playerId: "bob", value: 3 });
    const s = g.act({ type: "leave", playerId: "carol" });
    expect(s.phase).toBe("revealed");
    expect(s.issues[0].estimate).toBe(3);
  });

  it("a player leaving until fewer than 2 cancels the round", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 3 });
    const s = g.act({ type: "leave", playerId: "bob" });
    expect(s.phase).toBe("waiting");
    expect(s.currentIssueId).toBeNull();
    expect(s.issues[0].status).toBe("pending");
    expect(s.players.alice.vote).toBeNull();
  });

  it("completed issues can be re-estimated", () => {
    const g = joinTwo();
    const issueId = addIssue(g);
    g.act({ type: "startRound", playerId: "alice", issueId });
    g.act({ type: "vote", playerId: "alice", value: 2 });
    g.act({ type: "vote", playerId: "bob", value: 2 });
    g.act({ type: "nextIssue", playerId: "alice" });
    const s = g.act({ type: "startRound", playerId: "alice", issueId });
    expect(s.phase).toBe("voting");
    expect(s.round).toBe(2);
  });
});
