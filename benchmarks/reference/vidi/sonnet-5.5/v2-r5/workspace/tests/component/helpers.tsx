import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { deleteObjects, initDoc, snapshotObjects, setStickyColor, type ObjectSnapshot } from '../../src/shared/board-model';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection, type Selection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { UndoController } from '../../src/client/board/undo';
import { getObjectType } from '../../src/client/objects/registry';
import '../fixtures/testbox';

// jsdom has no PointerEvent; MouseEvent carries the coordinates and button we need.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill });
}

export function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Renders the registered objects of a doc the test owns, with the real selection, gesture, keys, overlay and bar. */
export function Harness({ doc, zoom = 1, canEdit = true, undo, onGestureStart, onGestureEnd, onSelection }: {
  doc: Y.Doc; zoom?: number; canEdit?: boolean; undo?: UndoController;
  onGestureStart?(): void; onGestureEnd?(): void;
  onSelection?(sel: Selection): void;
}) {
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => snapshotObjects(doc));
  const sel = useSelection(objects);
  const camera = useMemo(() => ({ x: 0, y: 0, zoom }), [zoom]);
  const gesture = useTransformGesture({ doc, camera, selection: sel, snapshot: objects, canEdit,
    onGestureStart: () => { undo?.boundary(); onGestureStart?.(); }, onGestureEnd: () => { undo?.boundary(); onGestureEnd?.(); },
  });
  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit, undo });
  useEffect(() => { onSelection?.(sel); });
  useEffect(() => {
    const map = doc.getMap('objects');
    const h = () => setObjects(snapshotObjects(doc));
    map.observeDeep(h);
    return () => map.unobserveDeep(h);
  }, [doc]);
  return (
    <div data-testid="empty-board" onPointerDown={() => sel.clear()}>
      {[...objects].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => {
        const spec = getObjectType(o.type);
        if (!spec) return null;
        const { Component } = spec;
        return (
          <Component
            key={o.id} object={o} doc={doc} zoom={zoom}
            selected={sel.ids.has(o.id)} editing={canEdit && sel.editingId === o.id}
            dragging={gesture.activeIds.has(o.id)} readOnly={!canEdit} undo={undo}
            onPointerDown={gesture.onObjectPointerDown}
            onStartEdit={sel.startEdit} onEndEdit={sel.endEdit}
          />
        );
      })}
      {sel.editingId === null && (
        <>
          <SelectionOverlay
            ids={sel.ids} snapshot={objects} camera={camera} canEdit={canEdit}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
          <SelectionBar
            ids={sel.ids} snapshot={objects} camera={camera} readOnly={!canEdit}
            onDelete={() => { deleteObjects(doc, [...sel.ids]); sel.clear(); }}
            onColor={(id, c) => { setStickyColor(doc, id, c); }}
          />
        </>
      )}
    </div>
  );
}
