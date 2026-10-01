import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';

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

/** Renders StickyNotes for a doc the test owns, with real selection state. */
export function Harness({ doc, zoom = 1 }: { doc: Y.Doc; zoom?: number }) {
  const [notes, setNotes] = useState<readonly StickySnapshot[]>(() => snapshot(doc));
  const sel = useSelection();
  useEffect(() => {
    const objects = doc.getMap('objects');
    const h = () => setNotes(snapshot(doc));
    objects.observeDeep(h);
    return () => objects.unobserveDeep(h);
  }, [doc]);
  return (
    <div data-testid="empty-board" onPointerDown={() => sel.select(null)}>
      {[...notes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => (
        <StickyNote
          key={n.id} note={n} doc={doc} zoom={zoom}
          selected={sel.selectedId === n.id} editing={sel.editingId === n.id}
          onSelect={sel.select} onStartEdit={sel.startEdit} onEndEdit={sel.endEdit}
        />
      ))}
    </div>
  );
}
