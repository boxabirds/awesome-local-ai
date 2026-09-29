/**
 * Story 7: the multi-selection action bar (sel.multibar).
 *
 * Appears only when TWO OR MORE objects are selected, above the selection's
 * bounding box: "N selected" (announced via aria-live, sel.a11y) and a
 * Delete action that removes every selected object (sel.delete_multi).
 * With exactly one sticky note the story 2 note toolbar is shown instead —
 * the two never appear at once.
 */
import type { JSX } from 'react';

export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  /** Disabled when the board is `load_failed` (sel.lock). */
  disabled: boolean;
  onDelete: () => void;
}): JSX.Element | null {
  const count = props.ids.size;
  if (count < 2) return null;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: '#202124',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span
        data-testid="selection-count"
        aria-live="polite"
        style={{ color: '#fff', fontSize: 12, fontFamily: 'system-ui, sans-serif' }}
      >
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-button"
        disabled={props.disabled}
        onClick={props.onDelete}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          border: 'none',
          borderRadius: 4,
          background: '#3C4043',
          color: '#fff',
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
          cursor: props.disabled ? 'default' : 'pointer',
          opacity: props.disabled ? 0.5 : 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none">
          <path
            d="M5 2V1.5C5 1.224 5.224 1 5.5 1h5c.276 0 .5.224.5.5V2h3v1.5H2V2h3Zm1 3.5v7h6v-7H6Zm7.5 0H13v7c0 .827-.673 1.5-1.5 1.5h-7C3.673 14 3 13.327 3 12.5v-7H2.5V12.5C2.5 13.605 3.395 14.5 4.5 14.5h7c1.105 0 2-.895 2-2V5.5h.5Z"
            fill="currentColor"
          />
        </svg>
        Delete
      </button>
    </div>
  );
}
