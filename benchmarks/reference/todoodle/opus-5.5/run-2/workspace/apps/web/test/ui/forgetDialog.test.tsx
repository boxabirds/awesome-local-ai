import type { RememberedPublic } from '@todoodle/shared/schemas';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSavedLink, linkSavedKey, markLinkSaved, resetLinkSavedCacheForTests } from '@/features/share/linkSaved';
import { A_ID, B_ID, linkFor, OTHER_SECRET, rememberedBody, rememberedEntry } from '../fixtures';
import { server } from '../msw';
import {
  countRequests,
  deferred,
  expectNoAxeViolations,
  openMenu,
  renderApp,
  restoreClipboard,
  stubClipboard,
} from '../render';

const BODY = 'This only removes it from this browser. Anyone with the link can still open it.';
const WARNING = "You haven't saved this link. If you forget it here, you may lose access.";
const COPIED = 'Link copied — you can forget it safely.';
const LINK = linkFor(OTHER_SECRET);

afterEach(() => restoreClipboard());

/** GET /api/remembered backed by a mutable list; DELETE removes from it unless `deleteStatus` says otherwise. */
function rememberedServer(initial: RememberedPublic[], opts: { deleteGate?: Promise<void>; deleteStatus?: number } = {}) {
  let list = initial;
  const deletes: string[] = [];
  server.use(
    http.get('/api/remembered', () => HttpResponse.json(rememberedBody(list))),
    http.delete('/api/remembered/:id', async ({ params }) => {
      deletes.push(String(params.id));
      await opts.deleteGate;
      if (opts.deleteStatus && opts.deleteStatus >= 400) {
        return HttpResponse.json({ error: 'internal', message: 'x' }, { status: opts.deleteStatus });
      }
      list = list.filter((w) => w.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { deletes };
}

function linkServer(opts: { gate?: Promise<void>; status?: number } = {}) {
  return http.get('/api/w/:id/link', async () => {
    await opts.gate;
    return opts.status
      ? HttpResponse.json({ error: 'internal', message: 'x' }, { status: opts.status })
      : HttpResponse.json({ link: LINK });
  });
}

const TWO = () => [rememberedEntry(A_ID, 'Alpha'), rememberedEntry(B_ID, 'Beta', 10)];

async function openForgetDialog(name = 'Alpha') {
  await renderApp({ pathname: '/' });
  await openMenu(await screen.findByRole('button', { name: `More actions for ${name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Forget on this browser' }));
  return screen.findByRole('alertdialog', { name: `Forget ${name} on this browser?` });
}

const rowLink = (name: string) => screen.queryByRole('link', { name: new RegExp(`^${name}\\s*Opened`) });

describe('ForgetDialog', () => {
  it('TC-55 saved link: exact text, no warning; Cancel sends nothing; Forget is optimistic', async () => {
    markLinkSaved(A_ID);
    const gate = deferred();
    const { deletes } = rememberedServer(TWO(), { deleteGate: gate.promise });
    const links = countRequests('GET', /^\/api\/w\/[^/]+\/link$/);
    let dialog = await openForgetDialog();
    expect(within(dialog).getByText(BODY)).toBeInTheDocument();
    expect(within(dialog).queryByText(WARNING)).not.toBeInTheDocument();
    await expectNoAxeViolations(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20));
    expect(deletes).toEqual([]);
    expect(rowLink('Alpha')).toBeInTheDocument();

    await openMenu(screen.getByRole('button', { name: 'More actions for Alpha' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Forget on this browser' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Forget Alpha on this browser?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));
    // Gone before the server answers.
    await waitFor(() => expect(rowLink('Alpha')).not.toBeInTheDocument());
    expect(deletes).toEqual([A_ID]);
    expect(rowLink('Beta')).toBeInTheDocument();
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(rowLink('Alpha')).not.toBeInTheDocument();
    expect(links.count).toBe(0);
  });

  it('TC-56 DELETE 500 -> the row comes back and an alert toast shows', async () => {
    markLinkSaved(A_ID);
    rememberedServer(TWO(), { deleteStatus: 500 });
    const dialog = await openForgetDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't forget this workspace — try again");
    await waitFor(() => expect(rowLink('Alpha')).toBeInTheDocument());
  });

  it('TC-64 unsaved: warning + Copy link; one GET link on click; clipboard; flag set; "Link copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    rememberedServer(TWO());
    const gate = deferred();
    server.use(linkServer({ gate: gate.promise }));
    const links = countRequests('GET', /^\/api\/w\/[^/]+\/link$/);
    const dialog = await openForgetDialog();
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument();
    await expectNoAxeViolations(dialog);
    await new Promise((r) => setTimeout(r, 20));
    expect(links.count).toBe(0);

    const forget = within(dialog).getByRole('button', { name: 'Forget' });
    expect(forget).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(forget).toBeDisabled());
    await waitFor(() => expect(links.count).toBe(1));
    await act(async () => gate.resolve());

    expect(await within(dialog).findByRole('status')).toHaveTextContent(COPIED);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(window.localStorage.getItem(linkSavedKey(A_ID))).toBe('1');
    expect(within(dialog).queryByText(WARNING)).not.toBeInTheDocument();
    expect(forget).toBeEnabled();
    expect(links.count).toBe(1);
  });

  it('TC-65 saved: no warning, no Copy link, zero GET link requests', async () => {
    markLinkSaved(A_ID);
    rememberedServer(TWO());
    const links = countRequests('GET', /^\/api\/w\/[^/]+\/link$/);
    const dialog = await openForgetDialog();
    expect(within(dialog).queryByText(WARNING)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(links.count).toBe(0);
  });

  it.each([
    ['rejects', () => stubClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })],
    ['is undefined', () => stubClipboard(undefined)],
  ])('TC-66 clipboard %s -> pre-selected read-only field, "Copy it manually"; flag not set', async (_label, stub) => {
    stub();
    rememberedServer(TWO());
    server.use(linkServer());
    const dialog = await openForgetDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    const field = await within(dialog).findByLabelText<HTMLInputElement>('Workspace link');
    expect(field).toHaveAttribute('readonly');
    expect(field.value).toBe(LINK);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
    expect(within(dialog).getByText('Copy it manually')).toBeInTheDocument();
    resetLinkSavedCacheForTests();
    expect(hasSavedLink(A_ID)).toBe(false);
    expect(within(dialog).getByRole('button', { name: 'Forget' })).toBeEnabled();
  });

  it('TC-67 GET link 500 -> "Couldn\'t get the link" + Retry; Retry sends a second request; Forget enabled', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    rememberedServer(TWO());
    server.use(linkServer({ status: 500 }));
    const links = countRequests('GET', /^\/api\/w\/[^/]+\/link$/);
    const dialog = await openForgetDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText("Couldn't get the link")).toBeInTheDocument();
    expect(links.count).toBe(1);
    expect(within(dialog).getByRole('button', { name: 'Forget' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(links.count).toBe(2));
    expect(await within(dialog).findByText("Couldn't get the link")).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
    resetLinkSavedCacheForTests();
    expect(hasSavedLink(A_ID)).toBe(false);
  });

  it('TC-68 localStorage.getItem throws -> treated as unsaved, no crash, no console error', async () => {
    const consoleError = vi.spyOn(console, 'error');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    rememberedServer(TWO());
    const dialog = await openForgetDialog();
    expect(within(dialog).getByText(WARNING)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('focus returns to the row menu button when the dialog closes', async () => {
    markLinkSaved(A_ID);
    rememberedServer(TWO());
    const dialog = await openForgetDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions for Alpha' })),
    );
  });
});
