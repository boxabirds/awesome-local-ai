import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import {
  renderApp,
  dragNote,
  pressNote,
  shiftPressNote,
  dragHandle,
  windowKeyDown,
  setSize,
  type AppHarness,
} from './appHarness';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';

function bounds(app: AppHarness, id: string) {
  const obj = app.notes().find((n) => n.id === id);
  if (!obj) throw new Error(`note ${id} not found`);
  return objectBounds(obj as ObjectSnapshot);
}

function selectedIds(app: AppHarness): string[] {
  return [...app.notes()]
    .filter((n) => app.noteOrNull(n.id)?.getAttribute('data-selected') === 'true')
    .map((n) => n.id);
}

describe('transform gesture (story 7, ui-component)', () => {
  it('TC-18: dragging one note moves it by the pointer delta (absolute world position)', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 }); // centred → left-top (0,0)
    dragNote(app, a, 100, 40);
    expect(bounds(app, a)).toEqual({ x: 100, y: 40, width: 200, height: 200 });
  });

  it('TC-19: group move — both selected notes move by the same delta; the dragged one ends on top', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 400, y: 100 });

    pressNote(app, a);
    shiftPressNote(app, b);
    expect(selectedIds(app).sort()).toEqual([a, b].sort());

    // a left-top (0,0); b left-top (300,0)
    dragNote(app, a, 60, -20);

    expect(bounds(app, a)).toEqual({ x: 60, y: -20, width: 200, height: 200 });
    expect(bounds(app, b)).toEqual({ x: 360, y: -20, width: 200, height: 200 });

    // the dragged note was raised above the other (z order)
    const za = app.notes().find((n) => n.id === a)!.z;
    const zb = app.notes().find((n) => n.id === b)!.z;
    expect(za).toBeGreaterThan(zb);
  });

  it('TC-20: dragging an unselected note selects only it and moves only it', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 400, y: 100 });

    pressNote(app, a);
    // drag b (unselected): selection becomes {b}, a stays put
    // b left-top (300,0)
    dragNote(app, b, 30, 30);

    expect(selectedIds(app)).toEqual([b]);
    expect(bounds(app, b)).toEqual({ x: 330, y: 30, width: 200, height: 200 });
    expect(bounds(app, a)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it('TC-21: corner resize — the SE handle scales from the opposite corner', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 }); // left-top (0,0)
    act(() => setSize(app.doc, a, 100, 100)); // 100×100 at (0,0)

    pressNote(app, a);
    dragHandle('se', 50, 50);

    // stickies stay square: 150×150 from the same top-left
    expect(bounds(app, a)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('TC-22: edge handles resize one dimension of the bounding box', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 350, y: 100 });
    act(() => {
      setSize(app.doc, a, 100, 100);
      setSize(app.doc, b, 100, 100);
    });
    // bounding box: (100,100) 350×100

    pressNote(app, a);
    shiftPressNote(app, b);
    dragHandle('e', 50, 0);

    // the box grew 50 wider → both 1:1 notes scaled 400/350… but stickies are
    // aspect-locked, so the uniform scale is 400/350 → 114.28…×114.28…
    const ra = bounds(app, a);
    const rb = bounds(app, b);
    expect(ra.width).toBeCloseTo(ra.height);
    const boxWidth = rb.x + rb.width - ra.x;
    expect(boxWidth).toBeCloseTo(400, 0);
  });

  it('TC-23: Shift during a handle drag keeps the proportions (single 1:1 note stays square)', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    act(() => setSize(app.doc, a, 100, 100));

    pressNote(app, a);
    // drag the E handle with an anisotropic delta + Shift → square result
    dragHandle('e', 80, 10, { x: 300, y: 300 }, { shiftKey: true });
    const r = bounds(app, a);
    expect(r.width).toBeCloseTo(r.height);
    expect(r.width).toBeCloseTo(180, 0); // dominant axis: 100+80
  });

  it('TC-27: arrow keys nudge the selection by 1 world unit; Shift by 10 (preventDefault)', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 }); // left-top (0,0)
    pressNote(app, a);

    let ev: KeyboardEvent = new KeyboardEvent('keydown');
    act(() => {
      ev = windowKeyDown('ArrowRight');
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(bounds(app, a).x).toBe(1);

    let ev2: KeyboardEvent = new KeyboardEvent('keydown');
    act(() => {
      ev2 = windowKeyDown('ArrowRight', { shiftKey: true });
    });
    expect(ev2.defaultPrevented).toBe(true);
    expect(bounds(app, a).x).toBe(11);

    act(() => {
      windowKeyDown('ArrowUp');
    });
    expect(bounds(app, a).y).toBe(-1);
  });

  it('TC-28: Delete/Backspace deletes the whole selection and clears it', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 400, y: 100 });
    pressNote(app, a);
    shiftPressNote(app, b);

    act(() => {
      windowKeyDown('Delete');
    });
    expect(app.noteOrNull(a)).toBeNull();
    expect(app.noteOrNull(b)).toBeNull();
    expect(selectedIds(app)).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    // Backspace form on a fresh selection
    const c = app.addNote({ x: 100, y: 100 });
    pressNote(app, c);
    act(() => {
      windowKeyDown('Backspace');
    });
    expect(app.noteOrNull(c)).toBeNull();
  });

  it('TC-31: with canEdit=false (load failed) gestures and deletes are ignored', async () => {
    // The board only mounts with a successful load in the app; the harness
    // renders the real Board with the guard forced off: selection works
    // (viewing) but no writes happen.
    const app = await renderApp({ canEdit: false });
    const a = app.addNote({ x: 100, y: 100 }); // left-top (0,0)

    // selection is allowed (viewing)
    pressNote(app, a);
    expect(selectedIds(app)).toEqual([a]);

    // dragging must not move the note
    dragNote(app, a, 100, 100);
    expect(bounds(app, a)).toEqual({ x: 0, y: 0, width: 200, height: 200 });

    // Delete must not delete it
    act(() => {
      windowKeyDown('Delete');
    });
    expect(app.noteOrNull(a)).not.toBeNull();
  });
});
