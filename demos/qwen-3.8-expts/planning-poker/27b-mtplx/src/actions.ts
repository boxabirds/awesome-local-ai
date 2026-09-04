import type { Action } from "./types";

// Shape of a raw message arriving from a browser over the WebSocket.
export interface ClientMsg {
  type: string;
  name?: string;
  playerId?: string;
  issueId?: string;
  title?: string;
  description?: string;
  value?: number;
}

// Map a raw client message to a typed Action. Pure: no state, no side effects,
// so the exact browser->reducer data path can be unit-tested in isolation.
//
// A quick vote is signalled by `issueId === null` (Game.tsx sends
// { type: "startRound", issueId: null }); that null must be preserved, never
// coerced to an empty string, or the reducer reports "Issue not found".
export function toAction(msg: ClientMsg, playerId: string): Action | null {
  switch (msg.type) {
    case "vote":
      return { type: "vote", playerId, value: Number(msg.value) };
    case "clearVote":
      return { type: "clearVote", playerId };
    case "addIssue":
      return {
        type: "addIssue",
        playerId,
        title: String(msg.title ?? ""),
        description: String(msg.description ?? ""),
      };
    case "removeIssue":
      return { type: "removeIssue", playerId, issueId: String(msg.issueId ?? "") };
    case "startRound":
      return { type: "startRound", playerId, issueId: msg.issueId ?? null };
    case "nextIssue":
      return { type: "nextIssue", playerId };
    case "revote":
      return { type: "revote", playerId };
    default:
      return null;
  }
}