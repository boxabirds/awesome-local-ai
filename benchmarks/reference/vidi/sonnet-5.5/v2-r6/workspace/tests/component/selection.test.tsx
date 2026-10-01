import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import type { Camera } from '../../src/client/canvas/camera';
import { BoardApp } from '../../src/client/App';
import {
  createSticky, deleteObjects, initDoc, snapshot, type ObjectSnapshot,
} from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { registerTestbox } from '../fixtures/testbox';
import { addNote, click, moveTo, noteEl, notes, press, release, renderBoard } from './board';
import { flushFrame, readCamera } from './helpers';

const selectAll = () => fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
const toScreen = (world: HTMLElement, x: number, y: number): [number, number] => {
  const cam = readCamera(world);
  return [(x - cam.x) * cam.zoom, (y - cam.y) * cam.zoom];
};
const selectedIds = () => [...document.querySelectorAll('[data-selected="true"]')].map((e) => (e as HTMLElement).dataset.noteId);

describe('selection bar and state (sel.interaction)', () => {
  it('TC-17 two selected: "2 selected", Delete selection button, live region', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    selectAll();
    expect(screen.getByText('2 selected').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Note toolbar' })).toBeNull();
  });

  it('TC-18 exactly one sticky shows the note toolbar instead of the bar', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    click(noteEl(id));
    expect(screen.getByRole('toolbar', { name: 'Note toolbar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
  });

  it('the Delete selection button removes every selected note and clears the selection', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    selectAll();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(notes(doc)).toHaveLength(0);
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('TC-16 all selected notes deleted by someone else: selection empty, bar hidden', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    selectAll();
    act(() => { deleteObjects(doc, notes(doc).map((n) => n.id)); });
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('one of three deleted remotely: the other two stay selected (sel.remote_delete)', () => {
    const { doc } = renderBoard();
    const [a, b, c] = [addNote(doc, 0, 0), addNote(doc, 400, 0), addNote(doc, 800, 0)];
    selectAll();
    act(() => { deleteObjects(doc, [b]); });
    expect(selectedIds().sort()).toEqual([a, c].sort());
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('shift-click adds and removes; a plain click selects only that note', () => {
    const { doc } = renderBoard();
    const [a, b, c] = [addNote(doc, 0, 0), addNote(doc, 400, 0), addNote(doc, 800, 0)];
    click(noteEl(a));
    fireEvent.pointerDown(noteEl(b), { button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, shiftKey: true });
    expect(selectedIds().sort()).toEqual([a, b].sort());
    fireEvent.pointerDown(noteEl(a), { button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(noteEl(a), { pointerId: 1, shiftKey: true });
    expect(selectedIds()).toEqual([b]);
    click(noteEl(c));
    expect(selectedIds()).toEqual([c]);
  });

  it('TC-19 clicking empty space without dragging clears; Escape clears', () => {
    const { doc, viewport } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    selectAll();
    click(viewport, 5, 5);
    expect(selectedIds()).toEqual([]);
    selectAll();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectedIds()).toEqual([]);
  });

  it('SelectionBar without a camera renders in place', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const snap = snapshot(doc);
    const onDelete = vi.fn();
    render(<SelectionBar ids={new Set(snap.map((n) => n.id))} snapshot={snap} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe('marquee (sel.marquee_ui)', () => {
  const shiftDown = (el: Element, x: number, y: number) =>
    fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: true });

  function layout() {
    const ctx = renderBoard();
    // A at world (0,0)-(200,200); B straddles x=300; C far away.
    const a = addNote(ctx.doc, 100, 100);
    const b = addNote(ctx.doc, 400, 100);
    const c = addNote(ctx.doc, 1500, 1500);
    return { ...ctx, a, b, c };
  }

  it('TC-20 Shift+drag adds only fully-inside notes to the existing selection', () => {
    const { world, viewport, a, b, c } = layout();
    click(noteEl(c));
    const [x0, y0] = toScreen(world, -50, -50);
    const [x1, y1] = toScreen(world, 350, 250);
    shiftDown(viewport, x0, y0);
    moveTo(viewport, x1, y1);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    release(viewport, x1, y1);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds().sort()).toEqual([a, c].sort());
    expect(selectedIds()).not.toContain(b);
  });

  it('Shift+drag over nothing leaves the selection unchanged', () => {
    const { world, viewport, c } = layout();
    click(noteEl(c));
    const [x0, y0] = toScreen(world, 600, 600);
    shiftDown(viewport, x0, y0);
    moveTo(viewport, x0 + 50, y0 + 50);
    release(viewport, x0 + 50, y0 + 50);
    expect(selectedIds()).toEqual([c]);
  });

  it('TC-21 a plain drag pans the board and draws no marquee', async () => {
    const { world, viewport } = layout();
    const before = readCamera(world);
    press(viewport, 300, 300);
    moveTo(viewport, 360, 340);
    await flushFrame();
    expect(screen.queryByTestId('marquee')).toBeNull();
    release(viewport, 360, 340);
    expect(readCamera(world)).not.toEqual(before);
  });

  it('TC-22 pointercancel mid-marquee discards it; selection unchanged', () => {
    const { world, viewport, a, c } = layout();
    click(noteEl(c));
    const [x0, y0] = toScreen(world, -50, -50);
    const [x1, y1] = toScreen(world, 350, 250);
    shiftDown(viewport, x0, y0);
    moveTo(viewport, x1, y1);
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    release(viewport, x1, y1);
    expect(selectedIds()).toEqual([c]);
    expect(selectedIds()).not.toContain(a);
  });

  it('Escape mid-marquee abandons it without clearing the selection', () => {
    const { world, viewport, c } = layout();
    click(noteEl(c));
    const [x0, y0] = toScreen(world, -50, -50);
    shiftDown(viewport, x0, y0);
    moveTo(viewport, x0 + 100, y0 + 100);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([c]);
  });
});

describe('transform through the board (sel.transform)', () => {
  it('dragging a selected note moves the whole selection and raises it above others', async () => {
    const { doc } = renderBoard();
    const [a, b] = [addNote(doc, 0, 0), addNote(doc, 400, 0)];
    const other = addNote(doc, 800, 0);
    const before = new Map(notes(doc).map((n) => [n.id, n]));
    click(noteEl(a));
    fireEvent.pointerDown(noteEl(b), { button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, shiftKey: true });
    press(noteEl(a), 100, 100);
    moveTo(noteEl(a), 150, 130);
    await flushFrame();
    release(noteEl(a), 150, 130);
    const after = new Map(notes(doc).map((n) => [n.id, n]));
    for (const id of [a, b]) {
      expect(after.get(id)!.x).toBe(before.get(id)!.x + 50);
      expect(after.get(id)!.y).toBe(before.get(id)!.y + 30);
      expect(after.get(id)!.z).toBeGreaterThan(after.get(other)!.z);
    }
    expect(after.get(other)!.x).toBe(before.get(other)!.x);
    expect(selectedIds().sort()).toEqual([a, b].sort());
  });

  it('dragging the bottom-right handle scales both notes and their gap, keeping them square', async () => {
    const { doc } = renderBoard();
    const [a, b] = [addNote(doc, 0, 0), addNote(doc, 300, 0)]; // 200 wide, 100 apart
    selectAll();
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    moveTo(document.body, 500, 100); // box is 500 wide: +500 doubles it
    await flushFrame();
    release(document.body, 500, 100);
    const na = notes(doc).find((n) => n.id === a)!;
    const nb = notes(doc).find((n) => n.id === b)!;
    expect(na.width).toBe(400);
    expect(na.height).toBe(400);
    expect(nb.x - (na.x + na.width)).toBe(200);
  });

  it('shrinking stops at the 50-unit sticky minimum', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    click(noteEl(a));
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    moveTo(document.body, -190, -190);
    await flushFrame();
    release(document.body, -190, -190);
    expect(notes(doc)[0]).toMatchObject({ width: 50, height: 50 });
  });

  it('handles have accessible names for every position', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    selectAll();
    for (const name of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(screen.getByRole('button', { name: `Resize ${name}` })).toBeTruthy();
    }
  });

  it('TC-25 a board that failed to load refuses moves, resizes, nudges and deletes', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 }) as string;
    render(<BoardApp board={{ doc, notes: snapshot(doc), connection: 'load_failed' }} />);
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const el = noteEl(id);
    press(el, 310, 310);
    moveTo(el, 400, 400);
    await flushFrame();
    release(el, 400, 400);
    selectAll();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: /^Resize/ })).toBeNull();
    expect(updates).toBe(0);
  });
});

/** Generic objects (no sticky UI) driven straight through the hooks. */
function readAll(doc: Y.Doc): ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  doc.getMap('objects').forEach((m, id) => {
    const o = m as Y.Map<unknown>;
    out.push({
      id, type: o.get('type'), x: o.get('x'), y: o.get('y'), width: o.get('width'), height: o.get('height'),
      z: o.get('z') ?? 0, color: 'yellow', text: '', createdAt: 0,
    } as ObjectSnapshot);
  });
  return out;
}

function addBox(doc: Y.Doc, id: string, x: number, y: number, w = 100, h = 60, type = 'testbox') {
  const m = new Y.Map<unknown>();
  doc.getMap('objects').set(id, m);
  m.set('type', type);
  m.set('x', x);
  m.set('y', y);
  m.set('width', w);
  m.set('height', h);
  m.set('z', 1);
}

function GestureHarness(props: {
  doc: Y.Doc; canEdit?: boolean; onStart?(): void; onEnd?(): void; zoom?: number;
}) {
  const { doc } = props;
  const [snap, setSnap] = useState(() => readAll(doc));
  useEffect(() => {
    const h = () => setSnap(readAll(doc));
    doc.on('update', h);
    return () => doc.off('update', h);
  }, [doc]);
  const selection = useSelection(snap);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: props.zoom ?? 1 });
  const g = useTransformGesture({
    doc, camera, selection, snapshot: snap, canEdit: props.canEdit ?? true,
    onGestureStart: props.onStart, onGestureEnd: props.onEnd,
  });
  const camValue: Camera = camera.current;
  return (
    <div>
      {snap.map((o) => (
        <div
          key={o.id}
          data-testid={`obj-${o.id}`}
          data-selected={selection.ids.has(o.id) ? 'true' : 'false'}
          onPointerDown={(e) => g.onObjectPointerDown(e, o.id)}
        />
      ))}
      <button type="button" onClick={() => selection.setMany(snap.map((o) => o.id), false)}>all</button>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={snap}
        camera={camValue}
        onHandlePointerDown={g.onHandlePointerDown}
      />
    </div>
  );
}

function setupGenerics() {
  registerTestbox();
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}
const box = (doc: Y.Doc, id: string) => {
  const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
  return { x: m.get('x') as number, y: m.get('y') as number, w: m.get('width') as number, h: m.get('height') as number };
};

describe('generic gesture over registered types', () => {
  it('TC-23 dragging an unselected object selects only it and moves only it; threshold boundary', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0);
    addBox(doc, 'b', 300, 0);
    render(<GestureHarness doc={doc} />);
    fireEvent.click(screen.getByText('all'));
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId('obj-a'), { pointerId: 1, clientX: 10, clientY: 10 });
    // a selected alone now; DRAG_THRESHOLD_PX - 1 is a click: no write
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const b = screen.getByTestId('obj-b');
    fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, DRAG_THRESHOLD_PX - 1, 0);
    await flushFrame();
    release(document.body, DRAG_THRESHOLD_PX - 1, 0);
    expect(updates).toBe(0);
    expect(screen.getByTestId('obj-b').dataset.selected).toBe('true');
    expect(screen.getByTestId('obj-a').dataset.selected).toBe('false');
    // exactly DRAG_THRESHOLD_PX starts the gesture; only b moves
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(screen.getByTestId('obj-a'), { pointerId: 1 });
    fireEvent.pointerDown(screen.getByTestId('obj-b'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(screen.getByTestId('obj-b'), { pointerId: 1 });
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, DRAG_THRESHOLD_PX, 0);
    await flushFrame();
    release(document.body, DRAG_THRESHOLD_PX, 0);
    expect(box(doc, 'a').x).toBe(DRAG_THRESHOLD_PX);
    expect(box(doc, 'b').x).toBe(300);
  });

  it('TC-24 an edge handle changes width only; Shift keeps the ratio; labels exist', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0, 100, 60);
    render(<GestureHarness doc={doc} />);
    fireEvent.click(screen.getByText('all'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize right' }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, 50, 20);
    await flushFrame();
    release(document.body, 50, 20);
    expect(box(doc, 'a')).toEqual({ x: 0, y: 0, w: 150, h: 60 });

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize bottom-right' }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document.body, { clientX: 150, clientY: 0, pointerId: 1, shiftKey: true });
    await flushFrame();
    fireEvent.pointerUp(document.body, { clientX: 150, clientY: 0, pointerId: 1, shiftKey: true });
    const r = box(doc, 'a');
    expect(r.w / r.h).toBeCloseTo(150 / 60, 9);
    expect(r.w).toBe(300);
  });

  it('TC-26 gesture start and end fire once per drag; cancel keeps the last applied position', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(<GestureHarness doc={doc} onStart={onStart} onEnd={onEnd} />);
    const a = screen.getByTestId('obj-a');
    fireEvent.pointerDown(a, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, 20, 0);
    moveTo(document.body, 40, 0);
    await flushFrame();
    release(document.body, 40, 0);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(box(doc, 'a').x).toBe(40);

    fireEvent.pointerDown(a, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, 30, 0);
    await flushFrame();
    fireEvent.pointerCancel(document.body, { pointerId: 1 });
    moveTo(document.body, 300, 0);
    await flushFrame();
    expect(box(doc, 'a').x).toBe(40 + 30);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('a click without movement calls neither hook', () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0);
    const onStart = vi.fn();
    render(<GestureHarness doc={doc} onStart={onStart} />);
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(document.body, { pointerId: 1 });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('TC-25 canEdit false: no writes, no handles', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0);
    render(<GestureHarness doc={doc} canEdit={false} />);
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, 50, 0);
    await flushFrame();
    release(document.body, 50, 0);
    expect(updates).toBe(0);
  });

  it('an object deleted mid-drag is skipped; the rest keep moving', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0);
    addBox(doc, 'b', 300, 0);
    render(<GestureHarness doc={doc} />);
    fireEvent.click(screen.getByText('all'));
    fireEvent.pointerDown(screen.getByTestId('obj-a'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, 10, 0);
    await flushFrame();
    act(() => { doc.getMap('objects').delete('b'); });
    moveTo(document.body, 30, 0);
    await flushFrame();
    release(document.body, 30, 0);
    expect(box(doc, 'a').x).toBe(30);
  });

  it('resizing mixed objects is bounded by the minimum of the first object to reach it', async () => {
    const doc = setupGenerics();
    addBox(doc, 'a', 0, 0, 100, 100); // testbox, min 10
    addBox(doc, 'b', 200, 0, 100, 100);
    render(<GestureHarness doc={doc} />);
    fireEvent.click(screen.getByText('all'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize right' }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    moveTo(document.body, -290, 0);
    await flushFrame();
    release(document.body, -290, 0);
    expect(box(doc, 'a').w).toBeCloseTo(10, 9);
    expect(box(doc, 'b').w).toBeCloseTo(10, 9);
    expect(box(doc, 'b').x).toBeCloseTo(20, 9);
  });
});

describe('keyboard (sel.keyboard)', () => {
  it('TC-27 Ctrl/Cmd+A selects every note and prevents the browser default', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    expect(selectedIds()).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(fireEvent.keyDown(window, { key: 'A', metaKey: true })).toBe(false);
    expect(selectedIds()).toHaveLength(2);
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing without error', () => {
    renderBoard();
    expect(() => selectAll()).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('TC-29 arrows nudge by 1, Shift+arrow by 10, and prevent scrolling', () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    const b = addNote(doc, 400, 0);
    selectAll();
    const [x0, y0] = [notes(doc).find((n) => n.id === a)!.x, notes(doc).find((n) => n.id === a)!.y];
    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    expect(notes(doc).find((n) => n.id === a)!.x).toBe(x0 + NUDGE_STEP_WORLD);
    expect(notes(doc).find((n) => n.id === b)!.x).toBe(400 - 100 + NUDGE_STEP_WORLD);
    fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    expect(notes(doc).find((n) => n.id === a)!.y).toBe(y0 - NUDGE_LARGE_STEP_WORLD);
  });

  it('arrows with nothing selected do nothing', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    const before = notes(doc);
    expect(fireEvent.keyDown(window, { key: 'ArrowLeft' })).toBe(true);
    expect(notes(doc)).toEqual(before);
  });

  it('TC-30 Backspace while editing text edits the text and keeps the notes', () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    fireEvent.doubleClick(noteEl(a));
    const area = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.keyDown(area, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(notes(doc)).toHaveLength(2);
  });

  it('TC-31 Delete removes every selected note and empties the selection', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    const keep = addNote(doc, 800, 0);
    click(noteEl(keep));
    selectAll();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(notes(doc)).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });
});
