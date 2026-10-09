import type { ReactElement } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  deleteObjects,
  getStickyText,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

const PAD = 12;

/**
 * The story 1 sticky note, now rendered through the story 7 object registry
 * (sel.all_types). It reads width/height from the object (falling back to the
 * default square size) and delegates all pointer interaction to the generic
 * transform gesture via `onObjectPointerDown`. Selection, move, resize and
 * delete are generic; this component only renders a sticky and its toolbar.
 *
 * Note: text editing implies selection; the floating NoteToolbar (colour +
 * delete) is shown for the single selected sticky. Deleting clears the
 * selection automatically through the selection `prune`.
 */
export function StickyNote(props: ObjectProps): ReactElement {
  const { obj, doc, zoom, selected, editing, editable } = props;
  const note = obj as StickySnapshot & { id: string };
  const id = obj.id;
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const textBoxW = width - PAD * 2;
  const textBoxH = height - PAD * 2;

  const measureRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Text auto-fit: measure the current text at candidate sizes. Re-runs when
  // the text or the box size changes (e.g. after a resize).
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    el.textContent = note.text;
    const fit = fitFontSize(el, textBoxH);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text, textBoxW, textBoxH]);

  const ytext = getStickyText(doc, id);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    props.onObjectPointerDown(e, id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return; // load_failed: text editing is a no-op
    props.onStartEdit(id);
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={id}
      data-object-id={id}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
        borderRadius: 3,
        boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        outline: selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="sticky-text"
        style={{
          position: 'absolute',
          inset: PAD,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: fontPx,
          lineHeight: 1.25,
          color: '#23272e',
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {overflow && (
        <div
          className="text-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.18))',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: -99999,
          top: 0,
          width: textBoxW,
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.25,
          fontFamily: 'inherit',
          fontSize: STICKY_FONT_MAX_PX,
          pointerEvents: 'none',
        }}
      />
      {selected && !editing && (
        <NoteToolbar
          color={note.color}
          onColor={(c: StickyColor) => {
            if (!editable) return;
            props.undo.boundary();
            setStickyColor(doc, id, c);
            props.undo.boundary();
          }}
          onDelete={() => {
            if (!editable) return; // load_failed: deletion is a no-op
            props.undo.boundary();
            deleteObjects(doc, [id]);
            props.undo.boundary();
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          padding={PAD}
          undo={props.undo}
          onEnd={props.onEndEdit}
        />
      )}
    </div>
  );
}
