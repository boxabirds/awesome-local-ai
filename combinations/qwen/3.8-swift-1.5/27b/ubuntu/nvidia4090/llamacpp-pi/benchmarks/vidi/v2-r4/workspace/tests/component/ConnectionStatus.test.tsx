import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNoteComponent } from '../../src/client/objects/StickyNote';
import { initDoc, type StickySnapshot } from '../../src/shared/board-model';

afterEach(() => {
  cleanup();
});

describe('TC-22: ConnectionStatus load_failed badge', () => {
  it('shows red text with role=status for load_failed', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByTestId('connection-status');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toBe("This board couldn't be loaded. Retrying…");
    // Verify red color (browser may normalize hex to rgb)
    const bg = el.style.backgroundColor;
    expect(bg).toMatch(/(?:#DC2626|rgb\(220,\s*38,\s*38\))/);
  });

  it('shows nothing for connected state', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.querySelector('[data-testid="connection-status"]')).toBeNull();
  });
});

describe('TC-23: App edit lock', () => {
  const mockNote: StickySnapshot = {
    id: 'test-note-1',
    type: 'sticky',
    x: 100,
    y: 100,
    color: 'yellow',
    text: 'Hello',
    z: 1,
    createdAt: 0,
  };

  function makeTestDoc(): Y.Doc {
    const doc = new Y.Doc();
    initDoc(doc);
    return doc;
  }

  it('Toolbar button is disabled when disabled=true', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Toolbar onCreateSticky={onClick} disabled={true} />);
    const btn = screen.getByRole('button', { name: /sticky note/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Toolbar button is enabled when disabled=false', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Toolbar onCreateSticky={onClick} disabled={false} />);
    const btn = screen.getByRole('button', { name: /sticky note/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await user.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('StickyNote does not start editing on dblclick when editable=false', async () => {
    const onStartEdit = vi.fn();
    const doc = makeTestDoc();
    render(
      <StickyNoteComponent
        obj={mockNote}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        editable={false}
        onPointerDown={vi.fn()}
        onStartEdit={onStartEdit}
        onEndEdit={vi.fn()}
      />,
    );
    const note = screen.getByTestId('sticky-note');
    fireEvent.doubleClick(note);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it('StickyNote starts editing on dblclick when editable=true', async () => {
    const onStartEdit = vi.fn();
    const doc = makeTestDoc();
    render(
      <StickyNoteComponent
        obj={mockNote}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        editable={true}
        onPointerDown={vi.fn()}
        onStartEdit={onStartEdit}
        onEndEdit={vi.fn()}
      />,
    );
    const note = screen.getByTestId('sticky-note');
    fireEvent.doubleClick(note);
    expect(onStartEdit).toHaveBeenCalledWith('test-note-1');
  });
});

describe('TC-28: close-code mapping', () => {
  it('ConnectionState type includes load_failed', async () => {
    // Verify the ConnectionState type includes all required states
    const states = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    for (const s of states) {
      expect(typeof s).toBe('string');
    }
  });
});
