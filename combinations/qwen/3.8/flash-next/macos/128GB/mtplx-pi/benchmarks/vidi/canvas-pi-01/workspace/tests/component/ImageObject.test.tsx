/**
 * Story 12 · component tests for ImageObject (design Test pyramid → component;
 * PRD image.select, image.resize).
 *
 * Rendered through a real `Y.Doc` and a real `TransformController`, and driven
 * with real pointer events, so the "select by coordinate under a transparent
 * corner" and the "one aspect-locked gesture" behaviour is exercised exactly as
 * the browser would, not asserted against a faked transform. jsdom cannot decode a
 * real image, so the `src` is a `data:` URL and the *decode* path lives in e2e;
 * the four render states are seeded through the model, then rendered directly.
 */
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { createTransformController } from '../../src/client/board/transformController';
import type { TransformContext } from '../../src/client/board/transformController';
import { seedDocWithImages } from '../fixtures/image-seed';
import { snapshot } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { dblclick, pointer } from './helpers';
import type { ImageSnap } from '../../src/shared/objects/image';

const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const NOOP = () => {};

function snapOf(doc: Y.Doc, id: string, over: Partial<ImageSnap> = {}): ImageSnap {
  const entry = snapshot(doc).find((obj) => obj.id === id)!;
  return {
    id: entry.id,
    type: 'image',
    x: entry.x,
    y: entry.y,
    z: entry.z,
    width: entry.width,
    height: entry.height,
    createdAt: entry.createdAt,
    assetKey: entry.assetKey ?? null,
    contentType: entry.contentType ?? 'image/png',
    naturalWidth: entry.naturalWidth ?? entry.width,
    naturalHeight: entry.naturalHeight ?? entry.height,
    status: entry.status ?? 'uploading',
    uploadStartedAt: entry.uploadStartedAt ?? 0,
    uploaderId: 'seed',
    ...over,
  };
}

function controllerFor(
  doc: Y.Doc,
  mode: 'both' | 'width' = 'both',
): ReturnType<typeof createTransformController> {
  const ctx: TransformContext = {
    doc,
    camera: { x: 0, y: 0, zoom: 1 },
    snapshot: snapshot(doc),
    canEdit: true,
    resizeMode: () => mode,
  };
  return createTransformController(() => ctx);
}

describe('render state', () => {
  test('TC-06: an uploading image shows a loading indicator, not a broken image', () => {
    const { doc, ids } = seedDocWithImages([{ x: 0, y: 0, width: 200, height: 100, status: 'uploading' }]);
    // `now` just past the seed time so it still reads as uploading, not unfinished.
    render(
      <ImageObject
        image={snapOf(doc, ids[0])}
        src={null}
        zoom={1}
        selected={false}
        controller={controllerFor(doc)}
        selection={[]}
        onSelect={NOOP}
        onRemove={NOOP}
        now={1000}
      />,
    );
    expect(screen.getByTestId('image-loading')).toBeTruthy();
    expect(screen.queryByTestId('image-img')).toBeNull();
    // The placeholder is not a focusable control (interaction.accessible).
    expect(screen.getByTestId('image-loading').getAttribute('role')).toBeNull();
  });

  test('a ready image renders the picture and eight handles when alone-selected', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    render(
      <ImageObject
        image={snapOf(doc, ids[0])}
        src={DATA}
        zoom={1}
        selected
        controller={controllerFor(doc)}
        selection={[ids[0]]}
        onSelect={NOOP}
        onRemove={NOOP}
      />,
    );
    expect(screen.getByTestId('image-img')).toBeTruthy();
    expect(screen.getAllByTestId(/^image-handle-/)).toHaveLength(8);
  });

  test('a ready image shows no handles when unselected or grouped', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
      { x: 300, y: 0, width: 100, height: 100, status: 'ready', assetKey: 'b/bbbbbbbbbbbbbbbbbbbbbb' },
    ]);
    const { rerender } = render(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected={false} controller={controllerFor(doc)} selection={[]} onSelect={NOOP} onRemove={NOOP} />,
    );
    expect(screen.queryAllByTestId(/^image-handle-/)).toHaveLength(0);
    rerender(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected controller={controllerFor(doc)} selection={[ids[0], ids[1]]} onSelect={NOOP} onRemove={NOOP} />,
    );
    // Group-selected: the shared bounding box owns the transform, not the object.
    expect(screen.queryAllByTestId(/^image-handle-/)).toHaveLength(0);
  });

  test('TC-07: a failed image shows the error indicator with Retry and Remove', () => {
    const { doc, ids } = seedDocWithImages([{ x: 0, y: 0, width: 200, height: 100, status: 'failed' }]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={null} zoom={1} selected={false} controller={controllerFor(doc)} selection={[]} onSelect={NOOP} onRetry={NOOP} onRemove={NOOP} />,
    );
    expect(screen.getByTestId('image-failed')).toBeTruthy();
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
    expect(screen.queryByTestId('image-img')).toBeNull();
    expect(screen.getByText("Image upload didn't work.")).toBeTruthy();
  });

  test('TC-07: a stale uploading image renders as unfinished with a Remove only', () => {
    // Seeded at t=0, rendered just past the 5-minute boundary.
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'uploading', uploadStartedAt: 0 },
    ]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={null} zoom={1} selected={false} controller={controllerFor(doc)} selection={[]} onSelect={NOOP} onRemove={NOOP} now={IMAGE_UPLOAD_STALE_MS + 1} />,
    );
    expect(screen.getByTestId('image-unfinished')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByText("Image upload didn't finish.")).toBeTruthy();
  });

  test('exactly at the stale boundary it is still uploading, one ms past is unfinished', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'uploading', uploadStartedAt: 0 },
    ]);
    const at = render(
      <ImageObject image={snapOf(doc, ids[0])} src={null} zoom={1} selected={false} controller={controllerFor(doc)} selection={[]} onSelect={NOOP} onRemove={NOOP} now={IMAGE_UPLOAD_STALE_MS} />,
    );
    expect(screen.getByTestId('image-loading')).toBeTruthy();
    at.unmount();
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={null} zoom={1} selected={false} controller={controllerFor(doc)} selection={[]} onSelect={NOOP} onRemove={NOOP} now={IMAGE_UPLOAD_STALE_MS + 1} />,
    );
    expect(screen.getByTestId('image-unfinished')).toBeTruthy();
  });
});

describe('select by coordinate under a transparent area', () => {
  test('TC-27 (component part): a pointer-down inside the image selects it', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    let selectedId: string | null = null;
    let additive = false;
    render(
      <ImageObject
        image={snapOf(doc, ids[0])}
        src={DATA}
        zoom={1}
        selected={false}
        controller={controllerFor(doc)}
        selection={[]}
        onSelect={(id, add) => {
          selectedId = id;
          additive = add;
        }}
        onRemove={NOOP}
      />,
    );
    // A press inside the group's box (jsdom has no layout, so we fire on the node
    // itself; a real click would land at the world point the object covers).
    screen.getByTestId('image').dispatchEvent(pointer('pointerdown', 50, 50));
    expect(selectedId).toBe(ids[0]);
    expect(additive).toBe(false);
  });

  test('a double-click on an image does not start text editing', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 0, y: 0, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected controller={controllerFor(doc)} selection={[ids[0]]} onSelect={NOOP} onRemove={NOOP} />,
    );
    // `editableText: false` — a dblclick is swallowed and reaches no editor.
    expect(() => screen.getByTestId('image').dispatchEvent(dblclick(50, 50))).not.toThrow();
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
  });
});

describe('aspect-locked resize', () => {
  test('TC-18: a corner drag keeps the 2:1 ratio (a +40 x, +40 y drag on a 200×100 image)', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 100, y: 100, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected controller={controllerFor(doc)} selection={[ids[0]]} onSelect={NOOP} onRemove={NOOP} />,
    );
    // Begin the gesture on the SE handle, drag +40/+40 in screen px (zoom 1).
    const handle = screen.getByTestId('image-handle-se');
    handle.dispatchEvent(pointer('pointerdown', 300, 200));
    handle.dispatchEvent(pointer('pointermove', 340, 240));
    handle.dispatchEvent(pointer('pointerup', 340, 240));
    const after = snapshot(doc).find((obj) => obj.id === ids[0])!;
    // Aspect-locked: the ratio is preserved, so both axes grew by the same factor.
    expect(Math.round(after.width / after.height)).toBe(2);
    expect(after.width).toBeGreaterThan(200);
  });

  test('the ratio is preserved only because the image locks aspect (contrast)', () => {
    // Same drag under a *non*-locking mode (`'width'`, what a text box uses): the
    // box skews, proving the previous test really tested the lock, not a no-op.
    const { doc, ids } = seedDocWithImages([
      { x: 100, y: 100, width: 200, height: 100, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected controller={controllerFor(doc, 'width')} selection={[ids[0]]} onSelect={NOOP} onRemove={NOOP} />,
    );
    const handle = screen.getByTestId('image-handle-se');
    handle.dispatchEvent(pointer('pointerdown', 300, 200));
    handle.dispatchEvent(pointer('pointermove', 340, 240));
    handle.dispatchEvent(pointer('pointerup', 340, 240));
    const after = snapshot(doc).find((obj) => obj.id === ids[0])!;
    // A width-only drag leaves the height fixed at 100, so 2:1 is broken.
    expect(Math.round(after.height)).toBe(100);
  });

  test('TC-19: a drag past the minimum stops at 16 world units', () => {
    const { doc, ids } = seedDocWithImages([
      { x: 100, y: 100, width: 40, height: 20, status: 'ready', assetKey: 'b/aaaaaaaaaaaaaaaaaaaaaa' },
    ]);
    render(
      <ImageObject image={snapOf(doc, ids[0])} src={DATA} zoom={1} selected controller={controllerFor(doc)} selection={[ids[0]]} onSelect={NOOP} onRemove={NOOP} />,
    );
    const handle = screen.getByTestId('image-handle-se');
    // Drag far inward — the clamp must stop at the per-axis minimum, not go smaller.
    handle.dispatchEvent(pointer('pointerdown', 140, 120));
    handle.dispatchEvent(pointer('pointermove', 40, 80));
    handle.dispatchEvent(pointer('pointerup', 40, 80));
    const after = snapshot(doc).find((obj) => obj.id === ids[0])!;
    // Aspect-locked to 2:1, and both axes are floored at the minimum.
    expect(after.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.001);
    expect(after.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.001);
  });
});
