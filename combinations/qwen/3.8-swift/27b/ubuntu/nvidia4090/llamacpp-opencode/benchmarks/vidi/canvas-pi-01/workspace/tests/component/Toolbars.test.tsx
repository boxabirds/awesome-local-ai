// sticky.toolbar (story 2): TC-27 to TC-29.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  click,
  dispatch,
  installResizeObserverMock,
  keyOn,
  pointerEvent,
  renderApp,
  viewportEl,
} from './helpers';

const NOTE_CENTRE = { x: 640, y: 400 };

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

function noteEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

function firstNote(container: HTMLElement): HTMLElement {
  const el = noteEls(container)[0];
  if (el === undefined) throw new Error('no sticky note rendered');
  return el;
}

function clickEmpty(container: HTMLElement): void {
  const vp = viewportEl(container);
  dispatch(vp, pointerEvent('pointerdown', 100, 100));
  dispatch(vp, pointerEvent('pointerup', 100, 100));
}

function clickNote(container: HTMLElement): void {
  const note = firstNote(container);
  dispatch(note, pointerEvent('pointerdown', NOTE_CENTRE.x, NOTE_CENTRE.y));
  dispatch(note, pointerEvent('pointerup', NOTE_CENTRE.x, NOTE_CENTRE.y));
}

function createNoteViaButton(): void {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Sticky note"]');
  if (button === null) throw new Error('toolbar button not rendered');
  click(button);
}

function editingTextarea(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
  if (el === null) throw new Error('no editor textarea rendered');
  return el;
}

describe('sticky.toolbar', () => {
  it('TC-27 clicking the Pink swatch changes the model colour and keeps the selection', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    keyOn(editingTextarea(), 'Escape');
    clickEmpty(container);
    clickNote(container);
    expect(firstNote(container).hasAttribute('data-selected')).toBe(true);

    const pink = container.querySelector<HTMLButtonElement>('button[aria-label="Pink colour"]');
    expect(pink).not.toBeNull();
    click(pink!);

    // jsdom normalises hex colours to rgb() in inline styles.
    expect(firstNote(container).style.backgroundColor).toBe('rgb(244, 143, 177)'); // #F48FB1
    expect(firstNote(container).hasAttribute('data-selected')).toBe(true);
    expect(pink!.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 the Sticky note button creates one note centred on the viewport, in edit mode', async () => {
    const { container } = await renderApp();
    createNoteViaButton();

    const notes = noteEls(container);
    expect(notes).toHaveLength(1);
    // Viewport 1280x800, home camera: viewport centre = world (0,0); the note
    // is 200x200 centred there → top-left (-100,-100) in world units.
    expect(notes[0]!.style.left).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(notes[0]!.style.top).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    // Editing immediately: the textarea is mounted with the caret at the end.
    const ta = editingTextarea();
    expect(ta.value).toBe('');
  });

  it('TC-29 the bin button deletes the note and clears the selection', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    keyOn(editingTextarea(), 'Escape');
    clickNote(container);
    expect(noteEls(container)).toHaveLength(1);
    expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();

    const bin = container.querySelector<HTMLButtonElement>('button[aria-label="Delete note"]');
    expect(bin).not.toBeNull();
    click(bin!);

    expect(noteEls(container)).toHaveLength(0);
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });
});
