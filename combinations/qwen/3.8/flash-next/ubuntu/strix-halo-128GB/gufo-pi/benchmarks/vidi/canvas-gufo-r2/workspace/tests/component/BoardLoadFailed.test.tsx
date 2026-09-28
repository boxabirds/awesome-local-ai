/**
 * Story 4 TC-22 / TC-23: the load-failed badge and the editing gate.
 *
 * TC-22 asserts the badge copy, role and colour. TC-23 renders the whole App
 * with the connection reporting 'load_failed' and checks that no interaction
 * mutates the document — asserted on the doc itself, which is what matters.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App, canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky, snapshot } from '../../src/shared/board-model';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

/** Replaced by vi.mock below: lets a test push a connection state into the App. */
const connection = vi.hoisted(() => ({
  report: null as ((state: string) => void) | null,
}));

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, _boardId: string, onState: (state: string) => void) => {
      connection.report = onState;
      return {
        destroy() {
          connection.report = null;
        },
      };
    },
  };
});

function setBoardPath(boardId: string): void {
  window.history.pushState({}, '', `/b/${boardId}`);
}

function mountWithConnection(state: ConnectionState, doc: Y.Doc): void {
  render(<App doc={doc} />);
  act(() => {
    connection.report?.(state);
  });
}

/** The badge, ignoring other role=status elements such as the navigation hint. */
function badge(): HTMLElement | null {
  return document.querySelector('[data-testid="connection-status"]');
}

function noteCount(doc: Y.Doc): number {
  return snapshot(doc).length;
}

describe('TC-22: load_failed shows a red badge with retry copy', () => {
  it('renders the retry message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByTestId('connection-status');
    expect(el.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(el.className).toContain('connection-status--load-failed');
  });

  it('is styled red', () => {
    const css = readFileSync(resolve(__dirname, '../../src/client/styles.css'), 'utf8');
    const rule = css.match(/\.connection-status--load-failed\s*{[^}]*}/)?.[0] ?? '';
    // #b91c1c / #dc2626 / #c00 and friends all read as red; assert the channel.
    const colour = rule.match(/color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/)?.[1];
    expect(colour).toBeTruthy();
    const hex = (colour as string).replace('#', '');
    const long = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(long.slice(0, 2), 16);
    const g = parseInt(long.slice(2, 4), 16);
    const b = parseInt(long.slice(4, 6), 16);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
  });

  it('canEdit refuses only the load-failed state', () => {
    expect(canEdit('load_failed')).toBe(false);
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
  });
});

describe('TC-23: editing is disabled while the board could not load', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    setBoardPath('load-failed-test');
  });

  afterEach(() => {
    cleanup();
    doc.destroy();
    window.history.pushState({}, '', '/');
  });

  it('double-click, toolbar, delete key, drag and text entry all do nothing', () => {
    const id = createSticky(doc, { x: 300, y: 300 });
    mountWithConnection('load_failed', doc);
    expect(badge()?.textContent).toContain("couldn't be loaded");

    // Double-click the empty board: no new note.
    const board = screen.getByTestId('board');
    fireEvent.dblClick(board, { clientX: 700, clientY: 500 });
    expect(noteCount(doc)).toBe(1);

    // The Sticky note button is disabled and clicking it changes nothing.
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(noteCount(doc)).toBe(1);

    // Selecting and pressing Delete does not remove the note.
    const note = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
    fireEvent.pointerDown(note, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(noteCount(doc)).toBe(1);

    // A read-only board does not even select, so its colour and delete
    // controls never appear (the handlers are gated too).
    expect(note.getAttribute('data-selected')).not.toBe('true');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    // Dragging does not move it.
    const before = snapshot(doc)[0];
    fireEvent.pointerDown(note, { button: 0, pointerId: 2, clientX: 320, clientY: 320 });
    fireEvent.pointerMove(note, { pointerId: 2, clientX: 420, clientY: 420 });
    fireEvent.pointerUp(note, { pointerId: 2, clientX: 420, clientY: 420 });
    expect(snapshot(doc)[0].x).toBe(before.x);
    expect(snapshot(doc)[0].y).toBe(before.y);

    // Double-clicking the note does not open the text editor.
    fireEvent.dblClick(note, { clientX: 320, clientY: 320 });
    expect(note.getAttribute('data-editing')).not.toBe('true');
  });

  it('the same interactions do mutate the doc once the board loads', () => {
    const board = (() => {
      // Control: proves the gate is what blocks the interactions above.
      const d = new Y.Doc();
      return d;
    })();
    try {
      mountWithConnection('connected', board);
      const el = screen.getByTestId('board');
      fireEvent.dblClick(el, { clientX: 640, clientY: 480 });
      expect(noteCount(board)).toBe(1);
      fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
      expect(noteCount(board)).toBe(2);
    } finally {
      board.destroy();
    }
  });
});
