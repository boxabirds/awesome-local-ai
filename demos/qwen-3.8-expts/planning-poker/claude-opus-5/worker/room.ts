import { DurableObject } from "cloudflare:workers";
import {
  CUSTOM_DECK_ID,
  DEFAULT_DECK_ID,
  MAX_CUSTOM_CARD_LENGTH,
  MAX_CUSTOM_DECK_CARDS,
  deckCards,
  findDeck,
} from "../shared/decks";
import {
  LIMITS,
  WS_CLOSE,
  type ClientMessage,
  type Issue,
  type PlayerRole,
  type PublicPlayer,
  type RoomSnapshot,
  type ServerMessage,
} from "../shared/protocol";
import { cleanText as clean } from "../shared/sanitize";
import type { Env } from "./env";
import { computeStats } from "./stats";

const ROOM_KEY = "room";
/** How long a disconnected player stays visible (page refresh, tunnel drop). */
const PRESENCE_GRACE_MS = 45_000;
const PRUNE_INTERVAL_MS = 15_000;
/** Rooms with no players and no activity are cleaned up by the alarm. */
const EMPTY_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  vote: string | null;
  connected: boolean;
  lastSeen: number;
  joinedAt: number;
}

interface StoredRoom {
  code: string;
  name: string;
  deckId: string;
  customValues: string[] | null;
  revealed: boolean;
  roundStartedAt: number;
  revealedAt: number | null;
  autoReveal: boolean;
  roundNumber: number;
  players: Record<string, StoredPlayer>;
  facilitatorId: string | null;
  issues: Issue[];
  activeIssueId: string | null;
  createdAt: number;
}

interface SocketAttachment {
  playerId: string;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export class PokerRoom extends DurableObject<Env> {
  private room!: StoredRoom;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<StoredRoom>(ROOM_KEY)) ?? this.emptyRoom();
      // Sockets survive hibernation; the persisted `connected` flags may not match.
      const live = new Set(
        this.ctx.getWebSockets().map((ws) => this.attachment(ws)?.playerId),
      );
      for (const player of Object.values(this.room.players)) {
        player.connected = live.has(player.id);
      }
    });
  }

  private emptyRoom(): StoredRoom {
    const now = Date.now();
    return {
      code: "",
      name: "Planning session",
      deckId: DEFAULT_DECK_ID,
      customValues: null,
      revealed: false,
      roundStartedAt: now,
      revealedAt: null,
      autoReveal: true,
      roundNumber: 1,
      players: {},
      facilitatorId: null,
      issues: [],
      activeIssueId: null,
      createdAt: now,
    };
  }

  /* -------------------------------- HTTP entry -------------------------------- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/summary")) {
      return Response.json({
        code: this.room.code,
        name: this.room.name,
        playerCount: Object.values(this.room.players).filter((p) => p.connected).length,
        roundNumber: this.room.roundNumber,
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const code = clean(url.searchParams.get("code"), LIMITS.MAX_ROOM_NAME_LENGTH);
    const name = clean(url.searchParams.get("name"), LIMITS.MAX_NAME_LENGTH) || "Guest";
    const role: PlayerRole = url.searchParams.get("role") === "spectator" ? "spectator" : "voter";
    // Stable per-browser id, so a refresh reclaims the same seat and vote.
    const clientId = clean(url.searchParams.get("cid"), 32) || newId();

    if (this.room.code === "") {
      this.room.code = code;
    }

    const existing = this.room.players[clientId];
    const connectedCount = Object.values(this.room.players).filter((p) => p.connected).length;
    if (!existing && connectedCount >= LIMITS.MAX_PLAYERS_PER_ROOM) {
      return new Response("Room is full", { status: 409 });
    }

    const now = Date.now();
    this.room.players[clientId] = existing
      ? { ...existing, name, role, connected: true, lastSeen: now }
      : {
          id: clientId,
          name,
          role,
          vote: null,
          connected: true,
          lastSeen: now,
          joinedAt: now,
        };

    // First player through the door runs the session.
    if (!this.room.facilitatorId || !this.room.players[this.room.facilitatorId]) {
      this.room.facilitatorId = clientId;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ playerId: clientId } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);

    await this.persist();
    await this.scheduleAlarm();
    this.broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  /* ------------------------------ socket lifecycle ------------------------------ */

  private attachment(ws: WebSocket): SocketAttachment | null {
    try {
      return ws.deserializeAttachment() as SocketAttachment;
    } catch {
      return null;
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const playerId = this.attachment(ws)?.playerId;
    if (!playerId || !this.room.players[playerId]) return;

    if (typeof raw !== "string" || raw.length > LIMITS.MAX_MESSAGE_BYTES) {
      this.send(ws, { t: "error", code: "bad_message", message: "Message rejected" });
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { t: "error", code: "bad_json", message: "Malformed message" });
      return;
    }

    this.room.players[playerId].lastSeen = Date.now();
    await this.handle(ws, playerId, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const playerId = this.attachment(ws)?.playerId;
    if (!playerId) return;
    const player = this.room.players[playerId];
    if (!player) return;

    // Another tab may still hold this seat open.
    const stillOpen = this.ctx
      .getWebSockets()
      .some((other) => other !== ws && this.attachment(other)?.playerId === playerId);
    if (stillOpen) return;

    player.connected = false;
    player.lastSeen = Date.now();
    await this.persist();
    await this.scheduleAlarm();
    this.broadcast();
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket is gone; the close handler reconciles presence.
    }
  }

  /* --------------------------------- commands --------------------------------- */

  private isFacilitator(playerId: string): boolean {
    return this.room.facilitatorId === playerId;
  }

  private requireFacilitator(ws: WebSocket, playerId: string): boolean {
    if (this.isFacilitator(playerId)) return true;
    this.send(ws, {
      t: "error",
      code: "forbidden",
      message: "Only the facilitator can do that",
    });
    return false;
  }

  private async handle(ws: WebSocket, playerId: string, message: ClientMessage): Promise<void> {
    const player = this.room.players[playerId];

    switch (message.t) {
      case "ping":
        this.send(ws, { t: "pong" });
        return;

      case "vote": {
        if (player.role !== "voter" || this.room.revealed) return;
        if (!this.cards().includes(message.value)) return;
        // Tapping the played card again takes it back.
        player.vote = player.vote === message.value ? null : message.value;
        break;
      }

      case "clearVote":
        player.vote = null;
        break;

      case "reveal":
        if (!this.requireFacilitator(ws, playerId)) return;
        this.reveal();
        break;

      case "newRound":
        if (!this.requireFacilitator(ws, playerId)) return;
        this.newRound();
        break;

      case "setRole": {
        const role: PlayerRole = message.role === "spectator" ? "spectator" : "voter";
        player.role = role;
        if (role === "spectator") player.vote = null;
        break;
      }

      case "rename":
        player.name = clean(message.name, LIMITS.MAX_NAME_LENGTH) || player.name;
        break;

      case "setRoomName":
        if (!this.requireFacilitator(ws, playerId)) return;
        this.room.name = clean(message.name, LIMITS.MAX_ROOM_NAME_LENGTH) || this.room.name;
        break;

      case "setDeck": {
        if (!this.requireFacilitator(ws, playerId)) return;
        if (message.deckId === CUSTOM_DECK_ID) {
          const values = (message.customValues ?? [])
            .map((v) => clean(v, MAX_CUSTOM_CARD_LENGTH))
            .filter((v) => v.length > 0)
            .slice(0, MAX_CUSTOM_DECK_CARDS);
          if (values.length < 2) {
            this.send(ws, {
              t: "error",
              code: "bad_deck",
              message: "A custom deck needs at least two cards",
            });
            return;
          }
          this.room.deckId = CUSTOM_DECK_ID;
          this.room.customValues = values;
        } else {
          if (!findDeck(message.deckId)) return;
          this.room.deckId = message.deckId;
          this.room.customValues = null;
        }
        // Votes cast against the old deck are meaningless now.
        this.newRound();
        break;
      }

      case "setAutoReveal":
        if (!this.requireFacilitator(ws, playerId)) return;
        this.room.autoReveal = Boolean(message.enabled);
        break;

      case "addIssues": {
        if (!this.requireFacilitator(ws, playerId)) return;
        const incoming = (message.issues ?? []).slice(0, LIMITS.MAX_ISSUES_PER_IMPORT);
        let order = this.room.issues.length;
        for (const raw of incoming) {
          if (this.room.issues.length >= LIMITS.MAX_ISSUES_PER_ROOM) break;
          const title = clean(raw.title, LIMITS.MAX_ISSUE_TITLE_LENGTH);
          if (!title) continue;
          this.room.issues.push({
            id: newId(),
            key: clean(raw.key, LIMITS.MAX_ISSUE_KEY_LENGTH) || null,
            title,
            estimate: null,
            order: order++,
          });
        }
        if (!this.room.activeIssueId && this.room.issues.length > 0) {
          this.room.activeIssueId = this.room.issues[0].id;
        }
        break;
      }

      case "removeIssue": {
        if (!this.requireFacilitator(ws, playerId)) return;
        this.room.issues = this.room.issues.filter((i) => i.id !== message.issueId);
        if (this.room.activeIssueId === message.issueId) {
          this.room.activeIssueId = this.room.issues[0]?.id ?? null;
        }
        break;
      }

      case "setActiveIssue": {
        if (!this.requireFacilitator(ws, playerId)) return;
        if (message.issueId !== null && !this.room.issues.some((i) => i.id === message.issueId)) {
          return;
        }
        this.room.activeIssueId = message.issueId;
        this.newRound();
        break;
      }

      case "setIssueEstimate": {
        if (!this.requireFacilitator(ws, playerId)) return;
        const issue = this.room.issues.find((i) => i.id === message.issueId);
        if (!issue) return;
        issue.estimate =
          message.estimate === null ? null : clean(message.estimate, MAX_CUSTOM_CARD_LENGTH);
        break;
      }

      case "commitEstimate": {
        if (!this.requireFacilitator(ws, playerId)) return;
        if (!this.room.revealed || !this.room.activeIssueId) return;
        const issue = this.room.issues.find((i) => i.id === this.room.activeIssueId);
        if (!issue) return;
        issue.estimate = this.agreedCard();
        // Move the session on to the next unestimated issue.
        const next = this.room.issues.find((i) => i.estimate === null);
        if (next) {
          this.room.activeIssueId = next.id;
          this.newRound();
        }
        break;
      }

      case "kick": {
        if (!this.requireFacilitator(ws, playerId)) return;
        if (message.playerId === playerId) return;
        delete this.room.players[message.playerId];
        for (const socket of this.ctx.getWebSockets()) {
          if (this.attachment(socket)?.playerId === message.playerId) {
            this.send(socket, { t: "kicked" });
            socket.close(WS_CLOSE.KICKED, "Removed by facilitator");
          }
        }
        break;
      }

      case "makeFacilitator": {
        if (!this.requireFacilitator(ws, playerId)) return;
        if (!this.room.players[message.playerId]) return;
        this.room.facilitatorId = message.playerId;
        break;
      }

      default:
        return;
    }

    this.maybeAutoReveal();
    await this.persist();
    this.broadcast();
  }

  /* ---------------------------------- rounds ---------------------------------- */

  private voters(): StoredPlayer[] {
    return Object.values(this.room.players).filter((p) => p.role === "voter" && p.connected);
  }

  private maybeAutoReveal(): void {
    if (!this.room.autoReveal || this.room.revealed) return;
    const voters = this.voters();
    if (voters.length > 0 && voters.every((p) => p.vote !== null)) this.reveal();
  }

  private reveal(): void {
    if (this.room.revealed) return;
    this.room.revealed = true;
    this.room.revealedAt = Date.now();
    this.ctx.waitUntil(this.persistRound());
  }

  private newRound(): void {
    this.room.revealed = false;
    this.room.revealedAt = null;
    this.room.roundStartedAt = Date.now();
    this.room.roundNumber += 1;
    for (const player of Object.values(this.room.players)) player.vote = null;
  }

  /** Mode of the cast votes; ties resolve to the more conservative (higher) card. */
  private agreedCard(): string | null {
    const cards = this.cards();
    const votes = this.castVotes();
    if (votes.length === 0) return null;

    const counts = new Map<string, number>();
    for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);

    let best: string | null = null;
    let bestCount = 0;
    for (const [card, count] of counts) {
      const isHigherCard = best !== null && cards.indexOf(card) > cards.indexOf(best);
      if (count > bestCount || (count === bestCount && isHigherCard)) {
        best = card;
        bestCount = count;
      }
    }
    return best;
  }

  private castVotes(): string[] {
    return Object.values(this.room.players)
      .filter((p) => p.role === "voter" && p.vote !== null)
      .map((p) => p.vote!);
  }

  /* ----------------------------------- deck ----------------------------------- */

  private deckInfo(): { label: string; cards: string[]; metaCards: string[] } {
    if (this.room.deckId === CUSTOM_DECK_ID && this.room.customValues) {
      return { label: "Custom", cards: this.room.customValues, metaCards: [] };
    }
    const deck = findDeck(this.room.deckId) ?? findDeck(DEFAULT_DECK_ID)!;
    return { label: deck.label, cards: deckCards(deck), metaCards: deck.meta ?? [] };
  }

  private cards(): string[] {
    return this.deckInfo().cards;
  }

  /* --------------------------------- snapshot --------------------------------- */

  private snapshotFor(viewerId: string): RoomSnapshot {
    const { label, cards, metaCards } = this.deckInfo();
    const players: PublicPlayer[] = Object.values(this.room.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        connected: p.connected,
        isFacilitator: p.id === this.room.facilitatorId,
        hasVoted: p.vote !== null,
        // Hidden votes never leave the Durable Object, so a client cannot peek.
        vote: this.room.revealed || p.id === viewerId ? p.vote : undefined,
      }));

    return {
      code: this.room.code,
      name: this.room.name,
      deckId: this.room.deckId,
      deckLabel: label,
      cards,
      metaCards,
      revealed: this.room.revealed,
      roundStartedAt: this.room.roundStartedAt,
      revealedAt: this.room.revealedAt,
      autoReveal: this.room.autoReveal,
      roundNumber: this.room.roundNumber,
      players,
      issues: [...this.room.issues].sort((a, b) => a.order - b.order),
      activeIssueId: this.room.activeIssueId,
      stats: this.room.revealed ? computeStats(this.castVotes(), cards, metaCards) : null,
    };
  }

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.attachment(ws)?.playerId;
      if (!playerId) continue;
      this.send(ws, { t: "state", room: this.snapshotFor(playerId), youId: playerId });
    }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(ROOM_KEY, this.room);
  }

  /* --------------------------------- history --------------------------------- */

  /** Best-effort archive of a revealed round. History is a nice-to-have, never a dependency. */
  private async persistRound(): Promise<void> {
    if (!this.env.DB || !this.room.code) return;
    const { cards, metaCards } = this.deckInfo();
    const votes = Object.values(this.room.players)
      .filter((p) => p.role === "voter" && p.vote !== null)
      .map((p) => ({ name: p.name, vote: p.vote }));
    const stats = computeStats(this.castVotes(), cards, metaCards);
    const issue = this.room.issues.find((i) => i.id === this.room.activeIssueId);

    try {
      await this.env.DB.prepare(
        `INSERT INTO rounds (room_code, round_number, issue_key, issue_title, deck_id,
                             votes_json, average, consensus, voter_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          this.room.code,
          this.room.roundNumber,
          issue?.key ?? null,
          issue?.title ?? null,
          this.room.deckId,
          JSON.stringify(votes),
          stats?.average ?? null,
          stats?.consensus ? 1 : 0,
          votes.length,
        )
        .run();
      await this.env.DB.prepare(`UPDATE rooms SET last_active_at = datetime('now') WHERE code = ?`)
        .bind(this.room.code)
        .run();
    } catch (error) {
      console.error("round_persist_failed", { code: this.room.code, error: String(error) });
    }
  }

  /* ---------------------------------- alarm ---------------------------------- */

  private async scheduleAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let changed = false;

    for (const player of Object.values(this.room.players)) {
      if (!player.connected && now - player.lastSeen > PRESENCE_GRACE_MS) {
        delete this.room.players[player.id];
        changed = true;
      }
    }

    if (this.room.facilitatorId && !this.room.players[this.room.facilitatorId]) {
      const heir = Object.values(this.room.players)
        .filter((p) => p.connected)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.room.facilitatorId = heir?.id ?? null;
      changed = true;
    }

    const empty = Object.keys(this.room.players).length === 0;
    if (empty && now - this.room.createdAt > EMPTY_ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      return;
    }

    if (changed) {
      await this.persist();
      this.broadcast();
    }

    if (!empty) await this.ctx.storage.setAlarm(now + PRUNE_INTERVAL_MS);
  }
}
