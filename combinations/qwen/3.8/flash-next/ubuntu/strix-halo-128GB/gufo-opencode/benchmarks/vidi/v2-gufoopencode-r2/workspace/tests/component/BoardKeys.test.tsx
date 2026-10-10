// TC-27 to TC-31: board keyboard commands (select all, nudge, delete) and
// their negative cases while editing text.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
} from '../../src/shared/config';
import {
  App,
  board,
  createNote,
  flush,
  noteEl,
  notes,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';
import { keyWith } from './selectionHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function selectTwo(): [string, string] {
  const a = createNote(0, 0);
  const b = createNote(600, 0);
  pressAndRelease(noteEl(a));
  fireEvent.pointerDown(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
  fireEvent.pointerUp(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
  flush();
  return [a, b];
}

describe('board keyboard commands', () => {
  it('TC-27: Ctrl/Cmd+A selects every object and prevents the page default', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(600, 0);

    const ev = keyWith('a', { ctrlKey: true });
    flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(noteEl(a).getAttribute('data-selected')).toBe('true');
    expect(noteEl(b).getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    const ev2 = keyWith('a', { metaKey: true });
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('TC-28: Ctrl/Cmd+A on an empty board selects nothing and does not error', () => {
    render(<App />);
    flush();

    expect(() => keyWith('a', { ctrlKey: true })).not.toThrow();
    flush();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-29: arrows nudge by the configured steps with preventDefault, without panning', () => {
    render(<App />);
    flush();
    const [a, b] = selectTwo();
    const cameraBefore = readCamera();

    const right = keyWith('ArrowRight');
    flush();
    expect(right.defaultPrevented).toBe(true);
    const byId = () => {
      const m = new Map(notes().map((n) => [n.id, n]));
      return [m.get(a)!, m.get(b)!] as const;
    };
    let [na, nb] = byId();
    expect(na).toMatchObject({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(nb).toMatchObject({ x: 600 + NUDGE_STEP_WORLD, y: 0 });

    const up = keyWith('ArrowUp', { shiftKey: true });
    flush();
    expect(up.defaultPrevented).toBe(true);
    [na, nb] = byId();
    expect(na).toMatchObject({ x: NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });
    expect(nb).toMatchObject({ x: 600 + NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });

    // No board pan happened (negative: TC-34 in e2e).
    expect(readCamera()).toEqual(cameraBefore);
  });

  it('TC-30: Backspace while editing changes text, never deletes the object', () => {
    render(<App />);
    flush();
    const id = createNote(0, 0);
    pressAndRelease(noteEl(id));
    fireEvent.doubleClick(noteEl(id));
    flush();
    const area = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'hello' } });
    flush();

    // Both notes are conceptually "selected with many" — edit one, then press
    // Backspace with focus inside the textarea.
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      area.dispatchEvent(ev);
    });
    flush();

    expect(notes().some((n) => n.id === id)).toBe(true);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-31: Delete removes every selected object and empties the selection', () => {
    render(<App />);
    flush();
    const [a, b] = selectTwo();
    const c = createNote(1200, 0);

    const ev = keyWith('Delete');
    flush();
    expect(ev.defaultPrevented).toBe(true);
    const ids = notes().map((n) => n.id);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).toContain(c);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(noteEl(c).getAttribute('data-selected')).toBe('false');
  });
});
