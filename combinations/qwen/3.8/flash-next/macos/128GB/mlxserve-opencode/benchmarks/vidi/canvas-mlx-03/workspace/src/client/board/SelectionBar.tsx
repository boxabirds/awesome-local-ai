// The selection bar (design `sel.interaction`).
//
// While two or more objects are selected it floats above their bounding box and
// says how many are selected, with one button that deletes the whole selection.
// With a single object selected there is nothing to say — the caller shows that
// object's own toolbar instead (story 2's note toolbar) — so this renders nothing.

import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model.ts';

export interface SelectionBarProps {
  /** The current selection. */
  ids: ReadonlySet<string>;
  /** The objects in the document, to count only ids that still exist. */
  snapshot: readonly ObjectSnapshot[];
  /** Remove every selected object. */
  onDelete(): void;
}

function stop(e: React.PointerEvent | React.MouseEvent | React.WheelEvent) {
  e.stopPropagation();
}

/**
 * "N selected" plus a delete button, in screen space (it does not scale with
 * zoom, like the note toolbar). Returns null for fewer than two objects, so the
 * board never shows two toolbars for one selection.
 */
export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const present = new Set(props.snapshot.map((o) => o.id));
  const count = [...props.ids].filter((id) => present.has(id)).length;
  if (count < 2) return null;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection options"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        fontSize: 13,
        color: '#2c2f36',
        whiteSpace: 'nowrap',
      }}
    >
      <span data-testid="selection-count">{`${count} selected`}</span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: '22px',
          color: '#b3261e',
        }}
      >
        <span aria-hidden>&#128465;</span>
      </button>
    </div>
  );
}
