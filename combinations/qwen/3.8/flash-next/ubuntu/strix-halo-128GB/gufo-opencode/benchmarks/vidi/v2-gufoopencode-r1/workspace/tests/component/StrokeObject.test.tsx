import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import {
  createSticky,
  deleteObjects,
  initDoc,
  snapshotAll,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import { createStroke, type StrokeSnapshot } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';

interface Reg {
  doc: Y.Doc;
  selection: SelectionApi;
}
let registry: MutableRefObject<Reg | null> = { current: null };

function Harness(props: { canEdit?: boolean }): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;
  const [notes, setNotes] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const observer = (): void => setNotes(snapshotAll(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  const selection = useSelection(notes);
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit !== false} />;
}

const ctrl = (): Reg => registry.current!;
const objects = (): readonly ObjectSnapshot[] => snapshotAll(ctrl().doc);
const find = (id: string): ObjectSnapshot => objects().find((obj) => obj.id === id)!;
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};

function placeStroke(points: { x: number; y: number }[]): string {
  let id = '';
  act(() => {
    id = createStroke(ctrl().doc, { points, color: 'black', thickness: 'thin' }, 's') as string;
  });
  return id;
}

beforeEach(() => {
  registry = { current: null };
});
afterEach(() => {
  cleanup();
});

describe('stroke.object component (story 11)', () => {
  test('TC-15 hit tolerance stays constant in screen pixels across zooms', () => {
    const spec = getObjectType('stroke')!;
    // A thin (2 world units) straight line from (0, 0) to (100, 0).
    const line = {
      id: 'st-line',
      type: 'stroke',
      x: 0,
      y: 0,
      width: 100,
      height: 2,
      z: 1,
      createdAt: 0,
      baseWidth: 100,
      baseHeight: 2,
      points: [0, 1, 100, 1],
      color: 'black',
      thickness: 'thin'
    } as unknown as StrokeSnapshot;
    for (const zoom of [0.5, 2]) {
      expect(spec.hitTest(line, { x: 50, y: 1 + 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(line, { x: 50, y: 1 + 7 / zoom }, zoom)).toBe(false);
    }
  });

  test('TC-16 a click inside the bbox far from the line selects the sticky underneath', () => {
    render(<Harness />);
    press('v');
    let sticky = '';
    let stroke = '';
    act(() => {
      sticky = createSticky(ctrl().doc, { x: 100, y: 100 }) as string;
    });
    stroke = placeStroke([
      { x: 60, y: 60 },
      { x: 60, y: 220 },
      { x: 220, y: 220 }
    ]);
    const stickySnap = find(sticky);
    const strokeSnap = find(stroke);
    // The centre of the stroke bbox lies inside the sticky and far from the L path.
    const cx = strokeSnap.x + strokeSnap.width / 2;
    const cy = strokeSnap.y + strokeSnap.height / 2;
    expect(cx).toBeGreaterThan(stickySnap.x);
    expect(cx).toBeLessThan(stickySnap.x + stickySnap.width);
    expect(cy).toBeGreaterThan(stickySnap.y);
    expect(cy).toBeLessThan(stickySnap.y + stickySnap.height);
    expect(getObjectType('stroke')!.hitTest(strokeSnap, { x: cx, y: cy }, 1)).toBe(false);
    expect(getObjectType('sticky')!.hitTest(stickySnap, { x: cx, y: cy }, 1)).toBe(true);

    // The rendered root ignores pointers, so a press there reaches the sticky.
    const strokeEl = document.querySelector(`[data-testid="stroke-${stroke}"]`) as HTMLElement;
    expect(strokeEl).not.toBeNull();
    expect(strokeEl.style.pointerEvents).toBe('none');
    const stickyEl = document.querySelector(`[data-testid="sticky-${sticky}"]`) as HTMLElement;
    fireEvent.pointerDown(stickyEl, { button: 0, pointerId: 7, clientX: cx, clientY: cy });
    expect(ctrl().selection.ids.has(sticky)).toBe(true);
    expect(ctrl().selection.ids.has(stroke)).toBe(false);
  });

  test('TC-21 a stroke deleted remotely while selected just leaves the selection', () => {
    render(<Harness />);
    press('v');
    const stroke = placeStroke([
      { x: 0, y: 0 },
      { x: 120, y: 80 }
    ]);
    act(() => {
      ctrl().selection.setMany([stroke], false);
    });
    expect(ctrl().selection.ids.has(stroke)).toBe(true);
    act(() => {
      deleteObjects(ctrl().doc, [stroke]);
    });
    expect(ctrl().selection.ids.has(stroke)).toBe(false);
    expect(screen.queryByTestId(`stroke-${stroke}`)).toBeNull();
    // The board stays usable afterwards.
    let sticky = '';
    act(() => {
      sticky = createSticky(ctrl().doc, { x: 400, y: 400 }) as string;
    });
    const stickyEl = document.querySelector(`[data-testid="sticky-${sticky}"]`) as HTMLElement;
    fireEvent.pointerDown(stickyEl, { button: 0, pointerId: 9, clientX: 400, clientY: 400 });
    expect(ctrl().selection.ids.has(sticky)).toBe(true);
  });
});
