/**
 * Sticky note rendering and text-editing entry point (story 7).
 *
 * Own drag code removed: pointerdown delegates to the shared transform gesture
 * (`onObjectPointerDown`). Size is read from the object bounds so a note created
 * before this story renders at STICKY_SIZE_WORLD and a resized note renders at
 * its persisted width/height. Text fit uses the note's width.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, DEFAULT_STICKY_COLOR } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import type { ObjectProps } from './registry';

export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, readOnly = false } = props;
  const measureRef = useRef<HTMLDivElement | null>(null);

  const bounds = objectBounds(obj);
  const width = bounds.width;
  const height = bounds.height;

  // Font fit measurement, using a detached element sized to the content box
  // (note width minus the padding allowance).
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const box = width - 24; // padding allowance
    const result = fitFontSize(el, box);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [obj.text, width]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${obj.x}px`,
    top: `${obj.y}px`,
    width: `${width}px`,
    height: `${height}px`,
    backgroundColor: STICKY_COLORS[obj.color ?? DEFAULT_STICKY_COLOR],
    zIndex: obj.z,
    pointerEvents: 'auto',
    touchAction: 'none',
  };

  return (
    <div
      className={`sticky-note${selected ? ' sticky-selected' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-note-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      tabIndex={0}
      style={style}
      onPointerDown={(e) => {
        // While editing, the textarea (and the editor's outside handler) own
        // pointer events; never start a drag from inside an editing note.
        if (editing) return;
        props.onObjectPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (readOnly) return;
        props.onStartEdit(obj.id);
      }}
    >
      {editing ? (
        <StickyTextEditor
          ytext={(doc.getMap('objects').get(obj.id) as Y.Map<unknown>)?.get('text') as Y.Text}
          fontPx={fontPx}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div
          className={`sticky-text${overflow ? ' sticky-text-overflow' : ''}`}
          style={{ fontSize: `${fontPx}px` }}
        >
          <span className="sticky-text-content">{obj.text}</span>
        </div>
      )}
      {/* Hidden measurement element for font fit (matches content box of sticky-text) */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="sticky-text-measure"
        style={{ width: `${width - 24}px` }}
      >
        {obj.text}
      </div>
    </div>
  );
}
