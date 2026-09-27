// Story 9, task 7: component tests for the tool mode (TC-14 to TC-18).
//
// The App is rendered against a mocked connector (same pattern as the story 7
// multi-select tests). Tool shortcuts are dispatched on window; the click-to-
// create is a pointerdown/pointerup pair on the viewport element.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { getTextContent, type TextSnapshot } from '../../src/shared/objects/text';
import { getStickyText, objectSnapshot } from '../../src/shared/board-model';
import {
  resetBoardForTests,
  setBoardCamera,
} from '../../src/client/canvas/useCamera';
import { makeEvent } from './helpers';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { StickyColor } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { Camera } from '../../src/client/canvas/camera';

// Module-scope seed config, read by the hoisted connectBoard mock.
const SEED = vi.hoisted(() => ({
  notes: [] as Array<{ x: number; y: number; color: StickyColor }>,
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  const boardModel = await import('../../src/shared/board-model');
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      queueMicrotask(() => {
        if (boardModel.objectSnapshot(doc).length !== 0) return;
        for (const n of SEED.notes) boardModel.createStickyAt(doc, n.x, n.y, n.color);
      });
      return { destroy: (): void => undefined };
    },
  };
});

// Deterministic camera: world (0,0) at screen (512,384), zoom 1 (jsdom's
// 1024x768 default window).
const CAM: Camera = { x: -512, y: -384, zoom: 1 };

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}

function pressKey(key: string, init: Record<string, unknown> = {}): void {
  dis(window, 'keydown', { key, ...init });
}

function selectPressed(): boolean {
  return (
    screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed') === 'true'
  );
}

function textPressed(): boolean {
  return (
    screen.getByRole('button', { name: 'Text (T)' }).getAttribute('aria-pressed') === 'true'
  );
}

function clickBoardAt(x: number, y: number): void {
  const vp = screen.getByTestId('board-viewport');
  dis(vp, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  dis(vp, 'pointerup', { pointerId: 1, clientX: x, clientY: y });
}

async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  act(() => {
    setBoardCamera(CAM);
  });
}

describe('story 9: tool mode (TC-14..TC-18)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.notes = [];
    SEED.state = 'connected';
    SEED.doc = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-14: T activates the Text tool; Escape and V return to Select', async () => {
    await openBoard();
    expect(selectPressed()).toBe(true);
    expect(textPressed()).toBe(false);

    pressKey('t');
    expect(textPressed()).toBe(true);
    expect(selectPressed()).toBe(false);

    pressKey('Escape');
    expect(selectPressed()).toBe(true);
    expect(textPressed()).toBe(false);

    pressKey('t');
    pressKey('v');
    expect(selectPressed()).toBe(true);
    expect(textPressed()).toBe(false);
  });

  it('TC-15: a load_failed board ignores T and disables the Text button', async () => {
    SEED.state = 'load_failed';
    await openBoard();
    const textButton = screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
    expect(textButton.disabled).toBe(true);

    pressKey('t');
    expect(textPressed()).toBe(false);
    expect(selectPressed()).toBe(true);
  });

  it('TC-16: T while editing a sticky types a character and does not switch the tool', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();
    const note = screen.getByRole('group', { name: 'Sticky note' });

    dis(note, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    dis(window, 'pointerup', { pointerId: 1 });
    dis(note, 'dblclick', {});
    const ta = screen.getByLabelText('Sticky note text');

    pressKey('t'); // must be swallowed by the editor, not the board
    fireEvent.input(ta, { target: { value: 't' } });

    const id =
      objectSnapshot(SEED.doc!).find((o) => o.type === 'sticky')?.id ?? '';
    expect(getStickyText(SEED.doc!, id)!.toString()).toBe('t');
    expect(textPressed()).toBe(false);
    expect(selectPressed()).toBe(true);
  });

  it('TC-17: a click with the Text tool creates text at the point and returns to Select', async () => {
    await openBoard();
    pressKey('t');
    expect(textPressed()).toBe(true);

    clickBoardAt(300, 200);

    // Tool is back on Select and the new text is being edited.
    expect(selectPressed()).toBe(true);
    expect(textPressed()).toBe(false);
    expect(screen.getByLabelText('Text object text')).toBeTruthy();

    // The object exists at screenToWorld(300, 200).
    const at = screenToWorld(CAM, { x: 300, y: 200 });
    const snap = objectSnapshot(SEED.doc!).find((o) => o.type === 'text') as
      | TextSnapshot
      | undefined;
    expect(snap).toBeDefined();
    expect(snap!.x).toBeCloseTo(at.x, 5);
    expect(snap!.y).toBeCloseTo(at.y, 5);
    // The creating client recorded its identity.
    expect(snap!.createdBy).toBeTruthy();
    // Editing started: the Y.Text exists (empty so far).
    expect(getTextContent(SEED.doc!, snap!.id)).toBeDefined();
  });

  it('TC-18: N still creates a sticky at the view centre (story 2 behaviour)', async () => {
    await openBoard();
    pressKey('n');

    const notes = screen.queryAllByRole('group', { name: 'Sticky note' });
    expect(notes).toHaveLength(1);
    // Centre of the 1024x768 view = world (0,0) under CAM; the note is
    // centred there, so its top-left is (-100, -100) (STICKY_SIZE_WORLD 200).
    expect(notes[0].style.left).toBe('-100px');
    expect(notes[0].style.top).toBe('-100px');
  });
});
