import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stubClipboard } from '../support/clipboard.ts';
import { linkFor } from '../support/fixtures.ts';
import { enterByHash, isSaved } from '../support/workspace.ts';

// D12: story 4 replaces the stub with the real offline store; here it is overridden per test.
const gate = vi.hoisted(() => ({ canEdit: true }));
vi.mock('@/features/live/canEditStore', () => ({ useCanEdit: () => gate.canEdit }));

describe('TC-94 edit gate', () => {
  it('canEdit true -> the name editor is enabled', async () => {
    gate.canEdit = true;
    await enterByHash({ saved: true });
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeEnabled();
  });

  it('canEdit false -> the name editor is disabled via the fieldset; Share, panel copy and banner copy still work', async () => {
    gate.canEdit = false;
    const { user } = await enterByHash();
    const clip = stubClipboard('ok');
    const name = screen.getByRole('textbox', { name: 'Workspace name' });
    expect(name).toBeDisabled();
    expect(name.closest('fieldset')).toBeDisabled();

    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toBeEnabled();
    await user.click(share);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(clip.writeText).toHaveBeenCalledWith(linkFor());
    expect(isSaved()).toBe(true);
  });

  it('canEdit false -> banner Copy link still works', async () => {
    gate.canEdit = false;
    const { user } = await enterByHash();
    const clip = stubClipboard('ok');
    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(copy).toBeEnabled();
    await user.click(copy);
    await waitFor(() => expect(isSaved()).toBe(true));
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(linkFor());
  });
});
