import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The full link to a board: what a person pastes into chat and what the
 *  browser opens straight back onto that board (share.open_link). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** Where the Share panel is. `manual` is the clipboard-blocked fallback. */
type PanelState = 'open' | 'copied' | 'manual';

const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/**
 * The Share button and its panel (share.copy).
 *
 * It hands a board's link to the clipboard with one click and confirms with
 * "Link copied" for LINK_COPIED_MS. Because a browser may refuse a clipboard
 * write (no permission, an insecure context, or — on some engines — no clipboard
 * API at all), a refusal is not a dead end: the link is selected in its field and
 * the person is told to copy it by hand. The panel spells out the whole of the
 * access model — the link is the key — in a single note.
 */
export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>('open');
  const inputRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const link = boardLink(window.location.origin, boardId);

  useEffect(() => () => {
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    shareRef.current?.focus();
  }, []);

  const openPanel = (): void => {
    setOpen(true);
    setState('open');
  };

  const selectField = (): void => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  };

  const copy = async (): Promise<void> => {
    const clipboard = navigator.clipboard;
    // Some engines have no clipboard; some have one that refuses the write.
    if (!clipboard?.writeText) {
      selectField();
      setState('manual');
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      selectField();
      setState('manual');
      return;
    }
    setState('copied');
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setState('open'), LINK_COPIED_MS);
  };

  // Escape closes; a pointerdown outside the panel closes it (PRD behaviour).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const panel = panelRef.current;
      const share = shareRef.current;
      const target = event.target as Node | null;
      if (panel !== null && target !== null && (panel.contains(target) || share?.contains(target))) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  if (!open) {
    return (
      <button type="button" className="share-button" ref={shareRef} onClick={openPanel} aria-haspopup="dialog">
        Share
      </button>
    );
  }

  return (
    <>
      <button type="button" className="share-button" ref={shareRef} onClick={openPanel} aria-haspopup="dialog">
        Share
      </button>
      <div className="share-panel" role="dialog" aria-label="Share board" ref={panelRef}>
        <input
          className="share-link"
          type="text"
          readOnly
          value={link}
          ref={inputRef}
          onFocus={selectField}
          aria-label="Board link"
        />
        <button type="button" className="share-copy" onClick={() => void copy()}>
          {state === 'copied' ? '\u2713 Link copied' : 'Copy link'}
        </button>
        {state === 'manual' ? <p className="share-manual">{MANUAL_COPY_MESSAGE}</p> : null}
        <p className="share-note">Anyone with this link can view and edit this board.</p>
      </div>
    </>
  );
}
