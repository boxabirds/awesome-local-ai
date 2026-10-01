import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useSelection } from '../../src/client/board/useSelection';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import {
  LOCAL_ORIGIN, createSticky, deleteObjects, snapshotObjects, type ObjectSnapshot,
} from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { Harness, newDoc } from './helpers';

afterEach(cleanup);

const objs = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
const at = (doc: Y.Doc, id: string) => snapshotObjects(doc).find((o) => o.id === id)!;
const el = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
const selectedIds = () => [...document.querySelectorAll('[data-selected="true"]')].map((e) => e.getAttribute('data-id')).sort();

function note(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x: x + 100, y: y + 100 }) as string; // top-left at (x, y)
  return id;
}

function addBox(doc: Y.Doc, x: number, y: number, width = 100, height = 100): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objs(doc).set(id, m);
    m.set('type', 'testbox'); m.set('x', x); m.set('y', y); m.set('width', width); m.set('height', height);
    m.set('z', 1); m.set('createdAt', 0);
  }, LOCAL_ORIGIN);
  return id;
}

function press(target: Element, x = 5, y = 5, extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, pointerId: 1, ...extra });
}
function release(target: Element, x = 5, y = 5) {
  fireEvent.pointerUp(target, { clientX: x, clientY: y, pointerId: 1 });
}
function click(target: Element, extra: Record<string, unknown> = {}) {
  press(target, 5, 5, extra);
  release(target);
}
function drag(target: Element, dx: number, dy: number, extra: Record<string, unknown> = {}) {
  press(target, 100, 100, extra);
  fireEvent.pointerMove(target, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1, ...extra });
  return () => release(target, 100 + dx, 100 + dy);
}
const key = (k: string, extra: KeyboardEventInit = {}, target: Element | Window = document.body) =>
  fireEvent.keyDown(target, { key: k, ...extra });
const wait = () => new Promise((r) => setTimeout(r, 40));

describe('selection bar and state (sel.interaction)', () => {
  it('TC-16 every selected object deleted remotely: selection empty, bar hidden', () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
    act(() => { deleteObjects(doc, [a, b]); });
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-15 one of three deleted remotely: the others stay selected and the count follows', () => {
    const doc = newDoc();
    const [a, b, c] = [note(doc, 0, 0), note(doc, 300, 0), note(doc, 600, 0)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    act(() => { deleteObjects(doc, [b]); });
    expect(selectedIds()).toEqual([a, c].sort());
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('TC-17 two selected: "2 selected", a Delete selection button and a live announcement', () => {
    const doc = newDoc();
    note(doc, 0, 0); note(doc, 300, 0);
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    expect(screen.getByText('2 selected').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('TC-18 one sticky selected: the note toolbar is shown instead of the bar', () => {
    const doc = newDoc();
    const a = note(doc, 0, 0);
    render(<Harness doc={doc} />);
    click(el(a));
    expect(screen.getByRole('toolbar', { name: 'Note tools' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
  });

  it('shift-click toggles one object without touching the others; plain click selects only it', () => {
    const doc = newDoc();
    const [a, b, c] = [note(doc, 0, 0), note(doc, 300, 0), note(doc, 600, 0)];
    render(<Harness doc={doc} />);
    click(el(a));
    click(el(b), { shiftKey: true });
    expect(selectedIds()).toEqual([a, b].sort());
    click(el(c), { shiftKey: true });
    click(el(a), { shiftKey: true });
    expect(selectedIds()).toEqual([b, c].sort());
    click(el(b));
    expect(selectedIds()).toEqual([b]);
  });

  it('TC-19 empty-space click without a drag clears the selection', () => {
    const doc = newDoc();
    const a = note(doc, 0, 0);
    render(<Harness doc={doc} />);
    click(el(a));
    fireEvent.pointerDown(screen.getByTestId('empty-board'));
    expect(selectedIds()).toEqual([]);
  });

  it('Escape clears the selection', () => {
    const doc = newDoc();
    note(doc, 0, 0);
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    key('Escape');
    expect(selectedIds()).toEqual([]);
  });
});

function MarqueeBoard({ objects, onCamera }: { objects: readonly ObjectSnapshot[]; onCamera?: (c: unknown) => void }) {
  const sel = useSelection(objects);
  const ids = useMemo(() => [...sel.ids].sort().join(','), [sel.ids]);
  return (
    <>
      <output data-testid="ids">{ids}</output>
      <BoardViewport
        objects={objects}
        onMarqueeSelect={(found) => sel.setMany(found, true)}
        onEmptyClick={sel.clear}
        overlay={(api) => { onCamera?.(api.getCamera()); return null; }}
      >
        {objects.map((o) => <button key={o.id} data-id={o.id} onClick={() => sel.click(o.id)}>{o.id}</button>)}
      </BoardViewport>
    </>
  );
}

describe('marquee (sel.marquee_ui)', () => {
  // jsdom viewport 1024x768, camera starts at world (-512, -384), so screen (sx, sy) = world (sx-512, sy-384).
  const world = (wx: number, wy: number) => ({ x: wx + 512, y: wy + 384 });
  const shiftDrag = (vp: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
    fireEvent.pointerDown(vp, { clientX: from.x, clientY: from.y, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(vp, { clientX: to.x, clientY: to.y, pointerId: 1, shiftKey: true });
  };

  it('TC-20 Shift+drag adds fully-inside objects to the existing selection; partly inside is not selected', () => {
    const doc = newDoc();
    const inside = note(doc, -400, -300); // -400..-200
    const half = note(doc, -250, -300); // -250..-50: half inside a rect ending at -150
    const outside = note(doc, 600, 600);
    const existing = note(doc, 300, 300);
    const objects = snapshotObjects(doc);
    render(<MarqueeBoard objects={objects} />);
    fireEvent.click(document.querySelector(`[data-id="${existing}"]`)!);
    const vp = screen.getByTestId('board-viewport');
    shiftDrag(vp, world(-450, -350), world(-150, -50));
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerUp(vp, { clientX: world(-150, -50).x, clientY: world(-150, -50).y, pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(screen.getByTestId('ids').textContent).toBe([existing, inside].sort().join(','));
    expect(screen.getByTestId('ids').textContent).not.toContain(half);
    expect(screen.getByTestId('ids').textContent).not.toContain(outside);
  });

  it('TC-21 plain drag pans and draws no marquee', () => {
    const doc = newDoc();
    note(doc, -400, -300);
    let cam = { x: 0, y: 0, zoom: 1 };
    render(<MarqueeBoard objects={snapshotObjects(doc)} onCamera={(c) => { cam = c as typeof cam; }} />);
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 110, clientY: 10, pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(vp, { clientX: 110, clientY: 10, pointerId: 1 });
    expect(cam.x).toBeLessThan(-512);
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const doc = newDoc();
    const existing = note(doc, 300, 300);
    note(doc, -400, -300);
    render(<MarqueeBoard objects={snapshotObjects(doc)} />);
    fireEvent.click(document.querySelector(`[data-id="${existing}"]`)!);
    const vp = screen.getByTestId('board-viewport');
    shiftDrag(vp, world(-450, -350), world(-150, -50));
    fireEvent.pointerCancel(vp, { pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(screen.getByTestId('ids').textContent).toBe(existing);
  });

  it('Escape during a marquee discards it', () => {
    const doc = newDoc();
    note(doc, -400, -300);
    render(<MarqueeBoard objects={snapshotObjects(doc)} />);
    const vp = screen.getByTestId('board-viewport');
    shiftDrag(vp, world(-450, -350), world(-150, -50));
    key('Escape');
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(screen.getByTestId('ids').textContent).toBe('');
  });

  it('a Shift+drag over nothing selects nothing; empty board does not fail', () => {
    render(<MarqueeBoard objects={[]} />);
    const vp = screen.getByTestId('board-viewport');
    shiftDrag(vp, { x: 10, y: 10 }, { x: 200, y: 200 });
    fireEvent.pointerUp(vp, { clientX: 200, clientY: 200, pointerId: 1 });
    expect(screen.getByTestId('ids').textContent).toBe('');
  });
});

describe('transform gesture (sel.transform)', () => {
  it('TC-23 dragging an unselected object selects only it and moves only it', async () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    click(el(a));
    const up = drag(el(b), 40, 0);
    await waitFor(() => expect(at(doc, b).x).toBe(340));
    up();
    expect(selectedIds()).toEqual([b]);
    expect(at(doc, a).x).toBe(0);
  });

  it('TC-23 boundary: DRAG_THRESHOLD_PX - 1 is a click, DRAG_THRESHOLD_PX starts the gesture', async () => {
    const doc = newDoc();
    const a = note(doc, 0, 0);
    const start = vi.fn();
    render(<Harness doc={doc} onGestureStart={start} />);
    press(el(a), 100, 100);
    fireEvent.pointerMove(el(a), { clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100, pointerId: 1 });
    release(el(a), 100 + DRAG_THRESHOLD_PX - 1, 100);
    await wait();
    expect(at(doc, a).x).toBe(0);
    expect(start).not.toHaveBeenCalled();
    press(el(a), 100, 100);
    fireEvent.pointerMove(el(a), { clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100, pointerId: 1 });
    release(el(a), 100 + DRAG_THRESHOLD_PX, 100);
    expect(at(doc, a).x).toBe(DRAG_THRESHOLD_PX);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('dragging one selected object moves the whole selection above unselected ones, keeping their order', async () => {
    const doc = newDoc();
    const [a, b, c, d] = [note(doc, 0, 0), note(doc, 300, 0), note(doc, 600, 0), note(doc, 900, 0)];
    render(<Harness doc={doc} />);
    click(el(a)); click(el(b), { shiftKey: true }); click(el(c), { shiftKey: true });
    const up = drag(el(b), 300, 20);
    await waitFor(() => expect(at(doc, a).x).toBe(300));
    up();
    expect(at(doc, b)).toMatchObject({ x: 600, y: 20 });
    expect(at(doc, c)).toMatchObject({ x: 900, y: 20 });
    expect(at(doc, d)).toMatchObject({ x: 900, y: 0 });
    const z = (id: string) => at(doc, id).z;
    expect(Math.min(z(a), z(b), z(c))).toBeGreaterThan(z(d));
    expect(z(a)).toBeLessThan(z(b));
    expect(z(b)).toBeLessThan(z(c));
  });

  it('click on an already selected object (no drag) narrows the selection to it', () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    click(el(a));
    expect(selectedIds()).toEqual([a]);
    expect(b).toBeTruthy();
  });

  it('TC-24 testbox: edge handle changes one dimension, Shift keeps the ratio, handles are labelled', async () => {
    const doc = newDoc();
    const box = addBox(doc, 0, 0, 100, 50);
    render(<Harness doc={doc} />);
    click(el(box));
    for (const l of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(screen.getByRole('button', { name: `Resize ${l}` })).toBeTruthy();
    }
    const right = screen.getByRole('button', { name: 'Resize right' });
    press(right, 100, 25);
    fireEvent.pointerMove(right, { clientX: 150, clientY: 25, pointerId: 1 });
    await waitFor(() => expect(at(doc, box).width).toBe(150));
    release(right, 150, 25);
    expect(at(doc, box)).toMatchObject({ x: 0, y: 0, width: 150, height: 50 });

    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });
    press(corner, 150, 50);
    fireEvent.pointerMove(corner, { clientX: 300, clientY: 60, pointerId: 1, shiftKey: true });
    await waitFor(() => expect(at(doc, box).width).toBe(300));
    release(corner, 300, 60);
    expect(at(doc, box).height).toBeCloseTo(100);
  });

  it('resizing a selection of two stickies scales sizes and gaps and keeps them square; min size holds', async () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)]; // 0..200 and 300..500
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    const right = screen.getByRole('button', { name: 'Resize right' });
    press(right, 500, 100);
    fireEvent.pointerMove(right, { clientX: 1000, clientY: 100, pointerId: 1 });
    await waitFor(() => expect(at(doc, a).width).toBe(400));
    release(right, 1000, 100);
    expect(at(doc, a)).toMatchObject({ x: 0, width: 400, height: 400 });
    expect(at(doc, b)).toMatchObject({ x: 600, width: 400, height: 400 });

    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });
    press(corner, 1000, 400);
    fireEvent.pointerMove(corner, { clientX: -5000, clientY: -5000, pointerId: 1 });
    await waitFor(() => expect(at(doc, a).width).toBeCloseTo(50));
    release(corner, -5000, -5000);
    expect(at(doc, b).width).toBeCloseTo(50);
    expect(at(doc, b).height).toBeCloseTo(50);
  });

  it('TC-25 load failed: gesture refused, no writes, selection still works', async () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    const start = vi.fn();
    render(<Harness doc={doc} canEdit={false} onGestureStart={start} />);
    click(el(a)); click(el(b), { shiftKey: true });
    expect(selectedIds()).toEqual([a, b].sort());
    const before = JSON.stringify(snapshotObjects(doc));
    const up = drag(el(a), 80, 80);
    await wait();
    up();
    expect(JSON.stringify(snapshotObjects(doc))).toBe(before);
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Resize/ })).toBeNull();
    key('Delete');
    key('ArrowRight');
    expect(JSON.stringify(snapshotObjects(doc))).toBe(before);
  });

  it('TC-26 start and end hooks fire once per drag; pointercancel keeps the last applied position', async () => {
    const doc = newDoc();
    const a = note(doc, 0, 0);
    const [start, end] = [vi.fn(), vi.fn()];
    render(<Harness doc={doc} onGestureStart={start} onGestureEnd={end} />);
    const up = drag(el(a), 40, 0);
    fireEvent.pointerMove(el(a), { clientX: 160, clientY: 100, pointerId: 1 });
    await waitFor(() => expect(at(doc, a).x).toBeGreaterThan(0));
    up();
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(at(doc, a).x).toBe(60);

    drag(el(a), 20, 0);
    await waitFor(() => expect(at(doc, a).x).toBe(80));
    fireEvent.pointerMove(el(a), { clientX: 400, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(el(a), { pointerId: 1 });
    await wait();
    expect(at(doc, a).x).toBe(80);
    expect(start).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('an object pruned mid-drag is skipped; the rest keep moving', async () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    const up = drag(el(a), 40, 0);
    await waitFor(() => expect(at(doc, b).x).toBe(340));
    act(() => { deleteObjects(doc, [a]); });
    fireEvent.pointerMove(el(b), { clientX: 200, clientY: 100, pointerId: 1 });
    await waitFor(() => expect(at(doc, b).x).toBe(400));
    up();
    expect(screen.queryByText('2 selected')).toBeNull();
  });
});

describe('keyboard (sel.keyboard)', () => {
  it('TC-27 Ctrl/Cmd+A selects every object and prevents the default', () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    expect(key('a', { ctrlKey: true })).toBe(false);
    expect(selectedIds()).toEqual([a, b].sort());
    key('Escape');
    expect(key('A', { metaKey: true })).toBe(false);
    expect(selectedIds()).toEqual([a, b].sort());
  });

  it('TC-28 Ctrl+A on an empty board selects nothing and does not fail', () => {
    render(<Harness doc={newDoc()} />);
    expect(() => key('a', { ctrlKey: true })).not.toThrow();
    expect(selectedIds()).toEqual([]);
  });

  it('TC-29 arrows nudge by NUDGE_STEP_WORLD, Shift+arrow by NUDGE_LARGE_STEP_WORLD, default prevented', () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 50)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    expect(key('ArrowRight')).toBe(false);
    expect(at(doc, a).x).toBe(NUDGE_STEP_WORLD);
    expect(at(doc, b).x).toBe(300 + NUDGE_STEP_WORLD);
    expect(key('ArrowUp', { shiftKey: true })).toBe(false);
    expect(at(doc, a).y).toBe(-NUDGE_LARGE_STEP_WORLD);
    expect(at(doc, b).y).toBe(50 - NUDGE_LARGE_STEP_WORLD);
  });

  it('arrows with nothing selected keep their default behaviour', () => {
    render(<Harness doc={newDoc()} />);
    expect(key('ArrowLeft')).toBe(true);
  });

  it('TC-30 Backspace while editing text edits the text and keeps the objects', () => {
    const doc = newDoc();
    const [a, b] = [note(doc, 0, 0), note(doc, 300, 0)];
    render(<Harness doc={doc} />);
    key('a', { ctrlKey: true });
    fireEvent.doubleClick(el(a));
    const box = screen.getByRole('textbox');
    key('Backspace', {}, box);
    key('a', { ctrlKey: true }, box);
    expect(snapshotObjects(doc)).toHaveLength(2);
    expect(at(doc, a)).toBeTruthy();
    expect(at(doc, b)).toBeTruthy();
  });

  it.each(['Delete', 'Backspace'])('TC-31 %s removes every selected object and empties the selection', (k) => {
    const doc = newDoc();
    const [a, b, c] = [note(doc, 0, 0), note(doc, 300, 0), note(doc, 600, 0)];
    render(<Harness doc={doc} />);
    click(el(a)); click(el(b), { shiftKey: true });
    key(k);
    expect(snapshotObjects(doc).map((o) => o.id)).toEqual([c]);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
