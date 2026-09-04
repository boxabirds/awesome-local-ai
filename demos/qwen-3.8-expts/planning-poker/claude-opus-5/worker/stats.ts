import { cardToNumber } from "../shared/decks";
import type { RoundStats } from "../shared/protocol";

const AVERAGE_DECIMAL_PLACES = 1;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : round((sorted[mid - 1] + sorted[mid]) / 2, AVERAGE_DECIMAL_PLACES);
}

/**
 * Summarises a revealed round.
 *
 * `metaCards` (?, coffee) are counted in the distribution but excluded from
 * average/median/spread, because they carry no magnitude.
 */
export function computeStats(
  votes: string[],
  cardOrder: string[],
  metaCards: string[],
): RoundStats | null {
  if (votes.length === 0) return null;

  const meta = new Set(metaCards);
  const numeric: number[] = [];
  const numericCards: string[] = [];

  for (const vote of votes) {
    if (meta.has(vote)) continue;
    const n = cardToNumber(vote);
    if (n !== null) {
      numeric.push(n);
      numericCards.push(vote);
    }
  }

  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);

  const distribution = cardOrder
    .filter((card) => counts.has(card))
    .map((card) => ({ card, count: counts.get(card)! }));
  // Cards played but no longer in the deck (deck changed mid-round) still count.
  for (const [card, count] of counts) {
    if (!cardOrder.includes(card)) distribution.push({ card, count });
  }

  const sorted = [...numeric].sort((a, b) => a - b);
  const lowIndex = numeric.indexOf(sorted[0]);
  const highIndex = numeric.indexOf(sorted[sorted.length - 1]);

  return {
    average:
      numeric.length > 0
        ? round(numeric.reduce((a, b) => a + b, 0) / numeric.length, AVERAGE_DECIMAL_PLACES)
        : null,
    median: numeric.length > 0 ? median(sorted) : null,
    consensus: votes.length > 1 && new Set(votes).size === 1,
    distribution,
    numericVoteCount: numeric.length,
    totalVoteCount: votes.length,
    spread:
      numeric.length > 1 && sorted[0] !== sorted[sorted.length - 1]
        ? { low: numericCards[lowIndex], high: numericCards[highIndex] }
        : null,
  };
}
