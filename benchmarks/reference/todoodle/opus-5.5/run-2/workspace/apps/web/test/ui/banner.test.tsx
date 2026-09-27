import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSavedLink, linkSavedKey, resetLinkSavedCacheForTests } from '@/features/share/linkSaved';
import { SECRET, WS_ID, workspace } from '../fixtures';
import { server } from '../msw';
import { primeCreated, renderApp, restoreClipboard, stubClipboard } from '../render';

const TEXT = "Your link isn't saved yet — you'll lose access if you clear this browser.";
const LINK = `http://localhost:3000/w#${SECRET}`;

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

function banner() {
  return screen.getByText(TEXT).closest('[role="status"]') as HTMLElement;
}

async function clickBannerCopy() {
  await act(async () => fireEvent.click(within(banner()).getByRole('button', { name: 'Copy link' })));
}

async function renderHashRoute() {
  await renderApp({ pathname: '/w', hash: `#${SECRET}` });
  await screen.findByLabelText('Workspace name');
}

afterEach(() => {
  restoreClipboard();
  vi.unstubAllGlobals();
});

describe('unsaved-link banner on /w#secret', () => {
  beforeEach(() => primeCreated(workspace(), SECRET));

  it('is shown with role=status while the link is unsaved', async () => {
    await renderHashRoute();
    expect(banner()).toHaveAttribute('role', 'status');
    expect(within(banner()).getByRole('button', { name: 'Remind me later' })).toBeInTheDocument();
  });

  it('TC-74 Copy link writes the link and hides the banner for good', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderHashRoute();
    await clickBannerCopy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(true);
    expect(window.localStorage.getItem(linkSavedKey(WS_ID))).toBe('1');
  });

  it('TC-74 a rejected copy opens the SharePanel in share mode; the banner stays', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    await renderHashRoute();
    await clickBannerCopy();
    expect(await screen.findByRole('dialog', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(false);
  });

  it('TC-75 Remind me later hides it; a new tab session shows it again', async () => {
    await renderHashRoute();
    fireEvent.click(within(banner()).getByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(false);

    // Same tab, next render: still snoozed.
    cleanup();
    await renderHashRoute();
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();

    // New tab session: sessionStorage starts empty (and a new page has a fresh read cache).
    cleanup();
    window.sessionStorage.clear();
    resetLinkSavedCacheForTests();
    await renderHashRoute();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it('TC-76 storage that throws: banner visible, copy works, nothing thrown, no console error', async () => {
    const consoleError = vi.spyOn(console, 'error');
    for (const area of ['localStorage', 'sessionStorage'] as const) {
      vi.spyOn(window, area, 'get').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    }
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderHashRoute();
    expect(banner()).toBeInTheDocument();
    await clickBannerCopy();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    // Nothing could be recorded, so the reminder stays (fail safe towards reminding).
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    fireEvent.click(within(banner()).getByRole('button', { name: 'Remind me later' }));
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('TC-77 a storage event from another tab hides the banner without a reload', async () => {
    await renderHashRoute();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    window.localStorage.setItem(linkSavedKey(WS_ID), '1');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: linkSavedKey(WS_ID), newValue: '1' }));
    });
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
  });
});

describe('unsaved-link banner on /w/:id', () => {
  beforeEach(() => {
    server.use(http.get('/api/w/:id', () => HttpResponse.json({ workspace: workspace() })));
  });

  function linkEndpoint(respond: () => Response = () => HttpResponse.json({ link: LINK })) {
    const count = { n: 0 };
    server.use(
      http.get('/api/w/:id/link', () => {
        count.n++;
        return respond();
      }),
    );
    return count;
  }

  it('TC-74 with ClipboardItem: write() with the fetched link promise; banner hides', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    let written = '';
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      written = await (await items[0]!.items['text/plain']!).text();
    });
    const writeText = vi.fn();
    stubClipboard({ write, writeText });
    const count = linkEndpoint();
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    expect(count.n).toBe(0);
    await clickBannerCopy();
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(written).toBe(LINK);
    expect(count.n).toBe(1);
    expect(hasSavedLink(WS_ID)).toBe(true);
  });

  it('TC-74 without ClipboardItem: the SharePanel opens in share mode; banner stays', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    stubClipboard({ write: vi.fn(), writeText: vi.fn() });
    linkEndpoint();
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    await clickBannerCopy();
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    await waitFor(() => expect(within(dialog).getByLabelText<HTMLInputElement>('Workspace link').value).toBe(LINK));
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it('TC-74 a link 404 falls back to the SharePanel; banner stays', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    stubClipboard({
      write: vi.fn(async (items: FakeClipboardItem[]) => {
        await items[0]!.items['text/plain'];
      }),
    });
    linkEndpoint(() => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 }));
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    await clickBannerCopy();
    expect(await screen.findByRole('dialog', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(false);
  });
});
