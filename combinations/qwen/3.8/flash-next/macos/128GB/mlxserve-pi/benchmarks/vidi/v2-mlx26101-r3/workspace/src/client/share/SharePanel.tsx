import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export interface SharePanelProps {
  /** The link, in full, exactly as it should reach the next person. */
  link: string;
}

/**
 * The one thing on the board page that reaches outside this tab.
 *
 * A board is shared by sending somebody its address, so the whole of sharing is a link and a
 * button that copies it. That is also why this panel is careful about what it says: the link it
 * hands over is a board's only means of access, so it is shown in full and never described as a
 * code, a meeting number or anything else that sounds shorter-lived than the board it points at.
 * What the panel says about that link is also the truth about it - anybody who has it can see and
 * change the board, which is the deal being made when a link is sent, and is worth one line.
 *
 * What the panel does *not* do is claim that a link was copied when it was not. The browser's
 * clipboard is the one thing on this page a person can lose - a denied permission, a browser that
 * will not let a script write to it, a page that lost focus - and every one of those ends the same
 * way: the link stays on screen, it is selected so the familiar keystroke is all that is left, the
 * panel says to copy it by hand, and nothing congratulates itself. A person who was told "Link
 * copied" and pasted nothing would blame the board.
 */
export function SharePanel({ link }: SharePanelProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((): void => {
    setOpen(false);
    setCopied(false);
    setManual(false);
    // Back where the person was: a panel that opens and closes should leave the keyboard exactly
    // where it found it, rather than in the middle of nowhere.
    trigger.current?.focus();
  }, []);

  const copy = useCallback((): void => {
    const clipboard = navigator.clipboard;
    // The clipboard is the thing a person can lose, so it is looked up when it is needed rather
    // than assumed at mount time: a page that has been open since before a permission was refused
    // is still a page that has to tell the truth about the next click.
    if (clipboard?.writeText === undefined) {
      setManual(true);
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setManual(false);
      },
      () => {
        setCopied(false);
        setManual(true);
      },
    );
  }, [link]);

  // The link is what is being asked for; a panel that has it on screen but cannot copy it should at
  // least have it selected and holding the keyboard, so that the one keystroke the person has left
  // is the familiar one.
  useEffect(() => {
    if (!manual) {
      return;
    }
    const input = panel.current?.querySelector<HTMLInputElement>('input');
    input?.focus();
    input?.select();
  }, [manual]);

  // "Link copied" is a fact about a moment, not a state: it says the copy worked, and then gets out
  // of the way, so that the panel says the link and nothing else.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, LINK_COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  // Escape, and a click anywhere outside: the two ways a person finishes with a panel like this.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const root = panel.current;
      if (root !== null && !root.contains(event.target as Node) && event.target !== trigger.current) {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  return (
    <div className="share" ref={panel} data-testid="share-panel">
      <button
        type="button"
        ref={trigger}
        className="share__trigger"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Share
      </button>
      {open ? (
        <div className="share__body" role="dialog" aria-label="Share board">
          <p className="share__hint">Share a link to this board</p>
          <input
            className="share__link"
            type="text"
            readOnly
            value={link}
            aria-label="Link to this board"
            data-testid="share-link"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className="share__copy"
            onClick={copy}
            data-testid="copy-link"
            data-copied={copied}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <p className="share__note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
          {manual ? (
            <p className="share__manual" role="status" data-testid="share-manual">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
