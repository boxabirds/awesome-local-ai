/**
 * The Share panel (story 5, task 6: TC-22 to TC-25).
 *
 * The clipboard is a seam here, because it is a seam in real life: the
 * asynchronous API needs a secure context and a permission, and it is missing or
 * denied on some of the browsers this app ships to. The panel's whole second
 * half — select the link and say what to press — only matters in those cases, so
 * they are tested with the same weight as the happy path.
 *
 * Time is fake for the copied confirmation, because "Link copied for two
 * seconds" is a promise with a boundary in it: still shown one millisecond
 * before, gone at it.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_TEXT, SharePanel } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const ORIGIN = 'https://vidi6.example';
const ID = 'abcdefghij_abcdef-1234';
const LINK = `${ORIGIN}/b/${ID}`;

function panel(clipboard: { writeText?: (text: string) => Promise<void> } | undefined) {
  return render(
    <SharePanel
      boardId={ID}
      link={LINK}
      clipboard={clipboard ?? {}}
    />,
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const find = (container: HTMLElement, testId: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

const trigger = (container: HTMLElement): HTMLButtonElement =>
  find(container, 'share-trigger') as HTMLButtonElement;
const copyButton = (container: HTMLElement): HTMLButtonElement =>
  find(container, 'share-copy') as HTMLButtonElement;
const linkField = (container: HTMLElement): HTMLInputElement =>
  container.querySelector<HTMLInputElement>('[data-testid="share-link"]')!;

/** Open the panel and press Copy link. */
async function copyLink(container: HTMLElement): Promise<void> {
  await click(trigger(container));
  expect(find(container, 'share-panel')).not.toBeNull();
  await click(copyButton(container));
}

describe('the panel copies the link (TC-22)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-22 puts the whole address on the clipboard and reverts after 2s', async () => {
    const written: string[] = [];
    const clipboard = {
      writeText: async (text: string): Promise<void> => {
        written.push(text);
      },
    };
    const { container } = render(<SharePanel boardId={ID} link={LINK} clipboard={clipboard} />);

    await click(trigger(container));
    // The address is readable before anything is copied: the panel is where you
    // look it up, not only somewhere to press.
    expect(linkField(container).value).toBe(LINK);

    await click(copyButton(container));
    expect(written).toEqual([LINK]);
    expect(find(container, 'share-manual')).toBeNull();

    // The boundary: the confirmation is still up one millisecond short of two
    // seconds, and gone at two seconds exactly.
    expect(copyButton(container).textContent).toBe(SHARE_TEXT.copied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(copyButton(container).textContent).toBe(SHARE_TEXT.copied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(copyButton(container).textContent).toBe(SHARE_TEXT.copy);
    // The panel stays open; only the confirmation is timed.
    expect(find(container, 'share-panel')).not.toBeNull();
  });
});

describe('the panel copes when copying is not allowed (TC-23, TC-24)', () => {
  it('TC-23 selects the link when the clipboard rejects', async () => {
    const clipboard = {
      writeText: (): Promise<void> => Promise.reject(new Error('NotAllowedError')),
    };
    const { container } = render(<SharePanel boardId={ID} link={LINK} clipboard={clipboard} />);

    await copyLink(container);

    const field = linkField(container);
    // The whole link, not the caret: the fallback is "one keystroke away".
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
    expect(find(container, 'share-manual')?.textContent).toBe(SHARE_TEXT.manual);
    // And it never claims to have copied.
    expect(copyButton(container).textContent).not.toBe(SHARE_TEXT.copied);
  });

  it('TC-24 does the same when there is no clipboard at all', async () => {
    const { container } = render(<SharePanel boardId={ID} link={LINK} clipboard={undefined} />);

    await copyLink(container);

    const field = linkField(container);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
    expect(find(container, 'share-manual')?.textContent).toBe(SHARE_TEXT.manual);
  });

  it('says the same thing a real browser without the API says', async () => {
    // The default seam reads `navigator.clipboard`, which jsdom does not have.
    expect(globalThis.navigator.clipboard).toBeUndefined();
    const { container } = render(<SharePanel boardId={ID} link={LINK} />);
    await copyLink(container);
    expect(find(container, 'share-manual')?.textContent).toBe(SHARE_TEXT.manual);
  });
});

describe('the panel closes the way a dialog does (TC-25)', () => {
  it('TC-25 closes on Escape and on a click outside, and gives focus back', async () => {
    const clipboard = { writeText: async (): Promise<void> => undefined };
    const { container } = render(<SharePanel boardId={ID} link={LINK} clipboard={clipboard} />);

    // Escape, from inside the panel.
    await click(trigger(container));
    expect(find(container, 'share-panel')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(find(container, 'share-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger(container));

    // A pointer down anywhere else, including on the board behind it.
    await click(trigger(container));
    expect(find(container, 'share-panel')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
    });
    expect(find(container, 'share-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
  });

  it('leaves the note about what a link means, because the link is the permission', async () => {
    const { container } = render(
      <SharePanel boardId={ID} link={LINK} clipboard={undefined} />,
    );
    await click(trigger(container));
    expect(find(container, 'share-note')?.textContent).toBe(SHARE_TEXT.note);
  });
});
