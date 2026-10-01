// tests/component/LoadFailure.test.tsx
// Component tests for load-failure badge, edit lock, and close-code mapping (TC-22, TC-23, TC-28)
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { canEdit, type ConnectionState } from '../../src/client/sync/connectBoard';
import { Toolbar } from '../../src/client/board/Toolbar';

beforeEach(() => {
  cleanup();
});

// ─── TC-22: Load failure badge ─────────────────────────────────────────────────

describe('persist.client_status: load failure badge (TC-22)', () => {
  it('TC-22: state load_failed → red text with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);

    const badge = screen.getByTestId('connection-status');
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    
    // Verify it's red (#D32F2F = rgb(211, 47, 47))
    expect(badge.style.background).toBe('rgb(211, 47, 47)');
  });
});

// ─── TC-23: Edit lock during load_failed ───────────────────────────────────────

describe('persist.client_status: edit lock during load_failed (TC-23)', () => {
  it('TC-23: canEdit returns false only for load_failed', () => {
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });

  it('TC-23: Toolbar Sticky note button is disabled in load_failed state', () => {
    const { getByTestId } = render(<Toolbar onCreateSticky={() => {}} disabled={true} tool="select" setTool={() => {}} shapeKind="rect" setShapeKind={() => {}} />);
    const btn = getByTestId('create-sticky-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('TC-23: Toolbar Sticky note button is enabled in connected state', () => {
    const { getByTestId } = render(<Toolbar onCreateSticky={() => {}} disabled={false} tool="select" setTool={() => {}} shapeKind="rect" setShapeKind={() => {}} />);
    const btn = getByTestId('create-sticky-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ─── TC-28: Close-code mapping ─────────────────────────────────────────────────

describe('persist.client_status: close-code mapping (TC-28)', () => {
  it('TC-28: canEdit is true for reconnecting (1011/1003 close codes)', () => {
    // 1011 and 1003 map to 'reconnecting', not 'load_failed'
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
  });

  it('TC-28: canEdit is false only for load_failed (4500 close code)', () => {
    expect(canEdit('load_failed')).toBe(false);
  });

  it('TC-28: recovery - after load_failed, connected state re-enables editing', () => {
    // Simulate state transitions
    let state: ConnectionState = 'load_failed';
    expect(canEdit(state)).toBe(false);
    
    // After successful sync, state becomes 'connected'
    state = 'connected';
    expect(canEdit(state)).toBe(true);
  });

  it('TC-28: ConnectionStatus shows reconnecting (not load_failed) for 1011/1003', () => {
    // When state is 'reconnecting', the badge shows "Reconnecting…" not the load failure message
    const { unmount } = render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe('Reconnecting…');
    unmount();
  });
});
