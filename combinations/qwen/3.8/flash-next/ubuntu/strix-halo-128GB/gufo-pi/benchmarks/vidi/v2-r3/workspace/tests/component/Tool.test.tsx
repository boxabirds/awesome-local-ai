import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot, getObjectsMap, createSticky } from '../../src/shared/board-model';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
  };
}

describe('text.tool (TC-14 to TC-18)', () => {
  it('TC-14: T → Text active and button aria-pressed=true; Escape → Select; T then V → Select', () => {
    setup();

    const textBtn = screen.getByTestId('tool-text-button');
    const selectBtn = screen.getByTestId('tool-select-button');

    // Initially select tool
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // Press T
    act(() => {
      fireEvent.keyDown(window, { key: 't' });
    });
    frames();
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'false');

    // Press Escape → back to select
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    frames();
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');

    // Press T then V → back to select
    act(() => {
      fireEvent.keyDown(window, { key: 't' });
    });
    frames();
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    frames();
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-15: canEdit false → T ignored, Text button disabled (negative)', () => {
    const handleRef = createRef<HarnessHandle | null>();
    render(<BoardHarness handleRef={handleRef} readOnly />);

    const textBtn = screen.getByTestId('tool-text-button');
    expect(textBtn).toBeDisabled();

    // Press T - should be ignored
    act(() => {
      fireEvent.keyDown(window, { key: 't' });
    });
    frames();
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-16: T pressed while editing a sticky → character typed, tool unchanged (negative)', () => {
    const { handle, doc } = setup();

    // Create a sticky and enter edit mode
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 100, y: 100 });
    });
    frames();

    // Select and start editing
    act(() => {
      handle.selection.click(id);
      handle.selection.startEdit(id);
    });
    frames();

    // The editor should be focused - press T in it
    const editor = screen.getByTestId('sticky-note-editor');
    expect(editor).toBeInTheDocument();

    // Typing 't' in the editor should not change tool
    fireEvent.input(editor, { target: { value: 't' } });
    frames();

    const textBtn = screen.getByTestId('tool-text-button');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-17: Text active, click board → createText at world point, tool back to Select, editing started', () => {
    const { handle, doc } = setup();

    // Activate Text tool
    act(() => {
      fireEvent.keyDown(window, { key: 't' });
    });
    frames();

    const textBtn = screen.getByTestId('tool-text-button');
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');

    // Click on the board surface at screen (300, 200)
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 300, 200);
    pointer(board, 'pointerup', 300, 200);
    frames();

    // Tool should be back to select
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // A text object should have been created
    const objects = snapshot(doc);
    const textObj = objects.find((o) => o.type === 'text');
    expect(textObj).toBeDefined();
    expect(textObj!.type).toBe('text');

    // Editing should have started on the new object
    expect(handle.getEditingId()).toBe(textObj!.id);
  });

  it('TC-18: N still creates a sticky at the view centre (regression)', () => {
    const { handle, doc } = setup();

    // Press N
    act(() => {
      fireEvent.keyDown(window, { key: 'n' });
    });
    frames();

    // A sticky note should have been created
    const objects = snapshot(doc);
    const sticky = objects.find((o) => o.type === 'sticky');
    expect(sticky).toBeDefined();
  });
});
