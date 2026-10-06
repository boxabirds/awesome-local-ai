/**
 * Unit tests for the board link code (`share.unguessable`, task 1).
 *
 * TC-04 is the whole of share.board_api's generator contract: a link code is
 * 16 cryptographic random bytes rendered as unpadded base64url, so it is
 * 22 characters long, carries 128 bits of randomness, and cannot be derived
 * from creation order, time or another board's link.
 *
 * This is the story-5 test written *first*: it pins the format before
 * `POST /api/boards` exists to produce ids at scale.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from "../../src/shared/board-id";
import { CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS } from "../../src/shared/config";

/** Named settings story 5 adds (design.md "Named settings added"). */
describe("story 5 named settings", () => {
  it("CREATE_BUDGET_MS, LINK_COPIED_MS and BOARD_CHECK_RETRY_BASE_MS are the PRD values", () => {
    expect(CREATE_BUDGET_MS).toBe(2_000);
    expect(LINK_COPIED_MS).toBe(2_000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1_000);
    // 128 bits, from story 3, is what satisfies share.unguessable.
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_BYTES * 8).toBe(128);
  });
});

/** base64url back to bytes, so "16 random bytes" is a measurement, not a claim. */
function fromBase64Url(code: string): Uint8Array {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** How many positions two same-length strings differ in. */
function hammingDistance(left: string, right: string): number {
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) different += 1;
  }
  return different;
}

const SAMPLE = 10_000;

describe("board link codes (TC-04)", () => {
  const ids = Array.from({ length: SAMPLE }, () => newBoardId());

  it(`TC-04 ${SAMPLE} generated codes are all distinct`, () => {
    const unique = new Set(ids);
    expect(unique.size).toBe(SAMPLE);
  });

  it("TC-04 every code is 22 characters and matches BOARD_ID_PATTERN", () => {
    for (const id of ids) {
      expect(id.length).toBe(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it("TC-04 every code decodes to exactly BOARD_ID_BYTES (128 bits) of randomness", () => {
    const lengths = new Set<number>();
    for (const id of ids.slice(0, 1_000)) lengths.add(fromBase64Url(id).byteLength);
    expect(lengths.size).toBe(1);
    expect([...lengths][0]).toBe(BOARD_ID_BYTES);
  });

  it("TC-04 codes come from the cryptographic random source", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const id = newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]![0] as Uint8Array;
    expect(call.byteLength).toBe(BOARD_ID_BYTES);
    spy.mockRestore();
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
  });

  it("TC-04 codes use only characters chat and email apps do not re-encode", () => {
    for (const id of ids.slice(0, 1_000)) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(id)).toBe(id);
    }
  });

  it("TC-04 a code is not derived from creation order, time or a neighbouring code", () => {
    // Consecutive calls are made back to back: if a code carried a counter, a
    // timestamp or any prefix derived from the previous code, neighbouring
    // codes would agree in most positions. Random 128-bit codes do not.
    let totalDistance = 0;
    let identicalPrefixes = 0;
    for (let index = 1; index < 2_000; index += 1) {
      const distance = hammingDistance(ids[index - 1]!, ids[index]!);
      totalDistance += distance;
      if (ids[index - 1]!.slice(0, 8) === ids[index]!.slice(0, 8)) identicalPrefixes += 1;
    }
    const mean = totalDistance / 1_999;
    // Expected for independent codes: ~21.6 of 22 positions differ.
    expect(mean).toBeGreaterThan(15);
    expect(identicalPrefixes).toBe(0);

    // And no code is sortable by the order it was created in.
    const sorted = ids.slice(0, 2_000).slice().sort();
    expect(sorted).not.toEqual(ids.slice(0, 2_000));
  });
});
