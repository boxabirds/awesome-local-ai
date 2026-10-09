import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { Harness, type HarnessRegistry } from './harness';
import { snapshot } from '../../src/shared/board-model';

let registry: MutableRefObject<HarnessRegistry>;

function mount(): void {
  registry = { current: { doc: null, selectedId: null, editingId: null } };
  render(<Harness registry={registry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
}

function editor(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
}

function typeValue(value: string): void {
  const el = editor();
  fireEvent.input(el, { target: { value } });
}

function clickOutsideBoard(): void {
  const viewport = screen.getByTestId('board-viewport');
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 99, clientX: 5, clientY: 5 });
  fireEvent.pointerUp(viewport, { pointerId: 99 });
}

afterEach(() => {
  cleanup();
});

describe('sticky.text editor', () => {
  test('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    mount();
    typeValue('abc');
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(registry.current.editingId).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(registry.current.editingId).not.toBeNull();
    const el = editor();
    expect(el.value).toBe('abc');
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(3);
    expect(el.selectionEnd).toBe(3);
  });

  test('TC-24 Escape ends editing and keeps the text', () => {
    mount();
    const doc = registry.current.doc!;
    const id = snapshot(doc)[0].id;
    typeValue('keep this');
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(snapshot(doc)[0].text).toBe('keep this');
    expect(registry.current.selectedId).toBe(id);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  test('TC-26 Backspace while editing edits text and does not delete the note', () => {
    mount();
    const doc = registry.current.doc!;
    typeValue('ab');
    expect(snapshot(doc)[0].text).toBe('ab');
    typeValue('a');
    fireEvent.keyDown(editor(), { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc).length).toBe(1);
    expect(snapshot(doc)[0].text).toBe('a');
  });

  test('TC-38 typing then clicking outside keeps the text and deselects', () => {
    mount();
    const doc = registry.current.doc!;
    typeValue('abc');
    clickOutsideBoard();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(snapshot(doc)[0].text).toBe('abc');
    expect(registry.current.selectedId).toBeNull();
    expect(registry.current.editingId).toBeNull();
  });
});
