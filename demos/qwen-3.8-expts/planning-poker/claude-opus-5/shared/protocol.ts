/** Wire protocol shared by the Worker/Durable Object and the browser client. */

export type PlayerRole = "voter" | "spectator";

export interface PublicPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  connected: boolean;
  isFacilitator: boolean;
  hasVoted: boolean;
  /** Present only once the round is revealed, or for the requesting player. */
  vote?: string | null;
}

export interface Issue {
  id: string;
  /** Optional external reference, e.g. "PROJ-123". */
  key: string | null;
  title: string;
  estimate: string | null;
  order: number;
}

export interface RoundStats {
  /** Mean of numeric votes, rounded to one decimal. Null when no numeric votes. */
  average: number | null;
  median: number | null;
  /** True when every counted vote is identical. */
  consensus: boolean;
  /** Card -> number of votes, ordered by deck order. */
  distribution: Array<{ card: string; count: number }>;
  numericVoteCount: number;
  totalVoteCount: number;
  /** Highest and lowest numeric cards played, for spotting disagreement. */
  spread: { low: string; high: string } | null;
}

export interface RoomSnapshot {
  code: string;
  name: string;
  deckId: string;
  deckLabel: string;
  /** Cards to render, including symbolic cards. */
  cards: string[];
  /** Cards excluded from numeric stats. */
  metaCards: string[];
  revealed: boolean;
  roundStartedAt: number;
  revealedAt: number | null;
  autoReveal: boolean;
  roundNumber: number;
  players: PublicPlayer[];
  issues: Issue[];
  activeIssueId: string | null;
  stats: RoundStats | null;
}

/* ---------------------------------- client -> server ---------------------------------- */

export type ClientMessage =
  | { t: "vote"; value: string }
  | { t: "clearVote" }
  | { t: "reveal" }
  | { t: "newRound" }
  | { t: "setRole"; role: PlayerRole }
  | { t: "rename"; name: string }
  | { t: "setRoomName"; name: string }
  | { t: "setDeck"; deckId: string; customValues?: string[] }
  | { t: "setAutoReveal"; enabled: boolean }
  | { t: "addIssues"; issues: Array<{ key?: string | null; title: string }> }
  | { t: "removeIssue"; issueId: string }
  | { t: "setActiveIssue"; issueId: string | null }
  | { t: "setIssueEstimate"; issueId: string; estimate: string | null }
  | { t: "commitEstimate" }
  | { t: "kick"; playerId: string }
  | { t: "makeFacilitator"; playerId: string }
  | { t: "ping" };

/* ---------------------------------- server -> client ---------------------------------- */

export type ServerMessage =
  | { t: "state"; room: RoomSnapshot; youId: string }
  | { t: "kicked" }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

export const WS_CLOSE = {
  /** Player was removed by the facilitator; the client must not reconnect. */
  KICKED: 4001,
  ROOM_FULL: 4002,
  BAD_REQUEST: 4003,
} as const;

export const LIMITS = {
  MAX_PLAYERS_PER_ROOM: 50,
  MAX_NAME_LENGTH: 32,
  MAX_ROOM_NAME_LENGTH: 60,
  MAX_ISSUE_TITLE_LENGTH: 200,
  MAX_ISSUE_KEY_LENGTH: 24,
  MAX_ISSUES_PER_ROOM: 500,
  MAX_ISSUES_PER_IMPORT: 200,
  MAX_MESSAGE_BYTES: 16 * 1024,
} as const;
