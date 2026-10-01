import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';

const BAR_GAP_PX = 10;
const HALF = 2;

/**
 * "N selected" + Delete for two or more objects; the sticky note toolbar for exactly one sticky note.
 * The count element is a polite live region so the selection size is announced when it changes.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  camera?: Camera;
  onColor?(id: string, color: StickyColor): void;
}) {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (!box || selected.length === 0) return null;
  const top = props.camera ? worldToScreen(props.camera, box) : { x: 0, y: 0 };
  const width = props.camera ? box.width * props.camera.zoom : 0;
  const style = props.camera ? { left: top.x + width / HALF, top: top.y - BAR_GAP_PX } : undefined;
  const only = selected.length === 1 ? selected[0] : null;

  if (only && only.type === 'sticky' && only.color) {
    return (
      <div className="note-toolbar-anchor" style={style}>
        <NoteToolbar
          color={only.color}
          onColor={(c) => props.onColor?.(only.id, c)}
          onDelete={props.onDelete}
        />
      </div>
    );
  }
  if (selected.length < 2) return null;
  return (
    <div className="note-toolbar-anchor" style={style}>
      <div
        className="selection-bar"
        role="toolbar"
        aria-label="Selection tools"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className="selection-count" aria-live="polite">{`${selected.length} selected`}</span>
        <button type="button" className="note-delete" aria-label="Delete selection" title="Delete selection" onClick={props.onDelete}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
