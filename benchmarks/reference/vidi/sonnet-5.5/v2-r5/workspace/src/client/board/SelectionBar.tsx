import { type StickyColor } from '../../shared/config';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { selectionScreenBox } from './SelectionOverlay';

const BAR_GAP_PX = 8;
const HALF = 2;
const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * "N selected" + Delete for two or more objects; story 2's note toolbar for exactly one sticky note.
 * Positioned above the selection when a camera is given.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>; snapshot: readonly ObjectSnapshot[]; onDelete(): void;
  camera?: Camera;
  onColor?(id: string, color: StickyColor): void;
  /** No Delete button or note tools while the board cannot be edited. */
  readOnly?: boolean;
}) {
  const { ids, snapshot, camera = ORIGIN_CAMERA, readOnly = false } = props;
  const selected = snapshot.filter((o) => ids.has(o.id));
  const count = selected.length;
  if (count === 0) return null;
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box) return null;
  const style = { left: box.x + box.width / HALF, top: Math.max(BAR_GAP_PX, box.y - BAR_GAP_PX) };
  const single = count === 1 && selected[0].type === 'sticky' ? (selected[0] as StickySnapshot) : null;

  if (single) {
    return (
      <>
        <span className="visually-hidden" aria-live="polite">1 selected</span>
        {!readOnly && (
          <div className="selection-bar-anchor" style={style}>
            <NoteToolbar
              color={single.color}
              onColor={(c) => props.onColor?.(single.id, c)}
              onDelete={props.onDelete}
            />
          </div>
        )}
      </>
    );
  }
  return (
    <div className="selection-bar-anchor" style={style}>
      <div className="selection-bar" role="group" aria-label="Selection" onPointerDown={(e) => e.stopPropagation()}>
        <span aria-live="polite">{count} selected</span>
        {!readOnly && (
          <button
            type="button" className="note-delete" aria-label="Delete selection" title="Delete selection"
            onClick={props.onDelete}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
