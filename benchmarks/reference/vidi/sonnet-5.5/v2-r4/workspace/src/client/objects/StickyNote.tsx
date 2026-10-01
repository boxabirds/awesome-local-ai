import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor, STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD } from './StickyTextEditor';

const SELECT_OUTLINE = '3px solid #1e88e5';
const FADE_HEIGHT = 40;

export function StickyNote(props: ObjectProps) {
  const { object, doc, selected, editing, editable } = props;
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const note = object as StickySnapshot;
  const boxHeight = note.height - 2 * STICKY_PADDING_WORLD;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, boxHeight);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text, note.width, boxHeight]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-selected={selected ? 'true' : 'false'}
      data-note-id={note.id}
      data-z={note.z}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) props.onStartEdit(note.id);
      }}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        zIndex: note.z,
        boxSizing: 'border-box',
        contain: 'layout style', // a text re-fit never re-lays-out the other notes (large boards)
        background: STICKY_COLORS[note.color],
        boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
        outline: selected ? SELECT_OUTLINE : 'none',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div
          ref={textRef}
          data-testid="note-text"
          data-overflow={fit.overflow ? 'true' : 'false'}
          style={{
            position: 'absolute',
            left: STICKY_PADDING_WORLD,
            right: STICKY_PADDING_WORLD,
            top: fit.overflow ? STICKY_PADDING_WORLD : '50%',
            transform: fit.overflow ? 'none' : 'translateY(-50%)',
            fontSize: fit.fontPx,
            lineHeight: STICKY_LINE_HEIGHT,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: '#222',
            visibility: editing ? 'hidden' : 'visible',
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
        {showEditor && (
          <div
            style={{
              position: 'absolute',
              left: STICKY_PADDING_WORLD,
              right: STICKY_PADDING_WORLD,
              top: STICKY_PADDING_WORLD,
              bottom: STICKY_PADDING_WORLD,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: fit.overflow ? 'flex-start' : 'center',
            }}
          >
            <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
          </div>
        )}
        {fit.overflow && (
          <div
            data-testid="note-fade"
            className="sticky-fade"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE_HEIGHT,
              background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
