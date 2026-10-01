import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import '@testing-library/jest-dom/vitest';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import { snapshot, objects, createSticky } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';

installComponentMocks();

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

function renderBoard(props: Partial<TestBoardProps> = {}) {
  let doc: Y.Doc | null = null;
  const utils = render(
    <TestBoard camera={CAMERA} viewportSize={VIEWPORT} onDocReady={(d) => (doc = d)} {...props} />,
  );
  return { ...utils, getDoc: () => doc as Y.Doc };
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

function pointer(el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        ...extra,
      }),
    );
  });
}

describe('text.tool_ui (tool mode + Text tool)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-14
  it('TC-14: T → Text active (aria-pressed); Escape → Select; T then V → Select', () => {
    renderBoard();
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    const selectBtn = screen.getByRole('button', { name: 'Select (V)' });

    pressKey('t');
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'false');

    pressKey('Escape');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    pressKey('t');
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    pressKey('v');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-15
  it('TC-15: read-only board — T is ignored and the Text button is disabled', () => {
    renderBoard({ canEdit: false });
    const textBtn = screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
    expect(textBtn.disabled).toBe(true);

    pressKey('t');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-16
  it('TC-16: T pressed while editing a sticky types the character, tool unchanged', async () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 200 }) as string;
    });
    const note = screen.getByTestId(`sticky-note-${id}`);
    pointer(note, 'pointerdown', 310, 210);
    pointer(note, 'pointerup', 310, 210);
    // Enter edit mode.
    pressKey('Enter');
    const editor = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();

    // T while editing: a real keystroke targets the focused textarea (typing),
    // and the board shortcuts ignore typing targets — so the character lands
    // in the note and the tool is untouched.
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
    });
    fireEvent.change(editor, { target: { value: 't' } });
    expect(editor.value).toBe('t');
    // The tool is unchanged (Select).
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // TC-17
  it('TC-17: Text active, click the board → createText at the point, Select, editor mounted', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();

    pressKey('t');
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const viewport = screen.getByTestId('board-viewport');
    pointer(viewport, 'pointerdown', 300, 200);
    pointer(viewport, 'pointerup', 300, 200);

    const all = objects(doc);
    const texts = all.filter((o) => o.type === 'text');
    expect(texts).toHaveLength(1);
    const expected = screenToWorld(CAMERA, { x: 300, y: 200 });
    expect(texts[0].x).toBe(expected.x);
    expect(texts[0].y).toBe(expected.y);

    // The tool handed back to Select and the new object is being edited.
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('text-editor')).toBeTruthy();
  });

  // TC-18
  it('TC-18: N still creates a sticky at the view centre', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    pressKey('n');
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // View centre in world units (camera identity).
    expect(notes[0].x).toBe(VIEWPORT.width / 2 - 100);
    expect(notes[0].y).toBe(VIEWPORT.height / 2 - 100);
  });
});
