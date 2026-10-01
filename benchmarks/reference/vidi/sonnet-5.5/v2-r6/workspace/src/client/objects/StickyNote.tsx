import { useLayoutEffect, useRef, useState } from 'react';
import { getStickyText } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { requestFit } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export function StickyNote(props: ObjectProps) {
  const { object: note, doc, selected, editing, dragging, onEndEdit } = props;
  const readOnly = props.readOnly;
  const onStartEdit = (id: string) => { if (!readOnly) props.onStartEdit(id); };
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!boxRef.current) return undefined;
    return requestFit(boxRef.current, note.height, (r) => setFit((prev) => (
      prev.fontPx === r.fontPx && prev.overflow === r.overflow ? prev : r)));
  }, [note.text, note.width, note.height]);

  return (
    <div
      className="sticky-note"
      data-sticky-note=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x, top: note.y, width: note.width, height: note.height,
        background: STICKY_COLORS[note.color], zIndex: note.z,
        outline: selected ? '3px solid #1a73e8' : 'none',
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, note.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit(note.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing) {
          e.preventDefault();
          e.stopPropagation();
          onStartEdit(note.id);
        }
      }}
    >
      <div
        ref={boxRef}
        className={`sticky-text-box${fit.overflow ? ' sticky-overflow' : ''}`}
        data-testid="sticky-text"
        style={{ fontSize: fit.fontPx, visibility: editing ? 'hidden' : 'visible' }}
      >
        <div className="sticky-text">{note.text}</div>
      </div>
      {fit.overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
      {editing && (() => {
        const ytext = getStickyText(doc, note.id);
        return ytext ? <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} /> : null;
      })()}
    </div>
  );
}
