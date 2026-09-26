import type { ReactElement, SyntheticEvent } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '@/shared/board-model';
import { setStickyColor } from '@/shared/board-model';
import { STICKY_COLORS, DEFAULT_STICKY_COLOR, type StickyColor } from '@/shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

/**
 * Selection bar (story 7, sel.interaction). Rendered above the selection's
 * bounding box (the Board positions it in screen space):
 *
 *  - >= 2 selected objects: "<n> selected" (aria-live count announcement) +
 *    a "Delete selection" button.
 *  - exactly one sticky: the story 2 NoteToolbar (colour + delete) instead.
 *
 * Deleting goes through the Board's `onDelete` (deleteObjects + clear); the
 * bar itself never touches the doc except for the single-sticky colour.
 */

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** The board's doc (needed by the single-sticky NoteToolbar colour action). */
  doc: Y.Doc;
  /** Story 4: the single-sticky toolbar is hidden while the board is locked. */
  editable: boolean;
  /** The single-sticky toolbar is hidden while that note is being edited. */
  editingId: string | null;
  /** The single-sticky toolbar is hidden while the note is being dragged. */
  draggingIds: ReadonlySet<string> | null;
  /** Deletes the whole current selection (all ids, not just stickies). */
  onDelete(): void;
}

function stop(e: SyntheticEvent): void {
  e.stopPropagation();
}

export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const { ids, snapshot, doc, editable, editingId, draggingIds, onDelete } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  // Exactly one selected object and it is a sticky: story 2's toolbar —
  // hidden while locked, while that note is being edited, or while it is
  // part of an active drag (story 2 states).
  if (selected.length === 1 && selected[0].type === 'sticky') {
    const sticky = selected[0];
    const hidden =
      !editable || editingId === sticky.id || (draggingIds !== null && draggingIds.has(sticky.id));
    if (hidden) return null;
    const color: StickyColor =
      typeof sticky.color === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, sticky.color)
        ? (sticky.color as StickyColor)
        : DEFAULT_STICKY_COLOR;
    return (
      <NoteToolbar
        color={color}
        onColor={(c) => {
          setStickyColor(doc, sticky.id, c);
        }}
        onDelete={onDelete}
      />
    );
  }

  const count = selected.length;
  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onClick={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        userSelect: 'none',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <span
        data-testid="selection-count"
        aria-live="polite"
        style={{ fontSize: 13, color: 'rgba(0, 0, 0, 0.8)', whiteSpace: 'nowrap' }}
      >
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        data-testid="delete-selection"
        onClick={onDelete}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 24,
          padding: '0 8px',
          borderRadius: 4,
          border: '1px solid rgba(0, 0, 0, 0.2)',
          background: 'transparent',
          cursor: 'pointer',
          color: 'rgba(0, 0, 0, 0.7)',
          fontSize: 12,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: 5 }}>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 10v6M14 10v6" />
        </svg>
        Delete
      </button>
    </div>
  );
}
