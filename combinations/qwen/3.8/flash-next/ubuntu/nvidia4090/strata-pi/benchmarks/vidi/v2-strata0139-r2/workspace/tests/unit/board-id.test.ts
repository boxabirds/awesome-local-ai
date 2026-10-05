import { describe, expect, it } from "vitest";
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from "../../src/shared/board-id";

/**
 * TC-01 / TC-02 — `sync.worker_entry` board addresses.
 *
 * A board id is the board's only credential before story 14, so both its shape
 * (a real address is accepted, junk is not) and its entropy (unguessable,
 * never duplicated) are contract.
 */

/** 22 characters drawn from the base64url alphabet. */
const VALID_ID = "aB3-_x9A8b7C6d5E4f3G2h";

describe("isValidBoardId (TC-01)", () => {
  it("accepts a 22-character base64url id", () => {
    expect(VALID_ID).toHaveLength(22);
    expect(BOARD_ID_PATTERN.test(VALID_ID)).toBe(true);
    expect(isValidBoardId(VALID_ID)).toBe(true);
  });

  it("rejects ids one character too short or too long (boundary)", () => {
    expect(isValidBoardId(VALID_ID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID_ID}x`)).toBe(false);
  });

  it("rejects characters outside the base64url alphabet", () => {
    expect(isValidBoardId("aB3+ax9A8b7C6d5E4f3G2h")).toBe(false);
    expect(isValidBoardId("../x")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidBoardId("")).toBe(false);
  });

  it("rejects ids that would escape the room route", () => {
    for (const id of ["../../secret", "a b c d e f g h i j k", "aB3/x9A8b7C6d5E4f3G2h"]) {
      expect(isValidBoardId(id)).toBe(false);
    }
  });

  it("describes exactly BOARD_ID_BYTES bytes of randomness as base64url", () => {
    // ceil(16 * 8 / 6) = 22 unpadded base64url characters.
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN).toEqual(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("newBoardId (TC-02)", () => {
  it("generates ids that all match BOARD_ID_PATTERN, with no duplicates (10,000)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      if (!BOARD_ID_PATTERN.test(id)) {
        throw new Error(`newBoardId produced ${JSON.stringify(id)}`);
      }
      if (seen.has(id)) throw new Error(`duplicate board id ${id}`);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it("generates ids usable as a route segment and a WebSocket path", () => {
    const id = newBoardId();
    expect(encodeURIComponent(id)).toBe(id);
    expect(new URL(`http://board.test/b/${id}`).pathname).toBe(`/b/${id}`);
    expect(new URL(`wss://board.test/api/rooms/${id}`).pathname).toBe(`/api/rooms/${id}`);
  });
});
