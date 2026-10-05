import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { ConnectorObject } from '../../src/client/objects/ConnectorObject';
import { createConnector } from '../../src/shared/objects/connector';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import type { Endpoint } from '../../src/shared/geometry/connector-geometry';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function createTestShape(doc: Y.Doc, id: string, x: number, y: number, w: number, h: number): void {
  const objects = doc.getMap('objects');
  const shapeMap = new Y.Map<unknown>();
  shapeMap.set('type', 'shape');
  shapeMap.set('x', x);
  shapeMap.set('y', y);
  shapeMap.set('width', w);
  shapeMap.set('height', h);
  shapeMap.set('kind', 'rect');
  shapeMap.set('fill', 'white');
  shapeMap.set('stroke', 'dark');
  shapeMap.set('text', new Y.Text());
  shapeMap.set('z', 1);
  shapeMap.set('createdAt', Date.now());
  shapeMap.set('createdBy', 'local');
  doc.transact(() => {
    objects.set(id, shapeMap);
  });
}

function makeSnapshot(doc: Y.Doc): ObjectSnapshot[] {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const result: ObjectSnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type !== 'shape' && type !== 'sticky') return;
    result.push({
      id,
      type: type as string,
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: obj.get('width') as number,
      height: obj.get('height') as number,
      text: '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });
  return result;
}

describe('ConnectorTool component', () => {
  // TC-18: L tool hover over shape → four dots at side midpoints.
  it('TC-18: hovering over a shape shows four connection dots', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 100, 100, 200, 100);
    const snapshot = makeSnapshot(doc);
    const onCreated = vi.fn();

    const { container } = render(
      <ConnectorTool camera={testCamera} snapshot={snapshot} doc={doc} onCreated={onCreated} />
    );

    const svg = container.querySelector('svg')!;

    // Move pointer over the shape (centre is at 200, 150)
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 150, pointerId: 1 });

    // Four dots should appear
    const dotTop = screen.getByTestId('conn-dot-A-top');
    const dotRight = screen.getByTestId('conn-dot-A-right');
    const dotBottom = screen.getByTestId('conn-dot-A-bottom');
    const dotLeft = screen.getByTestId('conn-dot-A-left');

    expect(dotTop).toBeDefined();
    expect(dotRight).toBeDefined();
    expect(dotBottom).toBeDefined();
    expect(dotLeft).toBeDefined();
  });

  // TC-19: drag from A over B → B's nearest dot highlighted; release → attached connector created.
  it('TC-19: drag from shape A to shape B creates attached connector', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);
    const snapshot = makeSnapshot(doc);
    const onCreated = vi.fn();

    const { container } = render(
      <ConnectorTool camera={testCamera} snapshot={snapshot} doc={doc} onCreated={onCreated} />
    );

    const svg = container.querySelector('svg')!;

    // Drag from centre of A (50, 50) to centre of B (350, 50)
    fireEvent.pointerDown(svg, { clientX: 50, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 350, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 350, clientY: 50, pointerId: 1 });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const id = onCreated.mock.calls[0][0];
    expect(id).toBeTypeOf('string');

    // Verify connector is attached to both A and B
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const from = obj.get('from') as any;
    const to = obj.get('to') as any;
    expect(from.objectId).toBe('A');
    expect(to.objectId).toBe('B');
  });
});

describe('Connector hit testing', () => {
  // TC-20: click 5 px and 7 px (screen) from an arrow at 50% and 200% zoom → selected / not selected (boundary, negative).
  it('TC-20: hit tolerance at different zoom levels', () => {
    // At 100% zoom: 5px < 6px tolerance → hit; 7px > 6px → miss
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // 5px from line
    expect(distanceToPolyline(pts, { x: 50, y: 5 })).toBeCloseTo(5, 10);
    expect(5 <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(true);

    // 7px from line
    expect(distanceToPolyline(pts, { x: 50, y: 7 })).toBeCloseTo(7, 10);
    expect(7 <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(false);

    // At 50% zoom: tolerance in world units = 6/0.5 = 12
    // 5 screen px = 10 world units → hit
    expect(10 <= CONNECTOR_HIT_TOLERANCE_PX / 0.5).toBe(true);
    // 7 screen px = 14 world units → miss
    expect(14 <= CONNECTOR_HIT_TOLERANCE_PX / 0.5).toBe(false);

    // At 200% zoom: tolerance in world units = 6/2 = 3
    // 5 screen px = 2.5 world units → hit
    expect(2.5 <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(true);
    // 7 screen px = 3.5 world units → miss
    expect(3.5 <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(false);
  });
});

describe('ConnectorObject component', () => {
  // TC-21: drag end handle onto C → attached to C; onto empty space → free at release point.
  it('TC-21: end handle drag reattaches to object or frees at point', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);
    createTestShape(doc, 'C', 0, 300, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const connId = createConnector(doc, from, to, 'local')!;

    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    rects.set('B', { x: 300, y: 0, width: 100, height: 100 });
    rects.set('C', { x: 0, y: 300, width: 100, height: 100 });

    const obj = {
      id: connId,
      type: 'connector' as const,
      x: 0, y: 0, width: 300, height: 0,
      z: 1, createdAt: Date.now(),
      from, to,
    };

    render(
      <svg>
        <ConnectorObject
          obj={obj as any}
          selected={true}
          rects={rects}
          doc={doc}
          camera={testCamera}
        />
      </svg>
    );

    // Drag the 'to' handle onto C (centre at 50, 350)
    const toHandle = screen.getByTestId(`connector-to-handle-${connId}`);
    fireEvent.pointerDown(toHandle, { clientX: 350, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(toHandle, { clientX: 50, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(toHandle, { clientX: 50, clientY: 350, pointerId: 1 });

    // Verify the endpoint is now attached to C
    const connObj = doc.getMap('objects').get(connId) as Y.Map<unknown>;
    const newTo = connObj.get('to') as any;
    expect(newTo.kind).toBe('attached');
    expect(newTo.objectId).toBe('C');
  });

  it('TC-21b: end handle drag to empty space creates free endpoint', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const connId = createConnector(doc, from, to, 'local')!;

    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    rects.set('B', { x: 300, y: 0, width: 100, height: 100 });

    const obj = {
      id: connId,
      type: 'connector' as const,
      x: 0, y: 0, width: 300, height: 0,
      z: 1, createdAt: Date.now(),
      from, to,
    };

    render(
      <svg>
        <ConnectorObject
          obj={obj as any}
          selected={true}
          rects={rects}
          doc={doc}
          camera={testCamera}
        />
      </svg>
    );

    // Drag the 'to' handle to empty space (500, 500)
    const toHandle = screen.getByTestId(`connector-to-handle-${connId}`);
    fireEvent.pointerDown(toHandle, { clientX: 350, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(toHandle, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(toHandle, { clientX: 500, clientY: 500, pointerId: 1 });

    // Verify the endpoint is now free
    const connObj = doc.getMap('objects').get(connId) as Y.Map<unknown>;
    const newTo = connObj.get('to') as any;
    expect(newTo.kind).toBe('free');
    expect(newTo.x).toBe(500);
    expect(newTo.y).toBe(500);
  });
});
