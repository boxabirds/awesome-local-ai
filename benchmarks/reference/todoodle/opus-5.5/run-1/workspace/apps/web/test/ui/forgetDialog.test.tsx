import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { stubClipboard } from '../support/clipboard.ts';
import { gate, linkFor, linkHandler, recordRequests } from '../support/fixtures.ts';
import {
  A,
  B,
  expectNoAxeViolations,
  forgetHandler,
  markSaved,
  rememberedHandler,
  savedKey,
  stubHoverNone,
} from '../support/remembered.ts';
import { renderApp } from '../support/render.tsx';

const BODY = 'This only removes it from this browser. Anyone with the link can still open it.';
const WARNING = "You haven't saved this link. If you forget it here, you may lose access.";

type User = Awaited<ReturnType<typeof renderApp>>['user'];

/** Home with [A, B]; opens A's '...' menu and chooses 'Forget on this browser'. Returns the dialog. */
async function openForgetA(user: User) {
  await screen.findByRole('heading', { name: 'Your workspaces on this browser' });
  await user.click(screen.getByRole('button', { name: `More actions for ${A.name}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Forget on this browser' }));
  return screen.findByRole('alertdialog');
}

const rowLink = (name: string) => screen.queryByRole('link', { name: new RegExp(`^${name}`) });
const linkRequests = (seen: string[]) => seen.filter((r) => r.endsWith('/link'));

describe('forget.confirm_dialog', () => {
  it('TC-55 saved link: exact copy, no warning; Cancel sends nothing; Forget sends DELETE and the row goes before the response', async () => {
    markSaved(A.id);
    const hold = gate();
    const deleted: string[] = [];
    server.use(rememberedHandler([A, B]), forgetHandler({ until: hold.promise, onRequest: (id) => deleted.push(id) }));
    const seen = recordRequests();
    const { user } = await renderApp('/');

    let dialog = await openForgetA(user);
    expect(within(dialog).getByRole('heading', { name: `Forget ${A.name} on this browser?` })).toBeInTheDocument();
    expect(within(dialog).getByText(BODY)).toBeInTheDocument();
    expect(within(dialog).queryByText(WARNING)).toBeNull();
    await expectNoAxeViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(seen.filter((r) => r.startsWith('DELETE'))).toEqual([]);
    expect(rowLink(A.name!)).toBeInTheDocument();

    dialog = await openForgetA(user);
    server.use(rememberedHandler([B]));
    await user.click(within(dialog).getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(rowLink(A.name!)).toBeNull());
    expect(deleted).toEqual([A.id]);
    expect(rowLink(B.name!)).toBeInTheDocument();
    await act(async () => hold.release());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(rowLink(A.name!)).toBeNull();
  });

  it('TC-56 DELETE 500 -> the row comes back and an alert toast explains', async () => {
    markSaved(A.id);
    server.use(rememberedHandler([A, B]), forgetHandler({ status: 500 }));
    const { user } = await renderApp('/');
    const dialog = await openForgetA(user);
    await user.click(within(dialog).getByRole('button', { name: 'Forget' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't forget this workspace — try again");
    await waitFor(() => expect(rowLink(A.name!)).toBeInTheDocument());
  });

  it('TC-71 dialog buttons use touch-target sizing', async () => {
    stubHoverNone(true);
    markSaved(A.id);
    server.use(rememberedHandler([A, B]));
    const { user } = await renderApp('/');
    const dialog = await openForgetA(user);
    for (const name of ['Cancel', 'Forget']) {
      expect(within(dialog).getByRole('button', { name }).className).toContain('touch-target');
    }
  });
});

describe('forget.unsaved_warning', () => {
  it('TC-64 unsaved: warning + Copy link; no link request on open; Copy -> one GET, clipboard, flag, "Link copied"; Forget disabled while pending', async () => {
    const hold = gate();
    server.use(rememberedHandler([A, B]), linkHandler({ until: hold.promise }));
    const seen = recordRequests();
    const { user } = await renderApp('/');
    const clipboard = stubClipboard('ok');
    const dialog = await openForgetA(user);
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument();
    expect(linkRequests(seen)).toEqual([]);

    const forget = within(dialog).getByRole('button', { name: 'Forget' });
    expect(forget).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(linkRequests(seen)).toEqual([`GET /api/w/${A.id}/link`]));
    expect(forget).toBeDisabled();
    await act(async () => hold.release());

    const status = await within(dialog).findByRole('status');
    expect(status).toHaveTextContent('Link copied — you can forget it safely.');
    expect(within(dialog).queryByText(WARNING)).toBeNull();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith(linkFor());
    expect(localStorage.getItem(savedKey(A.id))).toBe('1');
    expect(forget).toBeEnabled();
    expect(linkRequests(seen)).toHaveLength(1);
    // The link does not outlive the dialog in the query cache.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.link(A.id))).toBeUndefined());
  });

  it('TC-65 saved flag: no warning, no Copy link, zero link requests', async () => {
    markSaved(A.id);
    server.use(rememberedHandler([A, B]));
    const seen = recordRequests();
    const { user } = await renderApp('/');
    const dialog = await openForgetA(user);
    expect(within(dialog).queryByText(WARNING)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(linkRequests(seen)).toEqual([]);
  });

  it.each(['rejects', 'undefined'] as const)(
    'TC-66 clipboard %s -> read-only link field, pre-selected, "Copy it manually"; flag not set',
    async (mode) => {
      server.use(rememberedHandler([A, B]), linkHandler());
      const { user } = await renderApp('/');
      stubClipboard(mode);
      const dialog = await openForgetA(user);
      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
      const field = await within(dialog).findByRole('textbox', { name: 'Copy it manually' });
      expect(field).toHaveAttribute('readonly');
      expect(field).toHaveValue(linkFor());
      expect(field).toHaveFocus();
      const input = field as HTMLInputElement;
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, linkFor().length]);
      expect(localStorage.getItem(savedKey(A.id))).toBeNull();
      expect(within(dialog).getByText(WARNING)).toBeInTheDocument();
    },
  );

  it("TC-67 GET link 500 -> \"Couldn't get the link\" + Retry (a second request); Forget stays enabled; flag not set", async () => {
    let requests = 0;
    server.use(
      rememberedHandler([A, B]),
      http.get('/api/w/:id/link', () => {
        requests++;
        return HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 });
      }),
    );
    const { user } = await renderApp('/');
    stubClipboard('ok');
    const dialog = await openForgetA(user);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't get the link");
    expect(within(dialog).getByRole('button', { name: 'Forget' })).toBeEnabled();
    expect(requests).toBe(1);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(requests).toBe(2));
    await within(dialog).findByRole('alert');
    expect(within(dialog).getByRole('button', { name: 'Forget' })).toBeEnabled();
    expect(localStorage.getItem(savedKey(A.id))).toBeNull();
  });

  it('TC-68 localStorage.getItem throws -> treated as unsaved, no crash, no console error', async () => {
    const consoleError = vi.spyOn(console, 'error');
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => localStorage.getItem('x')).toThrow();
    server.use(rememberedHandler([A, B]));
    const { user } = await renderApp('/');
    const dialog = await openForgetA(user);
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
