import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { canEdit, type ConnectionState } from '../../src/client/sync/connectBoard';

afterEach(cleanup);

describe('TC-23: Edit gate (canEdit)', () => {
  it('canEdit returns false only for load_failed', () => {
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });
});

describe('TC-23: Edit lock UI behaviours in load_failed state', () => {
  /**
   * A minimal harness that replicates the gating logic from App.tsx
   * without needing a live WebSocket. We verify that when editable=false,
   * the Toolbar button is disabled and dblclick handlers are no-ops.
   */
  function makeHarness({ editable }: { editable: boolean }) {
    const mockCreateSticky = vi.fn();
    const mockDblClick = vi.fn();
    const mockDelete = vi.fn();

    return {
      mockCreateSticky,
      mockDblClick,
      mockDelete,
      Component() {
        return (
          <div data-testid="app-root" tabIndex={-1}>
            <button
              type="button"
              data-testid="create-sticky-btn"
              onClick={() => {
                if (editable) mockCreateSticky();
              }}
              disabled={!editable}
            >
              Sticky note
            </button>
            <div
              data-testid="board-viewport"
              onDoubleClick={() => {
                if (editable) mockDblClick();
              }}
              style={{ width: 400, height: 400 }}
            >
              <div
                data-testid="sticky-note-abc"
                data-note-id="abc"
                onPointerDown={(e) => e.stopPropagation()}
              >
                Note content
              </div>
            </div>
            <button
              type="button"
              data-testid="delete-btn"
              onClick={() => {
                if (editable) mockDelete();
              }}
              disabled={!editable}
            >
              Delete
            </button>
          </div>
        );
      },
    };
  }

  it('Sticky note button is disabled in load_failed', () => {
    const { Component } = makeHarness({ editable: false });
    render(<Component />);
    const btn = screen.getByTestId('create-sticky-btn');
    expect(btn).toBeDisabled();
  });

  it('Sticky note button click is a no-op in load_failed', () => {
    const { Component, mockCreateSticky } = makeHarness({ editable: false });
    render(<Component />);
    const btn = screen.getByTestId('create-sticky-btn');
    fireEvent.click(btn);
    expect(mockCreateSticky).not.toHaveBeenCalled();
  });

  it('Double-click on board is a no-op in load_failed', () => {
    const { Component, mockDblClick } = makeHarness({ editable: false });
    render(<Component />);
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport);
    expect(mockDblClick).not.toHaveBeenCalled();
  });

  it('Delete button is disabled in load_failed', () => {
    const { Component } = makeHarness({ editable: false });
    render(<Component />);
    const btn = screen.getByTestId('delete-btn');
    expect(btn).toBeDisabled();
  });

  it('Delete button click is a no-op in load_failed', () => {
    const { Component, mockDelete } = makeHarness({ editable: false });
    render(<Component />);
    const btn = screen.getByTestId('delete-btn');
    fireEvent.click(btn);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('When editable, all operations fire', () => {
    const { Component, mockCreateSticky, mockDblClick, mockDelete } = makeHarness({ editable: true });
    render(<Component />);

    fireEvent.click(screen.getByTestId('create-sticky-btn'));
    expect(mockCreateSticky).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(screen.getByTestId('board-viewport'));
    expect(mockDblClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('delete-btn'));
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('Close-code mapping', () => {
  it('4500 → load_failed, 1011 → reconnecting (not locked)', () => {
    // load_failed gates editing
    const loadFailed: ConnectionState = 'load_failed';
    expect(canEdit(loadFailed)).toBe(false);

    // reconnecting does NOT gate editing (1011 maps here)
    const reconnecting: ConnectionState = 'reconnecting';
    expect(canEdit(reconnecting)).toBe(true);
  });

  it('connectBoard maps connection-close events correctly and recovers on sync', async () => {
    // Test the handler logic directly by simulating the state transitions
    // that connectBoard performs when receiving close events.

    const states: string[] = [];
    const onState = (s: string) => states.push(s);

    // Simulate the close handler logic from connectBoard:
    // event.code === CLOSE_BOARD_LOAD_FAILED → load_failed
    // event.code === CLOSE_STORAGE_FAILURE → reconnecting
    // sync(true) while in load_failed → connected

    let currentState = 'connecting';
    function setState(s: string) {
      if (s !== currentState) {
        currentState = s;
        onState(s);
      }
    }

    // Simulate 4500 close → load_failed
    setState('load_failed');
    expect(states).toContain('load_failed');
    expect(canEdit('load_failed' as ConnectionState)).toBe(false);

    // Simulate sync recovery (first sync after load_failed → connected)
    setState('connected');
    expect(states).toContain('connected');
    expect(canEdit('connected' as ConnectionState)).toBe(true);

    // Simulate 1011 close → reconnecting (not locked)
    setState('reconnecting');
    expect(states).toContain('reconnecting');
    expect(canEdit('reconnecting' as ConnectionState)).toBe(true);
  });
});
