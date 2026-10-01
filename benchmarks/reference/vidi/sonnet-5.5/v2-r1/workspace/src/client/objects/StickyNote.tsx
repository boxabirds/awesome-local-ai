import { useLayoutEffect, useRef, useState } from 'react';
import { getStickyText, objectBounds } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export function StickyNote(props: ObjectProps) {
  const { doc, selected, editing } = props;
  const note = props.object as StickySnapshot;
  const { width, height } = objectBounds(note);
  const text = note.text ?? '';
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, height);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [text, width, height]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-sticky-note=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${fit.overflow ? ' sticky-note--overflow' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width,
        height,
        background: STICKY_COLORS[note.color ?? DEFAULT_STICKY_COLOR],
        zIndex: note.z,
        cursor: editing ? 'text' : 'pointer',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || editing) return;
        props.onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!props.readOnly) props.onStartEdit(note.id);
      }}
    >
      <div
        ref={textRef}
        className="sticky-text"
        data-testid="sticky-text"
        style={{ fontSize: fit.fontPx, visibility: editing ? 'hidden' : 'visible' }}
      >
        <div className="sticky-text-inner">{text}</div>
      </div>
      {fit.overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
      {editing && ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />}
    </div>
  );
}
