// Pure planning-poker room state machine. No I/O here so it is trivially testable.

export const PHASE = {
  VOTING: 'voting',
  REVEALED: 'revealed',
};

export const DECKS = {
  fibonacci: ['1/2', '1', '2', '3', '5', '8', '13', '21', '34', '55', '?', '☕'],
};

export const DEFAULT_DECK = 'fibonacci';

const PLAYER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#84cc16',
];

export function createRoom(id, deck = DEFAULT_DECK) {
  return {
    id,
    deck,
    topic: 'Sprint 1 — pick a story to estimate',
    phase: PHASE.VOTING,
    round: 1,
    revealedAt: null,
    players: [],
  };
}

function nextColor(playerCount) {
  return PLAYER_COLORS[playerCount % PLAYER_COLORS.length];
}

export function addPlayer(room, playerId, name, color) {
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    return {
      ...room,
      players: room.players.map((p) =>
        p.id === playerId ? { ...p, connected: true, name } : p,
      ),
    };
  }
  const player = {
    id: playerId,
    name,
    color: color || nextColor(room.players.length),
    connected: true,
    vote: null,
  };
  return { ...room, players: [...room.players, player] };
}

export function setConnected(room, playerId, connected) {
  return {
    ...room,
    players: room.players.map((p) =>
      p.id === playerId ? { ...p, connected } : p,
    ),
  };
}

export function castVote(room, playerId, value) {
  if (room.phase !== PHASE.VOTING) return room;
  if (!DECKS[room.deck].includes(value)) return room;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return room;
  return {
    ...room,
    players: room.players.map((p) =>
      p.id === playerId ? { ...p, vote: value } : p,
    ),
  };
}

export function setTopic(room, topic) {
  if (room.phase !== PHASE.VOTING) return room;
  return { ...room, topic };
}

function activePlayers(room) {
  return room.players.filter((p) => p.connected);
}

export function allVoted(room) {
  const active = activePlayers(room);
  return active.length > 0 && active.every((p) => p.vote !== null);
}

export function reveal(room) {
  if (room.phase !== PHASE.VOTING) return room;
  return { ...room, phase: PHASE.REVEALED, revealedAt: Date.now() };
}

export function startRound(room) {
  if (room.phase !== PHASE.REVEALED) return room;
  return {
    ...room,
    phase: PHASE.VOTING,
    round: room.round + 1,
    revealedAt: null,
    players: room.players.map((p) => ({ ...p, vote: null })),
  };
}

// Distribution of votes for the results bar. Counts are tied to the active deck order.
export function voteDistribution(room) {
  const counts = {};
  for (const card of DECKS[room.deck]) counts[card] = 0;
  for (const p of activePlayers(room)) {
    if (p.vote !== null) counts[p.vote] += 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, counts };
}
