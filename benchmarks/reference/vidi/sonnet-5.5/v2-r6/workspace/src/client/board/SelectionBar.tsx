import type { CSSProperties } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { selectionScreenBox } from './SelectionOverlay';

const BAR_GAP_PX = 12;
const BAR_MIN_TOP_PX = 48;
const HALF = 2;

/**
 * "N selected" + Delete for two or more objects; the sticky note toolbar for exactly one sticky note.
 * With a `camera` it floats above the selection's bounding box; without one it renders in place.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>; snapshot: readonly ObjectSnapshot[]; onDelete(): void;
  camera?: Camera; onColor?(id: string, c: StickyColor): void; onSize?(id: string, s: TextSize): void;
  onShapeStyle?(id: string, s: { fill?: FillColor; stroke?: StrokeColor }): void;
}) {
  const { ids, snapshot, onDelete, camera } = props;
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  let style: CSSProperties | undefined;
  if (camera) {
    const box = selectionScreenBox(ids, snapshot, camera);
    if (box) {
      style = {
        left: box.x + box.width / HALF,
        top: Math.max(BAR_MIN_TOP_PX, box.y - BAR_GAP_PX),
      };
    }
  }

  if (selected.length === 1) {
    const note = selected[0];
    return (
      <>
        <div className="sr-only" aria-live="polite">1 selected</div>
        <div className="selection-bar-anchor" style={style}>
          {note.type === 'shape' ? (
            <ShapeToolbar
              fill={note.fill}
              stroke={note.stroke}
              onFill={(fill) => props.onShapeStyle?.(note.id, { fill })}
              onStroke={(stroke) => props.onShapeStyle?.(note.id, { stroke })}
              onDelete={onDelete}
            />
          ) : note.type === 'connector' ? (
            <div className="note-toolbar" role="toolbar" aria-label="Arrow toolbar" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="note-delete" aria-label="Delete arrow" title="Delete arrow" onClick={onDelete}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : note.type === 'text' ? (
            <TextToolbar size={note.size} onSize={(s) => props.onSize?.(note.id, s)} onDelete={onDelete} />
          ) : (
            <NoteToolbar
              color={note.type === 'sticky' ? note.color : 'yellow'}
              onColor={(c) => props.onColor?.(note.id, c)}
              onDelete={onDelete}
            />
          )}
        </div>
      </>
    );
  }
  return (
    <div className="selection-bar-anchor" style={style}>
      <div className="selection-bar" role="toolbar" aria-label="Selection">
        <span className="selection-count" aria-live="polite">{selected.length} selected</span>
        <button
          type="button"
          className="selection-delete"
          aria-label="Delete selection"
          title="Delete selection"
          onClick={onDelete}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
