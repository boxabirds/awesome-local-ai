/**
 * Story 7: the multi-selection bar (sel.interaction UI). Shown for
 * selections of two or more objects: the count (announced via aria-live) and
 * a Delete button. A single sticky shows the story 2 NoteToolbar instead; an
 * empty selection renders nothing.
 */
export interface SelectionBarProps {
  count: number;
  onDeleteSelection: () => void;
}

export function SelectionBar({ count, onDeleteSelection }: SelectionBarProps): React.ReactElement | null {
  if (count < 2) return null;
  return (
    <div
      data-testid="selection-bar"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: 30,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      <span data-testid="selection-count">{count} selected</span>
      <button
        type="button"
        aria-label="Delete selection"
        onClick={onDeleteSelection}
        style={{
          border: '1px solid rgba(0,0,0,0.2)',
          background: 'transparent',
          borderRadius: 4,
          padding: '2px 10px',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Delete
      </button>
    </div>
  );
}
