import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { Harness, addNote, flush, moveTo, newProbe, notes, press, release, viewport } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(zoom = 1) {
  const probe = newProbe();
  render(<Harness probe={probe} zoom={zoom} />);
  const id = addNote(probe, 'Faster onboarding');
  return { probe, id, el: () => notes()[0] };
}

function pos(probe: { doc: import('yjs').Doc }) {
  const n = snapshot(probe.doc)[0];
  return { x: n.x, y: n.y };
}

describe('StickyNote interaction', () => {
  it('TC-18 click selects: outline attribute and note toolbar', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    const note = notes()[0];
    expect(note.dataset.selected).toBe('true');
    fireEvent.pointerDown(viewport(), { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(notes()[0].dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    press(notes()[0], 10, 10);
    release(notes()[0], 10, 10);
    expect(notes()[0].dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
  });

  it('TC-19 a 2px move does not drag', () => {
    const { probe, el } = setup();
    const before = pos(probe);
    press(el(), 10, 10);
    moveTo(el(), 12, 10);
    flush();
    release(el(), 12, 10);
    expect(probe.selectedId).not.toBeNull();
    expect(pos(probe)).toEqual(before);
  });

  it('TC-20 a 3px move drags by delta / zoom', () => {
    const { probe, el } = setup(2);
    const before = pos(probe);
    press(el(), 10, 10);
    moveTo(el(), 13, 10);
    flush();
    expect(pos(probe)).toEqual({ x: before.x + 1.5, y: before.y });
    release(el(), 13, 10);
    expect(probe.selectedId).not.toBeNull();
  });

  it('TC-20 note drag never reaches the board pan handler', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const transform = () => screen.getByTestId('board-world').style.transform;
    const before = transform();
    const note = notes()[0];
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    press(note, 10, 10);
    moveTo(note, 80, 60);
    flush();
    release(note, 80, 60);
    expect(transform()).toBe(before);
    expect(viewport().dataset.mode).toBe('idle');
  });

  it('dragging brings the note to the front', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, 'a');
    addNote(probe, 'b');
    press(notes()[0], 0, 0);
    moveTo(notes()[0], 10, 10);
    flush();
    release(notes()[0], 10, 10);
    const order = snapshot(probe.doc).map((n) => n.id);
    expect(order[order.length - 1]).toBe(a);
  });

  it('TC-21 pointercancel keeps the last applied position', () => {
    const { probe, el } = setup();
    press(el(), 0, 0);
    moveTo(el(), 20, 0);
    flush();
    const at = pos(probe);
    fireEvent.pointerCancel(el(), { pointerId: 1 });
    moveTo(el(), 90, 90);
    flush();
    expect(pos(probe)).toEqual(at);
    expect(probe.selectedId).not.toBeNull();
  });

  it('TC-25 Delete and Backspace remove the selected note', () => {
    for (const key of ['Delete', 'Backspace']) {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
      expect(notes()).toHaveLength(1);
      fireEvent.keyDown(window, { key });
      expect(notes()).toHaveLength(0);
      cleanup();
    }
  });

  it('TC-35 dblclick on a note edits it and creates nothing', () => {
    const { el } = setup();
    fireEvent.doubleClick(el());
    expect(notes()).toHaveLength(1);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('dblclick on empty board creates and edits a note', () => {
    render(<App />);
    fireEvent.doubleClick(viewport(), { clientX: 300, clientY: 200 });
    expect(notes()).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(notes()).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 note deleted while dragging ends silently', () => {
    const { probe, el } = setup();
    press(el(), 0, 0);
    moveTo(el(), 20, 0);
    flush();
    act(() => {
      deleteObject(probe.doc, snapshot(probe.doc)[0].id);
    });
    expect(notes()).toHaveLength(0);
    expect(() => flush()).not.toThrow();
    expect(snapshot(probe.doc)).toHaveLength(0);
  });

  it('TC-37 note deleted while editing ends silently', () => {
    const { probe, el } = setup();
    fireEvent.doubleClick(el());
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => {
      deleteObject(probe.doc, snapshot(probe.doc)[0].id);
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(snapshot(probe.doc)).toHaveLength(0);
  });
});
