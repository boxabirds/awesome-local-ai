import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { Harness, type HarnessRegistry } from './harness';
import { deleteObject, snapshot } from '../../src/shared/board-model';

let registry: MutableRefObject<HarnessRegistry>;

function mount(): string {
  registry = { current: { doc: null, selectedId: null, editingId: null } };
  render(<Harness registry={registry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
  const id = snapshot(registry.current.doc!)[0].id;
  fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });
  return id;
}

function noteEl(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-testid="sticky-${id}"]`)!;
}

function doc() {
  return registry.current.doc!;
}

function camera(): { x: number; y: number; zoom: number } {
  return (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera();
}

function flushFrames(): void {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sticky.interaction', () => {
  test('TC-18 press and release selects the note and shows the outline and toolbar', () => {
    const id = mount();
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(registry.current.selectedId).toBe(id);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  test('TC-19 a 2px move stays below the threshold and does not move the note', () => {
    const id = mount();
    const before = snapshot(doc())[0];
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 102, clientY: 100 });
    flushFrames();
    expect(el.getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerUp(el, { pointerId: 1 });
    const after = snapshot(doc())[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(registry.current.selectedId).toBe(id);
  });

  test('TC-20 a move of the threshold drags the note without panning the camera', () => {
    const id = mount();
    const before = snapshot(doc())[0];
    const camBefore = camera();
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 103, clientY: 100 });
    expect(el.getAttribute('data-dragging')).toBe('true');
    flushFrames();
    expect(snapshot(doc())[0].x).toBe(before.x + 3);
    fireEvent.pointerUp(el, { pointerId: 1 });
    const camAfter = camera();
    expect(camAfter.x).toBe(camBefore.x);
    expect(camAfter.y).toBe(camBefore.y);
    expect(camAfter.zoom).toBe(camBefore.zoom);
  });

  test('TC-21 pointer cancel mid-drag keeps the note selected at its last position', () => {
    const id = mount();
    const before = snapshot(doc())[0];
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 110, clientY: 104 });
    flushFrames();
    fireEvent.pointerCancel(el, { pointerId: 1 });
    const after = snapshot(doc())[0];
    expect(after.x).toBe(before.x + 10);
    expect(after.y).toBe(before.y + 4);
    expect(el.getAttribute('data-dragging')).toBe('false');
    expect(registry.current.selectedId).toBe(id);
  });

  test('TC-22 clicking empty board deselects and hides the toolbar', () => {
    mount();
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 7, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(viewport, { pointerId: 7 });
    expect(registry.current.selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  test('TC-25 Delete on a selected note removes it and clears the selection', () => {
    mount();
    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    expect(snapshot(doc()).length).toBe(0);
    expect(registry.current.selectedId).toBeNull();
  });

  test('TC-25 Backspace on a selected note removes it and clears the selection', () => {
    mount();
    expect(snapshot(doc()).length).toBe(1);
    act(() => {
      fireEvent.keyDown(window, { key: 'Backspace' });
    });
    expect(snapshot(doc()).length).toBe(0);
    expect(registry.current.selectedId).toBeNull();
  });

  test('TC-35 double-clicking an existing note edits it without creating a new one', () => {
    const id = mount();
    fireEvent.doubleClick(noteEl(id));
    expect(snapshot(doc()).length).toBe(1);
    expect(registry.current.editingId).toBe(id);
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
  });

  test('TC-36 Enter with nothing selected does nothing', () => {
    registry = { current: { doc: null, selectedId: null, editingId: null } };
    render(<Harness registry={registry} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(snapshot(doc()).length).toBe(0);
    expect(registry.current.editingId).toBeNull();
  });

  test('TC-37 a note deleted from the model while dragging ends cleanly and is not recreated', () => {
    const id = mount();
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 106, clientY: 100 });
    flushFrames();
    expect(el.getAttribute('data-dragging')).toBe('true');
    expect(() => {
      act(() => {
        deleteObject(doc(), id);
      });
      fireEvent.pointerUp(el, { pointerId: 1 });
      flushFrames();
    }).not.toThrow();
    expect(snapshot(doc()).length).toBe(0);
  });

  test('TC-37 a note deleted from the model while editing ends cleanly and is not recreated', () => {
    registry = { current: { doc: null, selectedId: null, editingId: null } };
    render(<Harness registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const id = snapshot(doc())[0].id;
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
    expect(() => {
      act(() => {
        deleteObject(doc(), id);
      });
      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.keyDown(window, { key: 'Enter' });
    }).not.toThrow();
    expect(snapshot(doc()).length).toBe(0);
  });
});
