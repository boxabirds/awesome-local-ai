import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/**
 * The Share panel: a Share button in the top-right corner that opens a small
 * panel holding the board's full link and a Copy link button (share.copy). The
 * access model is written on its face — "Anyone with this link can view and edit
 * this board" — because possession of the link is the only access control
 * (design: security model).
 *
 * The clipboard is not a guarantee: browsers refuse it on permission or in an
 * insecure context, and this is exactly why the PRD wants a fallback
 * (share.copy_fallback). When a copy cannot be completed the link is selected in
 * the field and the person is told to copy it themselves. Both paths are forced
 * in the component tests so neither rots.
 */

/** A board's full link: the origin this page is served from, plus its address. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

const MANUAL_COPY_COPY = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const NOTE_COPY = 'Anyone with this link can view and edit this board.';

/** Panel lifecycle. `copied` and `manual` are both "the panel is open, and here
 * is what the last copy attempt did". */
type PanelState = 'closed' | 'open' | 'copied' | 'manual';

const buttonStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#4A90D9',
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.20)',
};

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 60,
  right: 16,
  width: 320,
  padding: 16,
  borderRadius: 12,
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.22)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  zIndex: 20,
};

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(0, 0, 0, 0.20)',
  font: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
};

const copyButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#2E7D32',
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};

export function SharePanel({ boardId }: { boardId: string }): ReactNode {
  const [state, setState] = useState<PanelState>('closed');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const link = boardLink(window.location.origin, boardId);

  const open = useCallback((): void => setState('open'), []);

  const close = useCallback((): void => {
    setState('closed');
    // Focus returns to the button the person opened the panel from, so the
    // keyboard does not get dropped on the floor when the panel goes away.
    shareButtonRef.current?.focus();
  }, []);

  // Hand the field over to the person: select the whole link and focus it, so a
  // manual Ctrl/Cmd+C has exactly the link ready (share.copy_fallback).
  const takeManualCopy = useCallback((): void => {
    setState('manual');
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const copyLink = useCallback((): void => {
    const clipboard = navigator.clipboard;
    // No clipboard, or one without writeText (an insecure context): go straight
    // to the manual fallback rather than pretending to have copied.
    if (typeof clipboard?.writeText !== 'function') {
      takeManualCopy();
      return;
    }
    clipboard.writeText(link).then(
      (): void => setState('copied'),
      (): void => takeManualCopy(),
    );
  }, [link, takeManualCopy]);

  // "Link copied" holds for LINK_COPIED_MS and then reverts to "Copy link".
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('open'), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Escape closes; a pointerdown anywhere outside the panel (and not on the
  // Share button itself) closes. PRD Behaviour: outside click and Escape.
  useEffect(() => {
    if (state === 'closed') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [state, close]);

  if (state === 'closed') {
    return (
      <button
        type="button"
        data-testid="share-button"
        ref={shareButtonRef}
        style={buttonStyle}
        onClick={open}
      >
        Share
      </button>
    );
  }

  const copied = state === 'copied';
  return (
    <div
      data-testid="share-panel"
      role="dialog"
      aria-label="Share board"
      ref={panelRef}
      style={panelStyle}
      // Keep the panel's own interactions from reaching the board underneath.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="share-button"
        ref={shareButtonRef}
        style={{ ...buttonStyle, position: 'absolute', top: -44, right: 0 }}
        onClick={close}
      >
        Share
      </button>

      <input
        data-testid="share-link-field"
        ref={inputRef}
        type="text"
        readOnly
        value={link}
        aria-label="Board link"
        style={fieldStyle}
        // Clicking the field selects the whole link (PRD Behaviour).
        onClick={(event) => event.currentTarget.select()}
        onFocus={(event) => event.currentTarget.select()}
      />

      <button
        type="button"
        data-testid="copy-link-button"
        style={copyButtonStyle}
        onClick={copyLink}
      >
        {copied ? '✓ Link copied' : 'Copy link'}
      </button>

      {state === 'manual' ? (
        <p data-testid="manual-copy-hint" style={{ margin: 0, fontSize: 13 }}>
          {MANUAL_COPY_COPY}
        </p>
      ) : null}

      <p data-testid="share-note" style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
        {NOTE_COPY}
      </p>
    </div>
  );
}
