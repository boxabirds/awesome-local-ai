import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { Harness, type HarnessRegistry } from './harness';
import { snapshot } from '../../src/shared/board-model';

let registry: MutableRefObject<HarnessRegistry>;

function mount(): void {
  registry = { current: { doc: null, selectedId: null, editingId: null } };
  render(<Harness registry={registry} />);
}

function noteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="group"][aria-label="Sticky note"]'));
}

afterEach(() => {
  cleanup();
});

describe('sticky.toolbar', () => {
  test('TC-28 Sticky note button creates one note centred on the viewport centre in edit mode', () => {
    mount();
    const doc = registry.current.doc!;
    expect(snapshot(doc).length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const notes = snapshot(doc);
    expect(notes.length).toBe(1);
    // Initial camera is centred on world (0,0); the new note is centred there.
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
    expect(notes[0].color).toBe('yellow');
    expect(registry.current.editingId).toBe(notes[0].id);
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
  });

  test('TC-27 pink swatch recolours the note and keeps it selected', () => {
    mount();
    const doc = registry.current.doc!;
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const id = snapshot(doc)[0].id;
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });
    // Selected, not editing: the note toolbar is shown.
    expect(registry.current.selectedId).toBe(id);
    expect(registry.current.editingId).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(snapshot(doc)[0].color).toBe('pink');
    expect(registry.current.selectedId).toBe(id);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  test('TC-29 bin button deletes the note and clears the selection', () => {
    mount();
    const doc = registry.current.doc!;
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc).length).toBe(0);
    expect(registry.current.selectedId).toBeNull();
    expect(noteElements().length).toBe(0);
  });
});
