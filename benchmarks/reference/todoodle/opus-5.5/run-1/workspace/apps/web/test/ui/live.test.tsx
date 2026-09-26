import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { LiveAnnouncer } from '@/features/live/LiveAnnouncer';
import { LiveProvider } from '@/features/live/LiveProvider';
import { Providers } from '../support/render.tsx';
import { OTHER_CLIENT, workspaceUpdated } from '../support/liveFixtures.ts';
import { startLiveServer } from '../support/live.ts';
import { ID, enterByHash } from '../support/workspace.ts';

function Child({ onRender }: { onRender: () => void }) {
  onRender();
  return <p>child</p>;
}

describe('live.client_sync: provider, propagation, announcements', () => {
  it('TC-C09 one socket per workspace: children re-render 5 times, exactly one socket is constructed', async () => {
    const live = startLiveServer();
    let renders = 0;
    let bump: () => void = () => {};
    function Parent() {
      const [count, setCount] = useState(0);
      bump = () => setCount((n) => n + 1);
      return (
        <LiveProvider workspaceId={ID} notFound={<p>gone</p>}>
          <Child key="child" onRender={() => renders++} />
          <span>{count}</span>
        </LiveProvider>
      );
    }
    const { rerender } = render(
      <Providers entry="/">
        <Parent />
      </Providers>,
    );
    for (let i = 0; i < 5; i++) act(() => bump());
    rerender(
      <Providers entry="/">
        <Parent />
      </Providers>,
    );
    expect(renders).toBeGreaterThanOrEqual(6);
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    expect(live.constructed).toHaveLength(1);
  });

  it('TC-C10 the socket emits workspace.updated -> the header shows the new name', async () => {
    const live = startLiveServer();
    await enterByHash({ saved: true });
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    live.emit(workspaceUpdated(2, OTHER_CLIENT, 'Trip to Lisbon ✈️'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Trip to Lisbon ✈️'));
    expect(document.title).toBe('Todoodle - Trip to Lisbon ✈️');
  });

  it('TC-C17 an applied change by someone else is announced in a visually hidden polite status region', async () => {
    const live = startLiveServer();
    await enterByHash({ saved: true });
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    const region = screen.getByRole('status', { name: 'Changes by others' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveTextContent('');
    live.emit(workspaceUpdated(2, OTHER_CLIENT, 'Chores'));
    await waitFor(() => expect(region).toHaveTextContent('1 change made by someone else'));
  });

  it('LiveAnnouncer renders one region only', () => {
    render(<LiveAnnouncer />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
