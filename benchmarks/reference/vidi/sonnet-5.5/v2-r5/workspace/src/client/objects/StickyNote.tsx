import { useLayoutEffect, useRef, useState } from 'react';
import { getStickyText, objectBounds, type StickySnapshot } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PRIMARY_BUTTON = 0;
const NOTE_PADDING = 12;

export function StickyNote(props: ObjectProps) {
  const { doc, zoom, selected, editing, dragging, readOnly } = props;
  const note = props.object as StickySnapshot;
  const { id } = note;
  const { width, height } = objectBounds(note);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, height - NOTE_PADDING * 2);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text, width, height]);

  return (
    <div
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-sticky=""
      data-id={id}
      data-x={note.x}
      data-y={note.y}
      data-width={width}
      data-height={height}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragging}
      className="sticky-note"
      style={{
        left: note.x, top: note.y, zIndex: note.z, width, height,
        background: STICKY_COLORS[note.color], padding: NOTE_PADDING,
        outline: selected ? `${2 / zoom}px solid #2563eb` : 'none',
        cursor: dragging ? 'grabbing' : 'pointer',
      }}
      onPointerDown={(e) => {
        if (editing || (e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
        e.stopPropagation();
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing && !readOnly) {
          e.preventDefault();
          e.stopPropagation();
          props.onStartEdit(id);
        }
      }}
    >
      <div
        className={`sticky-text-box${fit.overflow ? ' sticky-fade' : ''}`}
        style={{ visibility: editing ? 'hidden' : 'visible' }}
      >
        <div ref={textRef} className="sticky-text" style={{ fontSize: fit.fontPx }}>{note.text}</div>
      </div>
      {editing && !readOnly && (
        <StickyTextEditorHost doc={doc} id={id} fontPx={fit.fontPx} onEnd={props.onEndEdit} undo={props.undo} />
      )}
    </div>
  );
}

function StickyTextEditorHost(props: {
  doc: ObjectProps['doc']; id: string; fontPx: number; onEnd(next: 'selected' | 'unselected'): void; undo?: ObjectProps['undo'];
}) {
  const ytext = getStickyText(props.doc, props.id);
  if (!ytext) return null; // note deleted while editing: no write, no re-creation
  return <StickyTextEditor ytext={ytext} fontPx={props.fontPx} onEnd={props.onEnd} undo={props.undo} />;
}
