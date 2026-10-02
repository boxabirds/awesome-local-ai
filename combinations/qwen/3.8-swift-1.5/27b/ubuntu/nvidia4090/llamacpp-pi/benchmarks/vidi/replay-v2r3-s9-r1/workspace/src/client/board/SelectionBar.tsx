import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { StickyColor, TextSize } from '../../shared/config';

/**
 * Story 7 (sel.selection_bar): the single place where selection actions live.
 *
 * - 1 sticky selected  → the story-2 NoteToolbar (colour swatches + delete)
 * - 1 text selected    → the story-9 TextToolbar (S/M/L/XL + delete)
 * - ≥ 2 selected       → "N selected" + one Delete button
 * - nothing selected   → nothing
 */
export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** Delete the whole current selection. */
  onDelete(): void;
  /** Colour change for the single-sticky NoteToolbar (story 2 behaviour). */
  onColor?: (id: string, color: StickyColor) => void;
  /** Story 9: size change for the single-text TextToolbar. */
  onTextSize?: (id: string, size: TextSize) => void;
}

export function SelectionBar({ ids, snapshot, onDelete, onColor, onTextSize }: SelectionBarProps) {
  const n = ids.size;
  if (n === 0) return null;

  if (n === 1) {
    const [id] = [...ids];
    const obj = snapshot.find((o) => o.id === id);
    if (obj && obj.type === 'sticky') {
      return (
        <NoteToolbar
          color={(obj as StickySnapshot).color}
          onColor={onColor ? (c) => onColor(id, c) : () => undefined}
          onDelete={onDelete}
        />
      );
    }
    if (obj && obj.type === 'text') {
      const size = (obj as any).size ?? 'M' as TextSize;
      return (
        <TextToolbar
          size={size}
          onSize={(s) => onTextSize?.(id, s)}
          onDelete={onDelete}
        />
      );
    }
    return null;
  }

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection options"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(255,255,255,0.97)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        color: '#333',
        userSelect: 'none',
      }}
    >
      <span data-testid="selection-count" aria-live="polite">
        {n} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection (Del)"
        onClick={onDelete}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        <span aria-hidden>🗑</span>
      </button>
    </div>
  );
}
