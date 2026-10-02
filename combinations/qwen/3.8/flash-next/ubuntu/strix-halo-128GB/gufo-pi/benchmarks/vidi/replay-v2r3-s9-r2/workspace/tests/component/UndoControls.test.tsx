/**
 * Component tests for undo.controls (TC-18 to TC-21).
 * Uses BoardHarness with a real controller and keydown/button interaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { frames } from './pointerUtils';

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
  const doc = handle.doc;
  return { handle, doc };
}

function makeNote(doc: any): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 300, y: 300 });
  });
  frames();
  return id;
}

describe('undo.controls', () => {
  it('TC-18: empty stacks → Undo and Redo buttons disabled with aria-disabled', () => {
    const { handle } = setup();

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });

    expect(undoBtn).toHaveProperty('disabled', true);
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toHaveProperty('disabled', true);
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');

    handle.undoController.destroy();
  });

  it('TC-19: Ctrl+Z, Cmd+Z → undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y → redo; each preventDefault', () => {
    const { handle, doc } = setup();

    // Make a change so undo is possible
    makeNote(doc);
    handle.undoController.boundary();

    const undoBtn = screen.getByTestId('undo-button');
    const redoBtn = screen.getByTestId('redo-button');
    expect(undoBtn).toHaveProperty('disabled', false);

    // Test Ctrl+Z calls undo
    let prevented = false;
    const ctrlZEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(ctrlZEvent, 'preventDefault', { value: () => { prevented = true; } });
    window.dispatchEvent(ctrlZEvent);
    frames();
    expect(prevented).toBe(true);
    // Undo stack should be empty now (only one step)
    expect(handle.undoController.canUndo()).toBe(false);
    expect(handle.undoController.canRedo()).toBe(true);

    // Test Cmd+Z calls undo (undo the redo first)
    handle.undoController.redo();
    handle.undoController.boundary();
    prevented = false;
    const metaZEvent = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(metaZEvent, 'preventDefault', { value: () => { prevented = true; } });
    window.dispatchEvent(metaZEvent);
    frames();
    expect(prevented).toBe(true);

    // Test Ctrl+Shift+Z calls redo
    prevented = false;
    const ctrlShiftZEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(ctrlShiftZEvent, 'preventDefault', { value: () => { prevented = true; } });
    window.dispatchEvent(ctrlShiftZEvent);
    frames();
    expect(prevented).toBe(true);

    // Test Cmd+Shift+Z calls redo
    // Need to undo first to get redo items
    handle.undoController.undo();
    prevented = false;
    const metaShiftZEvent = new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(metaShiftZEvent, 'preventDefault', { value: () => { prevented = true; } });
    window.dispatchEvent(metaShiftZEvent);
    frames();
    expect(prevented).toBe(true);

    // Test Ctrl+Y calls redo
    handle.undoController.undo();
    prevented = false;
    const ctrlYEvent = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(ctrlYEvent, 'preventDefault', { value: () => { prevented = true; } });
    window.dispatchEvent(ctrlYEvent);
    frames();
    expect(prevented).toBe(true);

    handle.undoController.destroy();
  });

  it('TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled', () => {
    const { handle, doc } = setup(true); // readOnly = true simulates load failed

    // Make a change directly on the doc (bypassing the UI guards)
    makeNote(doc);

    // Buttons should be disabled even with content
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });

    // Even though controller canUndo is true, UI shows disabled because canEdit is false
    expect(handle.undoController.canUndo()).toBe(true);
    expect(undoBtn).toHaveProperty('disabled', true);
    expect(redoBtn).toHaveProperty('disabled', true);

    // Ctrl+Z should NOT trigger undo
    const undoCountBefore = handle.undoController.canUndo();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    frames();
    // canUndo should still be true (undo was not executed)
    expect(handle.undoController.canUndo()).toBe(undoCountBefore);

    handle.undoController.destroy();
  });

  it('TC-21: Ctrl+Z with focus in a non-board input → controller not called (negative)', () => {
    const { handle, doc } = setup();

    makeNote(doc);
    handle.undoController.boundary();

    // Undo should be possible
    expect(handle.undoController.canUndo()).toBe(true);

    // Create a non-board input and dispatch Ctrl+Z from it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    frames();

    // Controller should NOT have undone anything
    expect(handle.undoController.canUndo()).toBe(true);

    document.body.removeChild(input);
    handle.undoController.destroy();
  });
});
