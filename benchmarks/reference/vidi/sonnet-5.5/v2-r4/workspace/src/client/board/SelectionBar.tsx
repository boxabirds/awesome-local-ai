import type * as Y from 'yjs';
import { isSticky, setStickyColor, type ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { selectionScreenBox } from './SelectionOverlay';

const BAR_GAP_PX = 10;
const BAR_MIN_TOP_PX = 60; // keeps the bar on screen when the selection touches the top edge

/**
 * "N selected" + Delete for two or more objects; story 2's note toolbar for exactly one sticky note.
 * Positioned above the selection's bounding box in screen space.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  camera: Camera;
  doc: Y.Doc;
  /** False while the board is not loaded: Delete and colours are disabled. */
  editable?: boolean;
  /** Hide while a drag or text edit is in progress. */
  hidden?: boolean;
}) {
  const { ids, snapshot, camera, doc } = props;
  const editable = props.editable !== false;
  const selected = snapshot.filter((o) => ids.has(o.id));
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box || selected.length === 0 || props.hidden) return null;
  const single = selected.length === 1 ? selected[0] : null;
  if (single && !isSticky(single)) return null;
  if (single && !editable) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: box.x + box.width / 2,
        top: Math.max(box.y - BAR_GAP_PX, BAR_MIN_TOP_PX),
        transform: 'translate(-50%, -100%)',
        zIndex: 11,
      }}
    >
      {single && isSticky(single) ? (
        <NoteToolbar
          color={single.color}
          onColor={(c) => setStickyColor(doc, single.id, c)}
          onDelete={props.onDelete}
        />
      ) : (
        <div
          role="toolbar"
          aria-label="Selection tools"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
            font: '14px system-ui, sans-serif',
          }}
        >
          <span role="status" aria-live="polite">{`${selected.length} selected`}</span>
          <button
            type="button"
            aria-label="Delete selection"
            title="Delete selection"
            disabled={!editable}
            onClick={props.onDelete}
            style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: editable ? 'pointer' : 'not-allowed', padding: 2, opacity: editable ? 1 : 0.4 }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
