import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { STICKY_BUTTON_TOOLTIP } from '../../src/client/board/Toolbar';
import { flushFrame, model, noteEl, noteElements, noteToolbar, press, readCamera, renderApp, useFakeFrames } from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;

function notes() {
  return snapshot(window.__vidi6!.doc);
}

describe('Toolbars (sticky.toolbar)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('the Sticky note button has its accessible name and tooltip', () => {
    renderApp();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute('title', STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note – or double-click the board');
  });

  it('TC-28 Sticky note button creates one note centred on the viewport, in edit mode', () => {
    const { viewport } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const cam = readCamera(viewport);
    const all = notes();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('yellow');
    expect(all[0].x + HALF).toBeCloseTo(window.innerWidth / 2 / cam.zoom + cam.x, 9);
    expect(all[0].y + HALF).toBeCloseTo(window.innerHeight / 2 / cam.zoom + cam.y, 9);
    const el = noteEl(all[0].id);
    expect(el.dataset.editing).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('TC-28 after panning, the button still creates at the viewport centre and on top', () => {
    const { viewport } = renderApp();
    model((doc) => createSticky(doc, { x: 0, y: 0 }));
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 100, clientY: 200 });
    flushFrame();
    const cam = readCamera(viewport);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const created = notes().at(-1)!;
    expect(created.z).toBe(2);
    expect(created.x + HALF).toBeCloseTo(window.innerWidth / 2 / cam.zoom + cam.x, 9);
  });

  it('TC-27 Pink swatch recolours the note and keeps text, position and selection', () => {
    renderApp();
    const id = model((doc) => {
      const newId = createSticky(doc, { x: HALF, y: HALF });
      getStickyText(doc, newId)!.insert(0, 'Faster onboarding');
      return newId;
    });
    const el = noteEl(id);
    press(el);
    const swatches = screen.getAllByRole('button', { name: /colour$/ });
    expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Yellow colour',
      'Orange colour',
      'Green colour',
      'Blue colour',
      'Pink colour',
      'Violet colour',
    ]);
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('title', 'Pink');

    const pink = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.pointerDown(pink, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(pink, { pointerId: 1 });
    fireEvent.click(pink);

    expect(notes()[0]).toMatchObject({ color: 'pink', text: 'Faster onboarding', x: 0, y: 0 });
    expect(el.dataset.selected).toBe('true');
    expect(el.style.backgroundColor).toBe('rgb(244, 143, 177)'); // STICKY_COLORS.pink
    expect(STICKY_COLORS.pink).toBe('#F48FB1');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute('aria-pressed', 'false');
    expect(noteToolbar()).toBeInTheDocument();
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    renderApp();
    const keep = model((doc) => createSticky(doc, { x: 600, y: 600 }));
    const id = model((doc) => createSticky(doc, { x: HALF, y: HALF }));
    press(noteEl(id));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(notes().map((n) => n.id)).toEqual([keep]);
    expect(noteElements()).toHaveLength(1);
    expect(noteToolbar()).toBeNull();
    expect(noteEl(keep).dataset.selected).toBe('false');
  });
});
