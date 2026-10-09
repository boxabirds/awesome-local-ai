import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

/** Exact UI text (PRD: Left-side vertical toolbar with a "Sticky note" button). */
export const STICKY_BUTTON_LABEL = 'Sticky note';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';
export const SHARE_BUTTON_LABEL = 'Share board';
export const SHARE_BUTTON_TOOLTIP = 'Share board – copy the link to this board';

export interface ToolbarProps {
  /** Creates a note in the middle of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /** The link that opens this board; the Share button puts it on the clipboard. */
  shareUrl: string;
}

/**
 * The fixed left toolbar. Its buttons are always available, whatever else is happening
 * on the board. Pointer events stop here so a click on a button never reaches the
 * viewport (which would pan the board and clear the selection).
 *
 * Sharing a board is only ever copying its link: there is no membership, no invite and
 * nothing to join, so the link *is* the invitation.
 */
export function Toolbar({ onCreateSticky, shareUrl }: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  const share = (): void => {
    // Clipboard access can be missing or refused; either way the board carries on.
    const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    if (!clipboard) return;
    clipboard.writeText(shareUrl).catch(() => {});
  };

  return (
    <div
      className="vidi6-toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="vidi6-sticky-glyph" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{STICKY_BUTTON_LABEL}</span>
      </button>
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="share-board"
        aria-label={SHARE_BUTTON_LABEL}
        title={SHARE_BUTTON_TOOLTIP}
        onClick={share}
      >
        <span className="vidi6-toolbar-text">{SHARE_BUTTON_LABEL}</span>
      </button>
    </div>
  );
}
