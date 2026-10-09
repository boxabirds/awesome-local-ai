import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX, MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { makeSticky } from '../fixtures/stickies';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { ensureTestboxRegistered, TESTBOX_TYPE } from '../fixtures/testbox';

interface TgRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<TgRegistry | null>;
let gestureLog: { starts: number; ends: number };

function genericBoxes(doc: Y.Doc): ObjectSnapshot[] {
  const objects = doc.getMap('objects');
  const out: ObjectSnapshot[] = [];
  for (const [id, value] of objects.entries()) {
    const entry = value as Y.Map<unknown>;
    if (entry.get('type') !== TESTBOX_TYPE) continue;
    const x = entry.get('x');
    const y = entry.get('y');
    const z = entry.get('z');
    const width = entry.get('width');
    const height = entry.get('height');
    const createdAt = entry.get('createdAt');
    out.push({
      id,
      type: TESTBOX_TYPE,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      width: typeof width === 'number' ? width : 100,
      height: typeof height === 'number' ? height : 100,
      createdAt: typeof createdAt === 'number' ? createdAt : 0
    });
  }
  return out;
}

function TgHarness(props: { canEdit: boolean }): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const merged = [...notes, ...genericBoxes(doc)];
  const selection = useSelection(merged);
  useBoardKeys({ doc, selection, snapshot: merged, canEdit: props.canEdit });
  registry.current = { doc, selection };
  return (
    <BoardViewport
      doc={doc}
      notes={merged}
      selection={selection}
      editable={props.canEdit}
      onGestureStart={() => {
        gestureLog.starts += 1;
      }}
      onGestureEnd={() => {
        gestureLog.ends += 1;
      }}
    />
  );
}

function mountHarness(canEdit = true): void {
  ensureTestboxRegistered();
  registry = { current: null };
  gestureLog = { starts: 0, ends: 0 };
  render(<TgHarness canEdit={canEdit} />);
}

function createBox(id: string, x: number, y: number, width: number, height: number): void {
  const doc = registry.current!.doc;
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', TESTBOX_TYPE);
    entry.set('x', x);
    entry.set('y', y);
    entry.set('z', 1);
    entry.set('width', width);
    entry.set('height', height);
    entry.set('createdAt', 0);
    doc.getMap('objects').set(id, entry);
  });
}

function boxValues(id: string): ObjectSnapshot {
  const found = genericBoxes(registry.current!.doc).find((b) => b.id === id);
  if (found === undefined) throw new Error(`box ${id} missing`);
  return found;
}

function noteEl(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-testid="sticky-${id}"]`)!;
}

function flushFrames(): void {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('transform gesture (sel.transform)', () => {
  test('TC-23: dragging an unselected object selects just it and moves only it', () => {
    mountHarness();
    const { doc, selection } = registry.current!;
    let a = '';
    let b = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
      b = makeSticky(doc, 500, 0);
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = snapshot(doc);
    const el = noteEl(b);
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect([...registry.current!.selection.ids]).toEqual([b]);
    const after = snapshot(doc);
    expect(after.find((n) => n.id === b)!.x).toBe(before.find((n) => n.id === b)!.x + DRAG_THRESHOLD_PX);
    expect(after.find((n) => n.id === a)!.x).toBe(before.find((n) => n.id === a)!.x);
  });

  test('TC-23 boundary: one pixel below the threshold is a click with no write', () => {
    mountHarness();
    const { doc } = registry.current!;
    let b = '';
    act(() => {
      b = makeSticky(doc, 0, 0);
    });
    const before = snapshot(doc)[0];
    const el = noteEl(b);
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100 });
    });
    flushFrames();
    expect(el.getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect([...registry.current!.selection.ids]).toEqual([b]);
    expect(snapshot(doc)[0].x).toBe(before.x);
  });

  test('TC-24: edge handle scales width only; Shift keeps the ratio; handles carry aria labels', () => {
    mountHarness();
    const { selection } = registry.current!;
    createBox('tb1', 0, 0, 100, 50);
    createBox('tb2', 200, 0, 100, 50);
    act(() => {
      selection.setMany(['tb1', 'tb2'], false);
    });
    for (const label of ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']) {
      expect(screen.getByLabelText(`Resize ${label}`)).toBeTruthy();
    }
    const east = screen.getByLabelText('Resize east');
    act(() => {
      fireEvent.pointerDown(east, { button: 0, pointerId: 2, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 550, clientY: 300 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 2 });
    const one = boxValues('tb1');
    const two = boxValues('tb2');
    expect(one.width).toBeCloseTo(150);
    expect(one.height).toBeCloseTo(50);
    expect(one.x).toBeCloseTo(0);
    expect(two.x).toBeCloseTo(300);
    expect(two.width).toBeCloseTo(150);
    expect(two.height).toBeCloseTo(50);

    // Shift while dragging the south-east corner scales uniformly: the
    // bounding box is 450 wide after the east drag, +300 → 750 (5/3).
    const se = screen.getByLabelText('Resize south-east');
    act(() => {
      fireEvent.pointerDown(se, { button: 0, pointerId: 3, clientX: 600, clientY: 300 });
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 900, clientY: 300, shiftKey: true });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 3 });
    const oneAgain = boxValues('tb1');
    expect(oneAgain.width).toBeCloseTo(one.width * (750 / 450));
    expect(oneAgain.height).toBeCloseTo(one.height * (750 / 450));
  });

  test('TC-25: with editing disabled no gesture writes and none starts', () => {
    mountHarness(false);
    const { doc } = registry.current!;
    let a = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
    });
    const before = snapshot(doc)[0];
    const el = noteEl(a);
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 140, clientY: 120 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(el.getAttribute('data-dragging')).toBe('false');
    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(gestureLog.starts).toBe(0);
    expect(gestureLog.ends).toBe(0);
  });

  test('TC-26: start and end fire exactly once; pointercancel keeps the last applied positions', () => {
    mountHarness();
    const { doc, selection } = registry.current!;
    let a = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = snapshot(doc)[0];
    const el = noteEl(a);
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 110, clientY: 100 });
    });
    expect(gestureLog.starts).toBe(1);
    expect(gestureLog.ends).toBe(0);
    flushFrames();
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(gestureLog.ends).toBe(1);
    expect(snapshot(doc)[0].x).toBe(before.x + 10);
    expect([...registry.current!.selection.ids]).toEqual([a]);

    // A second full drag increments each counter exactly once more.
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 120, clientY: 100 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(gestureLog.starts).toBe(2);
    expect(gestureLog.ends).toBe(2);
    expect(snapshot(doc)[0].x).toBe(before.x + 10 + 20);
  });

  test('moved objects render above unselected ones while keeping their relative order', () => {
    mountHarness();
    const { doc, selection } = registry.current!;
    let a = '';
    let b = '';
    let other = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
      b = makeSticky(doc, 250, 0);
      other = makeSticky(doc, 0, 500);
    });
    act(() => {
      selection.setMany([a, b], false);
    });
    const otherZBefore = snapshot(doc).find((n) => n.id === other)!.z;
    const el = noteEl(a);
    act(() => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 100 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 1 });
    const after = snapshot(doc);
    const za = after.find((n) => n.id === a)!.z;
    const zb = after.find((n) => n.id === b)!.z;
    const zOther = after.find((n) => n.id === other)!.z;
    expect(za).toBeGreaterThan(zOther);
    expect(zb).toBeGreaterThan(zOther);
    expect(zb - za).toBe(1);
    expect(zOther).toBe(otherZBefore);
  });

  test('a resized selection stays within its minimum size', () => {
    mountHarness();
    const { selection } = registry.current!;
    createBox('m1', 0, 0, 100, 100);
    act(() => {
      selection.setMany(['m1'], false);
    });
    const west = screen.getByLabelText('Resize west');
    act(() => {
      fireEvent.pointerDown(west, { button: 0, pointerId: 4, clientX: 200, clientY: 300 });
      // Push the west edge 500 units right: far below the testbox min of 10.
      fireEvent.pointerMove(window, { pointerId: 4, clientX: 200 + 500, clientY: 300 });
    });
    flushFrames();
    fireEvent.pointerUp(window, { pointerId: 4 });
    const box = boxValues('m1');
    expect(box.width).toBeCloseTo(10);
    expect(box.height).toBeCloseTo(100);
  });
});
