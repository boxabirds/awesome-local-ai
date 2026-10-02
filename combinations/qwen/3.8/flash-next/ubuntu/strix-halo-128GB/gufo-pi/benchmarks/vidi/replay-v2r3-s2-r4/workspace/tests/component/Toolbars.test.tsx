import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import { Toolbar, STICKY_NOTE_TOOLTIP } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import type { Vidi6TestHooks } from '../../src/client/canvas/testHooks';
import type { StickySnapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';

function hooks(): Vidi6TestHooks {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks are not registered');
  return h;
}

const objects = (): readonly StickySnapshot[] => hooks().getObjects();
const selection = () => hooks().getSelection();

function noteEl(id?: string): HTMLElement {
  const els = screen.getAllByTestId('sticky-note');
  if (!id) return els[els.length - 1]!;
  const el = els.find((e) => e.getAttribute('data-note-id') === id);
  if (!el) throw new Error(`note element ${id} is not rendered`);
  return el;
}

function dblClickBoard(x: number, y: number): string {
  fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: x, clientY: y });
  const all = objects();
  return all[all.length - 1]!.id;
}

function emptyClick(x = 20, y = 20): void {
  fireEvent.pointerDown(screen.getByTestId('board-viewport'), { clientX: x, clientY: y, pointerId: 9 });
  fireEvent.pointerUp(screen.getByTestId('board-viewport'), { clientX: x, clientY: y, pointerId: 9 });
}

function selectNote(id: string): void {
  const el = noteEl(id);
  fireEvent.pointerDown(el, { clientX: 350, clientY: 250, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 350, clientY: 250, pointerId: 1 });
}

function createIdleNote(x = 300, y = 200): string {
  const id = dblClickBoard(x, y);
  emptyClick();
  return id;
}

describe('sticky.toolbar: left toolbar', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport centre, editing', () => {
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe(STICKY_NOTE_TOOLTIP);
    expect(STICKY_NOTE_TOOLTIP).toBe('Sticky note – or double-click the board');

    fireEvent.click(button);

    expect(objects()).toHaveLength(1);
    const note = objects()[0]!;
    const centreX = window.innerWidth / 2;
    const centreY = window.innerHeight / 2;
    expect(note.x).toBeCloseTo(centreX - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centreY - STICKY_SIZE_WORLD / 2, 6);
    expect(note.color).toBe('yellow');
    expect(selection().editingId).toBe(note.id);
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();
  });

  it('TC-28b: the button uses the accessible name and tooltip', () => {
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute('title', 'Sticky note – or double-click the board');
  });

  it('the button works repeatedly and keeps stacking notes on top', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    emptyClick();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = objects();
    expect(notes).toHaveLength(2);
    expect(notes[1]!.z).toBeGreaterThan(notes[0]!.z);
  });
});

describe('sticky.toolbar: note toolbar', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-27: clicking the Pink swatch recolours the note and keeps text, position and selection', () => {
    const id = createIdleNote();
    const editorLaunch = noteEl(id);
    fireEvent.doubleClick(editorLaunch, { clientX: 300, clientY: 200 });
    fireEvent.input(screen.getByTestId('sticky-editor'), { target: { value: 'Faster onboarding' } });
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });

    const before = objects()[0]!;
    selectNote(id);

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));

    const after = objects().find((n) => n.id === id)!;
    expect(after.color).toBe('pink');
    expect(after.text).toBe('Faster onboarding');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(selection()).toEqual({ selectedId: id, editingId: null });
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('TC-27b: all six swatches are named, not only coloured', () => {
    const id = createIdleNote();
    selectNote(id);

    const names: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    for (const name of names) {
      const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} colour`;
      const swatch = screen.getByRole('button', { name: label });
      expect(swatch).toHaveAttribute('title', label);
      expect(swatch).toHaveAttribute('aria-pressed', name === 'yellow' ? 'true' : 'false');
    }
    expect(screen.getByTestId('note-toolbar').querySelectorAll('.note-toolbar-swatch')).toHaveLength(6);
  });

  it('TC-29: the bin button deletes the note and clears the selection', () => {
    const id = createIdleNote();
    selectNote(id);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(objects()).toHaveLength(0);
    expect(selection()).toEqual({ selectedId: null, editingId: null });
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('clicking the note toolbar does not clear the selection', () => {
    const id = createIdleNote();
    selectNote(id);

    fireEvent.pointerDown(screen.getByTestId('note-toolbar'), { clientX: 300, clientY: 60, pointerId: 4 });
    fireEvent.pointerUp(screen.getByTestId('note-toolbar'), { clientX: 300, clientY: 60, pointerId: 4 });

    expect(selection().selectedId).toBe(id);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('the toolbar is hidden while editing and while dragging', () => {
    const id = dblClickBoard(300, 200);
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // editing

    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument(); // selected

    const el = noteEl(id);
    fireEvent.pointerDown(el, { clientX: 350, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 380, clientY: 250, pointerId: 1 });
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // dragging

    fireEvent.pointerUp(el, { clientX: 380, clientY: 250, pointerId: 1 });
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('the note toolbar only appears for the selected note', () => {
    createIdleNote(150, 150);
    const second = createIdleNote(700, 500);

    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(0);
    selectNote(second);
    expect(screen.queryAllByTestId('note-toolbar')).toHaveLength(1);
  });
});

describe('sticky.toolbar: components in isolation', () => {
  it('Toolbar renders the Sticky note button with its tooltip', () => {
    const onCreateSticky = () => undefined;
    render(<Toolbar onCreateSticky={onCreateSticky} />);
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toHaveAttribute('title', 'Sticky note – or double-click the board');
  });

  it('NoteToolbar reports colour choices and delete', () => {
    const colours: StickyColor[] = [];
    let deletes = 0;
    render(<NoteToolbar color="blue" onColor={(c) => colours.push(c)} onDelete={() => (deletes += 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Green colour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(colours).toEqual(['green']);
    expect(deletes).toBe(1);
    expect(screen.getByRole('button', { name: 'Blue colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(Object.keys(STICKY_COLORS)).toHaveLength(6);
  });
});
