/**
 * Story 8 · task 8 — component tests for the personal undo history.
 *
 * Two kinds of drive, chosen for determinism:
 *
 *   • the *gesture* cases drive the transform controller and undo controller
 *     directly (no DOM pointer events, no layout), because "a whole drag is one
 *     step" is a property of the boundary wiring, not of the DOM; and
 *   • the *editor* and *toolbar* cases render the real `BoardShell` so the
 *     Ctrl+Z-inside-a-field path (criterion 10) and the toolbar buttons (task 5)
 *     are exercised through the components a user would hit.
 *
 * Remote peers use the {@link createPeer} helper, which forwards a second real
 * `Y.Doc`'s changes under a non-local origin, so "does not undo anyone else's"
 * and "never breaks on a peer delete" are proven for real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import {
  createSticky,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import {
  createTransformController,
  type TransformController,
} from '../../src/client/board/transformController';
import { createPeer } from '../unit/peer';
import { pointer } from './helpers';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => cleanup());

// --- helpers --------------------------------------------------------------

function board(notes: Array<{ x: number; y: number; color?: 'pink'; text?: string }> = []) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (const n of notes) {
    const id = createSticky(doc, { x: n.x, y: n.y }, n.color ?? 'yellow');
    if (n.text) (doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text).insert(0, n.text);
    ids.push(id);
  }
  return { doc, ids };
}

/** A controller wired to a fresh undo history, reading a live snapshot. */
function harness(doc: Y.Doc): { ctl: TransformController; undo: ReturnType<typeof createUndo> } {
  const undo = createUndo(doc);
  const camera = { x: 0, y: 0, zoom: 1 };
  const ctl = createTransformController(
    () => ({
      doc,
      camera,
      snapshot: snapshot(doc),
      canEdit: true,
      resizeMode: () => 'both',
    }),
    { onStart: () => undo.boundary(), onEnd: () => undo.boundary() },
  );
  return { ctl, undo };
}

/** One drag gesture: begin, a few frames, end. Whole gesture = one step. */
function drag(ctl: TransformController, ids: string[], x0: number, y0: number, dx: number, frames = 30) {
  ctl.beginMove(ids, x0, y0);
  for (let i = 1; i <= frames; i++) ctl.move(x0 + (dx * i) / frames, y0);
  ctl.end();
}

// Silence unused-import guard for helpers only used in some branches.

// --- TC-14 / TC-15: drag boundary ----------------------------------------

describe('drag gestures are one undo step', () => {
  it('TC-14: dragging 10 objects (30 frames each) is 10 steps; one undo restores the last group', () => {
    const { doc, ids } = board(Array.from({ length: 10 }, (_, i) => ({ x: 60 + i * 120, y: 100 })));
    const { ctl, undo } = harness(doc);

    // Before any gesture, nothing is undoable.
    expect(undo.canUndo()).toBe(false);

    for (const id of ids) drag(ctl, [id], 300, 300, 50);
    expect(undo.undoDepth()).toBe(10);

    // One undo restores only the last group (the 10th object).
    const last = ids[9];
    const before = snapshot(doc).find((o) => o.id === last)!;
    undo.undo();
    const after = snapshot(doc).find((o) => o.id === last)!;
    expect(after).toBeDefined();
    expect(after.x).not.toBe(before.x); // its position was reversed
    // The other nine keep their dragged positions (their steps are untouched).
    expect(undo.undoDepth()).toBe(9);
  });

  it('TC-15: a 30-frame drag followed by a colour change is two steps', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    const { ctl, undo } = harness(doc);

    drag(ctl, [a], 300, 300, 60);
    // A recolour, run inside its own undo step (as NoteToolbar does).
    undo.step(() => setStickyColor(doc, a, 'pink'));
    expect(undo.undoDepth()).toBe(2);

    // Undo reverses the colour first, then the gesture — independently.
    undo.undo();
    expect(snapshot(doc).find((o) => o.id === a)!.color).toBe('yellow');
    undo.undo();
    expect(snapshot(doc).find((o) => o.id === a)!.x).not.toBe(300 - 100 + 60);
  });

  it('a group drag is one step, and undo restores every moved object', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }, { x: 260, y: 100 }]);
    const { ctl, undo } = harness(doc);
    const before = snapshot(doc).map((o) => ({ ...o }));

    drag(ctl, ids, 100, 100, 80);
    expect(undo.undoDepth()).toBe(1);
    undo.undo();
    const after = new Map(snapshot(doc).map((o) => [o.id, o]));
    for (const o of before) expect(after.get(o.id)!.x).toBe(o.x);
  });

  it('resize gestures record one step too', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    const { ctl, undo } = harness(doc);
    // Drive a resize gesture through the controller (three frames).
    ctl.beginResize('se', [a], 300, 300);
    ctl.resize(360, 360);
    ctl.resize(420, 420);
    ctl.end();
    expect(undo.undoDepth()).toBe(1);
  });
});

// --- TC-16 / TC-17: editor keyboard routes to the history -----------------

describe('Ctrl+Z inside a note drives the personal history', () => {
  function renderBoard(doc: Y.Doc) {
    return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
  }
  function enterEditing(id: string) {
    const note = screen.getByTestId(`note-${id}`) as HTMLElement;
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  }
  function ytextOf(doc: Y.Doc, id: string): Y.Text {
    return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('text') as Y.Text;
  }

  it('TC-16: Ctrl+Z in a note undoes the typing burst (beyond any browser history)', () => {
    const { doc, ids } = board([{ x: 300, y: 300, text: 'abc' }]);
    renderBoard(doc);
    enterEditing(ids[0]);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;

    // A burst typed with no pause is one step; change the whole value at once to
    // model the run of keystrokes.
    fireEvent.change(editor, { target: { value: 'abcdef' } });
    expect(ytextOf(doc, ids[0]).toString()).toBe('abcdef');

    // Ctrl+Z inside the field reverts the burst in one go.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(ytextOf(doc, ids[0]).toString()).toBe('abc');
  });

  it('TC-17: Ctrl+Shift+Z re-applies the undone burst (no browser undo/redo)', () => {
    const { doc, ids } = board([{ x: 300, y: 300, text: 'abc' }]);
    renderBoard(doc);
    enterEditing(ids[0]);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: 'abcdef' } });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(ytextOf(doc, ids[0]).toString()).toBe('abc');

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(ytextOf(doc, ids[0]).toString()).toBe('abcdef');
  });
});

// --- TC-19: safe mode (peer delete mid-interaction) -----------------------

describe('undo never breaks on a peer-deleted object', () => {
  it('a remote delete during a drag leaves no residual gesture and does not throw', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }, { x: 300, y: 100 }]);
    const [a, b] = ids;
    const { ctl, undo } = harness(doc);

    // Begin a drag over both, then a peer deletes `a` while the gesture is live.
    ctl.beginMove([a, b], 100, 100);
    ctl.move(140, 100);
    const peer = createPeer(doc);
    peer.change(doc, (p) => p.getMap<Y.Map<unknown>>('objects').delete(a));
    // Further frames skip the gone object; the gesture still ends cleanly.
    expect(() => {
      ctl.move(180, 100);
      ctl.end();
    }).not.toThrow();
    expect(ctl.isActive()).toBe(false);
    expect(doc.getMap('objects').has(a)).toBe(false);

    // Undo after the peer delete does not throw and leaves the peer delete intact.
    expect(() => undo.undo()).not.toThrow();
    expect(doc.getMap('objects').has(a)).toBe(false);
  });

  it('undoing my own delete after a peer edited the note restores the peer content', () => {
    const { doc, ids } = board([{ x: 100, y: 100, text: 'draft' }]);
    const a = ids[0];
    const peer = createPeer(doc);
    peer.change(doc, (p) => {
      const rec = p.getMap<Y.Map<unknown>>('objects').get(a);
      (rec!.get('text') as Y.Text).insert(5, ' ok');
    });
    const undo = createUndo(doc);
    undo.step(() => {
      doc.transact(() => doc.getMap<Y.Map<unknown>>('objects').delete(a), LOCAL_ORIGIN);
    });
    expect(doc.getMap('objects').has(a)).toBe(false);
    undo.undo();
    expect(snapshot(doc).find((o) => o.id === a)?.text).toBe('draft ok');
  });
});

// --- TC-20: two controllers (two tabs) are independent -------------------

describe('two clients keep independent histories', () => {
  it('a change in one tab is not undoable in the other', () => {
    const docA = new Y.Doc();
    initDoc(docA);
    const id = createSticky(docA, { x: 100, y: 100 });
    // Tab B starts from the same shared state (as a joined client would).
    const docB = new Y.Doc({ gc: false });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const relay = (from: Y.Doc, to: Y.Doc) =>
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from), Symbol('wire'));

    const undoA = createUndo(docA);
    const undoB = createUndo(docB);

    // Tab A moves the shared note; forward to B under the wire origin.
    undoA.step(() => moveObject(docA, id, 200, 200));
    relay(docA, docB);

    // Tab B sees the note moved but has nothing to undo (it was not B's change).
    expect(undoB.canUndo()).toBe(false);
    // Tab A still has its own step.
    expect(undoA.canUndo()).toBe(true);

    // A change made in B stays in B and is invisible to A's history.
    const idB = createSticky(docB, { x: 500, y: 500 });
    undoB.step(() => setStickyColor(docB, idB, 'green'));
    expect(undoB.canUndo()).toBe(true);
    relay(docB, docA);
    // Forwarding B's change into A under the wire origin does not give A a step.
    expect(undoA.canUndo()).toBe(true);
    expect(undoA.undoDepth()).toBe(1);
  });
});

// --- TC-21: toolbar buttons reflect and drive the history -----------------

describe('toolbar Undo / Redo buttons (TC-21)', () => {
  function renderBoard(doc: Y.Doc) {
    return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
  }
  function selectNote(id: string) {
    const note = screen.getByTestId(`note-${id}`) as HTMLElement;
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
  }

  it('undo is disabled on an empty history and enabled after a local change', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    renderBoard(doc);

    expect((screen.getByTestId('undo-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('redo-button') as HTMLButtonElement).disabled).toBe(true);

    // A colour change is a local step.
    selectNote(ids[0]);
    fireEvent.click(screen.getByTestId('swatch-pink'));

    expect((screen.getByTestId('undo-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Undo reverts the last own step', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    renderBoard(doc);
    selectNote(a);
    fireEvent.click(screen.getByTestId('swatch-pink'));
    expect(snapshot(doc).find((o) => o.id === a)!.color).toBe('pink');

    fireEvent.click(screen.getByTestId('undo-button'));
    expect(snapshot(doc).find((o) => o.id === a)!.color).toBe('yellow');
    // After the undo, redo becomes available.
    expect((screen.getByTestId('redo-button') as HTMLButtonElement).disabled).toBe(false);
  });
});

// --- TC-18 to TC-21: undo/redo shortcuts and the edit lock ---------------

describe('undo/redo shortcuts (TC-19 to TC-21)', () => {
  function renderBoard(doc: Y.Doc, connectionState?: 'connected' | 'load_failed') {
    return render(
      connectionState
        ? <BoardShell viewport={VIEWPORT} doc={doc} connectionState={connectionState} />
        : <BoardShell viewport={VIEWPORT} doc={doc} />,
    );
  }
  function selectNote(id: string) {
    const note = screen.getByTestId(`note-${id}`) as HTMLElement;
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
  }
  function makeColourStep(_doc: Y.Doc, id: string) {
    selectNote(id);
    fireEvent.click(screen.getByTestId('swatch-pink'));
  }
  // Fire a board-level key: dispatched on the root so it reaches the window
  // listener (target is a non-editable element, so the board handles it).
  function pressKey(init: KeyboardEventInit & { key: string }): boolean {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  const colourOf = (doc: Y.Doc, id: string) =>
    doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('color');

  it('TC-18 the buttons expose Undo/Redo labels and start disabled', () => {
    const { doc } = board([{ x: 300, y: 300 }]);
    renderBoard(doc);
    const undo = screen.getByTestId('undo-button');
    const redo = screen.getByTestId('redo-button');
    expect(undo.getAttribute('aria-label')).toBe('Undo');
    expect(redo.getAttribute('aria-label')).toBe('Redo');
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-19 Ctrl+Z and Cmd+Z undo at the board level and consume the key', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    renderBoard(doc);
    makeColourStep(doc, a);
    expect(colourOf(doc, a)).toBe('pink');

    expect(pressKey({ key: 'z', ctrlKey: true })).toBe(true); // Ctrl+Z consumed
    expect(colourOf(doc, a)).toBe('yellow');
    // Undo again with nothing left is a harmless no-op (still consumed, no change).
    expect(pressKey({ key: 'z', metaKey: true })).toBe(true); // Cmd+Z consumed
  });

  it('TC-19b Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo the undone step', () => {
    for (const init of [
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ]) {
      const { doc, ids } = board([{ x: 300, y: 300 }]);
      const a = ids[0];
      renderBoard(doc);
      makeColourStep(doc, a);
      pressKey({ key: 'z', ctrlKey: true }); // undo the colour
      expect(colourOf(doc, a)).toBe('yellow');
      expect(pressKey(init)).toBe(true); // the redo combo is consumed
      expect(colourOf(doc, a)).toBe('pink');
      cleanup();
    }
  });

  it('TC-20 a read-only board disables the buttons and ignores the shortcuts', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    renderBoard(doc, 'load_failed');
    // Buttons are disabled in the read-only (safe) state.
    expect((screen.getByTestId('undo-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('redo-button') as HTMLButtonElement).disabled).toBe(true);

    // A board-level undo key is not consumed and changes nothing (nothing was
    // ever recorded while read-only).
    expect(pressKey({ key: 'z', ctrlKey: true })).toBe(false);
    expect(colourOf(doc, a)).toBe('yellow');
  });

  it('TC-21 Ctrl+Z with focus in a text field is left to that field, not the board', () => {
    const { doc, ids } = board([{ x: 300, y: 300 }]);
    const a = ids[0];
    const view = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    makeColourStep(doc, a);
    // Render a non-board text field and focus it, so the key's target is editable.
    const { container } = render(
      <div data-testid="outside"><input data-testid="link-input" defaultValue="x" /></div>,
      { container: view.container },
    );
    const input = container.querySelector('[data-testid="link-input"]') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    // The board ignores keys from an editable target, so the colour stays.
    expect(event.defaultPrevented).toBe(false);
    expect(colourOf(doc, a)).toBe('pink');
  });
});

