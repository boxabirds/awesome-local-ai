/**
 * toolbar component tests (TC-27 to TC-29): the note toolbar and the left board toolbar.
 * Their appearance at other zoom levels is covered by the e2e suite (TC-40).
 */
import { act, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, getCamera, runFrames } from './helpers';
import { screenToWorld } from '../../src/client/canvas/camera';
import { createSticky, getStickyText, type StickySnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_NOTE } from '../fixtures/texts';

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function notes(): readonly StickySnapshot[] {
  return window.__vidi6?.getNotes() ?? [];
}

function note(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

async function addNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  return id;
}

async function selectNote(id: string): Promise<void> {
  const element = note(id);
  fireEvent.pointerDown(element, {
    pointerId: 5,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerUp(element, { pointerId: 5, clientX: 200, clientY: 200 });
  await runFrames();
}

describe('toolbar.note', () => {
  test('TC-27 choosing a colour recolours the note and changes nothing else', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    await act(() => {
      getStickyText(doc(), id)?.insert(0, SHORT_NOTE);
    });
    const before = notes().find((item) => item.id === id);
    await selectNote(id);

    fireEvent.click(within(note(id)).getByLabelText('Pink colour'));
    await runFrames();

    const after = notes().find((item) => item.id === id);
    expect(after?.color).toBe('pink');
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    expect(after?.text).toBe(SHORT_NOTE);
    // the note is still selected and the new colour is pressed
    expect(note(id)).toHaveAttribute('data-selected', 'true');
    expect(within(note(id)).getByLabelText('Pink colour')).toHaveAttribute('aria-pressed', 'true');
    expect(within(note(id)).getByLabelText('Yellow colour')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('TC-29 the bin removes the note and clears the selection', async () => {
    renderBoard();
    const keep = await addNote(500, 0);
    const doomed = await addNote(0, 0);
    await selectNote(doomed);

    fireEvent.click(within(note(doomed)).getByLabelText('Delete note'));
    await runFrames();

    expect(notes().map((item) => item.id)).toEqual([keep]);
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
  });

  test('pressing a toolbar button does not deselect the note', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    await selectNote(id);

    // a real click arrives as pointerdown, pointerup and click; none may reach the board
    const swatch = within(note(id)).getByLabelText('Green colour');
    fireEvent.pointerDown(swatch, { pointerId: 6, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(swatch, { pointerId: 6, clientX: 10, clientY: 10 });
    fireEvent.click(swatch);
    await runFrames();

    expect(note(id)).toHaveAttribute('data-selected', 'true');
    expect(notes().find((item) => item.id === id)?.color).toBe('green');
  });
});

describe('toolbar.board', () => {
  test('TC-28 the Sticky note button creates one note in the middle of the view', async () => {
    const { container } = renderBoard();
    const button = screen.getByTestId('create-sticky-button');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    await runFrames();

    const created = notes();
    expect(created).toHaveLength(1);
    // the viewport centre (1024x768 in jsdom, camera at the initial pose) is world (0, 0),
    // and a new note is centred on the point it was created at
    const centre = screenToWorld(getCamera(), {
      x: (container.clientWidth || window.innerWidth) / 2,
      y: (container.clientHeight || window.innerHeight) / 2,
    });
    expect(created[0]?.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(created[0]?.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // and the user can type straight away
    expect(screen.getByTestId('sticky-note-input')).toHaveFocus();
  });

  test('the Sticky note button has the documented accessible name and description', () => {
    renderBoard();
    const button = screen.getByTestId('create-sticky-button');
    expect(button).toHaveAccessibleName('Sticky note (N)');
    expect(button).toHaveAttribute('title', 'Sticky note (N) – or double-click the board');
  });

  test('the two tool buttons have the documented names and the Select one is on', () => {
    renderBoard();
    const select = screen.getByRole('button', { name: 'Select (V)' });
    const text = screen.getByRole('button', { name: 'Text (T)' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(text).toHaveAttribute('aria-pressed', 'false');
    expect(text).toHaveAttribute('title', 'Text (T) – click the board to write');
  });
});
