/**
 * Story 12 · component tests for the image-insert orchestration (task 8).
 *
 * `useImageInsert`'s two browser effects (decode, upload) are injectable, so the
 * whole "read → place → upload" chain is driven here with a fake decoder and a
 * fake uploader against a real `Y.Doc` — no network, no R2, no image decoding.
 * This is the tier that fixes the placement geometry, the one-undo-step rule, and
 * the "a received image is not re-created and not personally undoable" behaviour
 * (design Test pyramid → component; PRD image.place, image.undo, image.shared).
 */
import { describe, expect, test } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { useImageInsert, type ImageInsertDeps } from '../../src/client/images/useImageInsert';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import type { AssetResult } from '../../src/shared/assets-protocol';

function file(name: string, type: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Deps with an injectable decode (always succeeds at 200×100) and a controllable
 * upload. The decode/upload fakes are the whole point: they stand in for the two
 * browser effects the design keeps out of unit/component tiers. */
function harness(opts: {
  canEdit?: boolean;
  decode?: (file: File) => Promise<{ naturalWidth: number; naturalHeight: number } | null>;
  upload?: (url: string, file: File) => Promise<AssetResult>;
  doc?: Y.Doc;
} = {}) {
  const doc = opts.doc ?? new Y.Doc();
  initDoc(doc);
  const toasts: Array<{ message: string; tone: string }> = [];
  const deps: ImageInsertDeps = {
    getDoc: () => doc,
    getIdentityId: () => 'me',
    uploadUrl: () => '/api/boards/board1/assets',
    canEdit: () => opts.canEdit ?? true,
    toast: (message, tone) => toasts.push({ message, tone: tone ?? 'info' }),
    now: () => 1000,
    decode: opts.decode ?? (async () => ({ naturalWidth: 200, naturalHeight: 100 })),
    upload:
      opts.upload ??
      (async (_url, _f) => ({ ok: true, assetKey: 'board1/aaaaaaaaaaaaaaaaaaaaaa' } as AssetResult)),
  };
  const screenToWorld = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
  return { doc, deps, toasts, screenToWorld };
}

const CENTRE = { x: 500, y: 400 };

describe('placement', () => {
  test('TC-25: a drop places images left-to-right under the cursor', async () => {
    const h = harness();
    const { result } = renderHook(() => useImageInsert(h.deps));
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.insert([file('a.png', 'image/png'), file('b.png', 'image/png')], { x: 100, y: 100 }, h.screenToWorld, CENTRE);
    });
    expect(ids).toHaveLength(2);
    const snap = snapshot(h.doc);
    const a = snap.find((o) => o.id === ids[0])!;
    const b = snap.find((o) => o.id === ids[1])!;
    // Both 200×100 (natural), placed left to right with the 24-unit gap.
    expect(a.x).toBe(100);
    expect(b.x).toBe(100 + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(b.y).toBe(100);
  });

  test('TC-25: a paste / picker placement is centred on the viewport centre', async () => {
    const h = harness();
    const { result } = renderHook(() => useImageInsert(h.deps));
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.insert([file('a.png', 'image/png')], null, h.screenToWorld, CENTRE);
    });
    const snap = snapshot(h.doc);
    const a = snap.find((o) => o.id === ids[0])!;
    // A 200×100 image centred on (500,400) → top-left (400,350).
    expect(a.x).toBe(400);
    expect(a.y).toBe(350);
  });

  test('a huge image is scaled to fit 800 world units, never upscaled', async () => {
    // A 3200×200 image: the widest axis caps at 800, so scale 0.25 → 200×50?
    // No — 800 / 3200 = 0.25, so 800×50. A 100×100 image is never upscaled.
    const h = harness({ decode: async (f) => (f.name === 'big.png' ? { naturalWidth: 3200, naturalHeight: 200 } : { naturalWidth: 100, naturalHeight: 100 }) });
    const { result } = renderHook(() => useImageInsert(h.deps));
    await act(async () => {
      await result.current.insert([file('big.png', 'image/png')], { x: 0, y: 0 }, h.screenToWorld, CENTRE);
      await result.current.insert([file('small.png', 'image/png')], { x: 0, y: 500 }, h.screenToWorld, CENTRE);
    });
    const big = snapshot(h.doc).find((o) => Math.round(o.width) === IMAGE_MAX_PLACE_SIZE_WORLD)!;
    expect(Math.round(big.width)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(Math.round(big.height)).toBe(50);
    const small = snapshot(h.doc).find((o) => Math.round(o.width) === 100 && o.y > 100)!;
    expect(small).toBeTruthy();
  });
});

describe('undo and the shared placeholder', () => {
  test('TC-04: a three-image drop is one personal-undo step', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // The undo manager must exist before the tracked change to record it.
    const undo = createUndo(doc);
    const h = harness({ doc });
    const { result } = renderHook(() => useImageInsert(h.deps));
    await act(async () => {
      await result.current.insert(
        [file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')],
        { x: 0, y: 0 },
        h.screenToWorld,
        CENTRE,
      );
    });
    expect(snapshot(doc).length).toBe(3);
    // One undo removes the whole row: they were written in one undoable transaction.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).length).toBe(0);
  });
});

describe('no duplicate objects', () => {
  test('TC-26: a re-drop of the same bytes creates a new object, never merges', async () => {
    const h = harness();
    const { result } = renderHook(() => useImageInsert(h.deps));
    const same = file('a.png', 'image/png');
    await act(async () => {
      await result.current.insert([same], { x: 0, y: 0 }, h.screenToWorld, CENTRE);
    });
    await act(async () => {
      await result.current.insert([same], { x: 900, y: 0 }, h.screenToWorld, CENTRE);
    });
    expect(snapshot(h.doc).length).toBe(2);
  });

  test('TC-26: a received placeholder cannot be personally undone on the receiver', async () => {
    // Two docs synced; B never issued the create, so its personal history is empty
    // and one Ctrl+Z must leave the received image alone (PRD image.undo).
    const a = new Y.Doc();
    initDoc(a);
    const b = new Y.Doc();
    initDoc(b);
    // B's undo manager tracks only its own LOCAL_ORIGIN; a remote update arrives
    // under a different origin, so it is not a personal step.
    const undoB = createUndo(b);

    // A creates an image; the update syncs into B.
    const hA = harness({ doc: a });
    const { result: resultA } = renderHook(() => useImageInsert(hA.deps));
    await act(async () => {
      await resultA.current.insert([file('a.png', 'image/png')], { x: 0, y: 0 }, hA.screenToWorld, CENTRE);
    });
    // Reflect A's state (including the placeholder) into B.
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(snapshot(b).length).toBe(1);
    // B's personal undo has nothing to do with the received object: it does not
    // remove it. (B's history never saw the create transaction.)
    const before = snapshot(b).length;
    undoB.undo();
    expect(snapshot(b).length).toBe(before);
  });
});

describe('rejection paths', () => {
  test('a read-only board answers with the offline reason only', async () => {
    const h = harness({ canEdit: false });
    const { result } = renderHook(() => useImageInsert(h.deps));
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.insert([file('a.png', 'image/png')], { x: 0, y: 0 }, h.screenToWorld, CENTRE);
    });
    expect(ids).toHaveLength(0);
    expect(snapshot(h.doc).length).toBe(0);
    expect(h.toasts[0]?.message).toMatch(/offline|reconnect/i);
  });

  test('more than 20 files: only the first 20 are added, with the count message', async () => {
    // PRD image.count_limit + F1: "first 20 added", not the whole batch refused.
    const h = harness();
    const { result } = renderHook(() => useImageInsert(h.deps));
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => file(`f${i}.png`, 'image/png'));
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.insert(files, { x: 0, y: 0 }, h.screenToWorld, CENTRE);
    });
    expect(ids).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(snapshot(h.doc).length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(h.toasts.some((t) => /20 images/i.test(t.message))).toBe(true);
  });

  test('an undecodable file earns the "unsupported types" message and is not placed', async () => {
    const h = harness({ decode: async (f) => (f.name === 'ok.png' ? { naturalWidth: 100, naturalHeight: 100 } : null) });
    const { result } = renderHook(() => useImageInsert(h.deps));
    await act(async () => {
      await result.current.insert([file('evil.svg', 'image/svg+xml'), file('ok.png', 'image/png')], { x: 0, y: 0 }, h.screenToWorld, CENTRE);
    });
    // The valid one still lands; the SVG does not.
    expect(snapshot(h.doc).length).toBe(1);
    expect(h.toasts.some((t) => /Only PNG|can be added/i.test(t.message))).toBe(true);
  });
});

describe('the failed path', () => {
  test('a rejected upload marks the object failed and keeps it on the board', async () => {
    // An accepted type whose upload is refused: the placeholder is placed, then
    // the failed upload flips it to `failed` (the object stays, PRD upload_failure).
    const h = harness({ upload: async () => ({ ok: false, reason: 'unsupported', status: 415 } as AssetResult) });
    const { result } = renderHook(() => useImageInsert(h.deps));
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.insert([file('corrupt.png', 'image/png')], { x: 0, y: 0 }, h.screenToWorld, CENTRE);
    });
    // Wait for the upload promise chain to settle the object status.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const obj = snapshot(h.doc).find((o) => o.id === ids[0])!;
    expect(obj.status).toBe('failed');
  });
});

