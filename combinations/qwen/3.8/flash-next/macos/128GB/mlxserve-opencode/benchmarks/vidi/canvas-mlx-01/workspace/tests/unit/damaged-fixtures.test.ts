/**
 * Unit tests (node) for the damaged-update fixtures: `Y.applyUpdate` MUST reject them, so
 * the store's quarantine / snapshot-failure paths are exercised with genuinely broken bytes.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  corruptBytes,
  damagedFixtures,
  retro25Board,
} from '../fixtures/boards.js';

/** Apply `updates` then attempt `damaged`; returns true iff the damaged apply throws. */
const applyThrows = (updates: Uint8Array[], damaged: Uint8Array): boolean => {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  try {
    Y.applyUpdate(doc, damaged);
    return false;
  } catch {
    return true;
  }
};

describe('damaged update fixtures are undecodable', () => {
  it('damagedFixtures.truncated and .random both make Y.applyUpdate throw', () => {
    const board = retro25Board();
    const damaged = damagedFixtures(board.updates[3]!);
    expect(applyThrows(board.updates.slice(0, 3), damaged.truncated)).toBe(true);
    expect(applyThrows(board.updates.slice(0, 3), damaged.random)).toBe(true);
  });

  it('corruptBytes makes a row own update undecodable (not an already-applied no-op)', () => {
    const board = retro25Board();
    for (const u of board.updates.slice(1, 5)) {
      expect(applyThrows(board.updates.slice(0, 0), corruptBytes(u))).toBe(true);
    }
  });
});
