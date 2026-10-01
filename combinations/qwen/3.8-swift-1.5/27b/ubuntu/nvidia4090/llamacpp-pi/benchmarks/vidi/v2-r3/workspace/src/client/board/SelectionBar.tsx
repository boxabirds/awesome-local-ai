import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { ShapeSnap } from '../../shared/objects/shape';
import type { StickyColor, TextSize, FillColor, StrokeColor } from '../../shared/config';

/**
 * Story 7 (sel.selection_bar): the single place where selection actions live.
 *
 * - 1 sticky selected  → the story-2 NoteToolbar (colour swatches + delete)
 * - 1 text selected    → the story-9 TextToolbar (S/M/L/XL + delete)
 * - ≥ 2 selected       → "N selected" + one Delete button (no colour, no text)
 * - nothing selected   → nothing
 */
export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** Delete the whole current selection. */
  onDelete(): void;
  /** Colour change for the single-sticky NoteToolbar (story 2 behaviour). */
  onColor?: (id: string, color: StickyColor) => void;
  /** Size preset change for the single-text TextToolbar (story 9). */
  onTextSize?: (id: string, size: TextSize) => void;
  /** Story 10: shape fill change. */
  onShapeFill?: (id: string, fill: FillColor) => void;
  /** Story 10: shape stroke change. */
  onShapeStroke?: (id: string, stroke: StrokeColor) => void;
}

export function SelectionBar({ ids, snapshot, onDelete, onColor, onTextSize, onShapeFill, onShapeStroke }: SelectionBarProps) {
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
      return (
        <TextToolbar
          size={(obj as TextSnapshot).size}
          onSize={onTextSize ? (s) => onTextSize(id, s) : () => undefined}
          onDelete={onDelete}
        />
      );
    }
    if (obj && obj.type === 'shape') {
      const shape = obj as ShapeSnap;
      return (
        <ShapeToolbar
          fill={shape.fill}
          stroke={shape.stroke}
          onFill={onShapeFill ? (c) => onShapeFill(id, c) : () => undefined}
          onStroke={onShapeStroke ? (c) => onShapeStroke(id, c) : () => undefined}
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
