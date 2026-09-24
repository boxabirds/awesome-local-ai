import type { CSSProperties } from 'react';
import { isSticky, type ObjectSnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { selectedObjects, selectionScreenBox } from './SelectionOverlay';

export const DELETE_SELECTION_LABEL = 'Delete selection';
const HALF = 2;

/** "3 selected" (PRD sel.bar). */
export function selectedCountText(count: number): string {
  return `${count} selected`;
}

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Places the bar above the selection's bounding box. */
  camera: Camera;
  /** Recolours the single selected sticky (story 2 note toolbar). */
  onColor(id: string, color: StickyColor): void;
  /** Board cannot be edited: no note toolbar, and the Delete button is disabled. */
  readOnly?: boolean;
  /** Hidden while a move/resize is in progress or text is being edited (announcer stays). */
  hidden?: boolean;
}

/**
 * Above the selection: "N selected" and a Delete button, or story 2's note toolbar when exactly
 * one sticky note is selected. A visually hidden polite live region announces the count
 * whenever the selection changes.
 */
export function SelectionBar({ ids, snapshot, onDelete, camera, onColor, readOnly = false, hidden = false }: SelectionBarProps) {
  const selected = selectedObjects(ids, snapshot);
  const count = selected.length;
  const box = selectionScreenBox(ids, snapshot, camera);
  const style: CSSProperties | undefined = box ? { left: box.x + box.width / HALF, top: box.y } : undefined;
  const single = count === 1 ? selected[0] : undefined;

  let bar = null;
  if (!hidden && count > 0) {
    if (single && isSticky(single)) {
      if (!readOnly) {
        bar = (
          <NoteToolbar color={single.color} style={style} onColor={(c) => onColor(single.id, c)} onDelete={onDelete} />
        );
      }
    } else {
      bar = (
        <div
          className="selection-bar"
          role="toolbar"
          aria-label="Selection"
          style={style}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span className="selection-bar__count">{selectedCountText(count)}</span>
          <span className="note-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="note-toolbar__delete"
            aria-label={DELETE_SELECTION_LABEL}
            title={DELETE_SELECTION_LABEL}
            disabled={readOnly}
            onClick={onDelete}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      );
    }
  }

  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="selection-announcer">
        {count > 0 ? selectedCountText(count) : ''}
      </div>
      {bar}
    </>
  );
}
