/**
 * Bar above the selection (anchor: sel.bar): "N selected" and a Delete button when two or
 * more objects are selected; story 2's note toolbar when exactly one sticky note is; story 9's
 * text toolbar when exactly one text object is; story 10's shape toolbar when exactly one shape is. A polite live region announces the count to
 * screen readers whenever it changes.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { isStickySnapshot, type ObjectSnapshot } from '../../shared/board-model';
import { NOTE_TOOLBAR_GAP_PX, type FillColor, type StickyColor, type StrokeColor, type TextSize } from '../../shared/config';
import { isShapeSnap } from '../../shared/objects/shape';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { isTextSnapshot } from '../../shared/objects/text';
import { selectedObjects, selectionBounds, toScreenRect } from './SelectionOverlay';

const HALF = 2;
/** Space kept between the bar and the fixed left toolbar, in screen pixels. */
const TOOLBAR_CLEARANCE_PX = 8;

/**
 * How far right the bar must move so the fixed left toolbar (which is above the board)
 * never covers it; 0 when they do not overlap.
 */
function clearanceShift(bar: DOMRect, toolbar: DOMRect | undefined): number {
  if (toolbar === undefined || bar.bottom <= toolbar.top || bar.top >= toolbar.bottom) return 0;
  return Math.max(0, toolbar.right + TOOLBAR_CLEARANCE_PX - bar.left);
}

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Positions the bar above the selection's bounding box (screen space). */
  camera?: Camera;
  /** Recolours a single selected sticky note (note toolbar). */
  onColor?(id: string, color: StickyColor): void;
  /** Changes the size of a single selected text object (text toolbar, story 9). */
  onTextSize?(id: string, size: TextSize): void;
  /** Recolours a single selected shape (shape toolbar, story 10). */
  onShapeStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // Keep the bar clear of the left toolbar (a note near the left edge would hide its swatches).
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    const unshifted = new DOMRect(r.x - shift, r.y, r.width, r.height);
    const toolbar = document.querySelector('.board-toolbar')?.getBoundingClientRect();
    const next = clearanceShift(unshifted, toolbar);
    if (next !== shift) setShift(next);
  });

  let position: CSSProperties | undefined;
  if (props.camera !== undefined && box !== null) {
    const r = toScreenRect(props.camera, box);
    position = { left: `${r.x + r.width / HALF + shift}px`, top: `${r.y - NOTE_TOOLBAR_GAP_PX}px` };
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
    } else if (single !== undefined && isTextSnapshot(single) && editable) {
      const id = single.id;
      content = <TextToolbar size={single.size} onSize={(s) => props.onTextSize?.(id, s)} onDelete={props.onDelete} />;
    } else if (single !== undefined && isShapeSnap(single) && editable) {
      const id = single.id;
      content = (
        <ShapeToolbar
          fill={single.fill}
          stroke={single.stroke}
          onFill={(fill) => props.onShapeStyle?.(id, { fill })}
          onStroke={(stroke) => props.onShapeStyle?.(id, { stroke })}
          onDelete={props.onDelete}
        />
      );
    }
  }

  return (
    <>
      <div className="sr-only" aria-live="polite" data-testid="selection-announcement">
        {count > 0 ? selectionLabel(count) : ''}
      </div>
      {content !== null && (
        <div ref={anchorRef} className="selection-bar-anchor" style={position}>
          {content}
        </div>
      )}
    </>
  );
}
