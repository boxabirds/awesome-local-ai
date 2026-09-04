/** Card decks. Values are strings so numeric and symbolic cards share one type. */

export const NON_NUMERIC_CARDS = {
  UNKNOWN: "?",
  BREAK: "☕",
  INFINITY: "∞",
} as const;

export interface Deck {
  id: string;
  label: string;
  values: string[];
  /** Cards excluded from average/median but still shown. */
  meta?: string[];
}

const META_CARDS = [NON_NUMERIC_CARDS.UNKNOWN, NON_NUMERIC_CARDS.BREAK];

export const DECKS: Deck[] = [
  {
    id: "fibonacci",
    label: "Fibonacci",
    values: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89"],
    meta: META_CARDS,
  },
  {
    id: "modified-fibonacci",
    label: "Modified Fibonacci",
    values: ["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100"],
    meta: META_CARDS,
  },
  {
    id: "powers-of-two",
    label: "Powers of 2",
    values: ["0", "1", "2", "4", "8", "16", "32", "64"],
    meta: META_CARDS,
  },
  {
    id: "t-shirt",
    label: "T-shirt sizes",
    values: ["XS", "S", "M", "L", "XL", "XXL"],
    meta: META_CARDS,
  },
  {
    id: "sequential",
    label: "Sequential",
    values: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    meta: META_CARDS,
  },
  {
    id: "risk",
    label: "Risk / confidence",
    values: ["Low", "Medium", "High", "Extreme"],
    meta: [NON_NUMERIC_CARDS.UNKNOWN],
  },
];

export const DEFAULT_DECK_ID = "fibonacci";
export const CUSTOM_DECK_ID = "custom";

export const MAX_CUSTOM_DECK_CARDS = 20;
export const MAX_CUSTOM_CARD_LENGTH = 6;

export function findDeck(id: string): Deck | undefined {
  return DECKS.find((d) => d.id === id);
}

/** Full card list a client should render for a deck (values + meta cards). */
export function deckCards(deck: Deck): string[] {
  return [...deck.values, ...(deck.meta ?? [])];
}

/** Parses a card to a number, or null when the card is symbolic. */
export function cardToNumber(card: string): number | null {
  const n = Number(card);
  return Number.isFinite(n) ? n : null;
}
