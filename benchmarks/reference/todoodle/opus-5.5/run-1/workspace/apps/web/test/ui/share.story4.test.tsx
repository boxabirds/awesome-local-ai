import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { networkMonitor } from '@/features/live/network';
import { SHARE_ACCESS_TEXT, SHARE_KEY_TEXT, SHARE_STATEMENT } from '@/features/share/copy';
import { server } from '../msw.ts';
import { stubClipboard } from '../support/clipboard.ts';
import { gate, linkFor, linkHandler, recordRequests } from '../support/fixtures.ts';
import { useHealth } from '../support/live.ts';
import { enterByHash, enterById } from '../support/workspace.ts';

async function openShare(user: { click(el: Element): Promise<void> }) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
  return screen.findByRole('dialog');
}

describe("share.panel: story 2's single SharePanel meets prd.share_panel", () => {
  it('the access statement is exactly the PRD text', () => {
    expect(SHARE_STATEMENT).toBe(
      "This link is the key to this workspace — for you and anyone you send it to. Anyone with it can see and change everything. Access can't be removed yet.",
    );
  });

  it('TC-S06 secret in memory (/w#secret): Share shows origin/w#secret, the access statement and Copy, with zero requests', async () => {
    const { user } = await enterByHash({ saved: true });
    const seen = recordRequests();
    const dialog = await openShare(user);
    expect(within(dialog).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Workspace link' })).toHaveValue(linkFor());
    expect(within(dialog).getByText(SHARE_KEY_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(SHARE_ACCESS_TEXT)).toHaveTextContent("Access can't be removed yet");
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeEnabled();
    expect(seen).toEqual([]);
  });

  it('TC-S07 no secret (/w/:id): the panel shows loading, then the fetched link', async () => {
    const held = gate();
    const { user } = await enterById({ saved: true });
    server.use(linkHandler({ until: held.promise }));
    const dialog = await openShare(user);
    expect(within(dialog).getByLabelText('Loading link')).toBeInTheDocument();
    held.release();
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Workspace link' })).toHaveValue(linkFor()));
  });

  it('TC-S08 offline (canEdit false): Share and Copy stay enabled (outside the fieldset)', async () => {
    useHealth(false);
    const { user } = await enterByHash({ saved: true });
    const clip = stubClipboard('ok');
    networkMonitor.handleOffline();
    await screen.findByText("You're offline — changes can't be saved right now");
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeDisabled();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeEnabled();
    const dialog = await openShare(user);
    const copy = within(dialog).getByRole('button', { name: 'Copy link' });
    expect(copy).toBeEnabled();
    await user.click(copy);
    expect(clip.writeText).toHaveBeenCalledWith(linkFor());
  });
});
