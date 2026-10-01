import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';

let connectionState = 'load_failed';
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: Y.Doc, _id: string, onState: (s: string) => void) => {
    onState(connectionState);
    return { destroy() {} };
  },
}));

import { App, canEdit } from '../../src/client/App';
import { click, noteEl, pointerDown, pointerMove, pointerUp, viewport, frame } from './helpers';

afterEach(cleanup);

function renderBoard(state: string) {
  connectionState = state;
  const doc = new Y.Doc();
  createSticky(doc, { x: 0, y: 0 });
  render(<App doc={doc} boardId="abc" />);
  const updates: unknown[] = []; // after render: App's own initDoc writes the schema version
  doc.on('update', (u: unknown) => updates.push(u));
  return { doc, updates };
}

describe('canEdit', () => {
  it('is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    for (const s of ['connecting', 'connected', 'reconnecting', 'confirmed'] as const) expect(canEdit(s)).toBe(true);
  });
});

describe('TC-23: a board that failed to load cannot be edited', () => {
  it('shows the message and makes no model mutation', async () => {
    const { doc, updates } = renderBoard('load_failed');
    expect(screen.getByText("This board couldn't be loaded. Retrying…").getAttribute('role')).toBe('status');
    const before = JSON.stringify(snapshot(doc));

    fireEvent.doubleClick(viewport(), { clientX: 300, clientY: 300 });
    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    click(noteEl());
    fireEvent.keyDown(window, { key: 'Delete' });
    pointerDown(noteEl(), 100, 100);
    pointerMove(noteEl(), 200, 160);
    await frame();
    pointerUp(noteEl(), 200, 160);
    fireEvent.doubleClick(noteEl());

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pink colour' })).toBeNull();
    expect(updates).toHaveLength(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
  });

  it('control: the same actions do edit when connected', () => {
    const { doc, updates } = renderBoard('connected');
    fireEvent.doubleClick(viewport(), { clientX: 300, clientY: 300 });
    expect(snapshot(doc)).toHaveLength(2);
    expect(updates.length).toBeGreaterThan(0);
  });
});
