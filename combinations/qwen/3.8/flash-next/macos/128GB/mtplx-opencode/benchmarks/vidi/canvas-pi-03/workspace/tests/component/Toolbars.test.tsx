import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import { pointerEvent, fire, seed, boardState } from './harness';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}
function snapshotMap() {
  const w = window as unknown as { __vidi6: { snapshot(): Array<{ id: string; x: number; y: number; color: string }> } };
  return w.__vidi6.snapshot();
}
function selectNote(id: string) {
  const el = noteEl(id);
  fire(el, pointerEvent('pointerdown', 400, 400));
  fire(el, pointerEvent('pointerup', 400, 400));
}

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

describe('TC-27 colour swatch', () => {
  it('clicking the Pink swatch recolours the note and keeps the selection', () => {
    const { getByLabelText } = render(<App />);
    const id = seed(640, 400);
    selectNote(id);
    expect(document.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();

    const pink = getByLabelText('Pink colour') as HTMLElement;
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pink);

    expect(snapshotMap().find((n) => n.id === id)!.color).toBe('pink');
    expect(boardState().selectedId).toBe(id);
  });
});

describe('TC-28 create via Sticky note button', () => {
  it('the Sticky note button creates one note centred in the viewport, in edit mode', () => {
    const { getByLabelText } = render(<App />);
    const createBtn = getByLabelText('Sticky note');
    fireEvent.click(createBtn);

    const snap = snapshotMap();
    expect(snap).toHaveLength(1);
    // Default camera centres the world origin; the new note is centred there.
    expect(snap[0].x).toBeCloseTo(-100, 0);
    expect(snap[0].y).toBeCloseTo(-100, 0);
    expect(boardState().editingId).toBe(snap[0].id);
    expect(boardState().selectedId).toBe(snap[0].id);
  });
});

describe('TC-29 delete via bin button', () => {
  it('the bin button removes the note and clears the selection', () => {
    const { getByLabelText } = render(<App />);
    const id = seed(640, 400);
    selectNote(id);

    const bin = getByLabelText('Delete note');
    fireEvent.click(bin);

    expect(snapshotMap().find((n) => n.id === id)).toBeUndefined();
    expect(boardState().selectedId).toBeNull();
  });
});