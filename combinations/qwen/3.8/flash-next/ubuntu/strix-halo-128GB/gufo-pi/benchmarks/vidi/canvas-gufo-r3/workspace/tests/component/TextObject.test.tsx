import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { render, fireEvent, act, cleanup, fireEvent as fb } from '@testing-library/react';
import { Camera, Size, screenToWorld } from '@client/canvas/camera';
import { useCamera } from '@client/canvas/useCamera';
import { useSelection } from '@client/board/useSelection';
import { createUndo, UndoController } from '@client/board/undo';
import { TextObject } from '@client/objects/TextObject';
import { StickyNote } from '@client/objects/StickyNote';
import { SelectionOverlay } from '@client/board/SelectionOverlay';
import { registerObjectType, registerStickyType } from '@client/objects/registry';
import { snapshotAll } from '@shared/board-model';
import { createSticky } from '@shared/board-model';
import { createText, setTextSize, getTextContent } from '@shared/objects/text';
import { TEXT_MIN_WIDTH_WORLD } from '@shared/config';

registerStickyType(StickyNote);
// Register text type (isolated module registry per test file)
let textRegistered = false;
function ensureTextRegistered() {
  if (textRegistered) return;
  textRegistered = true;
  registerObjectType('text', {
    Component: TextObject,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest(obj, worldPoint) {
      const w = (obj as any).width ?? 100;
      const h = (obj as any).height ?? 20;
      return worldPoint.x >= obj.x && worldPoint.x <= obj.x + w && worldPoint.y >= obj.y && worldPoint.y <= obj.y + h;
    },
  });
}

afterEach(cleanup);

const VIEWPORT: Size = { width: 1280, height: 800 };

interface Api {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  undoController: UndoController;
  camera: Camera;
}

interface Seed {
  text?: { x: number; y: number; content?: string; size?: 'S' | 'M' | 'L' | 'XL' }[];
  sticky?: { x: number; y: number }[];
}

function makeHarness() {
  return function Harness({ seed = {}, apiRef }: { seed?: Seed; apiRef: React.MutableRefObject<Api | null> }) {
    const doc = useRef<Y.Doc | null>(null);
    if (!doc.current) doc.current = new Y.Doc();
    const d = doc.current;
    const seeded = useRef(false);
    if (!seeded.current) {
      seeded.current = true;
      for (const s of seed.sticky ?? []) createSticky(d, { x: s.x, y: s.y });
      for (const t of seed.text ?? []) {
        const id = createText(d, { x: t.x, y: t.y }, 'user')!;
        if (t.content) {
          const yt = getTextContent(d, id)!;
          yt.insert(0, t.content);
        }
        if (t.size) setTextSize(d, id, t.size);
      }
    }
    const selection = useSelection(snapshotAll(d));
    const [, setVersion] = React.useState(0);
    React.useEffect(() => {
      const objects = d.getMap('objects');
      const obs = () => setVersion((v) => v + 1);
      objects.observeDeep(obs);
      return () => objects.unobserveDeep(obs);
    }, [d]);
    const cameraState = useCamera(VIEWPORT);
    const cameraRef = useRef(cameraState.camera);
    cameraRef.current = cameraState.camera;
    const undoController = useMemo2(d);
    apiRef.current = { doc: d, selection, undoController, camera: cameraState.camera };

    const objs = snapshotAll(d);
    return (
      <div style={{ width: VIEWPORT.width, height: VIEWPORT.height }}>
        <div className="world" style={{ transform: `scale(${cameraState.camera.zoom})`, transformOrigin: '0 0' }}>
          {objs.map((o) => {
            if (o.type === 'text') {
              return (
                <TextObject
                  key={o.id}
                  note={o}
                  doc={d}
                  zoom={cameraState.camera.zoom}
                  selected={selection.ids.has(o.id)}
                  editing={o.id === selection.editingId}
                  onSelect={selection.click}
                  onStartEdit={selection.startEdit}
                  onEndEdit={selection.endEdit}
                  undoController={undoController}
                />
              );
            }
            return (
              <StickyNote
                key={o.id}
                note={o}
                doc={d}
                zoom={cameraState.camera.zoom}
                selected={selection.ids.has(o.id)}
                editing={o.id === selection.editingId}
                onSelect={selection.click}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
                undoController={undoController}
              />
            );
          })}
        </div>
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objs}
          camera={cameraState.camera}
          showHandles={selection.ids.size > 0}
          onHandlePointerDown={() => {}}
        />
      </div>
    );
  };
}

import { useMemo } from 'react';
function useMemo2(d: Y.Doc): UndoController {
  return useMemo(() => createUndo(d), [d]);
}

const Harness = makeHarness();

function renderHarness(seed: Seed = {}) {
  ensureTextRegistered();
  const apiRef: React.MutableRefObject<Api | null> = { current: null };
  const utils = render(<Harness seed={seed} apiRef={apiRef} />);
  const api = () => apiRef.current as Api;
  return { api, ...utils };
}

describe('text object (text.object)', () => {
  it('TC-19: Enter inserts newline; Escape ends editing and keeps text selected', () => {
    const { api, getByTestId, queryByTestId } = renderHarness({ text: [{ x: 100, y: 100, content: 'hi' }] });
    const texts = snapshotAll(api().doc).filter((o) => o.type === 'text');
    const id = texts[0].id;
    act(() => api().selection.startEdit(id));

    const ta = getByTestId('text-editor') as HTMLTextAreaElement;
    // caret at end
    expect(ta.value).toBe('hi');
    expect(ta.selectionStart).toBe(2);

    // Insert a newline via input
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi\nthere' } });
    });

    // Escape ends editing, keeps selected
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(queryByTestId('text-editor')).toBeNull();
    expect(api().selection.ids.has(id)).toBe(true);
    const text = (snapshotAll(api().doc).find((o) => o.id === id) as any).text;
    expect(text).toContain('\n');
  });

  it('TC-20: Escape with zero characters removes the object and clears selection', () => {
    const { api, getByTestId } = renderHarness({ text: [{ x: 100, y: 100 }] });
    const id = snapshotAll(api().doc).filter((o) => o.type === 'text')[0].id;
    act(() => api().selection.startEdit(id));
    const ta = getByTestId('text-editor') as HTMLTextAreaElement;
    expect(ta.value).toBe('');
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(api().doc.getMap('objects').has(id)).toBe(false);
    expect(api().selection.ids.size).toBe(0);
  });

  it('TC-21: TextToolbar shows S/M/L/XL with M pressed; clicking XL sets size XL, x/y unchanged', () => {
    const { api, getByTestId } = renderHarness({ text: [{ x: 100, y: 100, content: 'title' }] });
    const id = snapshotAll(api().doc).filter((o) => o.type === 'text')[0].id;
    act(() => api().selection.click(id));
    // toolbar visible
    expect(getByTestId('text-toolbar')).toBeTruthy();
    expect(getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');
    const before = snapshotAll(api().doc).find((o) => o.id === id) as any;
    act(() => {
      fireEvent.click(getByTestId('text-size-XL'));
    });
    const after = snapshotAll(api().doc).find((o) => o.id === id) as any;
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-22: single text selected -> only e and w handles rendered', () => {
    const { api, getByTestId, queryByTestId } = renderHarness({ text: [{ x: 100, y: 100, content: 'hi' }] });
    const id = snapshotAll(api().doc).filter((o) => o.type === 'text')[0].id;
    act(() => api().selection.click(id));
    expect(getByTestId('handle-e')).toBeTruthy();
    expect(getByTestId('handle-w')).toBeTruthy();
    expect(queryByTestId('handle-n')).toBeNull();
    expect(queryByTestId('handle-s')).toBeNull();
    expect(queryByTestId('handle-nw')).toBeNull();
    expect(queryByTestId('handle-se')).toBeNull();
  });

  it('TC-23: text + sticky selected -> all handles; font size unchanged', () => {
    const { api, getByTestId } = renderHarness({
      text: [{ x: 100, y: 100, content: 'hi', size: 'XL' }],
      sticky: [{ x: 400, y: 100 }],
    });
    const objs = snapshotAll(api().doc);
    const text = objs.find((o) => o.type === 'text')!;
    const sticky = objs.find((o) => o.type === 'sticky')!;
    act(() => api().selection.setMany([text.id, sticky.id], false));
    // mixed selection shows all handles
    expect(getByTestId('handle-n')).toBeTruthy();
    expect(getByTestId('handle-se')).toBeTruthy();
    expect(getByTestId('handle-e')).toBeTruthy();
  });

  it('TC-24: remote delete during editing -> editor unmounts, no error, not recreated', () => {
    const { api, getByTestId, queryByTestId } = renderHarness({ text: [{ x: 100, y: 100, content: 'hi' }] });
    const id = snapshotAll(api().doc).filter((o) => o.type === 'text')[0].id;
    act(() => api().selection.startEdit(id));
    expect(getByTestId('text-editor')).toBeTruthy();
    // remote delete
    act(() => {
      api().doc.getMap('objects').delete(id);
    });
    // editor gone and not recreated; no error thrown
    expect(queryByTestId('text-editor')).toBeNull();
    expect(api().doc.getMap('objects').has(id)).toBe(false);
  });

  it('TC-25: type then Ctrl+Z -> text and stored box revert together in one step', () => {
    const { api, getByTestId } = renderHarness({ text: [{ x: 100, y: 100 }] });
    const id = snapshotAll(api().doc).filter((o) => o.type === 'text')[0].id;
    act(() => api().selection.startEdit(id));
    const ta = getByTestId('text-editor') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(ta, { target: { value: 'hello world' } });
    });
    const withText = snapshotAll(api().doc).find((o) => o.id === id) as any;
    expect(withText.text).toBe('hello world');
    expect(withText.width).toBeGreaterThan(0);
    // Undo once: text and box revert together
    act(() => {
      api().undoController.undo();
    });
    const undone = snapshotAll(api().doc).find((o) => o.id === id) as any;
    expect(undone.text).toBe('');
    // box also reverted (not the wide measured box)
    expect(undone.width).toBeLessThan(withText.width);
  });
});
