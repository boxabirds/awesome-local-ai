// Shared client-side helpers for the poker UI (kept framework-free + testable).

export const DECK = ['1/2', '1', '2', '3', '5', '8', '13', '21', '34', '55', '?', '☕'];

export const PHASE = { VOTING: 'voting', REVEALED: 'revealed' };

// Numeric weight used only to draw a relative bar height / average.
const CARD_WEIGHT = {
  '1/2': 0.5,
  1: 1,
  2: 2,
  3: 3,
  5: 5,
  8: 8,
  13: 13,
  21: 21,
  34: 34,
  55: 55,
};

export const CARDS_PER_ROW = 5;

export function cardWeight(card) {
  return CARD_WEIGHT[card] ?? 0;
}

export function isNumericCard(card) {
  return card in CARD_WEIGHT;
}

export function maxWeight() {
  return Math.max(...Object.values(CARD_WEIGHT));
}

export function distribution(room) {
  const counts = {};
  for (const c of DECK) counts[c] = 0;
  const active = (room?.players || []).filter((p) => p.connected && p.vote);
  for (const p of active) counts[p.vote] += 1;
  return counts;
}

export function averageEstimate(room) {
  const active = (room?.players || []).filter(
    (p) => p.connected && isNumericCard(p.vote),
  );
  if (active.length === 0) return null;
  const sum = active.reduce((a, p) => a + cardWeight(p.vote), 0);
  return Math.round((sum / active.length) * 10) / 10;
}

export function chunkByRow(items, perRow = CARDS_PER_ROW) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return rows;
}

export function isHost(room, playerId) {
  const connected = (room?.players || []).filter((p) => p.connected);
  return connected.length > 0 && connected[0].id === playerId;
}

// Build the shareable invite link that a teammate opens to join this room.
export function buildInviteUrl(origin, pathname, roomId) {
  if (!roomId) return '';
  return `${origin}${pathname || '/'}?room=${roomId}`;
}
