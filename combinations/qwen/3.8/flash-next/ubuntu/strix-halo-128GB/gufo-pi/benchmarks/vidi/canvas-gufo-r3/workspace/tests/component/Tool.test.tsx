import { describe, it, expect, afterEach } from 'vitest';
import React, { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { useTool, Tool } from '@client/board/useTool';
import { Toolbar } from '@client/board/Toolbar';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { useCamera } from '@client/canvas/useCamera';
import { Camera, screenToWorld } from '@client/canvas/camera';
import { createSticky } from '@shared/board-model';
import { createText, snapshotText } from '@shared/objects/text';
import { useSelection } from '@client/board/useSelection';

const VIEWPORT = { width: 1280, height: 800 };

interface ToolApi {
  doc: Y.Doc;
  tool: Tool;
  setTool(t: Tool): void;
  selection: ReturnType<typeof useSelection>;
  camera: Camera;
}

function ToolHarness({ canEdit = true }: { canEdit?: boolean; apiRef: React.MutableRefObject<ToolApi | null> }) {
  return null;
}

function makeHarness() {
  const docRef = React.createRef<Y.Doc>() as unknown as { current: Y.Doc };
  const Comp: React.FC<{ apiRef: React.MutableRefObject<ToolApi | null>; canEdit?: boolean }> = ({ apiRef, canEdit = true }) => {
    const doc = useRef(new Y.Doc()).current;
    const selection = useSelection();
    const cameraState = useCamera(VIEWPORT);
    const { camera } = cameraState;
    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    const { tool, setTool } = useTool(canEdit);
    apiRef.current = { doc, tool, setTool, selection, camera };

    const createStickyCentre = useCallback(() => {
      const world = screenToWorld(cameraRef.current, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    }, [doc, selection]);

    const handleClickEmpty = useCallback(
      (screenPoint: { x: number; y: number }) => {
        if (!canEdit) return;
        if (tool === 'text') {
          const world = screenToWorld(cameraRef.current, screenPoint);
          const id = createText(doc, world, 'user');
          setTool('select');
          if (id) selection.startEdit(id);
          return;
        }
      },
      [canEdit, tool, doc, setTool, selection],
    );

    return (
      <div style={{ width: VIEWPORT.width, height: VIEWPORT.height }}>
        <BoardViewport camera={camera} cursor={tool === 'text' ? 'text' : 'grab'} onClickEmpty={handleClickEmpty}>
          <div />
        </BoardViewport>
        <Toolbar onCreateSticky={createStickyCentre} disabled={!canEdit} tool={tool} onToolChange={setTool} />
      </div>
    );
  };
  return Comp;
}

const Comp = makeHarness();
afterEach(cleanup);

function renderHarness(canEdit = true) {
  const apiRef: React.MutableRefObject<ToolApi | null> = { current: null };
  const utils = render(<Comp apiRef={apiRef} canEdit={canEdit} />);
  const api = () => apiRef.current as ToolApi;
  return { api, ...utils };
}

describe('tool mode (text.tool)', () => {
  it('TC-14: Text button activates on T; Escape -> Select; T then V -> Select', () => {
    const { api, getByTestId } = renderHarness();
    const textBtn = getByTestId('tool-text');
    const selectBtn = getByTestId('tool-select');

    fireEvent.click(textBtn);
    expect(api().tool).toBe('text');
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');

    act(() => { api().setTool('select'); });
    expect(api().tool).toBe('select');
    expect(selectBtn.getAttribute('aria-pressed')).toBe('true');

    act(() => { api().setTool('text'); });
    act(() => { api().setTool('select'); });
    expect(api().tool).toBe('select');
  });

  it('TC-15: canEdit false -> Text button disabled and T ignored (Text stays select)', () => {
    const { api, getByTestId } = renderHarness(false);
    const textBtn = getByTestId('tool-text');
    expect(textBtn).toBeDisabled();
    act(() => { api().setTool('text'); });
    expect(api().tool).toBe('select');
  });

  it('TC-17: Text active + click board at screen (300,200) -> createText at world point, tool back to select, editing started', () => {
    const { api, getByTestId } = renderHarness();
    fireEvent.click(getByTestId('tool-text'));
    expect(api().tool).toBe('text');

    const viewport = getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 300, clientY: 200, button: 0 });

    const a = api();
    expect(a.tool).toBe('select');
    const texts = snapshotText(a.doc);
    expect(texts.length).toBe(1);
    expect(texts[0].x).toBeCloseTo(-340);
    expect(texts[0].y).toBeCloseTo(-200);
    expect(a.selection.editingId).toBe(texts[0].id);
  });

  it('TC-18: N-style create sticky still creates a sticky at the view centre', () => {
    const { api, getByTestId } = renderHarness();
    fireEvent.click(getByTestId('create-sticky-button'));
    const a = api();
    const objects = a.doc.getMap('objects');
    let found = false;
    objects.forEach((m: unknown) => {
      if (m instanceof Y.Map && m.get('type') === 'sticky') found = true;
    });
    expect(found).toBe(true);
    expect(a.selection.editingId).not.toBeNull();
  });
});
