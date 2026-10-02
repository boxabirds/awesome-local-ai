import { act } from 'react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import type { StickySnapshot } from '../../src/shared/board-model';
import type { Camera } from '../../src/client/canvas/camera';

/** rAF-batched state (camera, drag moves) needs a frame to land. */
export function flushRaf(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

export function hooks() {
  const value = window.__vidi6;
  if (!value) throw new Error('test hooks are not registered (MODE must be "test")');
  return value;
}

export function getDoc(): Y.Doc {
  return hooks().getDoc();
}

export function getNotes(): readonly StickySnapshot[] {
  return hooks().getNotes();
}

export function getCamera(): Camera {
  return hooks().getCamera();
}

/** Create a note through the model, exactly like the board does. */
export function makeNote(at: { x: number; y: number } = { x: 300, y: 300 }): string {
  let id = '';
  act(() => {
    id = createSticky(getDoc(), at);
  });
  flushRaf();
  return id;
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`no element for note ${id}`);
  return el;
}

export function noteById(id: string): StickySnapshot | undefined {
  return getNotes().find((note) => note.id === id);
}

export function textarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]');
}
