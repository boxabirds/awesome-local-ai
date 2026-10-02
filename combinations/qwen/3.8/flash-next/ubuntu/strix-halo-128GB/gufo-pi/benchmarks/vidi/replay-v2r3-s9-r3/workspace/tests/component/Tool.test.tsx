import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot, snapshotAll } from '../../src/shared/board-model';
import { pointer, frames, typeInto } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} />);
  const handle = handleRef.current!;
  return { handle, doc: handle.doc };
}

describe('Tool mode', () => {
  it('TC-14: T → Text active, button pressed=true; Escape → Select; V → Select', () => {
    const { handle } = setup();
    frames();

    // Press T to activate text tool
    fireEvent.keyDown(window, { key: 't' });
    frames();

    expect(handle.tool).toBe('text');
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'false');

    // Press Escape to go back to select
    fireEvent.keyDown(window, { key: 'Escape' });
    frames();

    expect(handle.tool).toBe('select');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');

    // Press T again, then V to go back
    fireEvent.keyDown(window, { key: 't' });
    frames();
    expect(handle.tool).toBe('text');

    fireEvent.keyDown(window, { key: 'v' });
    frames();
    expect(handle.tool).toBe('select');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-15: canEdit false → T ignored, Text button disabled', () => {
    const { handle } = setup(true);
    frames();

    // Text button should be disabled
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn).toBeDisabled();

    // Pressing T should not activate text tool
    fireEvent.keyDown(window, { key: 't' });
    frames();

    expect(handle.tool).toBe('select');
  });

  it('TC-16: T pressed while editing a sticky → character typed, tool unchanged', () => {
    const { handle, doc } = setup();
    frames();

    // Create a sticky and start editing it
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    frames();
    expect(handle.getEditingId()).not.toBeNull();

    // The editor should be focused; pressing T types 't' into the textarea
    const editor = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    editor.value = '';
    fireEvent.input(editor);

    // Press T while focused in the editor
    fireEvent.keyDown(editor, { key: 't' });
    frames();

    // Tool should still be select (not switched to text)
    expect(handle.tool).toBe('select');
  });

  it('TC-17: Text active, click board → createText at world point, tool back to Select, editing starts', () => {
    const { handle, doc } = setup();
    frames();

    // Activate text tool
    fireEvent.keyDown(window, { key: 't' });
    frames();
    expect(handle.tool).toBe('text');

    // Click the board (grid layer)
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 300, 200);
    frames();

    // Tool should be back to select
    expect(handle.tool).toBe('select');

    // A text object should have been created
    const objs = snapshotAll(doc);
    const textObj = objs.find((o) => o.type === 'text');
    expect(textObj).toBeDefined();

    // Editing should have started for that id
    expect(handle.getEditingId()).toBe(textObj!.id);
  });

  it('TC-18: N creates a sticky at the view centre', () => {
    const { handle, doc } = setup();
    frames();

    // Press N
    fireEvent.keyDown(window, { key: 'n' });
    frames();

    // A sticky note should be created
    const objs = snapshot(doc);
    const sticky = objs.find((o) => o.type === 'sticky');
    expect(sticky).toBeDefined();

    // Camera starts at (0,0) zoom 1, viewport is 1280x800, so center is (640, 400)
    // createSticky centers on the point, so x = 640 - 100 = 540, y = 400 - 100 = 300
    expect(sticky!.x).toBeCloseTo(640 - 100, 0);
    expect(sticky!.y).toBeCloseTo(400 - 100, 0);
  });
});
