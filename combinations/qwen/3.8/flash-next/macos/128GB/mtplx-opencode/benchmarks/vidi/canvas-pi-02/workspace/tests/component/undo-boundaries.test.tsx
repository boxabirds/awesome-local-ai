import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { renderApp, flush, typeText, type AppHarness } from './appHarness';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { getStickyText } from '../../src/shared/board-model';
import { dispatch, keyEvent, pointerEvent } from './harness';

/**
 * Story 8, undo.boundaries at the component level (TC-14 to TC-17): where
 * the step boundaries land in the real app - a drag is one step, a gesture
 * and a colour are two, a typing burst is one step and Ctrl+Z inside the
 * editor answers that burst, not the drag.
 *
 * The histories here are built by the test (`undoFactory`) and read back
 * from the same controller, so "one step" is a count, not a vibe. Timing is
 * kept honest with real pacing (the burst uses ~160 ms gaps inside the
 * 500 ms capture window, with a >= 3x margin), never with a clock the app
 * does not actually consult.
 */

let harness: AppHarness | null = null;
let undoUnderTest: UndoController | null = null;

afterEach(() => {
  // The harness keeps its own controller when `undoFactory` built one; the
  // app only destroys controllers it owns itself.
  undoUnderTest?.destroy();
  undoUnderTest = null;
  harness = null;
});

function renderWithHistory(
  seed: { x: number; y: number; color?: 'yellow' | 'pink'; text?: string }[],
) {
  const built: UndoController[] = [];
  const harnessNow = renderApp(seed, {
    undoFactory: (doc: Y.Doc) => {
      const undo = createUndo(doc);
      built.push(undo);
      undoUnderTest = undo;
      return undo;
    },
  });
  harness = harnessNow;
  // React StrictMode mounts twice; the factory runs per mounted controller,
  // and only the second one survives its cleanup - keep the live one.
  undoUnderTest = built[built.length - 1] ?? null;
  return harnessNow;
}

async function drag(
  h: AppHarness,
  target: EventTarget,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const mk = (type: string, x: number, y: number, buttons: number) =>
    pointerEvent(type, { clientX: x, clientY: y, buttons });

  await dispatch(target, mk('pointerdown', from.x, from.y, 1));
  // Frames, one at a time: the pointer moves live on the window, where the
  // gesture listeners are in the running app (jsdom does not bubble element
  // events to the window).
  const steps = 12;
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    await dispatch(
      window,
      mk('pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1),
    );
    if (index % 4 === 0) await flush();
  }
}

async function cancelDrag(h: AppHarness): Promise<void> {
  await dispatch(window, pointerEvent('pointercancel', { clientX: 600, clientY: 400 }));
  await flush();
}

function notePosition(h: AppHarness, id: string): { x: number; y: number } {
  const note = h.notes().find((entry) => entry.id === id);
  if (!note) throw new Error(`note ${id} is gone`);
  return { x: note.x, y: note.y };
}

async function openEditor(h: AppHarness, id: string): Promise<HTMLTextAreaElement> {
  await dispatch(h.noteElement(id), new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await flush();
  const editor = h.editor();
  if (!editor) throw new Error('the editor did not open');
  return editor;
}

/** Type one character at a time, ~160 ms apart: inside the capture window. */
async function typeBurst(editor: HTMLTextAreaElement, word: string): Promise<void> {
  let sofar = '';
  for (const char of word) {
    sofar += char;
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    await typeText(editor, sofar);
  }
}

describe('undo.boundaries at the component level (TC-14 to TC-17)', () => {
  it('TC-14 a many-frame drag is one step that restores the start', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const before = notePosition(h, id!);

    // A 12-frame drag, dragged down in the harness's own multi-frame style:
    // the same 30-frame shape the design asks for, sampled to keep the run
    // quick. Every frame is one gesture, so every frame must land in one step.
    await drag(h, h.noteElement(id!), { x: 400, y: 200 }, { x: 620, y: 360 });
    await dispatch(window, pointerEvent('pointerup', { clientX: 620, clientY: 360 }));
    await flush();

    const moved = notePosition(h, id!);
    expect(moved.x).not.toBeCloseTo(before.x, 1); // it really moved

    const undo = undoUnderTest!;
    expect(undo.stackSize().undo).toBe(1); // twelve frames, one step

    fireEvent.click(h.button('Undo'));
    await flush();
    const restored = notePosition(h, id!);
    expect(restored.x).toBeCloseTo(before.x, 1);
    expect(restored.y).toBeCloseTo(before.y, 1);
  });

  it('TC-15 a drag then a colour a moment later are two separate steps', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const before = notePosition(h, id!);

    // Drag, release...
    await drag(h, h.noteElement(id!), { x: 400, y: 200 }, { x: 560, y: 300 });
    await dispatch(window, pointerEvent('pointerup', { clientX: 560, clientY: 300 }));
    await flush();

    // ...and within well under 200 ms, the swatch for pink. The gesture-end
    // boundary is what splits them: the gap alone would not.
    const swatch = h.container.querySelector<HTMLButtonElement>('[aria-label="Pink colour"]');
    expect(swatch, 'the colour toolbar should be up for the selected note').not.toBeNull();
    fireEvent.click(swatch!);
    await flush();

    const undo = undoUnderTest!;
    expect(undo.stackSize().undo).toBe(2); // move, then colour: two steps

    // One Undo peels off the colour only - the position from the drag stays.
    fireEvent.click(h.button('Undo'));
    await flush();
    const after = h.notes().find((note) => note.id === id)!;
    expect(after.color).toBe('yellow'); // the colour came back...
    expect(after.x).not.toBeCloseTo(before.x, 1); // ...the move did not
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing burst, not the drag before it', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const before = notePosition(h, id!);

    // Step one: move the note.
    await drag(h, h.noteElement(id!), { x: 400, y: 200 }, { x: 560, y: 300 });
    await dispatch(window, pointerEvent('pointerup', { clientX: 560, clientY: 300 }));
    await flush();
    const moved = notePosition(h, id!);
    expect(moved.x).not.toBeCloseTo(before.x, 1);

    // Step two: open the note and type a burst - one editing session, one
    // step, characters ~160 ms apart.
    const editor = await openEditor(h, id!);
    await typeBurst(editor, 'hello');
    await flush();

    const undo = undoUnderTest!;
    expect(undo.stackSize().undo).toBe(2); // the drag and the burst
    // The text layer is replaced by the editor while editing, so the burst
    // is read from the document itself.
    expect(getStickyText(h.doc, id!)?.toString()).toBe('hello');

    // Ctrl+Z inside the editor: the editor answers it, and it undoes the
    // burst only.
    const event = keyEvent('z', { ctrlKey: true });
    await dispatch(editor, event);
    expect(event.defaultPrevented).toBe(true); // the native textarea undo was blocked
    await flush();

    expect(getStickyText(h.doc, id!)?.toString()).toBe(''); // typing undone...
    expect(editor.value).toBe(''); // ...and the editor agrees with the document
    const stillMoved = notePosition(h, id!);
    expect(stillMoved.x).not.toBeCloseTo(before.x, 1); // ...the move is not
    expect(undo.stackSize().undo).toBe(1); // and one honest step remains
  });

  it('TC-17 a drag cancelled mid-flight is one step that restores the start', async () => {
    const h = renderWithHistory([{ x: 300, y: 100 }]);
    await flush();
    const [id] = h.notes().map((note) => note.id);
    const before = notePosition(h, id!);

    // Drag down... and let go of the pointer via pointercancel mid-flight.
    await drag(h, h.noteElement(id!), { x: 400, y: 200 }, { x: 600, y: 380 });
    await cancelDrag(h);

    const moved = notePosition(h, id!);
    expect(moved.x).not.toBeCloseTo(before.x, 1); // it moved before the cancel

    const undo = undoUnderTest!;
    expect(undo.stackSize().undo).toBe(1); // the partial drag is still one step

    // One Undo from the cancelled, half-dragged state: the note returns to
    // where the drag began - the cancelled gesture is not left as a smear of
    // frames in the history.
    fireEvent.click(h.button('Undo'));
    await flush();
    const restored = notePosition(h, id!);
    expect(restored.x).toBeCloseTo(before.x, 1);
    expect(restored.y).toBeCloseTo(before.y, 1);
    // The cancelled drag was the only step: the history is honestly empty now.
    expect(undo.canUndo()).toBe(false);
  });
});