import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import { click, notes, renderApp } from './helpers';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('toolbars', () => {
  it('Sticky note button has the specified tooltip', () => {
    renderApp();
    expect(screen.getByLabelText('Sticky note', { selector: 'button' }).getAttribute('title'))
      .toBe('Sticky note – or double-click the board');
  });

  it('TC-27 the Pink swatch recolours and keeps the selection', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    click(notes()[0], 500, 400);
    fireEvent.click(screen.getByLabelText('Pink colour'));
    expect(snapshot(doc)[0].color).toBe('pink');
    expect(notes()[0].style.background).not.toBe('');
    expect(notes()[0].getAttribute('data-selected')).toBe('true');
    expect(screen.getByLabelText('Pink colour').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Yellow colour').getAttribute('aria-pressed')).toBe('false');
  });

  it('offers six named swatches', () => {
    renderApp([{ x: 0, y: 0 }]);
    click(notes()[0], 500, 400);
    for (const name of Object.keys(STICKY_COLORS)) {
      expect(screen.getByLabelText(`${name[0].toUpperCase()}${name.slice(1)} colour`)).toBeTruthy();
    }
  });

  it('TC-28 the Sticky note button creates a centred note in edit mode', () => {
    const { doc } = renderApp();
    fireEvent.click(screen.getByLabelText('Sticky note', { selector: 'button' }));
    const list = snapshot(doc);
    expect(list).toHaveLength(1);
    // jsdom viewport 1024x768; the initial camera centres the world origin on screen
    expect(list[0].x).toBe(-100);
    expect(list[0].y).toBe(-100);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(notes()[0].getAttribute('data-selected')).toBe('true');
  });

  it('TC-29 the bin button removes the note and clears the selection', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    click(notes()[0], 500, 400);
    fireEvent.click(screen.getByLabelText('Delete note'));
    expect(snapshot(doc)).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(screen.queryByLabelText('Delete note')).toBeNull();
  });
});
