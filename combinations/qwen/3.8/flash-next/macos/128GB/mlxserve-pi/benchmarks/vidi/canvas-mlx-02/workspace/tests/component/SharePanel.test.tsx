// The panel that carries the link: what it shows, what it puts on the clipboard,
// what it says after, and what it stops saying when the copy did not happen or the
// panel it was said in is gone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SharePanel } from '../../src/client/share/SharePanel.tsx';
import { panelHarness } from './story5TestUtils.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LINK_COPIED_MS } from '../../src/shared/config.ts';

const id = newBoardId();
const urlOf = (boardId: string) => `${location.origin}/b/${boardId}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('the Share panel shows the board it is about', () => {
  it('TC-16: shows the address of the board it is about', () => {
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByTestId('share-button'));

    const h = panelHarness();
    expect(h.linkValue()).toBe(urlOf(id));
    // Selectable text the visitor can take with their own hands: never disabled,
    // and focus puts the whole address into their selection.
    expect(h.linkInput()).not.toBeDisabled();
    fireEvent.focus(h.linkInput()!);
    expect((h.linkInput() as HTMLInputElement).selectionStart).toBe(0);
    // What a link grants is said on the panel, because until permissions exist the
    // link is the whole of this board's access.
    expect(screen.getByTestId('share-panel').getAttribute('aria-label')).toBe('Share board');
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );
  });
});

describe('copying the link', () => {
  it('TC-20: a press copies that address and says it once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SharePanel boardId={id} open />);

    fireEvent.click(screen.getByTestId('copy-link-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(urlOf(id)));
    await waitFor(() => expect(panelHarness().copyClaim()).toBe('Link copied'));
    expect(screen.getByTestId('copy-link-button').getAttribute('data-copied')).toBe('true');

    // The claim is made once. A panel that said "Link copied" in the button and
    // again in the slot, or that said it beside the instruction for taking the link
    // by hand, is the failure this story exists to avoid.
    expect(screen.getAllByText('Link copied')).toHaveLength(1);
    expect(panelHarness().copyMessage()).toBeNull();
    expect(screen.queryByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeNull();
  });

  it('TC-21: a clipboard that refuses leaves the address selectable and tells the visitor to take it', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Document is not focused'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SharePanel boardId={id} open />);

    fireEvent.click(screen.getByTestId('copy-link-button'));
    await waitFor(() =>
      expect(panelHarness().copyMessage()).toBe('Press Ctrl+C (Cmd+C on Mac) to copy'),
    );

    const h = panelHarness();
    expect(h.linkInput()).not.toBeDisabled();
    expect(h.linkValue()).toBe(urlOf(id));
    // The text is put into the visitor's hands, not merely mentioned: focused, and
    // the whole of it selected, so the keystroke in the sentence does the copy.
    expect(h.linkInput()).toBe(document.activeElement);
    expect((h.linkInput() as HTMLInputElement).selectionStart).toBe(0);
    expect((h.linkInput() as HTMLInputElement).selectionEnd).toBe(urlOf(id).length);
    // A clipboard that refused is never reported as a copy that happened.
    expect(screen.queryByText('Link copied')).toBeNull();
    expect(h.copyButton()?.getAttribute('data-copied')).toBeNull();
  });

  it('TC-21b: an answer that arrives after the panel was shut is not shown when it reopens', async () => {
    let finish: () => void = () => {};
    const copy = () => new Promise<void>((resolve) => (finish = resolve));
    // Uncontrolled, because the visitor is the one who opens and shuts it here.
    render(<SharePanel boardId={id} copy={copy} />);
    fireEvent.click(screen.getByTestId('share-button'));

    fireEvent.click(screen.getByTestId('copy-link-button'));
    expect(screen.getByTestId('copy-link-button')).toBeDisabled();
    expect(panelHarness().copyMessage()).toBeNull();

    // The visitor takes the panel back out of the way while the write is pending.
    act(() => {
      fireEvent.click(screen.getByTestId('share-button'));
    });
    expect(panelHarness().panel()).toBeNull();

    await act(async () => {
      finish();
    });

    // The copy that was in flight belongs to a panel that is gone.
    expect(panelHarness().copyClaim()).toBeNull();
    fireEvent.click(screen.getByTestId('share-button'));
    expect(panelHarness().copyClaim()).toBeNull();
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('TC-17: presses in a row mean one copy, not two races for the message', async () => {
    const writeText = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SharePanel boardId={id} open />);

    fireEvent.click(screen.getByTestId('copy-link-button'));
    fireEvent.click(screen.getByTestId('copy-link-button'));
    fireEvent.click(screen.getByTestId('copy-link-button'));

    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('TC-16b: the address that is copied is the address that is shown, whatever it says', async () => {
    // A different origin and pathname, so "the shown one" and "the copied one" are
    // two different claims that the test can tell apart.
    const shown = `https://board.example.test/b/${id}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    render(
      <SharePanel boardId={id} open getShareUrl={() => shown} copy={(t) => writeText(t) as unknown as Promise<void>} />,
    );

    expect(panelHarness().linkValue()).toBe(shown);
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown));
  });

  it('the "copied" message is not a permanent fixture of the panel', async () => {
    vi.useFakeTimers();
    const copy = () => Promise.resolve();
    render(<SharePanel boardId={id} open copy={copy} />);

    fireEvent.click(screen.getByTestId('copy-link-button'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(panelHarness().copyClaim()).toBe('Link copied');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS);
    });
    expect(panelHarness().copyClaim()).toBeNull();
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Copy link');
  });

  it('a different board in the same panel starts with nothing claimed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const first = newBoardId();
    const second = newBoardId();
    const { rerender } = render(<SharePanel boardId={first} open copy={(t) => writeText(t) as unknown as Promise<void>} />);
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await waitFor(() => expect(panelHarness().copyClaim()).toBe('Link copied'));

    rerender(<SharePanel boardId={second} open copy={(t) => writeText(t) as unknown as Promise<void>} />);
    expect(panelHarness().copyClaim()).toBeNull();
    expect(panelHarness().linkValue()).toBe(urlOf(second));
  });
});

describe('the panel is put away', () => {
  it('Escape closes it, and the pointer is left on the button that opens it again', () => {
    render(<SharePanel boardId={id} />);
    const toggle = screen.getByTestId('share-button');
    fireEvent.click(toggle);
    expect(panelHarness().panel()).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panelHarness().panel()).toBeNull();
    expect(toggle).toBe(document.activeElement);
  });

  it('a press anywhere else on the page closes it', () => {
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent.pointerDown(outside);
    expect(panelHarness().panel()).toBeNull();
    outside.remove();
  });

  it('a press inside the panel keeps it open, and the panel keeps its answer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const inside = screen.getByTestId('share-panel');

    fireEvent.pointerDown(inside);
    expect(panelHarness().panel()).toBeTruthy();

    fireEvent.click(screen.getByTestId('copy-link-button'));
    await waitFor(() => expect(panelHarness().copyClaim()).toBe('Link copied'));
    // The keystroke that dismisses a note being edited is the note's own; it must
    // not be the panel's business.
    const editor = document.createElement('textarea');
    editor.className = 'sticky-editor';
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(panelHarness().panel()).toBeTruthy();
    editor.remove();
  });
});

describe('a board that the server cannot read', () => {
  it('TC-22: its panel offers nothing to copy and says why', () => {
    render(<SharePanel boardId={id} connectionState="load_failed" open />);

    expect(screen.getByTestId('share-button')).toBeDisabled();
    expect(screen.queryByTestId('copy-link-button')).toBeNull();
    expect(screen.getByTestId('share-disabled-note')).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
  });
});
