import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStickyColor, snapshot } from '../../src/shared/board-model';
import { Harness, addNote, flush, moveTo, newProbe, press, release } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const el = (id: string) => document.querySelector(`[data-note-id="${id}"]`)!;
const pos = (probe: { doc: import('yjs').Doc }, id: string) => {
  const o = snapshot(probe.doc).find((n) => n.id === id)!;
  return { x: o.x, y: o.y };
};

function drag(id: string, frames = 30) {
  press(el(id), 0, 0);
  for (let i = 1; i <= frames; i++) {
    moveTo(el(id), i * 3, i * 2);
    flush();
  }
  release(el(id), frames * 3, frames * 2);
}

describe('undo.boundaries', () => {
  it('TC-14 a 30-frame drag of a selection is one undo step', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    const b = addNote(probe, '', { x: 400, y: 100 });
    probe.undo.boundary();
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    const start = { a: pos(probe, a), b: pos(probe, b) };
    drag(a);
    expect(pos(probe, a).x).toBe(start.a.x + 90);
    act(() => {
      probe.undo.undo();
    });
    expect(pos(probe, a)).toEqual(start.a);
    expect(pos(probe, b)).toEqual(start.b);
  });

  it('TC-15 a drag and a colour change shortly after are separate steps', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    probe.undo.boundary();
    const start = pos(probe, a);
    drag(a, 5);
    vi.advanceTimersByTime(200);
    probe.undo.boundary();
    act(() => {
      setStickyColor(probe.doc, a, 'pink');
    });
    act(() => {
      probe.undo.undo();
    });
    expect(snapshot(probe.doc)[0].color).toBe('yellow');
    expect(pos(probe, a).x).toBe(start.x + 15);
    act(() => {
      probe.undo.undo();
    });
    expect(pos(probe, a)).toEqual(start);
  });

  it('TC-16 Ctrl+Z inside the editor undoes typing, not the earlier move', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    probe.undo.boundary();
    drag(a, 5);
    const moved = pos(probe, a);
    fireEvent.doubleClick(el(a));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: 'hel' } });
    vi.advanceTimersByTime(50);
    fireEvent.input(box, { target: { value: 'hello' } });
    expect(snapshot(probe.doc)[0].text).toBe('hello');
    const notPrevented = fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(snapshot(probe.doc)[0].text).toBe('');
    expect(box.value).toBe('');
    expect(pos(probe, a)).toEqual(moved);
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(snapshot(probe.doc)[0].text).toBe('hello');
  });

  it('TC-17 a cancelled drag is still one step restoring the start position', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    probe.undo.boundary();
    const start = pos(probe, a);
    press(el(a), 0, 0);
    for (let i = 1; i <= 10; i++) {
      moveTo(el(a), i * 4, 0);
      flush();
    }
    fireEvent.pointerCancel(el(a), { pointerId: 1 });
    expect(probe.gestureEnds).toBe(1);
    // The last frame may or may not have run before the cancel; the partial drag is what matters.
    expect(pos(probe, a).x).toBeGreaterThan(start.x);
    act(() => {
      probe.undo.undo();
    });
    expect(pos(probe, a)).toEqual(start);
  });
});
