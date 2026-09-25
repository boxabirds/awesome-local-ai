import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { hasObject } from '../../src/shared/board-model';
import {
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Tool } from '../../src/client/board/useTool';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import type { Selection } from '../../src/client/board/useSelection';
import { useCamera } from '../../src/client/canvas/useCamera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useTool } from '../../src/client/board/useTool';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { createUndo } from '../../src/client/board/undo';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { Toolbar } from '../../src/client/board/Toolbar';
import { getObjectType } from '../../src/client/objects/registry';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import { createStroke } from '../../src/shared/objects/stroke';
import { simplify } from '../../src/shared/geometry/simplify';
import { LONG_SPIRAL } from '../fixtures/pen-paths';
import { enableFakeFrameTimers, flushFrames, DEFAULT_SIZE } from './test-utils';

/**
 * Story 11 pen.tool component tests (task 5, TC-09 to TC-14): the Pen tool in
 * jsdom with synthetic pointer events — commit (colour/thickness/identity),
 * zoom-scaled smoothing tolerance, the live preview, the STROKE_MAX_POINTS
 * split, tool state (P / Escape / V) and option changes not touching
 * existing strokes.
 *
 * Coordinate model: 1280x800 viewport, home camera {-640, -400, 1}, so
 * screen = world + (640, 400).
 */

// createStroke and simplify are spied (calling through to the real
// implementations, so the strokes really exist in the doc for assertions).
vi.mock('../../src/shared/objects/stroke', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/shared/objects/stroke')>();
  return { ...original, createStroke: vi.fn(original.createStroke) };
});
vi.mock('../../src/shared/geometry/simplify', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/shared/geometry/simplify')>();
  return { ...original, simplify: vi.fn(original.simplify) };
});

const PID = 1;
const IDENTITY = 'drawer-1';

const sc = (wx: number, wy: number) => ({ clientX: wx + 640, clientY: wy + 400 });

/** The full board wiring plus the pen (the PenTool harness). */
function PenHarness({
  docRef,
  apiRef,
  selectionRef,
  toolRef,
}: {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  selectionRef: RefObject<Selection | null>;
  toolRef: RefObject<Tool | null>;
}) {
  const size = DEFAULT_SIZE;
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const [undo] = useState(() => createUndo(doc));
  useEffect(() => () => undo.destroy(), [undo]);
  const selection = useSelection(notes, (id) => hasObject(doc, id));
  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: true,
  });
  const { tool, setTool } = useTool(true);
  const pen = usePenOptions();
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: true, undo, tool, setTool });
  if (docRef) docRef.current = doc;
  if (apiRef) apiRef.current = api;
  if (selectionRef) selectionRef.current = selection;
  if (toolRef) toolRef.current = tool;

  return (
    <div className="vidi6-shell">
      <BoardViewport api={api} tool={tool} onEmptyClick={() => selection.clear()}>
        {notes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={false}
              editable={true}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              undo={undo}
            />
          );
        })}
      </BoardViewport>
      {tool === 'pen' && (
        <PenTool
          camera={api.camera}
          color={pen.color}
          thickness={pen.thickness}
          doc={doc}
          identityId={IDENTITY}
          undo={undo}
        />
      )}
      {tool === 'pen' && (
        <PenToolbar
          color={pen.color}
          thickness={pen.thickness}
          onColor={pen.setColor}
          onThickness={pen.setThickness}
        />
      )}
      <Toolbar onCreateSticky={() => {}} tool={tool} onToolChange={setTool} />
    </div>
  );
}

function renderPenBoard() {
  const docRef: RefObject<Y.Doc | null> = { current: null };
  const apiRef: RefObject<CameraApi | null> = { current: null };
  const selectionRef: RefObject<Selection | null> = { current: null };
  const toolRef: RefObject<Tool | null> = { current: 'select' };
  render(<PenHarness docRef={docRef} apiRef={apiRef} selectionRef={selectionRef} toolRef={toolRef} />);
  const viewport = document.querySelector('.vidi6-viewport') as HTMLElement;
  return {
    doc: () => docRef.current!,
    api: () => apiRef.current!,
    selection: () => selectionRef.current!,
    tool: () => toolRef.current!,
    viewport,
  };
}

/** Activate the pen tool via the keyboard (P) — the real useBoardKeys path. */
const activatePen = () => act(() => { fireEvent.keyDown(window, { key: 'p' }); });

/** A short drag from world (0,0) to (dx, dy). */
const drawDrag = (viewport: HTMLElement, dx: number, dy: number) => {
  fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, ...sc(0, 0) });
  fireEvent.pointerMove(window, { pointerId: PID, ...sc(dx, dy) });
  fireEvent.pointerUp(window, { pointerId: PID, ...sc(dx, dy) });
};

beforeEach(() => {
  enableFakeFrameTimers();
  vi.mocked(createStroke).mockClear();
  vi.mocked(simplify).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pen.tool (TC-09 to TC-14)', () => {
  it('TC-09 pen: red + thick; drag commits exactly one stroke with red/thick; the tool stays pen', () => {
    const { viewport, doc, tool } = renderPenBoard();
    activatePen();
    expect(tool()).toBe('pen');

    // Pick red + thick in the pen toolbar.
    fireEvent.click(screen.getByTestId('pen-color-red'));
    fireEvent.click(screen.getByTestId('pen-thickness-thick'));

    drawDrag(viewport, 60, 20);

    expect(createStroke).toHaveBeenCalledTimes(1);
    const [calledDoc, args, by] = vi.mocked(createStroke).mock.calls[0]!;
    expect(calledDoc).toBe(doc());
    expect(args.color).toBe('red');
    expect(args.thickness).toBe('thick');
    expect(by).toBe(IDENTITY);

    // The stroke is really in the doc (the spy called through).
    const strokes = snapshot(doc()).filter((o) => o.type === 'stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.color).toBe('red');
    expect(strokes[0]!.thickness).toBe('thick');

    // The pen stays active after the commit (pen.stay_active).
    expect(tool()).toBe('pen');
    expect(screen.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-10 thin at 200% zoom: the smoothing tolerance passed to simplify is STROKE_SIMPLIFY_TOLERANCE_PX / 2', () => {
    const { viewport, api } = renderPenBoard();
    // Zoom to exactly 200%, keeping the board centre fixed.
    act(() => { api().zoomAtPoint({ x: 640, y: 400 }, 2); });
    flushFrames();
    expect(api().camera.zoom).toBe(2);

    activatePen();
    fireEvent.click(screen.getByTestId('pen-thickness-thin'));
    drawDrag(viewport, 60, 20);

    expect(createStroke).toHaveBeenCalledTimes(1);
    expect(simplify).toHaveBeenCalledTimes(1);
    const tolerance = vi.mocked(simplify).mock.calls[0]![1];
    expect(tolerance).toBeCloseTo(STROKE_SIMPLIFY_TOLERANCE_PX / 2, 12);
  });

  it('TC-11 preview: the preview path exists while the drag is in flight and is gone after release', () => {
    const { viewport } = renderPenBoard();
    activatePen();

    expect(screen.queryByTestId('pen-preview')).toBeNull();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, ...sc(0, 0) });
    fireEvent.pointerMove(window, { pointerId: PID, ...sc(30, 10) });
    flushFrames();

    const preview = screen.getByTestId('pen-preview');
    expect(preview.getAttribute('d')).toBeTruthy();
    // The preview is drawn in the pen colour at thickness × zoom.
    expect(preview.getAttribute('stroke')).toBe('#212121'); // default black
    expect(preview.getAttribute('stroke-width')).toBe('4'); // medium @ 100%

    fireEvent.pointerUp(window, { pointerId: PID, ...sc(30, 10) });
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(createStroke).toHaveBeenCalledTimes(1);
  });

  it(`TC-12 ${STROKE_MAX_POINTS + 10} synthetic moves: two createStroke calls; the second starts at the first's last point`, () => {
    const { viewport, doc } = renderPenBoard();
    activatePen();

    // Down at the spiral's first point, then STROKE_MAX_POINTS + 10 moves.
    const pts = LONG_SPIRAL;
    expect(pts.length).toBe(STROKE_MAX_POINTS + 10);
    fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, ...sc(pts[0]!.x, pts[0]!.y) });
    for (let i = 1; i < pts.length; i += 1) {
      fireEvent.pointerMove(window, { pointerId: PID, ...sc(pts[i]!.x, pts[i]!.y) });
    }
    fireEvent.pointerUp(window, { pointerId: PID, ...sc(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y) });

    expect(createStroke).toHaveBeenCalledTimes(2);
    const first = vi.mocked(createStroke).mock.calls[0]![1]!;
    const second = vi.mocked(createStroke).mock.calls[1]![1]!;
    expect(first.points.length).toBeGreaterThan(0);
    expect(second.points.length).toBeGreaterThan(0);
    // The join point: part 2 starts where part 1 ended.
    expect(second.points[0]).toEqual(first.points[first.points.length - 1]);
    // Both strokes are in the doc.
    expect(snapshot(doc()).filter((o) => o.type === 'stroke')).toHaveLength(2);
  });

  it('TC-13 pen: Escape → select; V keeps select; nothing is created', () => {
    const { doc, tool } = renderPenBoard();
    activatePen();
    expect(tool()).toBe('pen');

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(tool()).toBe('select');
    expect(screen.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'false');

    act(() => { fireEvent.keyDown(window, { key: 'v' }); });
    expect(tool()).toBe('select');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');

    expect(createStroke).not.toHaveBeenCalled();
    expect(snapshot(doc())).toHaveLength(0);
    // The pen overlay is unmounted with the tool.
    expect(screen.queryByTestId('pen-overlay')).toBeNull();
  });

  it('TC-14 changing the colour after a stroke: the existing stroke keeps its colour; the next stroke uses the new one', () => {
    const { viewport, doc } = renderPenBoard();
    activatePen();
    // First stroke with the default black.
    drawDrag(viewport, 40, 10);
    let strokes = snapshot(doc()).filter((o) => o.type === 'stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.color).toBe('black');

    // Switch to red and draw a second stroke elsewhere.
    fireEvent.click(screen.getByTestId('pen-color-red'));
    fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, ...sc(200, 0) });
    fireEvent.pointerMove(window, { pointerId: PID, ...sc(260, 30) });
    fireEvent.pointerUp(window, { pointerId: PID, ...sc(260, 30) });

    strokes = snapshot(doc()).filter((o) => o.type === 'stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.color).toBe('black'); // unchanged
    expect(strokes[1]!.color).toBe('red'); // new option
    expect(createStroke).toHaveBeenCalledTimes(2);
  });
});

