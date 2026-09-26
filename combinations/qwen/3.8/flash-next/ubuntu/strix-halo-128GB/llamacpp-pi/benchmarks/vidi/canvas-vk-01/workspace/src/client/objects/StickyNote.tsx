import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import type * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { getStickyText, objectBounds, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

const PADDING = 24; // 12px each side

/**
 * A sticky note on the board, rendered through the object registry. Selection,
 * move and resize are handled generically (see `useTransformGesture`); this
 * component only renders and hosts the inline text editor.
 */
export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onStartEdit, onEndEdit, onObjectPointerDown } =
    props;
  const note = obj as StickySnapshot;

  const elementRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  const bounds = objectBounds(obj);
  const textBox = Math.max(0, bounds.width - PADDING);

  // Real font measurement after render (runs in a browser, not jsdom).
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    if (note.text.length === 0) {
      el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
      setOverflow(false);
      return;
    }
    const box = el.clientHeight || textBox;
    const result = fitFontSize(el, box);
    setOverflow(result.overflow);
  }, [note.text, editing, textBox]);

  // Editing an object that disappears (remote delete) must not leave a dangling
  // editor: the component unmounts with the snapshot, but end editing cleanly.
  const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  useEffect(() => {
    if (!objectsMap.has(note.id) && editing) onEndEdit('unselected');
  }, [note.id, objectsMap, editing, onEndEdit]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${note.id}`}
      data-selected={selected ? 'true' : undefined}
      data-note-id={note.id}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: obj.z,
        cursor: editing ? 'text' : 'default',
      }}
      onPointerDown={(event) => onObjectPointerDown(event, note.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!editable) return;
        if (!objectsMap.has(note.id)) return;
        onStartEdit(note.id);
      }}
      tabIndex={0}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note-text${overflow ? ' overflow-fade' : ''}`}
          data-testid={`sticky-text-${note.id}`}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
