import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { getStickyFields, getStickyText } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export const STICKY_PADDING_WORLD = 16;

export type StickyNoteProps = ObjectProps;

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const {
    obj,
    doc,
    selected,
    editing,
    editable = true,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
    undo
  } = props;
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const bounds = objectBounds(obj);
  const fields = getStickyFields(doc, obj.id);
  const text = fields?.text ?? '';
  const color = STICKY_COLORS[fields?.color ?? 'yellow'];
  const textBox = bounds.width - STICKY_PADDING_WORLD * 2;

  // Auto-fit: run on mount, on text changes and whenever the box is resized
  // (story 7 resize handles). Zoom scales the world layer uniformly so the
  // board-unit font size needs no per-zoom pass.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    el.textContent = text;
    const next = fitFontSize(el, textBox);
    setFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next
    );
  }, [text, textBox]);

  useEffect(() => {
    // Unmount while editing (e.g. remote delete): nothing to clean up here;
    // the gesture layer drops writes for missing objects on its own.
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Never let the viewport see this: pressing a note must not pan (TC-20).
    e.stopPropagation();
    if (!editable) return; // load-failed board: no interaction (TC-23)
    if (editing) return; // the textarea owns interaction while editing
    // Selection and the group move/resize gesture are owned by the board.
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Editing an existing note instead of creating a new one (TC-35).
    e.stopPropagation();
    if (!editable) return; // load-failed board: no edit (TC-23)
    if (!editing) onStartEdit(obj.id);
  };

  const ytext = editing ? getStickyText(doc, obj.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  return (
    <div
      data-testid="sticky-note"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      className={`sticky-note${fit.overflow ? ' sticky-note--overflow' : ''}`}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        background: color
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={measureRef}
        className="sticky-note-measure"
        style={{ width: textBox }}
        aria-hidden="true"
      />
      {showEditor ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} undo={undo} />
      ) : (
        <div className="sticky-note-text">
          <div className="sticky-note-text-inner" style={{ fontSize: fit.fontPx }}>
            {text}
          </div>
        </div>
      )}
    </div>
  );
}
