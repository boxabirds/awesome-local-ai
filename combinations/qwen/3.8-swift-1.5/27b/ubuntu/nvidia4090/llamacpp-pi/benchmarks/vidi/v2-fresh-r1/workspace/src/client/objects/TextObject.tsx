// Free text object component (story 9): render + edit.
// Selection, move and (horizontal) resize are handled by the shared board
// machinery; the component renders the box and delegates input.
//
// The box size is driven by the text (useTextBoxSync) for local changes and
// by remote sync for everyone else.

import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { DEFAULT_TEXT_SIZE, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, type TextSize } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { getTextContent } from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

// One shared measurer; canvas-based where available (falls back to
// estimation in non-browser environments).
let sharedMeasurer: ReturnType<typeof createCanvasMeasurer> | null = null;
function createMeasurer() {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

export function TextObject({
  obj,
  doc,
  selected,
  editing,
  onObjectPointerDown,
  onObjectDoubleClick,
  onEndEdit,
  onBoundary,
  onUndo,
  onRedo,
}: ObjectProps) {
  const defaultMeasurer = createMeasurer();
  const size = (obj.size as TextSize | undefined) ?? DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = obj.height ?? fontPx * TEXT_LINE_HEIGHT;

  // Keep the stored box in sync with the text for LOCAL changes (typing,
  // size changes, handle drags). Remote changes arrive via sync.
  useTextBoxSync(doc, obj.id, defaultMeasurer);

  const ytext = editing ? getTextContent(doc, obj.id) : undefined;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // Don't let the viewport pan
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onObjectDoubleClick(obj.id);
  };

  return (
    <div
      role="group"
      aria-label="Text object"
      data-testid="text-object"
      data-id={obj.id}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      data-size={size}
      className="text-object"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        overflow: 'hidden',
        color: '#222',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
        ...(selected
          ? { boxShadow: '0 0 0 2px #1976D2' }
          : {}),
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {!editing && (
        <div
          className="text-object__text"
          data-testid="text-content"
          style={{
            fontSize: `${fontPx}px`,
            lineHeight: `${TEXT_LINE_HEIGHT}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: '2px',
            boxSizing: 'border-box',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {obj.text}
        </div>
      )}
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          padding={2}
          ariaLabel="Text"
          origin={LOCAL_ORIGIN}
          onEnd={onEndEdit}
          onBoundary={onBoundary}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      )}
    </div>
  );
}
