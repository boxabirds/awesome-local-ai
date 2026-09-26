import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { COPY_CONFIRM_MS } from '@todoodle/shared/limits';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../msw.ts';
import { stubClipboard } from '../support/clipboard.ts';
import { SECRET, createHandler, linkFor, linkHandler, recordRequests } from '../support/fixtures.ts';
import { currentLocation, renderApp } from '../support/render.tsx';
import { ID, enterByHash, enterById, isSaved } from '../support/workspace.ts';

const KEY_TEXT = 'This link is the key to this workspace — for you and anyone you send it to.';
const ACCESS_TEXT = "Anyone with it can see and change everything. Access can't be removed yet.";
const LOSE_TEXT = "It's the only way back in: if you lose it, you lose access.";

function linkField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Workspace link' });
}

async function openShare(user: { click(el: Element): Promise<void> }) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
  return screen.findByRole('dialog');
}

describe('web.link_dialog (SharePanel)', () => {
  it("TC-43 after create: 'Save your link' shows the link, the warning copy and the four actions", async () => {
    server.use(createHandler());
    const { user } = await renderApp('/');
    stubClipboard('ok');
    await user.click(screen.getByRole('button', { name: 'Start a new list' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Save your link' })).toBeInTheDocument();
    expect(linkField()).toHaveValue(linkFor());
    expect(linkField()).toHaveAttribute('readonly');
    expect(within(dialog).getByText(KEY_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(LOSE_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(ACCESS_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link & continue' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Email it to me' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Bookmark this page' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Workspace name', hidden: true })).toHaveValue('My Todoodle');
  });

  it("TC-44 share mode Copy link -> writeText(link) once; 'Copied' for COPY_CONFIRM_MS; panel stays open", async () => {
    const { user } = await enterByHash({ saved: true });
    const clip = stubClipboard('ok');
    const dialog = await openShare(user);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await act(async () => {});
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(linkFor());
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(COPY_CONFIRM_MS - 1));
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2));
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each(['rejects', 'undefined'] as const)('TC-45 writeText %s -> field focused and fully selected; no Copied; flag not set', async (mode) => {
    const { user } = await enterByHash();
    stubClipboard(mode);
    const dialog = await openShare(user);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    const field = linkField();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(within(dialog).queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(isSaved()).toBe(false);
  });

  it("TC-46 Skip for now closes; focus returns to the trigger; Share reopens titled 'Share'; no 'Link' button", async () => {
    const { user } = await enterByHash({ justCreated: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Save your link' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Closing clears justCreated but keeps the hash (a reload must not re-show the panel).
    expect(currentLocation.value?.hash).toBe(`#${SECRET}`);
    expect(currentLocation.value?.state).toEqual({});

    const share = screen.getByRole('button', { name: 'Share' });
    await user.click(share);
    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    await user.click(within(reopened).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(share));

    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('button', { name: /^link$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull();
  });

  it('TC-65 /w/:id: no link request before the panel opens; opening makes exactly one GET link', async () => {
    const seen = recordRequests();
    server.use(linkHandler());
    const { user } = await enterById({ saved: true });
    // Story 3: opening by id also touches this browser's remembered list. Story 5: and loads the Inbox.
    expect([...seen].sort()).toEqual([
      `GET /api/w/${ID}`,
      `GET /api/w/${ID}/counts`,
      `GET /api/w/${ID}/tasks`,
      `POST /api/remembered/${ID}/touch`,
    ]);
    await openShare(user);
    await waitFor(() => expect(linkField()).toHaveValue(linkFor()));
    expect(seen.filter((r) => r.endsWith('/link'))).toEqual([`GET /api/w/${ID}/link`]);
  });

  it("TC-65 /w/:id link failure -> 'Couldn't load the link' + Try again", async () => {
    const { http, HttpResponse } = await import('msw');
    server.use(http.get('/api/w/:id/link', () => HttpResponse.json({ error: 'not_found', message: 'x' }, { status: 404 })));
    const { user } = await enterById({ saved: true });
    const dialog = await openShare(user);
    expect(await within(dialog).findByText("Couldn't load the link")).toBeInTheDocument();
    server.use(linkHandler());
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(linkField()).toHaveValue(linkFor()));
  });

  it('TC-66 /w#secret: opening the panel does not request the link', async () => {
    const seen = recordRequests();
    const { user } = await enterByHash({ saved: true });
    await openShare(user);
    expect(linkField()).toHaveValue(linkFor());
    expect(seen).toEqual([]);
  });

  it('TC-67 Copy link & continue -> writeText once, flag saved, panel closed', async () => {
    const { user } = await enterByHash({ justCreated: true });
    const clip = stubClipboard('ok');
    const dialog = await screen.findByRole('dialog');
    expect(isSaved()).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link & continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(linkFor());
    expect(isSaved()).toBe(true);
  });

  it('TC-68 Email it to me: mailto href with the encoded link; click marks saved; no fetch', async () => {
    const seen = recordRequests();
    const { user } = await enterByHash({ justCreated: true });
    const email = within(await screen.findByRole('dialog')).getByRole('link', { name: 'Email it to me' });
    expect(email).toHaveAttribute(
      'href',
      `mailto:?subject=Your%20Todoodle%20link&body=${encodeURIComponent(linkFor())}`,
    );
    email.addEventListener('click', (event) => event.preventDefault()); // no navigation in the test DOM
    await user.click(email);
    expect(isSaved()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seen).toEqual([]);
  });

  it.each([
    ['MacIntel', 'Press ⌘D'],
    ['iPhone', 'Press ⌘D'],
    ['Win32', 'Press Ctrl+D'],
    ['Linux x86_64', 'Press Ctrl+D'],
  ])('TC-69 Bookmark on platform %s shows %s; the flag is unchanged', async (platform, hint) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const { user } = await enterByHash({ justCreated: true });
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Bookmark this page' }));
    expect(within(dialog).getByText(new RegExp(hint.replace('+', '\\+')))).toBeInTheDocument();
    expect(isSaved()).toBe(false);
  });

  it('TC-70 /w/:id Bookmark -> one GET link, URL becomes /w#secret via replaceState; the router stays put', async () => {
    const seen = recordRequests();
    server.use(linkHandler());
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const { user } = await enterById({ saved: true });
    const dialog = await openShare(user);
    await waitFor(() => expect(linkField()).toHaveValue(linkFor()));
    await user.click(within(dialog).getByRole('button', { name: 'Bookmark this page' }));
    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState.mock.calls[0]![2]).toBe(`/w#${SECRET}`);
    expect(window.location.pathname).toBe('/w');
    expect(window.location.hash).toBe(`#${SECRET}`);
    expect(within(dialog).getByText(/Press (⌘D|Ctrl\+D)/)).toBeInTheDocument();
    expect(seen.filter((r) => r.endsWith('/link'))).toHaveLength(1);
    expect(currentLocation.value?.pathname).toBe(`/w/${ID}`);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('TC-71 Skip for now -> closed; flag still unsaved; banner visible', async () => {
    const { user } = await enterByHash({ justCreated: true });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(isSaved()).toBe(false);
    expect(screen.getByText("Your link isn't saved yet — you'll lose access if you clear this browser.")).toBeInTheDocument();
  });

  it("TC-72 header Share opens share mode: title Share, 'Copy link', 'Done', no 'Skip for now'", async () => {
    const { user } = await enterByHash({ saved: true });
    const dialog = await openShare(user);
    expect(within(dialog).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Skip for now' })).toBeNull();
    expect(within(dialog).queryByText(LOSE_TEXT)).toBeNull();
    expect(within(dialog).getByText(KEY_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(ACCESS_TEXT)).toBeInTheDocument();
  });

  it('TC-73 after the fallback selection, a native copy event on the field marks the link saved', async () => {
    const { user } = await enterByHash();
    stubClipboard('rejects');
    const dialog = await openShare(user);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(document.activeElement).toBe(linkField()));
    expect(isSaved()).toBe(false);
    fireEvent.copy(linkField());
    expect(isSaved()).toBe(true);
    expect(screen.queryByText("Your link isn't saved yet — you'll lose access if you clear this browser.")).toBeNull();
  });
});
