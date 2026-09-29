/**
 * TextObject (story 9): renders a text object on the board.
 *
 * - Plain text, no fill, no background, no border.
 * - Absolutely positioned at x/y with stored width/height.
 * - `white-space: pre-wrap`, font TEXT_SIZES[size].
 * - Double-click or Enter starts editing (if canEdit).
 * - Escape or clicking elsewhere ends editing.
 * - Edit end calls deleteIfEmpty.
 * - Remote deletion during editing ends editing silently.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, TEXT_MAX_CHARS, TEXT_LINE_HEIGHT, type TextSize } from '../../shared/config';
import { getTextContent, deleteIfEmpty } from '../../shared/objects/text';
import { createTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer } from './textLayout';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: TextSize;
  editing: boolean;
  selected: boolean;
  canEdit: boolean;
  doc: Y.Doc;
  camera: { zoom: number };
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDelete(id: string): void;
  undo?: UndoController;
}

function TextObjectView(props: TextObjectProps): JSX.Element | null {
  const { id, x, y, width, height, size, editing, canEdit } = props;
  const fontPx = TEXT_SIZES[size];

  // Observe the Y.Text content for rendering.
  const [text, setText] = useState<string>(() => {
    const ytext = getTextContent(props.doc, id);
    return ytext ? ytext.toString() : '';
  });
  const [alive, setAlive] = useState(true);

  // Watch for remote deletion.
  useEffect(() => {
    const objects = props.doc.getMap<Y.Map<unknown>>('objects');

    const checkAlive = () => {
      const obj = objects.get(id);
      if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') {
        setAlive(false);
        return false;
      }
      return true;
    };

    const ytext = getTextContent(props.doc, id);
    if (!ytext) {
      setAlive(false);
      return;
    }

    const onTextChange = () => {
      if (!checkAlive()) return;
      const t = getTextContent(props.doc, id);
      if (t) setText(t.toString());
      else setAlive(false);
    };

    const onMapChange = (_e: Y.YMapEvent<unknown>) => {
      // Check if the object was removed.
      const obj = objects.get(id);
      if (!(obj instanceof Y.Map)) {
        setAlive(false);
        return;
      }
      // Check if size changed.
      const newSize = obj.get('size') as TextSize | undefined;
      if (newSize && newSize !== size) {
        // Trigger re-render by updating text.
        const t = getTextContent(props.doc, id);
        if (t) setText(t.toString());
      }
    };

    ytext.observe(onTextChange);
    const map = objects.get(id);
    if (map instanceof Y.Map) {
      map.observe(onMapChange);
    }

    return () => {
      ytext.unobserve(onTextChange);
      const m = objects.get(id);
      if (m instanceof Y.Map) m.unobserve(onMapChange);
    };
  }, [props.doc, id, size]);

  // If deleted remotely, end editing.
  useEffect(() => {
    if (!alive && editing) {
      props.onEndEdit('unselected');
    }
  }, [alive]);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Box sync: remeasure after local edits.
  const measurerRef = useRef<ReturnType<typeof createCanvasMeasurer> | null>(null);
  if (!measurerRef.current) {
    measurerRef.current = createCanvasMeasurer();
  }
  const boxSyncRef = useRef<ReturnType<typeof createTextBoxSync> | null>(null);
  if (!boxSyncRef.current) {
    boxSyncRef.current = createTextBoxSync(props.doc, id, measurerRef.current);
  }

  const handleInput = useCallback(() => {
    boxSyncRef.current?.remeasureAfterLocalChange();
  }, []);

  const handleEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      // Check if text is empty; if so, delete.
      if (deleteIfEmpty(props.doc, id)) {
        props.onEndEdit('unselected');
        return;
      }
      props.onEndEdit(next);
    },
    [props],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.stopPropagation();
      props.onSelect(id);
    },
    [canEdit, id, props],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      e.stopPropagation();
      props.onStartEdit(id);
    },
    [canEdit, id, props],
  );

  if (!alive) return null;

  return (
    <div
      ref={rootRef}
      data-board-object
      data-testid={`text-object-${id}`}
      data-text-id={id}
      role="option"
      aria-label={text || 'Empty text'}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        minHeight: height,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: editing ? 'text' : 'default',
        pointerEvents: 'auto',
        color: '#000',
        overflow: 'hidden',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <TextEditor
          ytext={getTextContent(props.doc, id)!}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width="auto"
          onInput={handleInput}
          onEnd={handleEnd}
          undo={props.undo}
        />
      ) : (
        <span aria-hidden="true">{text}</span>
      )}
    </div>
  );
}

/** Wrapper for React.memo comparison. */
export function TextObject(props: TextObjectProps): JSX.Element | null {
  return <TextObjectView key={props.id} {...props} />;
}