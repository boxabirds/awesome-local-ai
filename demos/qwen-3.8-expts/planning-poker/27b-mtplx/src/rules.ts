import type { Action, GameState, Issue, Result } from "./types";

export const FIBONACCI_DECK: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 100];

export const MAX_NAME_LENGTH = 40;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_PLAYERS = 50;
export const MIN_PLAYERS_FOR_ROUND = 2;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function createInitialState(gameId: string): GameState {
  return {
    gameId,
    createdAt: Date.now(),
    phase: "waiting",
    currentIssueId: null,
    round: 0,
    players: {},
    issues: [],
    facilitatorId: null,
  };
}

function ok(state: GameState): Result {
  return { state };
}

function fail(error: string): Result {
  return { error };
}

function allVoted(state: GameState): boolean {
  const players = Object.values(state.players);
  return players.length > 0 && players.every((p) => p.vote !== null);
}

function reveal(state: GameState): void {
  const issue = state.issues.find((i) => i.id === state.currentIssueId);
  if (!issue) return;
  const values = Object.values(state.players).map((p) => p.vote as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  issue.status = "revealed";
  issue.history.push(min === max ? min : Math.round(mean * 10) / 10);
  if (min === max) issue.estimate = min;
  state.phase = "revealed";
}

function clearAllVotes(state: GameState): void {
  for (const p of Object.values(state.players)) p.vote = null;
}

export function reducer(input: GameState, action: Action): Result {
  const state = JSON.parse(JSON.stringify(input)) as GameState;

  switch (action.type) {
    case "join": {
      const name = action.name.trim();
      if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
        return fail("Name must be 1-40 characters");
      }
      const existing = state.players[action.playerId];
      if (existing) {
        existing.name = name;
        return ok(state);
      }
      if (Object.keys(state.players).length >= MAX_PLAYERS) {
        return fail("Game is full (50 players max)");
      }
      state.players[action.playerId] = { id: action.playerId, name, vote: null };
      if (!state.facilitatorId) state.facilitatorId = action.playerId;
      return ok(state);
    }

    case "leave": {
      const player = state.players[action.playerId];
      if (!player) return ok(state);
      delete state.players[action.playerId];
      if (state.facilitatorId === action.playerId) {
        state.facilitatorId = Object.keys(state.players)[0] ?? null;
      }
      if (state.phase === "voting") {
        const issue = state.issues.find((i) => i.id === state.currentIssueId);
        if (Object.keys(state.players).length < MIN_PLAYERS_FOR_ROUND) {
          if (issue) issue.status = "pending";
          state.phase = "waiting";
          state.currentIssueId = null;
          clearAllVotes(state);
        } else if (allVoted(state)) {
          reveal(state);
        }
      }
      return ok(state);
    }

    case "addIssue": {
      if (action.playerId !== state.facilitatorId) {
        return fail("Only the facilitator can add issues");
      }
      if (state.phase === "voting") {
        return fail("Wait for the current round to finish");
      }
      const title = action.title.trim();
      if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
        return fail("Title must be 1-120 characters");
      }
      const description = action.description.trim();
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return fail("Description must be 2000 characters or fewer");
      }
      state.issues.push({
        id: randomId(10),
        title,
        description,
        status: "pending",
        estimate: null,
        history: [],
      });
      return ok(state);
    }

    case "removeIssue": {
      if (action.playerId !== state.facilitatorId) {
        return fail("Only the facilitator can remove issues");
      }
      const issue = state.issues.find((i) => i.id === action.issueId);
      if (!issue) return fail("Issue not found");
      if (issue.id === state.currentIssueId && state.phase !== "waiting") {
        return fail("Cannot remove the active issue");
      }
      state.issues = state.issues.filter((i) => i.id !== action.issueId);
      return ok(state);
    }

    case "startRound": {
      if (action.playerId !== state.facilitatorId) {
        return fail("Only the facilitator can start a round");
      }
      if (state.phase !== "waiting") {
        return fail("A round is already in progress");
      }
      if (Object.keys(state.players).length < MIN_PLAYERS_FOR_ROUND) {
        return fail("Need at least 2 players to start");
      }
      let issue: Issue;
      if (action.issueId === null) {
        issue = {
          id: randomId(10),
          title: "Quick vote",
          description: "",
          status: "pending",
          estimate: null,
          history: [],
        };
        state.issues.push(issue);
      } else {
        const found = state.issues.find((i) => i.id === action.issueId);
        if (!found) return fail("Issue not found");
        if (found.status === "voting" || found.status === "revealed") {
          return fail("Issue already has an active round");
        }
        issue = found;
      }
      clearAllVotes(state);
      issue.status = "voting";
      state.currentIssueId = issue.id;
      state.phase = "voting";
      state.round += 1;
      return ok(state);
    }

    case "vote": {
      if (state.phase !== "voting") return fail("No round in progress");
      const player = state.players[action.playerId];
      if (!player) return fail("Not in game");
      if (!FIBONACCI_DECK.includes(action.value)) return fail("Invalid card value");
      player.vote = action.value;
      if (allVoted(state)) reveal(state);
      return ok(state);
    }

    case "clearVote": {
      if (state.phase !== "voting") return fail("No round in progress");
      const player = state.players[action.playerId];
      if (!player) return fail("Not in game");
      player.vote = null;
      return ok(state);
    }

    case "nextIssue": {
      if (action.playerId !== state.facilitatorId) {
        return fail("Only the facilitator can advance");
      }
      if (state.phase !== "revealed") return fail("Round not revealed yet");
      const issue = state.issues.find((i) => i.id === state.currentIssueId);
      if (issue) issue.status = issue.estimate !== null ? "done" : "skipped";
      clearAllVotes(state);
      state.phase = "waiting";
      state.currentIssueId = null;
      return ok(state);
    }

    case "revote": {
      if (action.playerId !== state.facilitatorId) {
        return fail("Only the facilitator can re-vote");
      }
      if (state.phase !== "revealed") return fail("Round not revealed yet");
      const issue = state.issues.find((i) => i.id === state.currentIssueId);
      if (issue) issue.status = "voting";
      clearAllVotes(state);
      state.phase = "voting";
      state.round += 1;
      return ok(state);
    }
  }
}
