/**
 * The Share panel (share.share_panel).
 *
 * One thing makes this panel more than a text field: the clipboard can be taken away.
 * Browsers refuse it on an insecure origin, in a private window, or when the person
 * has said no to a paste before — and the panel cannot tell which. So the tests here
 * are mostly about the three ways a copy can fail (refused, absent, not a function at
 * all) and the one behaviour that covers all of them: the link selected in a field,
 * with the words that make the keyboard do the rest (share.copy_fallback).
 *
 * Fake timers are the point in TC-22: "Link copied" is a duration, and a test that
 * slept for two seconds would be slow and still not prove the boundary.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SharePanel } from '../../src/client/share/SharePanel';
import { boardPath } from '../../src/client/router';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const boardId = newBoardId();
const link = `${window.location.origin}${boardPath(boardId)}`;

let writeText: ReturnType<typeof vi.fn> | undefined;
const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');

/** Put a clipboard on this page, or take it away. */
function withClipboard(value: unknown): void {
  Object.defineProperty(Navigator.prototype, 'clipboard', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  withClipboard({ writeText });
});

afterEach(() => {
  if (originalClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', originalClipboard);
  else delete (Navigator.prototype as unknown as { clipboard?: unknown }).clipboard;
});

/** Let the page finish what the copy started, and optionally pass some time. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Open the panel, ask for a copy, and hand back the link field it leaves selected. */
async function copyByHand(): Promise<HTMLInputElement> {
  openPanel();
  fireEvent.click(screen.getByTestId('share-copy'));
  await settle();
  return screen.getByTestId('share-link') as HTMLInputElement;
}

function openPanel(): void {
  render(<SharePanel boardId={boardId} />);
  fireEvent.click(screen.getByTestId('share-button'));
}

it('TC-22: Copy link copies the whole address, and the tick lasts its moment', async () => {
  openPanel();

  expect((screen.getByTestId('share-link') as HTMLInputElement).value).toBe(link);
  const copy = screen.getByTestId('share-copy');
  fireEvent.click(copy);
  await settle();

  // The absolute address, not the path: a pasted link has to work away from this page.
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(link);
  expect(link).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

  expect(copy.textContent).toContain('Link copied');
  expect(screen.getByTestId('share-panel')).not.toBeNull();

  await settle(LINK_COPIED_MS - 1);
  expect(copy.textContent).toContain('Link copied');

  // The boundary: at LINK_COPIED_MS the confirmation is over, and the panel is still
  // open with the button ready — the person is about to paste the link somewhere.
  await settle(1);
  expect(copy.textContent).toBe('Copy link');
  expect(screen.getByTestId('share-panel')).not.toBeNull();
});

it('TC-23: when the write is refused, the link is ready to copy by hand', async () => {
  withClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
  const field = await copyByHand();

  expect(screen.getByTestId('share-manual')?.textContent).toContain('Press Ctrl+C (Cmd+C on Mac) to copy');
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(link.length);
  expect(document.activeElement).toBe(field);
  // The panel is still there to copy from: nothing was lost by the refusal.
  expect(screen.getByTestId('share-panel')).not.toBeNull();
});

for (const [label, clipboard] of [
  ['there is no clipboard at all', undefined],
  // A clipboard object with no usable writeText: what an unfinished or odd browser
  // hands back. Feature-detecting the object would be confident about nothing.
  ['the clipboard has no writeText', { writeText: 'not a function' }],
] as [string, unknown][]) {
  it(`TC-24: when ${label}, the link is ready to copy by hand`, async () => {
    withClipboard(clipboard);
    const field = await copyByHand();

    expect(screen.getByTestId('share-manual')?.textContent).toContain('Press Ctrl+C (Cmd+C on Mac) to copy');
    // Selected in full, and focused, so the keystroke lands wherever the focus is.
    expect(field.value).toBe(link);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(link.length);
    expect(document.activeElement).toBe(field);
  });
}

it('TC-25: Escape and a click outside both close it, and focus goes home', () => {
  openPanel();
  expect(screen.getByTestId('share-panel')).not.toBeNull();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('share-panel')).toBeNull();
  expect(document.activeElement).toBe(screen.getByTestId('share-button'));

  fireEvent.click(screen.getByTestId('share-button'));
  expect(screen.getByTestId('share-panel')).not.toBeNull();

  fireEvent.pointerDown(document.body);
  expect(screen.queryByTestId('share-panel')).toBeNull();
  expect(document.activeElement).toBe(screen.getByTestId('share-button'));
});

it('clicking in the link field selects the whole link', () => {
  openPanel();
  const field = screen.getByTestId('share-link') as HTMLInputElement;
  fireEvent.focus(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(link.length);
});
