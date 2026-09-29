import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import { TestBoard, HarnessHandle } from './harness';
import { snapshot, getStickyText } from '@shared/board-model';

function setup(initialNotes: { x: number; y: number; text?: string }[] = []) {
  const handle: HarnessHandle = { current: null };
  const utils = render(<TestBoard handle={handle} initialNotes={initialNotes} />);
  return { handle, ...utils };
}

function getNote(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
}

function selectNote(container: HTMLElement, handle: HarnessHandle): string {
  const id = snapshot(handle.current!.doc)[0].id;
  const note = getNote(container);
  fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
  fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
  return id;
}

function pressEnter() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  fireEvent.input(el, { target: { value } });
}

describe('StickyTextEditor', () => {
  afterEach(cleanup);

  describe('TC-23: Enter starts editing with the caret at the end', () => {
    it('mounts a focused textarea with caret after the existing text', () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'Faster onboarding' }]);
      selectNote(container, handle);
      pressEnter();

      expect(handle.current!.selection.editingId).not.toBeNull();
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;
      expect(ta).not.toBeNull();
      expect(document.activeElement).toBe(ta);
      expect(ta.value).toBe('Faster onboarding');
      expect(ta.selectionStart).toBe('Faster onboarding'.length);
      expect(ta.selectionEnd).toBe('Faster onboarding'.length);
    });
  });

  describe('TC-24: Escape ends editing and keeps the text', () => {
    it('returns to selected with text intact', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = selectNote(container, handle);
      pressEnter();
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;
      typeInto(ta, 'Keep me');

      fireEvent.keyDown(ta, { key: 'Escape', bubbles: true, cancelable: true });

      expect(container.querySelector('[data-testid="sticky-textarea"]')).toBeNull();
      const note = snapshot(handle.current!.doc).find((n) => n.id === id)!;
      expect(note.text).toBe('Keep me');
      expect(handle.current!.selection.editingId).toBeNull();
      expect(handle.current!.selection.selectedId).toBe(id);
    });
  });

  describe('TC-26: Backspace while editing edits text, does not delete the note', () => {
    it("pressing Backspace in 'ab' yields 'a' and the note stays", () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'ab' }]);
      const id = selectNote(container, handle);
      pressEnter();
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;

      // Simulate the browser's own text edit, then a Backspace keydown.
      ta.setSelectionRange(2, 2);
      fireEvent.keyDown(ta, { key: 'Backspace', bubbles: true });
      typeInto(ta, 'a');

      expect(snapshot(handle.current!.doc).length).toBe(1);
      const note = snapshot(handle.current!.doc).find((n) => n.id === id)!;
      expect(note.text).toBe('a');
    });
  });

  describe('TC-38: click outside commits and unmounts', () => {
    it("typing 'abc' then clicking the board keeps 'abc' and deselects", () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = selectNote(container, handle);
      pressEnter();
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;
      typeInto(ta, 'abc');

      const viewport = screen.getByTestId('board-viewport');
      fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 900, clientY: 600, button: 0 });
      fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 900, clientY: 600, button: 0 });

      expect(container.querySelector('[data-testid="sticky-textarea"]')).toBeNull();
      const ytext = getStickyText(handle.current!.doc, id)!;
      expect(ytext.toString()).toBe('abc');
      expect(handle.current!.selection.selectedId).toBeNull();
      expect(handle.current!.selection.editingId).toBeNull();
    });
  });

  describe('clicking another note while editing', () => {
    it('commits the text and moves the selection to the other note', () => {
      const handle: HarnessHandle = { current: null };
      const { container } = render(
        <TestBoard handle={handle} initialNotes={[{ x: 0, y: 0, text: 'first' }, { x: 400, y: 0, text: 'second' }]} />,
      );
      const ids = snapshot(handle.current!.doc);
      const first = ids.find((n) => n.text === 'first')!;
      const second = ids.find((n) => n.text === 'second')!;

      fireEvent.doubleClick(
        container.querySelector(`[data-note-id="${first.id}"][data-testid="sticky-note"]`)!,
      );
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;
      typeInto(ta, 'first edited');

      const secondEl = container.querySelector(
        `[data-note-id="${second.id}"][data-testid="sticky-note"]`,
      ) as HTMLElement;
      fireEvent.pointerDown(secondEl, { pointerId: 1, clientX: 500, clientY: 50, button: 0 });
      fireEvent.pointerUp(secondEl, { pointerId: 1, clientX: 500, clientY: 50, button: 0 });

      expect(container.querySelector('[data-testid="sticky-textarea"]')).toBeNull();
      expect(snapshot(handle.current!.doc).find((n) => n.id === first.id)!.text).toBe('first edited');
      expect(handle.current!.selection.selectedId).toBe(second.id);
      expect(handle.current!.selection.editingId).toBeNull();
    });
  });

  describe('editing beyond the limit truncates', () => {
    it('typing past 1,000 characters keeps exactly 1,000', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = selectNote(container, handle);
      pressEnter();
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;
      const long = 'x'.repeat(1200);
      typeInto(ta, long);

      const ytext = getStickyText(handle.current!.doc, id)!;
      expect(ytext.toString().length).toBe(1000);
      expect(ta.value.length).toBe(1000);
      // counter visible near the limit
      const counter = container.querySelector('[data-testid="sticky-note-counter"]');
      expect(counter?.textContent).toBe('1000/1000');
    });
  });
});
