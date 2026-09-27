import { COPY_CONFIRM_MS } from '@todoodle/shared/limits';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSavedLink, markLinkSaved } from '@/features/share/linkSaved';
import { SECRET, WS_ID, workspace } from '../fixtures';
import { server } from '../msw';
import { currentLocation, primeCreated, renderApp, restoreClipboard, stubClipboard } from '../render';

const ORIGIN = 'http://localhost:3000';
const LINK = `${ORIGIN}/w#${SECRET}`;
const WARNING_1 = 'This link is the key to this workspace — for you and anyone you send it to.';
const WARNING_2 = "Anyone with it can see and change everything. Access can't be removed yet.";
const WARNING_SAVE = "It's the only way back in: if you lose it, you lose access.";

afterEach(() => {
  restoreClipboard();
  Reflect.deleteProperty(navigator, 'platform');
  Reflect.deleteProperty(navigator, 'userAgentData');
  window.history.replaceState(null, '', '/');
});

function setPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform });
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
}

function countLinkRequests(link = LINK) {
  const count = { n: 0 };
  server.use(
    http.get('/api/w/:id/link', () => {
      count.n++;
      return HttpResponse.json({ link });
    }),
  );
  return count;
}

async function openSavePanel() {
  primeCreated(workspace(), SECRET);
  await renderApp({ pathname: '/w', hash: `#${SECRET}`, state: { justCreated: true } });
  return screen.findByRole('dialog', { name: 'Save your link' });
}

async function openSharePanel() {
  const share = screen.getByRole('button', { name: 'Share' });
  act(() => share.focus());
  fireEvent.click(share);
  return screen.findByRole('dialog', { name: 'Share' });
}

function linkField(dialog: HTMLElement) {
  return within(dialog).getByLabelText<HTMLInputElement>('Workspace link');
}

describe('SharePanel: save mode after creation', () => {
  it('TC-43 shows the link, the warnings and all four actions', async () => {
    const dialog = await openSavePanel();
    expect(linkField(dialog).value).toBe(LINK);
    expect(linkField(dialog)).toHaveAttribute('readonly');
    expect(within(dialog).getByText(WARNING_1)).toBeInTheDocument();
    expect(within(dialog).getByText(WARNING_SAVE)).toBeInTheDocument();
    expect(within(dialog).getByText(WARNING_2)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link & continue' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Email it to me' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Bookmark this page' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
  });

  it('TC-67 Copy link & continue copies once, marks saved and closes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const dialog = await openSavePanel();
    expect(hasSavedLink(WS_ID)).toBe(false);
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link & continue' })));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(hasSavedLink(WS_ID)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Your link isn't saved yet/)).not.toBeInTheDocument();
    // justCreated is dropped but the hash (the link) stays.
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
    expect(currentLocation.value?.state).toEqual({});
  });

  it.each([
    ['rejects', () => stubClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) })],
    ['is undefined', () => stubClipboard(undefined)],
  ])('TC-45 when writeText %s: field focused and fully selected, no Copied, not saved', async (_label, stub) => {
    stub();
    const dialog = await openSavePanel();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link & continue' })));
    const field = linkField(dialog);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Save your link' })).toBeInTheDocument();
  });

  it('TC-68 Email it to me: mailto href with the encoded link; click marks saved; no fetch', async () => {
    const dialog = await openSavePanel();
    const email = within(dialog).getByRole('link', { name: 'Email it to me' });
    expect(email).toHaveAttribute(
      'href',
      `mailto:?subject=${encodeURIComponent('Your Todoodle link')}&body=${encodeURIComponent(LINK)}`,
    );
    expect(email.getAttribute('href')).toContain('subject=Your%20Todoodle%20link');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const stopNavigation = (e: Event) => e.preventDefault();
    document.addEventListener('click', stopNavigation);
    try {
      await act(async () => fireEvent.click(email));
    } finally {
      document.removeEventListener('click', stopNavigation);
    }
    expect(hasSavedLink(WS_ID)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['MacIntel', 'Press ⌘D'],
    ['iPhone', 'Press ⌘D'],
    ['Win32', 'Press Ctrl+D'],
    ['Linux x86_64', 'Press Ctrl+D'],
  ])('TC-69 Bookmark on %s shows %s and does not mark saved', async (platform, hint) => {
    setPlatform(platform);
    const dialog = await openSavePanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bookmark this page' }));
    expect(within(dialog).getByText(new RegExp(hint.replace('+', '\\+')))).toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(false);
  });

  it('TC-69 userAgentData.platform wins over navigator.platform', async () => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({ platform: 'macOS' }) });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Win32' });
    const dialog = await openSavePanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bookmark this page' }));
    expect(within(dialog).getByText(/Press ⌘D/)).toBeInTheDocument();
  });

  it('TC-71 Skip for now closes, leaves the link unsaved and the banner visible', async () => {
    const dialog = await openSavePanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hasSavedLink(WS_ID)).toBe(false);
    expect(screen.getByText("Your link isn't saved yet — you'll lose access if you clear this browser.")).toBeInTheDocument();
  });

  it('TC-66 on /w#secret opening the panel never calls GET link', async () => {
    const count = countLinkRequests();
    const dialog = await openSavePanel();
    expect(linkField(dialog).value).toBe(LINK);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    await openSharePanel();
    await new Promise((r) => setTimeout(r, 20));
    expect(count.n).toBe(0);
  });
});

describe('SharePanel: share mode from the header', () => {
  beforeEach(() => {
    primeCreated(workspace(), SECRET);
  });

  it('TC-72 Share opens the share mode: title Share, Copy link, Done, no Skip for now', async () => {
    markLinkSaved(WS_ID);
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const dialog = await openSharePanel();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(WARNING_SAVE)).not.toBeInTheDocument();
    expect(within(dialog).getByText(WARNING_1)).toBeInTheDocument();
    expect(within(dialog).getByText(WARNING_2)).toBeInTheDocument();
  });

  it('TC-44 Copy link copies once, shows Copied for COPY_CONFIRM_MS and stays open', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const dialog = await openSharePanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' })));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(true);
    act(() => vi.advanceTimersByTime(COPY_CONFIRM_MS - 1));
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2));
    expect(within(dialog).queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument();
  });

  it('TC-73 after the fallback selection, a native copy event marks the link saved', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const dialog = await openSharePanel();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' })));
    expect(hasSavedLink(WS_ID)).toBe(false);
    act(() => {
      fireEvent.copy(linkField(dialog));
    });
    expect(hasSavedLink(WS_ID)).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Your link isn't saved yet/)).not.toBeInTheDocument());
  });

  it("TC-46 Done closes and returns focus to Share; Share reopens titled 'Share'; no 'Link' button", async () => {
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    const share = screen.getByRole('button', { name: 'Share' });
    let dialog = await openSharePanel();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(share));
    dialog = await openSharePanel();
    expect(dialog).toHaveAccessibleName('Share');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('button', { name: /^Link$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Link$/ })).not.toBeInTheDocument();
    expect(within(header).getAllByRole('button')).toHaveLength(1);
  });

  it('TC-46 Skip for now in save mode closes the panel and Share reopens it', async () => {
    primeCreated(workspace(), SECRET);
    await renderApp({ pathname: '/w', hash: `#${SECRET}`, state: { justCreated: true } });
    const dialog = await screen.findByRole('dialog', { name: 'Save your link' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const again = await openSharePanel();
    expect(within(again).getByLabelText<HTMLInputElement>('Workspace link').value).toBe(LINK);
  });
});

describe('SharePanel on the id route', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/w/${WS_ID}`);
    server.use(http.get('/api/w/:id', () => HttpResponse.json({ workspace: workspace() })));
    markLinkSaved(WS_ID);
  });

  it('TC-65 the link is not requested before the panel opens; opening makes exactly one GET link', async () => {
    const count = countLinkRequests();
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    await new Promise((r) => setTimeout(r, 20));
    expect(count.n).toBe(0);
    const dialog = await openSharePanel();
    await waitFor(() => expect(linkField(dialog).value).toBe(LINK));
    expect(count.n).toBe(1);
  });

  it("TC-65 a failed link fetch shows 'Couldn't load the link' + Try again", async () => {
    let calls = 0;
    server.use(
      http.get('/api/w/:id/link', () =>
        ++calls === 1 ? HttpResponse.json({ error: 'not_found', message: 'x' }, { status: 404 }) : HttpResponse.json({ link: LINK }),
      ),
    );
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    const dialog = await openSharePanel();
    expect(await within(dialog).findByText("Couldn't load the link")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(linkField(dialog).value).toBe(LINK));
    expect(calls).toBe(2);
  });

  it('TC-70 Bookmark swaps the URL to /w#secret with replaceState and shows the hint; the router stays put', async () => {
    setPlatform('Win32');
    const count = countLinkRequests();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderApp({ pathname: `/w/${WS_ID}` });
    await screen.findByLabelText('Workspace name');
    const dialog = await openSharePanel();
    await waitFor(() => expect(linkField(dialog).value).toBe(LINK));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bookmark this page' }));
    expect(count.n).toBe(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/w');
    expect(window.location.hash).toBe(`#${SECRET}`);
    expect(within(dialog).getByText(/Press Ctrl\+D/)).toBeInTheDocument();
    expect(currentLocation.value?.pathname).toBe(`/w/${WS_ID}`);
    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument();
    expect(hasSavedLink(WS_ID)).toBe(true);
  });
});
