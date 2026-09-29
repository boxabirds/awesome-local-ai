// Story 11, tasks.md task 5 — the Pen tool and its options (TC-09 to TC-14), component.
//
// As in the story 10 shape tests, these run the real `BoardApp` in jsdom over a `Y.Doc`
// loaded directly, with the undo history injected so a test can count what a gesture cost.
// jsdom reports every rectangle as zero-sized, so at the identity camera a screen point
// and the board point under it are the same numbers.
//
// jsdom has no animation frames. The pen repaints its preview once per frame — that is
// the whole point of `pen.tool`'s contract — so these tests own the frame queue: a stubbed
// `requestAnimationFrame` collects the callbacks and `nextFrame()` runs them. A commit does
// not wait for a frame (it happens in the pointer handler), which is why a test can release
// and read the document without flushing anything.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { initDoc, objectSnapshots, createSticky } from '../../src/shared/board-model.ts';
import {
  createStroke,
  scaledPoints,
  strokeSnapshots,
  type StrokeSnap,
} from '../../src/shared/objects/stroke.ts';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config.ts';
import { straightRun } from '../fixtures/pen-paths.ts';

let doc: Y.Doc;
let undo: UndoController;

/** The pen's preview frames, which jsdom would otherwise never give us. */
let frames: FrameRequestCallback[];

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  doc = new Y.Doc();
  initDoc(doc);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Run the frames the pen has asked for. */
function nextFrame() {
  act(() => {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
  });
}

function mount() {
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
}

const viewport = () => screen.getByTestId('viewport') as HTMLElement;
const world = () => screen.getByTestId('world-layer') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const pressed = (name: string) => toolButton(name).getAttribute('aria-pressed');

function firePointer(target: EventTarget, type: string, x = 20, y = 20) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
/** Press the Pen tool button (the same route a screen reader takes). */
function armPen() {
  firePointer(toolButton('Pen'), 'click');
  expect(pressed('Pen')).toBe('true');
}
/** Press, drag through every point, release. Repaints after each move. */
function draw(path: readonly { x: number; y: number }[]) {
  firePointer(viewport(), 'pointerdown', path[0]!.x, path[0]!.y);
  for (const p of path.slice(1)) {
    firePointer(window, 'pointermove', p.x, p.y);
    nextFrame();
  }
  firePointer(window, 'pointerup', path[path.length - 1]!.x, path[path.length - 1]!.y);
  nextFrame();
}
/** Choose a pen colour / thickness by its accessible name. */
function choose(name: string) {
  firePointer(screen.getByLabelText(name), 'click');
}

const strokes = () => strokeSnapshots(doc);
const preview = () => screen.getByTestId('pen-preview') as HTMLElement;
const noteEl = (id: string) => world().querySelector(`[data-note-id="${id}"]`) as HTMLElement;

describe('story 11 pen tool (TC-09, TC-10, TC-11)', () => {
  it('a drag with a colour and thickness chosen writes one stroke and leaves the pen armed', () => {
    mount();
    armPen();
    choose('Red pen');
    choose('Thick');

    firePointer(viewport(), 'pointerdown', 100, 100);
    firePointer(window, 'pointermove', 140, 120);
    nextFrame();
    firePointer(window, 'pointermove', 190, 130);
    nextFrame();
    // The stroke in hand is on screen and is nowhere in the document.
    expect(preview().getAttribute('d')).toMatch(/^M/);
    expect(strokes().length).toBe(0);

    firePointer(window, 'pointerup', 190, 130);
    nextFrame();

    const made = strokes();
    expect(made.length).toBe(1);
    expect(made[0]!.color).toBe('red');
    expect(made[0]!.thickness).toBe('thick');
    // It is a stroke of what was drawn: many points, simplified to a few.
    expect(made[0]!.points.length).toBeGreaterThanOrEqual(4);
    // The preview is gone; the pen is still the armed tool and Select is not.
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(pressed('Pen')).toBe('true');
    expect(pressed('Select')).toBe('false');
    // Nothing but the stroke was written: no second object for the same line.
    expect(objectSnapshots(doc).length).toBe(1);
  });

  it('one stroke is one undo step, and undoing it leaves the pen alone', () => {
    mount();
    armPen();
    draw(straightRun(6, 50, 50, 12));
    expect(strokes().length).toBe(1);
    expect(undo.canUndo()).toBe(true);
    act(() => {
      undo.undo();
    });
    expect(strokes().length).toBe(0);
    // Opening the board is not my change, so there is nothing older to undo.
    expect(undo.canUndo()).toBe(false);
    expect(pressed('Pen')).toBe('true');
  });

  it('a click with no movement at all is a dot: one point, a thickness-sized box', () => {
    mount();
    armPen();
    draw([{ x: 300, y: 220 }]);

    const made = strokes();
    expect(made.length).toBe(1);
    expect(made[0]!.points.length).toBe(2);
    const dot = made[0]!;
    const half = PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS] / 2;
    expect({ x: dot.x, y: dot.y }).toEqual({ x: 300 - half, y: 220 - half });
    expect({ width: dot.width, height: dot.height }).toEqual({
      width: PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS],
      height: PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS],
    });
    expect(scaledPoints(dot)[0]).toEqual({ x: 300, y: 220 });
  });

  it('an interrupted pointer finishes the stroke instead of discarding it', () => {
    mount();
    armPen();
    firePointer(viewport(), 'pointerdown', 400, 100);
    firePointer(window, 'pointermove', 440, 140);
    firePointer(window, 'pointermove', 470, 150);
    nextFrame();
    expect(strokes().length).toBe(0);

    firePointer(window, 'pointercancel', 470, 150);
    nextFrame();

    // The system took the pointer away; the line drawn so far is kept, not thrown away.
    const made = strokes();
    expect(made.length).toBe(1);
    expect(made[0]!.points.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(pressed('Pen')).toBe('true');
    // And the release that a real browser fires afterwards writes nothing more.
    firePointer(window, 'pointerup', 470, 150);
    expect(strokes().length).toBe(1);
  });

  it('Escape mid-drag draws nothing; Escape then V leaves the pen', () => {
    mount();
    armPen();
    firePointer(viewport(), 'pointerdown', 100, 400);
    firePointer(window, 'pointermove', 200, 450);
    nextFrame();
    fireKey('Escape');
    nextFrame();
    expect(strokes().length).toBe(0);
    expect(pressed('Select')).toBe('true');
    // The pointer is still down in the test's world; releasing it must not draw either.
    firePointer(window, 'pointerup', 200, 450);
    expect(strokes().length).toBe(0);

    // TC-13: arming the pen and pressing Escape, then V, leaves Select and no stroke.
    armPen();
    fireKey('Escape');
    fireKey('v');
    expect(pressed('Select')).toBe('true');
    expect(pressed('Pen')).toBe('false');
    expect(strokes().length).toBe(0);
  });
});

describe('story 11 pen options (TC-14)', () => {
  it('changing the options restyles the next stroke and nothing already drawn', () => {
    mount();
    armPen();
    // The pen starts at the configured defaults, without anything being chosen.
    expect(screen.getByTestId('pen-color-red').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId(`pen-color-${DEFAULT_PEN_COLOR}`).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`pen-thickness-${DEFAULT_PEN_THICKNESS}`).getAttribute('aria-pressed')).toBe('true');
    draw(straightRun(5, 100, 100, 10));
    const before = strokes()[0]!;
    expect(before.color).toBe(DEFAULT_PEN_COLOR);
    expect(before.thickness).toBe(DEFAULT_PEN_THICKNESS);

    choose('Blue pen');
    choose('Thin');
    draw(straightRun(5, 100, 300, 10));

    const after = strokes();
    expect(after.length).toBe(2);
    const first = after.find((s) => s.id === before.id)!;
    // The stroke that was already on the board was not repainted.
    expect({ c: first.color, t: first.thickness }).toEqual({
      c: DEFAULT_PEN_COLOR,
      t: DEFAULT_PEN_THICKNESS,
    });
    const second = after.find((s) => s.id !== before.id)!;
    expect(second.color).toBe('blue');
    expect(second.thickness).toBe('thin');
  });

  it('every colour and thickness is a named control, and choosing one is one keystroke of state', () => {
    mount();
    armPen();
    // Every configured colour and thickness is reachable by its accessible name.
    expect(screen.getAllByRole('button', { name: / pen$/ }).length).toBe(Object.keys(PEN_COLORS).length);
    expect(screen.getAllByRole('button', { name: /^(Thin|Medium|Thick)$/ }).length).toBe(
      Object.keys(PEN_THICKNESS_WORLD).length,
    );
    for (const name of Object.keys(PEN_COLORS)) {
      choose(`${name[0]!.toUpperCase()}${name.slice(1)} pen`);
      expect(screen.getByTestId(`pen-color-${name}`).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('pen-current-color').textContent).toBe(
        name[0]!.toUpperCase() + name.slice(1),
      );
    }
    // Choosing an option is not a change to the board: nothing was written, no undo step.
    expect(objectSnapshots(doc).length).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });

  it('the pen toolbar belongs to the tool, not to a selection, and it leaves with the tool', () => {
    mount();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    armPen();
    expect(screen.getByTestId('pen-toolbar')).toBeTruthy();
    // It is a toolbar of its own, not an object toolbar: nothing is selected.
    fireKey('v');
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
  });

  it('options are session state: a new board starts at the defaults again', () => {
    mount();
    armPen();
    choose('Purple pen');
    choose('Thick');
    draw(straightRun(4, 80, 80, 10));
    expect(strokes()[0]!.color).toBe('purple');
    cleanup();

    // A second mount of the same document — a reload of the same board — does not remember.
    undo = createUndo(doc);
    render(<BoardApp doc={doc} undo={undo} />);
    armPen();
    expect(screen.getByTestId(`pen-color-${DEFAULT_PEN_COLOR}`).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`pen-thickness-${DEFAULT_PEN_THICKNESS}`).getAttribute('aria-pressed')).toBe('true');
    draw(straightRun(4, 300, 80, 10));
    const made = strokes()[strokes().length - 1]!;
    expect(made.color).toBe(DEFAULT_PEN_COLOR);
    expect(made.thickness).toBe(DEFAULT_PEN_THICKNESS);
  });

  it('the options bar belongs to the pen and draws nothing when it is used', () => {
    mount();
    armPen();
    // A press inside the bar is the bar's, not the board's: no stroke, no pan.
    const bar = screen.getByTestId('pen-toolbar');
    firePointer(bar, 'pointerdown', 90, 90);
    firePointer(window, 'pointermove', 400, 400);
    firePointer(window, 'pointerup', 400, 400);
    nextFrame();
    expect(strokes().length).toBe(0);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    // The camera did not move either.
    expect(world().style.transform).toBe('scale(1) translate(0px, 0px)');
  });
});

describe('story 11 long stroke (TC-12)', () => {
  it('a drag longer than one stroke can hold becomes two strokes that join without a gap', () => {
    mount();
    armPen();
    const path = straightRun(STROKE_MAX_POINTS + 10, 0, 0, 5);
    firePointer(viewport(), 'pointerdown', path[0]!.x, path[0]!.y);
    for (const p of path.slice(1)) firePointer(window, 'pointermove', p.x, p.y);
    firePointer(window, 'pointerup', path[path.length - 1]!.x, path[path.length - 1]!.y);
    nextFrame();

    const made = strokes();
    expect(made.length).toBe(2);
    const first = made[0]!;
    const second = made[1]!;
    // No stroke object ever holds more than the limit.
    expect(first.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    // They meet: the second starts exactly where the first ended, so the line is unbroken.
    const a = scaledPoints(first);
    const b = scaledPoints(second);
    expect(b[0]!.x).toBeCloseTo(a[a.length - 1]!.x, 1);
    expect(b[0]!.y).toBeCloseTo(a[a.length - 1]!.y, 1);
    // Both are strokes, and both were finished in the document.
    expect(made.every((s) => s.type === 'stroke')).toBe(true);
  });

  it('a drag just inside the limit stays one stroke', () => {
    mount();
    armPen();
    draw(straightRun(STROKE_MAX_POINTS - 1, 0, 0, 5));
    expect(strokes().length).toBe(1);
  });

  it('a stroke written straight through the model renders as a drawing on the board', () => {
    const id = createStroke(
      doc,
      { points: straightRun(6, 100, 100, 20), color: 'green', thickness: 'thin' },
      'someone-else',
    )!;
    mount();
    const el = world().querySelector(`[data-stroke-id="${id}"]`) as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('aria-label')).toContain('Drawing');
    const path = el.querySelector('[data-testid="stroke-path"]') as SVGPathElement;
    expect(path.getAttribute('stroke')).toBe(PEN_COLORS.green);
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thin));
    expect(path.getAttribute('d')).toMatch(/^M/);
  });
});

describe('story 11 pen over other objects', () => {
  it('drawing across a sticky note draws a stroke and leaves the note where it was', () => {
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const before = objectSnapshots(doc).find((o) => o.id === noteId)!;
    mount();
    armPen();
    // The press lands on the note itself.
    firePointer(noteEl(noteId), 'pointerdown', 240, 240);
    firePointer(window, 'pointermove', 420, 300);
    nextFrame();
    firePointer(window, 'pointerup', 420, 300);
    nextFrame();

    const after = objectSnapshots(doc).find((o) => o.id === noteId)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(strokes().length).toBe(1);
    // The note was not opened for editing either.
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    expect(noteEl(noteId).getAttribute('data-selected')).toBe('false');
  });

  it('a finished stroke stacks above what was on the board before it', () => {
    createSticky(doc, { x: 100, y: 100 });
    mount();
    armPen();
    const stickyZ = objectSnapshots(doc).find((o) => o.type === 'sticky')!.z;
    draw(straightRun(5, 100, 100, 10));
    const stroke: StrokeSnap = strokes()[0]!;
    expect(stroke.z).toBeGreaterThan(stickyZ);
  });
});
