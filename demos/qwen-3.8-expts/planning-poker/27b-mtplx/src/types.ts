export type Phase = "waiting" | "voting" | "revealed";

export type IssueStatus = "pending" | "voting" | "revealed" | "done" | "skipped";

export interface Player {
  id: string;
  name: string;
  vote: number | null;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  estimate: number | null;
  history: number[];
}

export interface GameState {
  gameId: string;
  createdAt: number;
  phase: Phase;
  currentIssueId: string | null;
  round: number;
  players: Record<string, Player>;
  issues: Issue[];
  facilitatorId: string | null;
}

export type Action =
  | { type: "join"; playerId: string; name: string }
  | { type: "leave"; playerId: string }
  | { type: "addIssue"; playerId: string; title: string; description: string }
  | { type: "removeIssue"; playerId: string; issueId: string }
  | { type: "startRound"; playerId: string; issueId: string | null }
  | { type: "vote"; playerId: string; value: number }
  | { type: "clearVote"; playerId: string }
  | { type: "nextIssue"; playerId: string }
  | { type: "revote"; playerId: string };

export type Result =
  | { state: GameState; error?: undefined }
  | { state?: undefined; error: string };
