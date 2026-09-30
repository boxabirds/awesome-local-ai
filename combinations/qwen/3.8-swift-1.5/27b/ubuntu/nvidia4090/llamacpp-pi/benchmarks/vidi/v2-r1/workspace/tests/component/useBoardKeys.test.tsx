import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useSyncExternalStore, useCallback, useRef } from 'react';
import { initDoc, createSticky, snapshot, type ObjectSnapshot } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import { useSelection } from '@client/board/useSelection';
import { useBoardKeys } from '@client/board/useBoardKeys';
import { StickyNote } from '@client/objects/StickyNote';

function makeDoc(notes: Array<{ x: number; y: number }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = notes.map((n) => createSticky(doc, n));
  return { doc, ids };
}

interface HarnessHandles {
  selection: ReturnType<typeof useSelection>;
}

/** Live snapshot of the doc (re-renders on doc changes), like useBoardDoc. */
function useLiveObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const snapshotRef = useRef<readonly ObjectSnapshot[]>(snapshot(doc));
  const subscribe = useCallback((cb: () => void) => {
    const m = doc.getMap('objects');
    const obs = () => {
      snapshotRef.current = snapshot(doc);
      cb();
    };
    m.observeDeep(obs);
    return () => m.unobserveDeep(obs);
  }, [doc]);
  return useSyncExternalStore(subscribe, () => snapshotRef.current);
}

function KeyHarness(props: {
  doc: Y.Doc;
  canEdit?: boolean;
  onEscape?: () => void;
  isMarqueeActive?: () => boolean;
  handlesRef: { current: HarnessHandles | null };
}) {
  const { doc, canEdit = true, onEscape, isMarqueeActive, handlesRef } = props;
  const objects = useLiveObjects(doc);
  const selection = useSelection(objects);
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit,
    isBusy: () => false,
    isMarqueeActive: () => isMarqueeActive?.() ?? false,
    onEscape: () => onEscape?.(),
  });
  handlesRef.current = { selection };
  return (
    <div>
      {objects.map((obj) => (
        <StickyNote
          key={obj.id}
          obj={obj}
          doc={doc}
          zoom={1}
          selected={selection.ids.has(obj.id)}
          editing={selection.editingId === obj.id}
          onObjectPointerDown={() => {}}
          onStartEdit={selection.startEdit}
          onEndEdit={selection.endEdit}
        />
      ))}
    </div>
  );
}

function setup(notes: Array<{ x: number; y: number }>, opts: { canEdit?: boolean; onEscape?: () => void; isMarqueeActive?: () => boolean } = {}) {
  const { doc, ids } = makeDoc(notes);
  const handlesRef = { current: null as HarnessHandles | null };
  render(<KeyHarness doc={doc} canEdit={opts.canEdit} onEscape={opts.onEscape} isMarqueeActive={opts.isMarqueeActive} handlesRef={handlesRef} />);
  const positions = () => {
    const snap = snapshot(doc);
    const m = new Map<string, { x: number; y: number }>();
    for (const o of snap) m.set(o.id, { x: o.x, y: o.y });
    return m;
  };
  return { doc, ids, positions, handlesRef };
}

function key(k: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(window, { key: k, ...init });
  });
}

describe('sel.keys (useBoardKeys)', () => {
  // TC-25: Delete removes the whole selection
  it('TC-25: Delete removes all selected objects; unselected stay', () => {
    const s = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 700, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany([s.ids[0], s.ids[1]], false));
    key('Delete');
    const after = s.positions();
    expect(after.has(s.ids[0])).toBe(false);
    expect(after.has(s.ids[1])).toBe(false);
    expect(after.has(s.ids[2])).toBe(true);
  });

  it('TC-25c: Backspace also removes the selection', () => {
    const s = setup([{ x: 100, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany([s.ids[0]], false));
    key('Backspace');
    expect(s.positions().size).toBe(0);
  });

  it('Delete with an empty selection does nothing', () => {
    const s = setup([{ x: 100, y: 100 }]);
    key('Delete');
    expect(s.positions().size).toBe(1);
  });

  it('Delete is ignored when editing is not allowed (viewing only)', () => {
    const s = setup([{ x: 100, y: 100 }], { canEdit: false });
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany([s.ids[0]], false));
    key('Delete');
    expect(s.positions().size).toBe(1);
  });

  // TC-34: nudge
  it('TC-34: arrow keys nudge the selection by 1 world unit', () => {
    const s = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    const start = s.positions();

    key('ArrowRight');
    let after = s.positions();
    for (const id of s.ids) {
      expect(after.get(id)!.x).toBe(start.get(id)!.x + NUDGE_STEP_WORLD);
      expect(after.get(id)!.y).toBe(start.get(id)!.y);
    }

    key('ArrowUp');
    after = s.positions();
    for (const id of s.ids) {
      expect(after.get(id)!.y).toBe(start.get(id)!.y - NUDGE_STEP_WORLD);
    }

    key('ArrowLeft');
    key('ArrowDown');
    after = s.positions();
    for (const id of s.ids) {
      expect(after.get(id)!.x).toBe(start.get(id)!.x);
      expect(after.get(id)!.y).toBe(start.get(id)!.y);
    }
  });

  it('TC-34b: Shift+arrow nudges by 10', () => {
    const s = setup([{ x: 100, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    const start = s.positions();

    key('ArrowRight', { shiftKey: true });
    const after = s.positions();
    expect(after.get(s.ids[0])!.x).toBe(start.get(s.ids[0])!.x + NUDGE_LARGE_STEP_WORLD);
  });

  it('arrow keys with an empty selection do nothing', () => {
    const s = setup([{ x: 100, y: 100 }]);
    key('ArrowRight');
    expect(s.positions().get(s.ids[0])!.x).toBe(s.positions().get(s.ids[0])!.x);
  });

  it('Ctrl+A selects every object', () => {
    const s = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 700, y: 100 }]);
    key('a', { ctrlKey: true });
    const selection = s.handlesRef.current!.selection; // fresh after the key
    expect(selection.ids.size).toBe(3);
    expect(selection.ids.has(s.ids[0])).toBe(true);
    expect(selection.ids.has(s.ids[2])).toBe(true);
  });

  it('Cmd+A also selects every object', () => {
    const s = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    key('a', { metaKey: true });
    expect(s.handlesRef.current!.selection.ids.size).toBe(2);
  });

  it('Escape clears the selection', () => {
    const s = setup([{ x: 100, y: 100 }], { onEscape: vi.fn() });
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    expect(s.handlesRef.current!.selection.ids.size).toBe(1);
    key('Escape');
    expect(s.handlesRef.current!.selection.ids.size).toBe(0);
  });

  it('keys are ignored while the marquee is active', () => {
    const s = setup([{ x: 100, y: 100 }], { isMarqueeActive: () => true });
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    expect(s.handlesRef.current!.selection.ids.size).toBe(1);
    key('Delete');
    expect(s.positions().size).toBe(1);
    key('a', { ctrlKey: true });
    // selection unchanged (still 1)
    expect(s.handlesRef.current!.selection.ids.size).toBe(1);
  });

  it('keys are ignored while typing in a text editor', () => {
    const s = setup([{ x: 100, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(s.positions().size).toBe(1);
    input.remove();
  });

  it('Enter starts editing the single selected sticky', () => {
    const s = setup([{ x: 100, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany([s.ids[0]], false));
    key('Enter');
    expect(s.handlesRef.current!.selection.editingId).toBe(s.ids[0]);
  });

  it('Enter with a multi-selection does nothing', () => {
    const s = setup([{ x: 100, y: 100 }, { x: 400, y: 100 }]);
    const { selection } = s.handlesRef.current!;
    act(() => selection.setMany(s.ids, false));
    key('Enter');
    expect(s.handlesRef.current!.selection.editingId).toBeNull();
  });
});
