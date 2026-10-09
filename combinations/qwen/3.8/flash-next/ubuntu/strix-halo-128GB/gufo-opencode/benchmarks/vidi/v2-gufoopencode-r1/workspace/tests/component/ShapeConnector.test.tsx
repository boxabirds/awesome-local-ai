import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { initDoc, snapshotAll, type ObjectSnapshot } from '../../src/shared/board-model';
import { createSticky } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { getObjectType } from '../../src/client/objects/registry';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { Point } from '../../src/shared/geometry';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';

interface Reg {
  doc: Y.Doc;
  selection: SelectionApi;
}
let registry: MutableRefObject<Reg | null> = { current: null };

function Harness(props: { canEdit?: boolean }): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;
  const [notes, setNotes] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const observer = (): void => setNotes(snapshotAll(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  const selection = useSelection(notes);
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit !== false} />;
}

const ctrl = (): Reg => registry.current!;
const CAM = { x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 };
// The viewport reports a zero rect in jsdom, so client px equal the viewport
// frame the camera maps world through.
const clientToWorld = (clientX: number, clientY: number): Point => screenToWorld(CAM, { x: clientX, y: clientY });

const objects = (): ObjectSnapshot[] => [...snapshotAll(ctrl().doc)];
const byType = (type: string): ObjectSnapshot[] => objects().filter((obj) => obj.type === type);
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};
const toolButton = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement;
const pressed = (b: HTMLButtonElement): boolean => b.getAttribute('aria-pressed') === 'true';

function placeShape(clientX: number, clientY: number): string {
  let id = '';
  act(() => {
    id = createShape(ctrl().doc, { kind: 'rect', rect: null, at: clientToWorld(clientX, clientY), square: false }, 's') as string;
  });
  return id;
}

function dragTool(testId: string, from: [number, number], to: [number, number]): void {
  const overlay = screen.getByTestId(testId);
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(overlay, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(overlay, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

beforeEach(() => {
  registry = { current: null };
});
afterEach(() => {
  cleanup();
});

describe('shape.ui component (story 10)', () => {
  test('TC-15 S drag shows a preview, creates one shape and selects it', () => {
    render(<Harness />);
    press('s');
    expect(pressed(toolButton('Shape (S)'))).toBe(true);
    dragTool('shape-tool-overlay', [100, 100], [300, 220]);
    const shapes = byType('shape');
    expect(shapes.length).toBe(1);
    expect(shapes[0].width).toBeCloseTo(200, 1);
    expect(shapes[0].height).toBeCloseTo(120, 1);
    expect(ctrl().selection.ids.has(shapes[0].id)).toBe(true);
    expect(pressed(toolButton('Select (V)'))).toBe(true);
  });

  test('TC-15b the dashed preview is shown while dragging', () => {
    render(<Harness />);
    press('s');
    const overlay = screen.getByTestId('shape-tool-overlay');
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 260, clientY: 200 });
    expect(screen.queryByTestId('shape-preview')).not.toBeNull();
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 260, clientY: 200 });
  });

  test('TC-16 double-click opens the label editor and clamps to SHAPE_LABEL_MAX_CHARS', () => {
    render(<Harness />);
    const id = placeShape(300, 200);
    const el = document.querySelector(`[data-testid="shape-${id}"]`) as HTMLElement;
    fireEvent.doubleClick(el);
    const editor = document.querySelector(`[data-testid="shape-editor-${id}"]`) as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    fireEvent.input(editor, { target: { value: 'x'.repeat(600) } });
    const shape = byType('shape')[0] as unknown as { label: string };
    expect(shape.label.length).toBe(500);
  });

  test('TC-17 fill and outline swatches apply and keep the selection', () => {
    render(<Harness />);
    const id = placeShape(300, 200);
    act(() => {
      ctrl().selection.setMany([id], false);
    });
    fireEvent.click(screen.getByTestId('shape-fill-blue'));
    fireEvent.click(screen.getByTestId('shape-stroke-red'));
    const shape = byType('shape')[0] as unknown as { fill: string; stroke: string; label: string };
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    expect(ctrl().selection.ids.has(id)).toBe(true);
  });

  test('TC-28 a shape drag starting over an existing sticky leaves the sticky put', () => {
    render(<Harness />);
    let sticky = '';
    act(() => {
      sticky = createSticky(ctrl().doc, { x: 0, y: 0 }) as string;
    });
    const before = byType('sticky')[0] as { x: number; y: number };
    press('s');
    dragTool('shape-tool-overlay', [200, 150], [360, 300]);
    expect(byType('shape').length).toBe(1);
    const after = objects().find((obj) => obj.id === sticky) as { x: number; y: number };
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('connector.ui component (story 10)', () => {
  test('TC-18 hovering a shape with the connector tool shows its four side dots', () => {
    render(<Harness />);
    const id = placeShape(300, 200);
    press('l');
    const overlay = screen.getByTestId('connector-tool-overlay');
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 200 });
    const group = screen.getByTestId(`connector-dots-${id}`);
    expect(group.querySelectorAll('[data-testid^="connector-dot-"]').length).toBe(4);
  });

  test('TC-19 dragging from one shape onto another creates an attached arrow', () => {
    render(<Harness />);
    const a = placeShape(300, 200);
    const b = placeShape(600, 500);
    press('l');
    const overlay = screen.getByTestId('connector-tool-overlay');
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 600, clientY: 500 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 600, clientY: 500 });
    const conns = byType('connector');
    expect(conns.length).toBe(1);
    const ends = conns[0] as unknown as { from: { objectId: string }; to: { objectId: string } };
    expect([ends.from.objectId, ends.to.objectId].sort()).toEqual([a, b].sort());
    expect(pressed(toolButton('Select (V)'))).toBe(true);
  });

  test('TC-21 dragging an end handle onto a third shape re-attaches it', () => {
    render(<Harness />);
    const a = placeShape(200, 200);
    const b = placeShape(500, 200);
    const c = placeShape(500, 600);
    let conn = '';
    act(() => {
      conn = createConnector(ctrl().doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 's') as string;
    });
    act(() => {
      ctrl().selection.setMany([conn], false);
    });
    const handle = document.querySelector(`[data-testid="connector-handle-to-${conn}"]`) as Element;
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 500, clientY: 200 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 500, clientY: 600 });
    const ends = byType('connector')[0] as unknown as { to: { kind: string; objectId: string } };
    expect(ends.to.kind).toBe('attached');
    expect(ends.to.objectId).toBe(c);
  });

  test('TC-20 connector hit-test uses a screen-constant tolerance across zoom', () => {
    const spec = getObjectType('connector')!;
    const conn = {
      resolved: { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }
    } as unknown as ObjectSnapshot;
    for (const zoom of [0.5, 2]) {
      const tolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;
      expect(spec.hitTest(conn, { x: 50, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(conn, { x: 50, y: tolerance }, zoom)).toBe(true);
      expect(spec.hitTest(conn, { x: 50, y: 7 / zoom }, zoom)).toBe(false);
    }
  });
});

describe('tools.active_tool (story 10)', () => {
  test('TC-22 creating with Shape then Connector returns to Select; Escape creates nothing', () => {
    render(<Harness />);
    // Shape then create → Select active.
    press('s');
    dragTool('shape-tool-overlay', [120, 120], [260, 240]);
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(byType('shape').length).toBe(1);

    // Connector then create → Select active.
    const a = placeShape(700, 200);
    const b = placeShape(900, 520);
    press('l');
    dragTool('connector-tool-overlay', [700, 200], [900, 520]);
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(byType('connector').length).toBe(1);
    expect(a).not.toBe(b);

    // Escape while Shape armed → Select, no new shape.
    const shapes = byType('shape').length;
    press('s');
    expect(pressed(toolButton('Shape (S)'))).toBe(true);
    press('Escape');
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(byType('shape').length).toBe(shapes);

    // Escape while Connector armed → Select, no new connector.
    const conns = byType('connector').length;
    press('l');
    expect(pressed(toolButton('Connector (L)'))).toBe(true);
    press('Escape');
    expect(pressed(toolButton('Select (V)'))).toBe(true);
    expect(byType('connector').length).toBe(conns);
  });
});
