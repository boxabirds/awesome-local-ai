// TC-23 to TC-26: group move, handle resize for a non-aspect-locked type,
// load-failed gesture refusal and the single start/end per drag.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { Selection } from '../../src/client/board/useSelection';
import {
  App,
  createNote,
  flush,
  noteEl,
  notes,
  pressAndRelease,
} from './stickyHelpers';
import { createTestbox, dragPath, objectFields, testboxEl } from './selectionHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('transform gesture', () => {
  it('TC-23: dragging an unselected object selects only it and moves only it', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(1000, 0);
    pressAndRelease(noteEl(a));
    expect(noteEl(a).getAttribute('data-selected')).toBe('true');

    dragPath(noteEl(b), [
      [50, 50],
      [80, 75],
      [150, 100],
    ]);

    expect(noteEl(a).getAttribute('data-selected')).toBe('false');
    expect(noteEl(b).getAttribute('data-selected')).toBe('true');
    const [na, nb] = [...notes()].sort((p, q) => p.createdAt - q.createdAt);
    expect(na).toMatchObject({ id: a, x: 0, y: 0 });
    expect(nb).toMatchObject({ id: b, x: 1100, y: 50 });
  });

  it('TC-24: an edge handle changes width only; Shift keeps the ratio', () => {
    render(<App />);
    flush();
    const box = createTestbox(0, 0, 100, 80);
    pressAndRelease(testboxEl(box));

    const eHandle = screen.getByTestId('handle-e');
    dragPath(eHandle, [
      [740, 440],
      [780, 440],
    ]);
    expect(objectFields(box)).toMatchObject({ width: 140, height: 80 });

    // Shift+drag keeps the 100:80 ratio (scale 1.4 on both axes).
    dragPath(eHandle, [
      [740, 440],
      [780, 440],
    ], true);
    const fields = objectFields(box);
    expect(fields.width).toBeCloseTo(180);
    expect(fields.height).toBeCloseTo((80 * 180) / 140);
  });

  it('TC-25: a load-failed board refuses the gesture and writes nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', 500);
    m.set('y', 500);
    m.set('z', 1);
    m.set('createdAt', 1);
    objects.set('x1', m);

    const click = vi.fn();
    const selection: Selection = {
      ids: new Set(['x1']),
      editingId: null,
      click,
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    function Harness(): React.JSX.Element {
      const gesture = useTransformGesture({
        doc,
        camera: { x: 0, y: 0, zoom: 1 },
        selection,
        snapshot: objectSnapshots(doc),
        canEdit: false,
      });
      return (
        <div
          data-testid="target"
          onPointerDown={(e) => gesture.onObjectPointerDown(e, 'x1')}
        />
      );
    }

    render(<Harness />);
    const target = screen.getByTestId('target');
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 60 });
    flush();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 120, clientY: 60 });

    expect(objects.get('x1')!.get('x')).toBe(500);
    expect(objects.get('x1')!.get('y')).toBe(500);
    expect(click).not.toHaveBeenCalled();
  });

  it('TC-26: the bar hides for the whole drag and returns exactly once after release', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(600, 0);
    pressAndRelease(noteEl(a));
    fireEvent.pointerDown(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    flush();
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Mid-drag: the bar is suppressed.
    fireEvent.pointerDown(noteEl(a), { pointerId: 1, clientX: 20, clientY: 20, button: 0 });
    fireEvent.pointerMove(noteEl(a), { pointerId: 1, clientX: 120, clientY: 60 });
    flush();
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    fireEvent.pointerUp(noteEl(a), { pointerId: 1, clientX: 120, clientY: 60 });
    flush();
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    const [na, nb] = [...notes()].sort((p, q) => p.createdAt - q.createdAt);
    expect(na.x).toBe(100);
    expect(nb.x).toBe(700);
    act(() => undefined);
  });
});
