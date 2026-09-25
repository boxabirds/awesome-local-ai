/**
 * TC-25: offline + unsynced → amber "Offline — changes saved on this device".
 * TC-26: offline + synced → amber "Offline — changes saved".
 * TC-27: online + syncing → blue "Saving…".
 * TC-28: online + synced → nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

describe('offline status badge (story 13)', () => {
  it('TC-25: offline + pending_offline → amber "Offline — changes saved on this device"', () => {
    render(<ConnectionStatus online={false} syncState="pending_offline" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Offline — changes saved on this device');
  });

  it('TC-26: offline + synced → amber "Offline — changes saved"', () => {
    render(<ConnectionStatus online={false} syncState="synced" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Offline — changes saved');
  });

  it('TC-27: online + syncing → "Saving…"', () => {
    render(<ConnectionStatus online={true} syncState="syncing" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Saving…');
  });

  it('TC-28: online + synced → nothing rendered', () => {
    const { container } = render(<ConnectionStatus online={true} syncState="synced" />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
