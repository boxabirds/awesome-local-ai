import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_PAUSED_AFTER_MS } from '@todoodle/shared/limits';
import { describe, expect, it, vi } from 'vitest';
import { useCanEdit } from '@/features/live/canEdit';
import { setDefaultSocketFactory } from '@/features/live/LiveConnection';
import { LiveProvider } from '@/features/live/LiveProvider';
import { networkMonitor } from '@/features/live/network';
import { OfflineError, renameWorkspace } from '@/lib/api';
import { recordRequests } from '../support/fixtures.ts';
import { FakeSocket } from '../support/liveFixtures.ts';
import { startLiveServer, useHealth, workspaceBackend } from '../support/live.ts';
import { Providers } from '../support/render.tsx';
import { ID, enterByHash } from '../support/workspace.ts';

const OFFLINE_TEXT = "You're offline — changes can't be saved right now";

function nameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Workspace name' });
}

describe('live.connection_status: pill vs banner and the edit gate', () => {
  it('TC-O09 open + online: no pill, no banner, fieldsets enabled', async () => {
    const live = startLiveServer();
    await enterByHash({ saved: true });
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    expect(screen.queryByText('Reconnecting…')).toBeNull();
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
    expect(nameInput()).toBeEnabled();
    for (const fieldset of document.querySelectorAll('fieldset')) expect(fieldset).toBeEnabled();
  });

  it('TC-O10 socket paused for 5,000 ms while online: Reconnecting… pill (role=status); rename still editable and saved', async () => {
    const backend = workspaceBackend();
    // Time still flows (for waitFor), and can be jumped ahead.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    await enterByHash({ saved: true }); // inert socket: never opens
    expect(screen.queryByText('Reconnecting…')).toBeNull();
    act(() => vi.advanceTimersByTime(LIVE_PAUSED_AFTER_MS));
    const pill = screen.getByText('Reconnecting…');
    expect(pill).toHaveAttribute('role', 'status');
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();

    const seen = recordRequests();
    const input = nameInput();
    expect(input).toBeEnabled();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Groceries 2' } });
    fireEvent.blur(input);
    await waitFor(() => expect(backend.patches).toEqual([{ name: 'Groceries 2' }]));
    expect(seen.filter((r) => r.startsWith('PATCH'))).toHaveLength(1);
    await waitFor(() => expect(nameInput()).toHaveValue('Groceries 2'));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('TC-O11 network offline: banner text with role=status; fieldsets and rename disabled; Share enabled', async () => {
    useHealth(false);
    await enterByHash({ saved: true });
    act(() => window.dispatchEvent(new Event('offline')));
    const banner = screen.getByText(OFFLINE_TEXT);
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(nameInput()).toBeDisabled();
    for (const fieldset of document.querySelectorAll('fieldset')) expect(fieldset).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('TC-O12 a draft "Groceries 2" survives going offline and back online, in the same DOM node', async () => {
    useHealth(true);
    workspaceBackend();
    const seen = recordRequests();
    await enterByHash({ saved: true });
    const input = nameInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Groceries 2' } });

    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText(OFFLINE_TEXT)).toBeInTheDocument();
    expect(nameInput()).toBe(input);
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Groceries 2');
    fireEvent.blur(input); // the browser may blur a field that becomes disabled: still kept, nothing sent
    expect(input).toHaveValue('Groceries 2');

    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText(OFFLINE_TEXT)).toBeNull());
    expect(nameInput()).toBe(input);
    expect(input).toBeEnabled();
    expect(input).toHaveValue('Groceries 2');
    expect(seen.filter((r) => r.startsWith('PATCH'))).toEqual([]);
  });

  it('TC-O18 offline: an api mutation rejects with OfflineError and sends nothing', async () => {
    useHealth(false);
    const seen = recordRequests();
    networkMonitor.handleOffline();
    await expect(renameWorkspace(ID, 'Nope')).rejects.toBeInstanceOf(OfflineError);
    expect(seen.filter((r) => !r.endsWith('/api/health'))).toEqual([]);
  });

  it('TC-O19 socket status flips 5 times while online: a useCanEdit consumer never re-renders', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    FakeSocket.instances = [];
    setDefaultSocketFactory(FakeSocket.factory);
    let renders = 0;
    function Consumer() {
      renders++;
      return <p>{useCanEdit() ? 'editable' : 'locked'}</p>;
    }
    render(
      <Providers entry="/">
        <LiveProvider workspaceId={ID} notFound={null}>
          <Consumer />
        </LiveProvider>
      </Providers>,
    );
    const initial = renders;
    act(() => FakeSocket.latest().open()); // 1: open
    act(() => FakeSocket.latest().serverClose(1006)); // 2: reconnecting
    act(() => vi.advanceTimersByTime(1_200)); // backoff(0) with the largest jitter
    act(() => FakeSocket.latest().open()); // 3: open
    act(() => FakeSocket.latest().serverClose(1006)); // 4: reconnecting
    act(() => vi.advanceTimersByTime(1_200));
    act(() => FakeSocket.latest().open()); // 5: open
    expect(FakeSocket.instances).toHaveLength(3);
    expect(renders).toBe(initial);
    expect(screen.getByText('editable')).toBeInTheDocument();
  });
});
