/**
 * Bar above the selection (anchor: sel.bar): "N selected" and a Delete button when two or
 * more objects are selected; story 2's note toolbar when exactly one sticky note is. A
 * polite live region announces the count to screen readers whenever it changes.
 */
import type { CSSProperties, SyntheticEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { isStickySnapshot, type ObjectSnapshot } from '../../shared/board-model';
import { NOTE_TOOLBAR_GAP_PX, type StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';
import { selectedObjects, selectionBounds, toScreenRect } from './SelectionOverlay';

const HALF = 2;

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Positions the bar above the selection's bounding box (screen space). */
  camera?: Camera;
  /** Recolours a single selected sticky note (note toolbar). */
  onColor?(id: string, color: StickyColor): void;
  /** False while the board is read-only: no Delete button, no note toolbar. */
  editable?: boolean;
  /** Hides the bar (not the announcement) while editing text or moving/resizing. */
  hidden?: boolean;
}

export function selectionLabel(count: number): string {
  return `${count} selected`;
}

export function SelectionBar(props: SelectionBarProps): React.JSX.Element | null {
  const objs = selectedObjects(props.ids, props.snapshot);
  const count = objs.length;
  const editable = props.editable ?? true;
  const box = selectionBounds(props.ids, props.snapshot);
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  let position: CSSProperties | undefined;
  if (props.camera !== undefined && box !== null) {
    const r = toScreenRect(props.camera, box);
    position = { left: `${r.x + r.width / HALF}px`, top: `${r.y - NOTE_TOOLBAR_GAP_PX}px` };
  }

  const single = count === 1 ? objs[0] : undefined;
  let content: React.JSX.Element | null = null;
  if (props.hidden !== true && box !== null) {
    if (count >= 2) {
      content = (
        <div
          className="selection-bar"
          role="toolbar"
          aria-label="Selection"
          data-testid="selection-bar"
          onPointerDown={stop}
          onPointerUp={stop}
          onDoubleClick={stop}
          onWheel={stop}
          onKeyDown={stop}
        >
          <span className="selection-count">{selectionLabel(count)}</span>
          {editable && (
            <>
              <span className="note-toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="note-delete"
                aria-label="Delete selection"
                title="Delete selection"
                onClick={props.onDelete}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path
                    d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      );
    } else if (single !== undefined && isStickySnapshot(single) && editable) {
      const id = single.id;
      content = (
        <NoteToolbar color={single.color} onColor={(c) => props.onColor?.(id, c)} onDelete={props.onDelete} />
      );
    }
  }

  return (
    <>
      <div className="sr-only" aria-live="polite" data-testid="selection-announcement">
        {count > 0 ? selectionLabel(count) : ''}
      </div>
      {content !== null && (
        <div className="selection-bar-anchor" style={position}>
          {content}
        </div>
      )}
    </>
  );
}
