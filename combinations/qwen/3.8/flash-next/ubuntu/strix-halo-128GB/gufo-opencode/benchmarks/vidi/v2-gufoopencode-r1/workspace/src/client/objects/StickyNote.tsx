import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, JSX } from 'react';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  type StickyColor
} from '../../shared/config';
import { deleteObject, getStickyText, isStickyObject, setStickyColor } from '../../shared/board-model';
import { useUndoController } from '../board/useUndo';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import {
  noteBodyStyle,
  noteFadeStyle,
  noteRootStyle,
  noteTextStyle,
  SELECTION_OUTLINE_COLOR,
  STICKY_PADDING_WORLD
} from './stickyStyles';
import type { ObjectProps } from './registry';

// The sticky renderer is a plain view of the generic machinery: selection,
// dragging and editing state come in as props, pointer-down is delegated to
// the transform gesture (registry ObjectProps).
export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, dragging, editing, editable } = props;
  const sticky = isStickyObject(obj)
    ? obj
    : { ...obj, type: 'sticky' as const, color: DEFAULT_STICKY_COLOR, text: '' };
  const [fontPx, setFontPx] = useState<number>(24);
  const [overflow, setOverflow] = useState(false);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const undo = useUndoController();

  const textBox = Math.max(0, obj.height - STICKY_PADDING_WORLD * 2);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    const result = fitFontSize(el, textBox);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [sticky.text, editing, obj.width, textBox]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (!editable || editing) return;
    props.onStartEdit(obj.id);
  };

  const rootStyle = {
    ...noteRootStyle,
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    background: STICKY_COLORS[sticky.color],
    outline: selected ? `2px solid ${SELECTION_OUTLINE_COLOR}` : 'none',
    zIndex: obj.z,
    cursor: dragging ? 'grabbing' : 'grab'
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-${obj.id}`}
      data-selected={selected}
      data-dragging={dragging}
      style={rootStyle}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        (() => {
          const ytext = getStickyText(doc, obj.id);
          return ytext ? <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={props.onEndEdit} /> : null;
        })()
      ) : (
        <div style={noteBodyStyle}>
          <div ref={measureRef} style={{ ...noteTextStyle, fontSize: fontPx }} data-testid={`sticky-text-${obj.id}`}>
            {sticky.text}
          </div>
          {overflow ? <div data-testid="sticky-fade" style={noteFadeStyle} /> : null}
        </div>
      )}
      {editable && selected && !editing && !dragging ? (
        <div
          data-testid={`note-toolbar-anchor-${obj.id}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            height: 0,
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'none'
          }}
        >
          <NoteToolbar
            color={sticky.color}
            onColor={(c: StickyColor) => {
              undo?.boundary();
              setStickyColor(doc, obj.id, c);
              undo?.boundary();
            }}
            onDelete={() => {
              undo?.boundary();
              deleteObject(doc, obj.id);
              undo?.boundary();
              props.onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
