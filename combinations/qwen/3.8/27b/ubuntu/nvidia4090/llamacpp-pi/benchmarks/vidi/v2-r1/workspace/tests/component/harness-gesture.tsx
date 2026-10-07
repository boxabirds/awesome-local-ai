// Story 7 test harness (TC-26): wires the real useTransformGesture hook (not
// the full App) so the onGestureStart/onGestureEnd callback contract can be
// counted. Exposes its Y.Doc on globalThis so tests can create objects.

import { useEffect, useMemo, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { getObjectType } from '../../src/client/objects/registry';

export interface GestureCounts {
  start: number;
  end: number;
}

export function GestureHarness(props: { counts: MutableRefObject<GestureCounts> }): JSX.Element {
  const board = useBoardDoc('gesture-harness');
  const selection = useSelection(board.objects);
  const camera = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const counts = props.counts;
  const gesture = useTransformGesture({
    doc: board.doc,
    camera,
    selection,
    snapshot: board.objects,
    canEdit: true,
    onGestureStart: () => {
      counts.current.start += 1;
    },
    onGestureEnd: () => {
      counts.current.end += 1;
    },
  });
  useEffect(() => {
    (globalThis as Record<string, unknown>).__harnessDoc = board.doc;
    return () => {
      delete (globalThis as Record<string, unknown>).__harnessDoc;
    };
  }, [board.doc]);
  return (
    <div data-testid="harness-root" style={{ position: 'relative', width: 1000, height: 800 }}>
      {board.objects.map((obj) => {
        const spec = getObjectType(obj.type);
        if (!spec) return null;
        const C = spec.Component;
        return (
          <C
            key={obj.id}
            obj={obj}
            doc={board.doc}
            zoom={1}
            selected={selection.ids.has(obj.id)}
            editing={selection.editingId === obj.id}
            canEdit
            onPointerDown={gesture.onObjectPointerDown}
            onStartEdit={() => {}}
            onEndEdit={() => {}}
          />
        );
      })}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={board.objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
    </div>
  );
}

/** The harness's live Y.Doc (set once the harness has mounted). */
export function harnessDoc(): Y.Doc {
  const doc = (globalThis as Record<string, unknown>).__harnessDoc;
  if (!(doc instanceof Y.Doc)) throw new Error('harness doc not mounted');
  return doc;
}
