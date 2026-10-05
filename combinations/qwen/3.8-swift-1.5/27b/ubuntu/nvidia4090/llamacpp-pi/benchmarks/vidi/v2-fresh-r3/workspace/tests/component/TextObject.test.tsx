import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import {
  renderApp,
  windowKeyDown,
  pointerEvent,
  shiftPressNote,
  dragHandle,
  type AppHarness,
} from './appHarness';
import {
  createText,
  getTextContent,
} from '../../src/shared/objects/text';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Rect,
} from '../../src/shared/geometry';
import {
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import { objectBounds, snapshotObjects } from '../../src/shared/board-model';

afterEach(cleanup);

function textEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-text-id="${id}"]`);
  if (!el) throw new Error(`text ${id} not found`);
  return el as HTMLElement;
}

function textMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!obj) throw new Error(`text ${id} not found in doc`);
  return obj as Y.Map<unknown>;
}

/** Creates a text object, selects it (pointerdown) and returns its id. */
function createAndSelectText(app: AppHarness, x: number, y: number, text?: string): string {
  let id = '';
  act(() => {
    id = createText(app.doc, { x, y }, 'me')!;
  });
  if (text) {
    act(() => {
      getTextContent(app.doc, id)!.insert(0, text);
    });
  }
  act(() => pointerEvent(textEl(id), 'pointerdown', x + 5, y + 5));
  act(() => pointerEvent(window, 'pointerup', x + 5, y + 5));
  return id;
}

/** Selects the text and starts editing (Enter). */
function startEditing() {
  act(() => windowKeyDown('Enter'));
  const ta = screen.getByTestId('text-textarea') as HTMLTextAreaElement;
  return ta;
}

describe('text.editor (ui-component)', () => {
  it('TC-19: editing starts with the caret at the end; Enter inserts a newline; Escape ends keeping the selection', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = createAndSelectText(app, 300, 200, 'hello');
    const ta = startEditing();
    await waitFor(() => expect(document.activeElement).toBe(ta));

    // Caret at the end of the existing text.
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);

    // Enter inserts a newline (the textarea default).
    await user.type(ta, '{Enter}');
    expect(ta.value).toBe('hello\n');
    expect(getTextContent(app.doc, id)!.toString()).toBe('hello\n');

    // Escape ends editing, keeps the selection, and the text is stored.
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textEl(id).getAttribute('data-selected')).toBe('true');
    expect(getTextContent(app.doc, id)!.toString()).toBe('hello\n');
  });

  it('TC-20: ending editing with zero characters → object removed, selection cleared', async () => {
    const app = await renderApp();
    const id = createAndSelectText(app, 300, 200);
    const ta = startEditing();
    await waitFor(() => expect(document.activeElement).toBe(ta));

    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    // The empty object is gone and the selection (overlay) is cleared.
    expect(app.doc.getMap('objects').has(id)).toBe(false);
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  it('TC-21: TextToolbar shows S M L XL with M pressed; clicking XL → size XL, position unchanged', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = createAndSelectText(app, 300, 200, 'Went well');

    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();
    for (const s of ['S', 'M', 'L', 'XL']) {
      expect(screen.getByLabelText(`Size ${s}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Size M').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Size XL').getAttribute('aria-pressed')).toBe('false');

    const before = textMap(app.doc, id);
    const x0 = before.get('x');
    const y0 = before.get('y');

    await user.click(screen.getByLabelText('Size XL'));
    const after = textMap(app.doc, id);
    expect(after.get('size')).toBe('XL');
    expect(after.get('x')).toBe(x0);
    expect(after.get('y')).toBe(y0);
    expect(screen.getByLabelText('Size XL').getAttribute('aria-pressed')).toBe('true');
    // The box height re-measured for XL (content-driven).
    expect(after.get('height')).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('TC-22: selecting a single text shows only the e and w handles', async () => {
    const app = await renderApp();
    createAndSelectText(app, 300, 200, 'Went well');

    expect(screen.getByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.getByTestId('resize-handle-w')).toBeTruthy();
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).toBeNull();
    }
  });

  it('TC-23: text + sticky selection → all handles; resize repositions the text proportionally, font size unchanged', async () => {
    const app = await renderApp();

    // Sticky centred at (400,400) → top-left (300,300), 200×200.
    const noteId = app.addNote({ x: 400, y: 400 });
    // Text with 'hello' at top-left (500,300).
    const textId = createAndSelectText(app, 500, 300, 'hello');

    // Add the note to the selection.
    shiftPressNote(app, noteId, 100, 100);

    // All 8 handles are present for the mixed selection.
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.getByTestId(`resize-handle-${h}`)).toBeTruthy();
    }

    // Compute the expected end state with the same geometry the gesture uses.
    const snap = snapshotObjects(app.doc);
    const noteRect = objectBounds(snap.find((s) => s.id === noteId)!);
    const textRect = objectBounds(snap.find((s) => s.id === textId)!);
    const startBox = unionRects([noteRect, textRect])!;
    const delta = { x: 100 / 1, y: 100 / 1 }; // zoom 1
    const newBox = resizeRect(startBox, 'se', delta, true); // sticky is aspect-locked
    const scale = {
      x: newBox.width / startBox.width,
      y: newBox.height / startBox.height,
    };
    const clamped = clampScale(
      scale,
      [noteRect, textRect],
      [STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    const to: Rect = {
      x: startBox.x,
      y: startBox.y,
      width: startBox.width * clamped.x,
      height: startBox.height * clamped.y,
    };
    const expectedText = scaleWithin(textRect, startBox, to);
    const expectedNote = scaleWithin(noteRect, startBox, to);

    // Drag the SE handle by (100, 100).
    dragHandle('se', 100, 100);

    const textAfter = textMap(app.doc, textId);
    expect(textAfter.get('x')).toBeCloseTo(expectedText.x, 3);
    expect(textAfter.get('y')).toBeCloseTo(expectedText.y, 3);
    // Auto width and font size are unchanged (content-driven).
    expect(textAfter.get('width')).toBe(textRect.width);
    expect(textAfter.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(textAfter.get('widthMode')).toBe('auto');

    const noteAfter = app.doc.getMap('objects').get(noteId) as Y.Map<unknown>;
    expect(noteAfter.get('width')).toBeCloseTo(expectedNote.width, 3);
    expect(noteAfter.get('height')).toBeCloseTo(expectedNote.height, 3);
  });

  it('TC-24: a remote deletes the text while it is being edited → editor closes, object not recreated', async () => {
    const app = await renderApp();
    const id = createAndSelectText(app, 300, 200, 'hello');
    const ta = startEditing();
    await waitFor(() => expect(document.activeElement).toBe(ta));
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // A remote peer deletes the object (not LOCAL_ORIGIN).
    act(() => {
      app.doc.transact(() => {
        app.doc.getMap('objects').delete(id);
      }, 'remote-peer');
    });

    // The editor is gone and the object stays gone (no recreation on blur/flush).
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(app.doc.getMap('objects').has(id)).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(app.doc.getMap('objects').has(id)).toBe(false);
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  it('TC-25: type then Ctrl+Z → text and stored box revert in one step', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = createAndSelectText(app, 300, 200);
    const ta = startEditing();
    await waitFor(() => expect(document.activeElement).toBe(ta));

    // Initial (empty) box.
    const initial = textMap(app.doc, id);
    const w0 = initial.get('width') as number;
    const h0 = initial.get('height') as number;
    expect(w0).toBe(TEXT_PADDING_WORLD);
    expect(h0).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);

    await user.type(ta, 'hello');
    const mid = textMap(app.doc, id);
    expect(getTextContent(app.doc, id)!.toString()).toBe('hello');
    expect(mid.get('width')).toBeGreaterThan(w0);

    // Ctrl+Z on the editor routes to the board undo controller.
    act(() => {
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    // One step reverts the text AND the box.
    expect(getTextContent(app.doc, id)!.toString()).toBe('');
    const after = textMap(app.doc, id);
    expect(after.get('width')).toBe(w0);
    expect(after.get('height')).toBe(h0);
    // The object still exists (empty, not yet ended).
    expect(app.doc.getMap('objects').has(id)).toBe(true);
  });
});
