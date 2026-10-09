import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX, MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { makeSticky } from '../fixtures/stickies';
import type { Point } from '../../src/shared/geometry';

interface MqRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<MqRegistry | null>;

function MqHarness(): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: true });
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} />;
}

function mountHarness(): void {
  registry = { current: null };
  render(<MqHarness />);
}

function camera(): { x: number; y: number; zoom: number } {
  return (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera();
}

function w2s(world: Point): Point {
  const cam = camera();
  return { x: (world.x - cam.x) * cam.zoom, y: (world.y - cam.y) * cam.zoom };
}

afterEach(() => {
  cleanup();
});

describe('marquee selection (sel.marquee_ui)', () => {
  // Three notes: A fully inside the drag box, B half inside, C outside.
  // Positions are sticky CENTRES (createSticky centres on the given point).
  test('TC-20: shift+drag adds only fully-enclosed objects to the existing selection', () => {
    mountHarness();
    const { doc, selection } = registry.current!;
    let a = '';
    let b = '';
    let c = '';
    act(() => {
      a = makeSticky(doc, 100, 100);
      b = makeSticky(doc, 250, 100);
      c = makeSticky(doc, 900, 600);
    });
    act(() => {
      selection.setMany([c], false);
    });
    const viewport = screen.getByTestId('board-viewport');
    const from = w2s({ x: -30, y: -30 });
    const to = w2s({ x: 220, y: 220 });
    act(() => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 3, shiftKey: true, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(viewport, { pointerId: 3, clientX: to.x, clientY: to.y });
    });
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();
    act(() => {
      fireEvent.pointerUp(viewport, { pointerId: 3 });
    });
    const ids = [...registry.current!.selection.ids].sort();
    expect(ids).toEqual([a, c].sort());
    expect(ids).not.toContain(b);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  test('TC-21: a plain drag on empty space pans the board and shows no marquee', () => {
    mountHarness();
    const viewport = screen.getByTestId('board-viewport');
    const camBefore = camera().x;
    act(() => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 300, clientY: 300 });
      fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 250, clientY: 300 });
      fireEvent.pointerUp(viewport, { pointerId: 4 });
    });
    expect(camera().x).toBe(camBefore + 50);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(registry.current!.selection.ids.size).toBe(0);
  });

  test('TC-22: pointercancel mid-marquee leaves the selection unchanged', () => {
    mountHarness();
    const { doc, selection } = registry.current!;
    let a = '';
    let c = '';
    act(() => {
      a = makeSticky(doc, 100, 100);
      c = makeSticky(doc, 900, 600);
    });
    act(() => {
      selection.setMany([c], false);
    });
    const viewport = screen.getByTestId('board-viewport');
    const from = w2s({ x: -30, y: -30 });
    const to = w2s({ x: 220, y: 220 });
    act(() => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 5, shiftKey: true, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(viewport, { pointerId: 5, clientX: to.x, clientY: to.y });
      fireEvent.pointerCancel(viewport, { pointerId: 5 });
    });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect([...registry.current!.selection.ids]).toEqual([c]);
    expect(a).toBeTruthy();
  });

  test('a shift+click without drag does not change the selection', () => {
    mountHarness();
    const { selection } = registry.current!;
    const viewport = screen.getByTestId('board-viewport');
    const at = w2s({ x: 100, y: 100 });
    act(() => {
      selection.setMany(['ghost'], false);
    });
    act(() => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 6, shiftKey: true, clientX: at.x, clientY: at.y });
      fireEvent.pointerUp(viewport, { pointerId: 6 });
    });
    expect([...registry.current!.selection.ids]).toEqual(['ghost']);
  });
});
