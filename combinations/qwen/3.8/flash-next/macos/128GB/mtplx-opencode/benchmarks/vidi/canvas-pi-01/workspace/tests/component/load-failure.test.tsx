/**
 * Story 4 · component tests for the load-failure state (TC-22, TC-23).
 *
 * Two halves: the badge (`ConnectionStatus`) must say, in words, that the board
 * could not be loaded; and while that state shows, the board must be *read
 * only*. The second half is written as a pair — every locked interaction is
 * also run with a healthy connection — so a passing test proves the gate is
 * doing the work, not a broken harness.
 *
 * `BoardShell` takes the connection state as a prop, so no server or provider
 * is involved: the same `canEdit` gate the live app uses is driven directly.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell, canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectionState';
import { dblclick, key, pointer, seedDoc } from './helpers';

const VIEWPORT = { width: 800, height: 600 };

/** A Ctrl/Cmd zoom shortcut (the board-level navigation keys). */
function zoomKey(keyName: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: keyName,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

/** Exact PRD/design copy for the read-only badge. */
const LOAD_FAILED_TEXT = 'This board couldn\u2019t be loaded. Retrying…';

beforeEach(() => {
  cleanup();
});

function renderBoard(doc: Y.Doc, state: ConnectionState) {
  return render(<BoardShell viewport={VIEWPORT} doc={doc} connectionState={state} />);
}

function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`note-${id}`) as HTMLElement;
}

/** Any document mutation at all: the thing the lock must prevent. */
function fingerprint(doc: Y.Doc): string {
  return JSON.stringify(Y.encodeStateAsUpdate(doc));
}

function positionOf(id: string): string | null {
  return noteEl(id).getAttribute('data-x');
}

describe('load-failure badge (TC-22)', () => {
  it('shows the red "could not be loaded" message as a status region', () => {
    const { container } = render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe(LOAD_FAILED_TEXT);
    expect(badge.getAttribute('data-state')).toBe('load_failed');
    expect(badge.getAttribute('aria-live')).toBe('polite');
    // Red is a stylesheet concern; the hook the stylesheet keys on is here.
    expect(container.querySelector('.connection-status--load_failed')).not.toBeNull();
  });

  it('is inert: it carries no pointer events, so it cannot cover the board', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    // The class that styles it also sets `pointer-events: none` (styles.css);
    // in the DOM the badge is a plain status region with no interactive child.
    expect(badge.tagName).toBe('DIV');
    expect(badge.querySelector('button, a, input, textarea')).toBeNull();
  });

  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = [
      'connecting',
      'connected',
      'reconnecting',
      'confirmed',
      'load_failed',
    ];
    expect(states.filter((state) => !canEdit(state))).toEqual(['load_failed']);
  });
});

describe('read-only board in load_failed (TC-23)', () => {
  const NOTES = [
    { id: 'seed-a', centre: { x: 300, y: 300 }, text: 'first' },
    { id: 'seed-b', centre: { x: 600, y: 300 }, text: 'second' },
  ];

  it('the Sticky note button is disabled', () => {
    const { doc } = seedDoc(NOTES);
    renderBoard(doc, 'load_failed');
    const button = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('double-clicking the board, the button, and Delete change nothing', () => {
    const { doc, ids } = seedDoc(NOTES);
    renderBoard(doc, 'load_failed');
    const before = fingerprint(doc);

    fireEvent(screen.getByTestId('board-viewport'), dblclick(400, 300));
    fireEvent.click(screen.getByTestId('create-sticky'));
    // And the keyboard route to the same two actions.
    window.dispatchEvent(key('Enter'));
    window.dispatchEvent(key('Delete'));

    expect(fingerprint(doc)).toBe(before);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(ids.length);
  });

  it('a note cannot be picked up, recoloured or opened for editing', () => {
    const { doc, ids } = seedDoc(NOTES);
    renderBoard(doc, 'load_failed');
    const [a] = ids;
    const before = fingerprint(doc);
    const note = noteEl(a);
    const xBefore = positionOf(a);
    expect(note.getAttribute('data-editable')).toBe('false');

    // Drag well past the threshold: no move, no raise.
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 520, 300));
    fireEvent(note, pointer('pointerup', 520, 300));
    expect(positionOf(a)).toBe(xBefore);
    expect(note.getAttribute('data-phase')).toBe('idle');
    // No selection therefore no note toolbar, so no swatch and no delete.
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(screen.queryAllByTestId(/swatch/).length).toBe(0);

    // Double-click does not open the editor either.
    fireEvent(note, dblclick(300, 300));
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(fingerprint(doc)).toBe(before);
  });

  it('zoom and panning still work: only editing is locked', async () => {
    const { doc, ids } = seedDoc(NOTES);
    renderBoard(doc, 'load_failed');
    const before = fingerprint(doc);
    const viewport = screen.getByTestId('board-viewport');
    const cameraBefore = screen.getByTestId('world-layer').getAttribute('data-camera');

    // Pan with a drag of the board surface (three steps: past the threshold).
    fireEvent(viewport, pointer('pointerdown', 400, 300));
    fireEvent(viewport, pointer('pointermove', 340, 260));
    fireEvent(viewport, pointer('pointermove', 300, 200));
    fireEvent(viewport, pointer('pointerup', 300, 200));
    await waitFor(() => {
      expect(screen.getByTestId('world-layer').getAttribute('data-camera')).not.toBe(
        cameraBefore,
      );
    });

    window.dispatchEvent(zoomKey('='));
    await waitFor(() => {
      const [, , zoom] =
        (screen.getByTestId('world-layer').getAttribute('data-camera') ?? '').split(',').map(Number);
      expect(zoom).toBeGreaterThan(1);
    });

    expect(fingerprint(doc)).toBe(before);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(ids.length);
  });
});

describe('the same interactions with a healthy connection (control)', () => {
  const NOTES = [
    { id: 'seed-a', centre: { x: 300, y: 300 }, text: 'first' },
    { id: 'seed-b', centre: { x: 600, y: 300 }, text: 'second' },
  ];

  it('double-click, the button, drag and Delete all mutate the board', () => {
    const { doc, ids } = seedDoc(NOTES);
    renderBoard(doc, 'connected');
    const button = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent(screen.getByTestId('board-viewport'), dblclick(400, 300));
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(ids.length + 1);

    fireEvent.click(button);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(ids.length + 2);
  });

  it('a note can be dragged, and deleted once selected', () => {
    const { doc, ids } = seedDoc(NOTES);
    renderBoard(doc, 'connected');
    const [a] = ids;
    const note = noteEl(a);

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 520, 300));
    fireEvent(note, pointer('pointerup', 520, 300));
    expect(Number(positionOf(a))).toBeGreaterThan(300);

    // Re-select and delete it with the keyboard.
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
    expect(note.getAttribute('data-selected')).toBe('true');
    window.dispatchEvent(key('Delete'));
    expect(doc.getMap<Y.Map<unknown>>('objects').has(a)).toBe(false);
  });

  it('a selected note keeps its toolbar, and loses it when the board locks', () => {
    const { doc, ids } = seedDoc(NOTES);
    const [a] = ids;
    const tree = (state: ConnectionState) => (
      <BoardShell viewport={VIEWPORT} doc={doc} connectionState={state} />
    );
    const { rerender } = render(tree('connected'));
    const note = noteEl(a);
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
    expect(screen.queryAllByTestId(/swatch/).length).toBeGreaterThan(0);
    const colourBefore = doc
      .getMap<Y.Map<unknown>>('objects')
      .get(a)
      ?.get('color') as string;

    // The connection drops into load_failed while the note is selected…
    rerender(tree('load_failed'));
    // …the toolbar is gone, and with it every colour / delete affordance.
    expect(screen.queryAllByTestId(/swatch/).length).toBe(0);
    expect(
      doc.getMap<Y.Map<unknown>>('objects').get(a)?.get('color') as string,
    ).toBe(colourBefore);
  });
});
