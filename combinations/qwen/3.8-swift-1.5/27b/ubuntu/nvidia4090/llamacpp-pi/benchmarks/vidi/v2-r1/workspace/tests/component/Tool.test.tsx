import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { screenToWorld } from '@client/canvas/camera';
import { dispatchPointer } from '../helpers';

// Mock the sync layer so the Board is fully editable in jsdom and tests can
// control the connection state.
const { connectMock } = vi.hoisted(() => {
  type ConnectFn = (
    // `any` (not Y.Doc): the type is not available inside vi.hoisted and
    // test implementations pass Y.Doc.
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
const { createSticky, getStickyText } = await import('@shared/board-model');

declare global {
  // eslint-disable-next-line no-var
  var __vidi6: {
    setCamera(x: number, y: number, zoom: number): void;
    getCamera(): { x: number; y: number; zoom: number };
  };
}

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'tool-test') {
  return render(<Board boardId={boardId} />);
}

describe('tool.mode (PRD)', () => {
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

  // TC-14: default tool = Select (aria-pressed true); Text not pressed.
  it('TC-14: the default tool is Select', () => {
    renderBoard();
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-15: click Text → aria-pressed flips; board cursor is text.
  it('TC-15: clicking Text activates it and the board cursor becomes text', () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText('Text (T)'));
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'false');
    const viewport = screen.getByTestId('board-viewport');
    expect(viewport.style.cursor).toBe('text');

    // And back to Select.
    fireEvent.click(screen.getByLabelText('Select (V)'));
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(viewport.style.cursor).toBe('grab');
  });

  // TC-16: T pressed while editing a sticky types a character; tool unchanged.
  it('TC-16: pressing T while editing a sticky types a character and keeps the tool', () => {
    const { unmount } = renderBoard();
    const doc = capturedDocs[0];

    // Create a sticky in view and start editing it.
    let id = '';
    act(() => {
      id = createSticky(doc, { x: -100, y: -100 });
    });
    const note = screen.getByTestId('sticky-note');
    fireEvent.doubleClick(note);
    const editor = screen.getByTestId('sticky-text-editor');
    editor.focus();

    // 'T' is a normal character here: the tool must not switch.
    fireEvent.keyDown(editor, { key: 't' });
    fireEvent.input(editor, { target: { value: 't' } });

    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    // The character was typed into the sticky.
    expect(getStickyText(doc, id)!.toString()).toBe('t');
    unmount();
  });

  // TC-17: Text active, click board at screen (300,200) → createText at the
  // screenToWorld point, tool reverts to Select, editor mounts on the new id.
  it('TC-17: a board click with Text active creates text at the click point and starts editing', () => {
    renderBoard();
    const doc = capturedDocs[0];

    fireEvent.click(screen.getByLabelText('Text (T)'));
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      dispatchPointer(viewport, 'pointerdown', 300, 200);
      dispatchPointer(viewport, 'pointerup', 300, 200);
    });

    // Exactly one object, a text, at the converted world point.
    const objects = doc.getMap('objects');
    expect(objects.size).toBe(1);
    const snap = [...objects.values()][0] as Y.Map<unknown>;
    expect(snap.get('type')).toBe('text');
    const cam = window.__vidi6.getCamera();
    const expected = screenToWorld(cam, { x: 300, y: 200 });
    expect(snap.get('x')).toBeCloseTo(expected.x, 6);
    expect(snap.get('y')).toBeCloseTo(expected.y, 6);

    // Tool reverted to Select; the new text is in editing mode.
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-editor')).toBeTruthy();
  });

  // TC-18: load_failed → Text button disabled; V keeps Select.
  it('TC-18: with a load-failed board the Text tool is unavailable', () => {
    connectMock.mockImplementationOnce((_doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      onState('load_failed');
      return { destroy: () => {} };
    });
    renderBoard('load-failed-board');

    const textButton = screen.getByLabelText('Text (T)') as HTMLButtonElement;
    expect(textButton.disabled).toBe(true);
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');

    // T must not switch; V keeps Select.
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByLabelText('Text (T)')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(window, { key: 'v' });
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect((screen.getByLabelText('Text (T)') as HTMLButtonElement).disabled).toBe(true);
  });
});
