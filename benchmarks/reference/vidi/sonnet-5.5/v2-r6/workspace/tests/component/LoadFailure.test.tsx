import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardApp, canEdit } from '../../src/client/App';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { click, drag, moveTo, noteEl, press, release } from './board';

class FakeProvider implements ProviderLike {
  private status: ((e: { status: 'connecting' | 'connected' | 'disconnected' }) => void)[] = [];
  private sync: ((s: boolean) => void)[] = [];
  private close: ((e: { code: number } | null) => void)[] = [];
  on(event: 'status' | 'sync' | 'connection-close', cb: never): void {
    (event === 'status' ? this.status : event === 'sync' ? this.sync : this.close).push(cb);
  }
  emitConnected() { act(() => { this.status.forEach((cb) => cb({ status: 'connected' })); this.sync.forEach((cb) => cb(true)); }); }
  emitClose(code: number) {
    act(() => {
      this.sync.forEach((cb) => cb(false));
      this.close.forEach((cb) => cb({ code }));
      this.status.forEach((cb) => cb({ status: 'disconnected' }));
    });
  }
  destroy() {}
}

describe('TC-22: load_failed badge', () => {
  it('shows red text with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('This board couldn\'t be loaded. Retrying…');
    expect(badge.className).toContain('connection-status--load_failed');
  });
});

describe('TC-23: nothing is editable while the board could not be loaded', () => {
  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed'];
    for (const s of states) expect(canEdit(s)).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });

  it('makes no model mutations from any gesture', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 }) as string;
    const board = { doc, notes: snapshot(doc), connection: 'load_failed' as const };
    render(<BoardApp board={board} />);
    let updates = 0;
    doc.on('update', () => { updates += 1; });

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport, { clientX: 100, clientY: 100 });
    const add = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await userEvent.click(add);

    const note = noteEl(id);
    click(note, 310, 310);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(note, { key: 'Delete' });
    await drag(note, [310, 310], [500, 500]);
    fireEvent.doubleClick(note);
    fireEvent.keyDown(note, { key: 'Enter' });
    press(note, 310, 310);
    moveTo(note, 400, 400);
    release(note, 400, 400);

    expect(screen.queryByRole('textbox', { name: 'Note text' })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Note toolbar' })).toBeNull();
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('TC-28: close-code mapping', () => {
  function Harness({ provider }: { provider: FakeProvider }) {
    const [state, setState] = useState<ConnectionState>('connecting');
    const [doc] = useState(() => { const d = new Y.Doc(); initDoc(d); return d; });
    useState(() => connectBoard(doc, 'b', setState, () => provider));
    return <BoardApp board={{ doc, notes: [], connection: state }} />;
  }
  const status = () => screen.queryByTestId('connection-status')?.textContent ?? null;
  const addDisabled = () => (screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement).disabled;

  it('4500 -> load_failed, then a successful sync -> connected and editable (no reload)', () => {
    const p = new FakeProvider();
    render(<Harness provider={p} />);
    p.emitClose(CLOSE_BOARD_LOAD_FAILED);
    expect(status()).toBe('This board couldn\'t be loaded. Retrying…');
    expect(addDisabled()).toBe(true);
    p.emitClose(CLOSE_BOARD_LOAD_FAILED); // a retry fails again: still the same message
    expect(status()).toBe('This board couldn\'t be loaded. Retrying…');
    p.emitConnected();
    expect(status()).toBeNull();
    expect(addDisabled()).toBe(false);
  });

  for (const code of [CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA]) {
    it(`${code} -> reconnecting, editing stays enabled`, () => {
      const p = new FakeProvider();
      render(<Harness provider={p} />);
      p.emitConnected();
      p.emitClose(code);
      expect(status()).toBe('Reconnecting…');
      expect(addDisabled()).toBe(false);
    });
  }
});
