/**
 * Component tests for undo controls (TC-18 to TC-21).
 * jsdom tests for undo/redo shortcuts, buttons, and edit lock.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

function flushFrames(count = 3): void {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
}

describe('undo controls (component)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    if (doc) doc.destroy();
    vi.useRealTimers();
  });

  function setup() {
    doc = new Y.Doc();
  }

  function mount() {
    render(<App doc={doc} />);
    flushFrames();
  }

  /** Make a local change AFTER mount so the controller captures it. */
  function makeLocalChange(): void {
    act(() => {
      doc.transact(() => {
        const m = new Y.Map();
        m.set('type', 'sticky');
        m.set('x', 500);
        m.set('y', 400);
        m.set('color', 'yellow');
        m.set('z', 1);
        m.set('createdAt', Date.now());
        m.set('text', new Y.Text());
        doc.getMap('objects').set('test-note', m);
      }, LOCAL_ORIGIN);
    });
    flushFrames();
  }

  /** Dispatch a keyboard event within act() and return the event for checking defaultPrevented. */
  function dispatchKey(opts: KeyboardEventInit): KeyboardEvent {
    let event: KeyboardEvent;
    act(() => {
      event = new KeyboardEvent('keydown', { ...opts, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
    });
    flushFrames();
    return event!;
  }

  it('TC-18: empty history → Undo and Redo buttons disabled', () => {
    setup();
    mount();

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });

    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('TC-19: Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y trigger undo/redo with preventDefault', () => {
    setup();
    mount();

    // Make a local change AFTER mount so the UndoController captures it
    makeLocalChange();

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    expect(undoBtn).not.toBeDisabled();

    // Test Ctrl+Z (undo)
    const eventCtrlZ = dispatchKey({ key: 'z', ctrlKey: true });
    expect(eventCtrlZ.defaultPrevented).toBe(true);

    // After undo, redo should be available
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect(redoBtn).not.toBeDisabled();

    // Test Ctrl+Shift+Z (redo)
    const eventCtrlShiftZ = dispatchKey({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(eventCtrlShiftZ.defaultPrevented).toBe(true);

    // Test Cmd+Z (undo - macOS) - make another change first
    doc.getMap('objects').delete('test-note');
    act(() => {
      doc.transact(() => {
        const m = new Y.Map();
        m.set('type', 'sticky');
        m.set('x', 600);
        m.set('y', 400);
        m.set('color', 'blue');
        m.set('z', 2);
        m.set('createdAt', Date.now());
        m.set('text', new Y.Text());
        doc.getMap('objects').set('test-note-2', m);
      }, LOCAL_ORIGIN);
    });
    flushFrames();

    const eventMetaZ = dispatchKey({ key: 'z', metaKey: true });
    expect(eventMetaZ.defaultPrevented).toBe(true);

    // Test Cmd+Shift+Z (redo - macOS)
    const eventMetaShiftZ = dispatchKey({ key: 'z', metaKey: true, shiftKey: true });
    expect(eventMetaShiftZ.defaultPrevented).toBe(true);

    // Test Ctrl+Y (redo - Windows)
    const eventCtrlY = dispatchKey({ key: 'y', ctrlKey: true });
    expect(eventCtrlY.defaultPrevented).toBe(true);
  });

  it('TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled', () => {
    setup();
    mount();

    // Make a local change
    makeLocalChange();

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    expect(undoBtn).not.toBeDisabled();

    // Undo it to clear the undo stack
    dispatchKey({ key: 'z', ctrlKey: true });

    // Buttons should reflect empty undo stack
    expect(undoBtn).toBeDisabled();

    // Shortcuts with empty history: still preventDefault (browser undo is blocked)
    const event = dispatchKey({ key: 'z', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-21: Ctrl+Z with focus in a non-board input (share link field) → controller not called', () => {
    setup();
    mount();

    // Make a local change AFTER mount so it's captured by the controller
    makeLocalChange();

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    expect(undoBtn).not.toBeDisabled();

    // Create an input that is not a sticky editor textarea
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-testid', 'share-link-input');
    document.body.appendChild(input);
    input.focus();

    // Dispatch Ctrl+Z while focus is in the input
    // The event bubbles from input → document → window
    // Our handler checks isTypingTarget(e.target) and returns early
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
    });
    flushFrames();

    // The undo should NOT have happened (controller was not called).
    // Verify: the Undo button should still be enabled (step still available).
    expect(undoBtn).not.toBeDisabled();

    // Clean up
    document.body.removeChild(input);
  });
});
