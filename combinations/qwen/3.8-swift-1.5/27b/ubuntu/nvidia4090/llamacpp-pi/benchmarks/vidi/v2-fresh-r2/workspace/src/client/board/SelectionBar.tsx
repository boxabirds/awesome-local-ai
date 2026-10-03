/**
 * Floating selection bar (story 7, sel.selectall / sel.delete; story 9,
 * text.size).
 *
 * Rendered in screen space above the board. For a multi-selection it shows a
 * live "N selected" count and a Delete button; for a single sticky note it
 * keeps the story 2 note toolbar (colours + delete); for a single text
 * object it shows the text toolbar (size presets + delete).
 */

import type { JSX } from 'react';
import type { StickyColor } from '../../shared/config';
import type { TextSize } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

interface SelectionBarProps {
  /** Number of selected objects. */
  count: number;
  /** The single selected object (only when count === 1). */
  single?: ObjectSnapshot;
  /**
   * Screen-space anchor (top-centre of the single selected object) for the
   * per-type toolbar. The bar itself is screen-space, so the toolbar must be
   * positioned against the object, not against the viewport corner.
   */
  anchor?: { x: number; y: number };
  onColor(c: StickyColor): void;
  onTextSize(s: TextSize): void;
  onDelete(): void;
}

export function SelectionBar({ count, single, anchor, onColor, onTextSize, onDelete }: SelectionBarProps): JSX.Element | null {
  if (count === 0) return null;

  if (count === 1 && single) {
    return (
      <div
        style={{
          position: 'absolute',
          left: anchor?.x ?? 0,
          top: anchor?.y ?? 0,
          width: 0,
          height: 0,
        }}
      >
        {single.type === 'text' ? (
          <TextToolbar
            size={(single as unknown as { size: TextSize }).size}
            onSize={onTextSize}
            onDelete={onDelete}
          />
        ) : (
          <NoteToolbar
            color={single.type === 'sticky' ? (single as unknown as { color: StickyColor }).color : 'yellow'}
            onColor={onColor}
            onDelete={onDelete}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        backgroundColor: 'white',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000,
        fontSize: 13,
        pointerEvents: 'auto',
      }}
    >
      <span data-testid="selection-count" aria-live="polite">
        {count} selected
      </span>
      <button
        data-testid="delete-selection-btn"
        aria-label="Delete selection"
        onClick={onDelete}
        style={{
          border: 'none',
          backgroundColor: '#fce8e6',
          color: '#c5221f',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Delete
      </button>
    </div>
  );
}
