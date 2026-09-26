import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { clearLinkSavedCache } from '@/features/share/linkSaved';
import { server } from '../msw.ts';
import { stubClipboard } from '../support/clipboard.ts';
import { linkFor, linkHandler, recordRequests } from '../support/fixtures.ts';
import { makeStorageUnavailable } from '../support/storage.ts';
import { ID, SAVED_KEY, enterByHash, enterById, isSaved } from '../support/workspace.ts';

const BANNER_TEXT = "Your link isn't saved yet — you'll lose access if you clear this browser.";

function banner(): HTMLElement | null {
  return screen.queryByText(BANNER_TEXT)?.closest<HTMLElement>('[role="status"]') ?? null;
}

function bannerButton(name: string): HTMLElement {
  return within(banner()!).getByRole('button', { name });
}

describe('web.unsaved_link_banner', () => {
  it('TC-74 hash route: Copy link uses writeText and hides the banner for good', async () => {
    const { user } = await enterByHash();
    const clip = stubClipboard('ok');
    expect(banner()).toHaveAttribute('role', 'status');
    await user.click(bannerButton('Copy link'));
    await waitFor(() => expect(banner()).toBeNull());
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(linkFor());
    expect(isSaved()).toBe(true);
  });

  it('TC-74 id route + ClipboardItem: write() with a promise of the fetched link; banner hides', async () => {
    const seen = recordRequests();
    server.use(linkHandler());
    const { user } = await enterById();
    const clip = stubClipboard('ok');
    await user.click(bannerButton('Copy link'));
    await waitFor(() => expect(banner()).toBeNull());
    expect(clip.write).toHaveBeenCalledOnce();
    expect(clip.writeText).not.toHaveBeenCalled();
    expect(clip.written).toEqual([linkFor()]);
    expect(seen.filter((r) => r.endsWith('/link'))).toEqual([`GET /api/w/${ID}/link`]);
    expect(isSaved()).toBe(true);
  });

  it('TC-74 id route without ClipboardItem: SharePanel opens in share mode, banner stays', async () => {
    server.use(linkHandler());
    const { user } = await enterById();
    stubClipboard('no-clipboard-item');
    await user.click(bannerButton('Copy link'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    expect(isSaved()).toBe(false);
  });

  it('TC-74 copy rejected (hash route) or link 404 (id route): SharePanel opens, banner stays', async () => {
    const first = await enterByHash();
    stubClipboard('rejects');
    await first.user.click(bannerButton('Copy link'));
    expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(isSaved()).toBe(false);
    cleanup();

    server.use(http.get('/api/w/:id/link', () => HttpResponse.json({ error: 'not_found', message: 'x' }, { status: 404 })));
    const second = await enterById();
    stubClipboard('ok');
    await second.user.click(bannerButton('Copy link'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    expect(isSaved()).toBe(false);
  });

  it('TC-75 Remind me later hides it; a new tab session shows it again', async () => {
    const { user } = await enterByHash();
    await user.click(bannerButton('Remind me later'));
    expect(banner()).toBeNull();
    expect(isSaved()).toBe(false);
    cleanup();

    // Same tab session: still snoozed.
    await enterByHash();
    expect(banner()).toBeNull();
    cleanup();

    // New tab: sessionStorage starts empty (and nothing is cached in the fresh page).
    sessionStorage.clear();
    clearLinkSavedCache();
    await enterByHash();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('TC-76 storage unavailable: banner visible, copy works, nothing throws, no console error', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const restore = makeStorageUnavailable();
    try {
      const { user } = await enterByHash();
      const clip = stubClipboard('ok');
      expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
      await user.click(bannerButton('Copy link'));
      expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(linkFor());
      // Nothing could be stored, so the reminder (fail-safe) stays.
      expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('TC-77 a storage event from another tab hides the banner without reload', async () => {
    await enterByHash();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    act(() => {
      localStorage.setItem(SAVED_KEY, '1');
      window.dispatchEvent(new StorageEvent('storage', { key: SAVED_KEY, newValue: '1' }));
    });
    expect(banner()).toBeNull();
  });
});
