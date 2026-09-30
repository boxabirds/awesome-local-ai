import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { dispatchPointer } from '../helpers';

// Mock the sync layer so the Board is fully editable in jsdom.
const { connectMock } = vi.hoisted(() => {
  type ConnectFn = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc: any,
    id: string,
    onState: (s: string) => void,
  ) => { destroy: () => void };
  const connectMock = vi.fn<ConnectFn>(() => ({ destroy: () => {} }));
  return { connectMock };
});
vi.mock('@client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/sync/connectBoard')>();
  return { ...actual, connectBoard: connectMock };
});

// Import after the mock is registered.
const { Board } = await import('@client/Board');
const { createSticky, deleteObject } = await import('@shared/board-model');
const {
  createText, getTextContent, setTextBox,
} = await import('@shared/objects/text');

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'text-object-test') {
  return render(<Board boardId={boardId} />);
}

/** Create a text object, seeding content with a NON-local origin so the
 *  seeded content is not part of the client's undo stack. */
function seedText(doc: Y.Doc, x: number, y: number, content: string): string {
  let id = '';
  act(() => {
    id = createText(doc, { x, y }, 'tester')!;
  });
  if (content !== '') {
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, content); }, 'test-seed');
  }
  return id;
}

function objMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function clickObject(el: HTMLElement, x: number, y: number, shift = false) {
  act(() => {
    dispatchPointer(el, 'pointerdown', x, y, { shiftKey: shift });
    dispatchPointer(window, 'pointerup', x, y);
  });
}

describe('text.object (PRD)', () => {
  beforeEach(() => {
    capturedDocs.length = 0;
    connectMock.mockImplementation((doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      capturedDocs.push(doc);
      onState('connected');
      return { destroy: () => {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // TC-19: caret at end; Enter inserts a newline (editing stays open);
  // Escape ends editing and keeps the text selected.
  it('TC-19: caret starts at the end, Enter keeps a newline, Escape stays selected', () => {
    renderBoard();
    const doc = capturedDocs[0];
    const id = seedText(doc, -100, -100, 'Hello');

    const el = screen.getByTestId('text-object');
    fireEvent.doubleClick(el);
    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;

    // Caret at the end of the content.
    expect(editor.value).toBe('Hello');
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);

    // Enter must not end editing (no preventDefault → newline is inserted
    // by the textarea; simulate the resulting input).
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByTestId('text-editor')).toBeTruthy();
    fireEvent.input(editor, { target: { value: 'Hello\n' } });
    expect(getTextContent(doc, id)!.toString()).toBe('Hello\n');

    // Escape ends editing; the object stays selected.
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.getByTestId('text-object')).toBeTruthy();
    expect(screen.getByTestId('selection-overlay')).toBeTruthy();
  });

  // TC-20: Escape with zero characters → object removed, selection cleared.
  it('TC-20: Escape on an empty text removes the object and clears the selection', () => {
    renderBoard();
    const doc = capturedDocs[0];
    const id = seedText(doc, -100, -100, '');

    const el = screen.getByTestId('text-object');
    fireEvent.doubleClick(el);
    const editor = screen.getByTestId('text-editor');
    fireEvent.keyDown(editor, { key: 'Escape' });

    // The object is gone from the doc (no invisible empty text lingers).
    expect(objMap(doc).get(id)).toBeUndefined();
    expect(objMap(doc).size).toBe(0);
    // Selection cleared: no overlay, no rendered object.
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; XL click → size XL,
  // x/y unchanged.
  it('TC-21: the text toolbar highlights M; choosing XL changes size only', () => {
    renderBoard();
    const doc = capturedDocs[0];
    const id = seedText(doc, -100, -100, 'Headline');

    clickObject(screen.getByTestId('text-object'), -100, -100);
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();

    expect(screen.getByLabelText('Size S')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Size M')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Size L')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Size XL')).toHaveAttribute('aria-pressed', 'false');

    const obj = objMap(doc).get(id)!;
    const x0 = obj.get('x') as number;
    const y0 = obj.get('y') as number;

    fireEvent.click(screen.getByLabelText('Size XL'));

    expect(obj.get('size')).toBe('XL');
    expect(obj.get('x')).toBe(x0);
    expect(obj.get('y')).toBe(y0);
    expect(screen.getByLabelText('Size XL')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-22: single text selected → only east/west handles.
  it('TC-22: a single selected text exposes only the east and west handles', () => {
    renderBoard();
    const doc = capturedDocs[0];
    seedText(doc, -100, -100, 'Note');

    clickObject(screen.getByTestId('text-object'), -100, -100);

    expect(screen.getByTestId('resize-handle-e')).toBeTruthy();
    expect(screen.getByTestId('resize-handle-w')).toBeTruthy();
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.queryByTestId(`resize-handle-${h}`)).toBeNull();
    }
  });

  // TC-23: text + sticky selected → all 8 handles; a group resize
  // repositions the text proportionally and keeps its font size.
  it('TC-23: text + sticky shows all handles; resize scales text position, not font size', () => {
    renderBoard();
    const doc = capturedDocs[0];

    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 175, y: 175 });
    });
    const textId = seedText(doc, 300, 150, 'Hi');
    // Give the text a realistic stored box (createText estimates 0 width).
    doc.transact(() => { setTextBox(doc, textId, { width: 100, height: 26 }); }, 'test-seed');

    // Select the text, then shift-select the sticky.
    clickObject(screen.getByTestId('text-object'), 350, 160);
    clickObject(screen.getByTestId('sticky-note'), 175, 175, true);

    // All 8 handles are present for a mixed selection.
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.getByTestId(`resize-handle-${h}`)).toBeTruthy();
    }

    // Union box: sticky 75..275 × 75..275, text 300..400 × 150..176 →
    // x 75..400 (w 325), y 75..275 (h 200). Drag the east handle +100 →
    // scale 425/325 ≈ 1.3077. The aspect-locked east handle keeps the box
    // centred on the y axis: to = {75, 44.23, 425, 261.54}.
    const east = screen.getByTestId('resize-handle-e');
    act(() => {
      dispatchPointer(east, 'pointerdown', 400, 175);
      dispatchPointer(window, 'pointermove', 500, 175);
      dispatchPointer(window, 'pointerup', 500, 175);
    });

    const scale = 425 / 325;
    const toY = 75 + (200 - 200 * scale) / 2; // aspect-locked: centred on y
    const t = objMap(doc).get(textId)!;
    const s = objMap(doc).get(stickyId)!;

    // Text repositioned proportionally within the scaled union box…
    expect(t.get('x')).toBeCloseTo(75 + (300 - 75) * scale, 1);
    expect(t.get('y')).toBeCloseTo(toY + (150 - 75) * scale, 1);
    // …and its font size is unchanged (only position/scale, never font).
    expect(t.get('size')).toBe('M');
    // The sticky scaled fully (aspect-locked), centred with the box.
    expect(s.get('width')).toBeCloseTo(200 * scale, 1);
    expect(s.get('height')).toBeCloseTo(200 * scale, 1);
    expect(s.get('x')).toBeCloseTo(75, 1);
    expect(s.get('y')).toBeCloseTo(toY, 1);
  });

  // TC-24: remote delete while editing → editor unmounts, no error, the
  // object is not recreated.
  it('TC-24: a remote deletion while editing unmounts the editor without recreating the object', async () => {
    renderBoard();
    const doc = capturedDocs[0];
    const id = seedText(doc, -100, -100, 'Fragile');

    fireEvent.doubleClick(screen.getByTestId('text-object'));
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // Simulate a remote client deleting the object.
    act(() => {
      deleteObject(doc, id);
    });

    // Editor and object are gone; the board is still alive.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(screen.getByTestId('toolbar')).toBeTruthy();

    // Let any (incorrect) re-creation effects run, then confirm absence.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(objMap(doc).get(id)).toBeUndefined();
    expect(objMap(doc).size).toBe(0);
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  // TC-25: type then Ctrl+Z → text and stored box revert together in one
  // step.
  it('TC-25: one undo reverts both the typed text and the re-measured box', () => {
    renderBoard();
    const doc = capturedDocs[0];
    const id = seedText(doc, -100, -100, '');

    const obj = objMap(doc).get(id)!;
    const w0 = obj.get('width') as number;
    const h0 = obj.get('height') as number;

    fireEvent.doubleClick(screen.getByTestId('text-object'));
    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'Hi' } });

    // The box was re-measured for the new content.
    expect(getTextContent(doc, id)!.toString()).toBe('Hi');
    expect(obj.get('width')).not.toBe(w0);

    // One Ctrl+Z reverts text AND box together.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });

    expect(getTextContent(doc, id)!.toString()).toBe('');
    expect(obj.get('width')).toBe(w0);
    expect(obj.get('height')).toBe(h0);
  });
});
