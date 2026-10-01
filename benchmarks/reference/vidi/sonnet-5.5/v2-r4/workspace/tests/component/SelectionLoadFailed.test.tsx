import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: Y.Doc, _id: string, onState: (s: string) => void) => {
    onState('load_failed');
    return { destroy() {} };
  },
}));

import { App } from '../../src/client/App';
import { frame, noteEls } from './helpers';

afterEach(cleanup);

describe('selection on a board that failed to load', () => {
  it('can select for viewing, but move, resize, nudge and delete do nothing', async () => {
    const doc = new Y.Doc();
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 400, y: 0 })];
    render(<App doc={doc} boardId="abc" />);
    const updates: unknown[] = [];
    doc.on('update', (u: unknown) => updates.push(u));
    const before = JSON.stringify(snapshot(doc));

    act(() => {
      fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete selection' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Resize/ })).toBeNull();

    fireEvent.pointerDown(noteEls()[0], { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(noteEls()[0], { clientX: 300, clientY: 100, pointerId: 1 });
    await frame();
    fireEvent.pointerUp(noteEls()[0], { clientX: 300, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'Delete' });
    });
    expect(updates).toHaveLength(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
    expect(ids).toHaveLength(2);
  });
});
