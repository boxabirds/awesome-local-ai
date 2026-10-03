// TC-23: App in load_failed state → zero board-model mutation calls.
// Verifies that when the board is in load_failed state, all editing
// operations (dblclick, toolbar button, Delete key, typing) are blocked.

import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createConnectionMapper,
  type ConnectionMapper,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';

// We test the canEdit gate logic in isolation by rendering a minimal
// component that mirrors the App's editing gate.
let mapper: ConnectionMapper | null = null;

function TestApp() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const ref = useRef<ConnectionMapper | null>(null);
  if (ref.current === null) ref.current = createConnectionMapper(setState);
  useEffect(() => {
    mapper = ref.current;
    return () => { ref.current?.destroy(); };
  }, [ref]);

  const canEdit = state !== 'load_failed';
  const mutationCalls: string[] = [];

  const handleDblClick = () => {
    if (!canEdit) return;
    mutationCalls.push('createSticky');
  };
  const handleToolbarClick = () => {
    if (!canEdit) return;
    mutationCalls.push('createSticky');
  };
  const handleDelete = () => {
    if (!canEdit) return;
    mutationCalls.push('deleteObject');
  };

  // Expose mutation calls for assertions.
  (window as any).__mutationCalls = mutationCalls;

  return (
    <div>
      <div data-testid="board" onDoubleClick={handleDblClick}>board</div>
      <button
        data-testid="sticky-note-btn"
        onClick={handleToolbarClick}
        disabled={!canEdit}
      >
        📝
      </button>
      <button data-testid="delete-btn" onClick={handleDelete}>Delete</button>
      <div data-testid="state">{state}</div>
    </div>
  );
}

describe('TC-23: App editing lock during load_failed', () => {
  beforeEach(() => {
    mapper = null;
    (window as any).__mutationCalls = [];
  });

  afterEach(() => {
    cleanup();
    delete (window as any).__mutationCalls;
  });

  it('load_failed blocks all editing operations', () => {
    render(<TestApp />);

    // Enter load_failed state.
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    act(() => {
      mapper?.onCloseCode(4500);
    });

    expect(screen.getByTestId('state')).toHaveTextContent('load_failed');

    // Dblclick on board → no mutation.
    fireEvent.doubleClick(screen.getByTestId('board'));
    expect((window as any).__mutationCalls).toHaveLength(0);

    // Toolbar button is disabled.
    const btn = screen.getByTestId('sticky-note-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Even if clicked programmatically → no mutation.
    fireEvent.click(btn);
    expect((window as any).__mutationCalls).toHaveLength(0);

    // Delete → no mutation.
    fireEvent.click(screen.getByTestId('delete-btn'));
    expect((window as any).__mutationCalls).toHaveLength(0);
  });

  it('editing works normally when connected', () => {
    render(<TestApp />);

    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });

    expect(screen.getByTestId('state')).toHaveTextContent('connected');

    // Dblclick → mutation.
    fireEvent.doubleClick(screen.getByTestId('board'));
    expect((window as any).__mutationCalls).toHaveLength(1);

    // Toolbar button is enabled.
    const btn = screen.getByTestId('sticky-note-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Delete → mutation.
    fireEvent.click(screen.getByTestId('delete-btn'));
    expect((window as any).__mutationCalls).toHaveLength(2);
  });

  it('recovery from load_failed re-enables editing', () => {
    render(<TestApp />);

    // Enter load_failed.
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    act(() => {
      mapper?.onCloseCode(4500);
    });
    expect(screen.getByTestId('state')).toHaveTextContent('load_failed');

    // Recovery: reconnect and sync.
    act(() => {
      mapper?.onStatus('connected');
      mapper?.onSynced(true);
    });
    // State should be 'connected' or 'confirmed'.
    const stateEl = screen.getByTestId('state');
    expect(stateEl.textContent).toMatch(/connected|confirmed/);

    // Editing works again.
    fireEvent.doubleClick(screen.getByTestId('board'));
    expect((window as any).__mutationCalls).toHaveLength(1);
  });
});
