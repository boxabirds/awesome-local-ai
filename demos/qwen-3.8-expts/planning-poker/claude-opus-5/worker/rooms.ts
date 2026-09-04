import { DEFAULT_DECK_ID, findDeck } from "../shared/decks";
import type { Env } from "./env";

/** No 0/o/1/l/i — room codes get read aloud and typed from a screen share. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_GROUP_LENGTH = 3;
const CODE_GROUPS = 3;
const CODE_SEPARATOR = "-";
const ROOM_CODE_PATTERN = /^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}$/;

export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_GROUP_LENGTH * CODE_GROUPS));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * CODE_GROUP_LENGTH, (i + 1) * CODE_GROUP_LENGTH).join(""));
  }
  return groups.join(CODE_SEPARATOR);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function resolveDeckId(deckId: unknown): string {
  return typeof deckId === "string" && findDeck(deckId) ? deckId : DEFAULT_DECK_ID;
}

/** Registers a room so history and "does this room exist" survive DO eviction. */
export async function registerRoom(
  env: Env,
  code: string,
  name: string,
  deckId: string,
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO rooms (code, name, deck_id) VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, last_active_at = datetime('now')`,
    )
      .bind(code, name, deckId)
      .run();
  } catch (error) {
    console.error("room_register_failed", { code, error: String(error) });
  }
}
