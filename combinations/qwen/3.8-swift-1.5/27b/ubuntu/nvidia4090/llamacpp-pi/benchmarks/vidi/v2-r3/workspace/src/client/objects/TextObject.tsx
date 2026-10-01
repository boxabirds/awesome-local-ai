import { useEffect, useRef, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  TEXT_FONT_FAMILY,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import { getTextSize, isEmptyText, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import { remeasureTextObject } from './textLayout';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * A free text object (story 9, text.object).
 *
 * Plain text, no fill, at x/y with the stored width/height, `pre-wrap`,
 * font TEXT_SIZES[size]. Double-click (or Enter on a single selection)
 * starts editing through the shared TextEditor.
 *
 * Edit end: if the text is empty the object is deleted BEFORE the
 * end-of-edit undo boundary, so a single undo restores the object with its
 * content (TC-06/TC-20). Otherwise the box is remeasured (at most one box
 * write) and the edit session's undo step is closed.
 *
 * A remote deletion while editing simply unmounts the editor (the object
 * leaves the snapshot) — no error, no recreation (TC-24).
 */
export function TextObject({
  obj,
  doc,
  selected,
  editing,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
  measurer,
}: ObjectProps): ReactElement {
  const t = obj as TextSnapshot;
  const id = t.id;
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest callbacks for the (stable) native pointer handlers.
  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;

  // Pointer interaction: native listeners so stopPropagation runs before the
  // board viewport's native pan listener (same pattern as StickyNote).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onObjectPointerDownRef.current(e, id);
    };
    const onDoubleClick = (e: MouseEvent) => {
      e.stopPropagation();
      onStartEditRef.current(id);
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [id]);

  const ytext = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)?.get('text') as Y.Text | undefined;
  const size = getTextSize(doc, id) ?? 'M';
  const fontPx = TEXT_SIZES[size];

  const handleEndEdit = (next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, id)) {
      // Empty: delete BEFORE the boundary → one undo restores it (TC-06).
      deleteIfEmpty(doc, id);
    } else if (measurer) {
      // Local edits are measured by this client (the sender measures).
      remeasureTextObject(doc, id, measurer);
    }
    undo?.boundary();
    onEndEdit(next);
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Text"
      data-testid={`text-object-${id}`}
      data-selected={selected || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: t.x,
        top: t.y,
        width: t.width,
        height: t.height,
        zIndex: t.z,
        color: '#222',
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: `${fontPx}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        textAlign: 'left',
        outline: selected ? '2px solid #1565C0' : 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={handleEndEdit}
          undo={undo}
          ariaLabel="Text"
          testId="text-editor"
          counterTestId="text-char-counter"
          textAlign="left"
          paddingPx={0}
          showCounter
        />
      ) : (
        <div
          data-testid={`text-content-${id}`}
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {t.text}
        </div>
      )}
    </div>
  );
}
