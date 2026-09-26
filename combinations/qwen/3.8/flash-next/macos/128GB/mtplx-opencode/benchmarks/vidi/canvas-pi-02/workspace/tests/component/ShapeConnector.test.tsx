/**
 * Component tests for shape/connector rendering and tool behaviour (Task 14).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector, isConnector } from '../../src/shared/objects/connector';
import { renderApp, type AppHarness, flush } from './appHarness';

function seedShapeAndConnector(doc: Y.Doc) {
  const shapeId = createShape(doc, {
    kind: 'rect',
    rect: { x: 0, y: 100, width: 200, height: 200 },
    at: { x: 100, y: 200 },
  }, 'test');
  const shape2Id = createShape(doc, {
    kind: 'ellipse',
    rect: { x: 400, y: 100, width: 200, height: 200 },
    at: { x: 500, y: 200 },
  }, 'test');
  const connId = shapeId && shape2Id
    ? createConnector(doc,
        { kind: 'attached', objectId: shapeId, fallback: { x: 200, y: 200 } },
        { kind: 'attached', objectId: shape2Id, fallback: { x: 400, y: 200 } },
        'test',
      )
    : null;
  return { shapeId, shape2Id, connId };
}

describe('shape rendering', () => {
  it('renders shape objects in the DOM', async () => {
    const harness = renderApp([], { canEdit: true });
    const doc = harness.doc;
    createShape(doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: 200, height: 200 },
      at: { x: 150, y: 150 },
    }, 'test');
    await flush();
    const shapes = harness.container.querySelectorAll('[data-testid="shape-object"]');
    expect(shapes.length).toBe(1);
  });

  it('renders connector objects in the DOM', async () => {
    const harness = renderApp([], { canEdit: true });
    const doc = harness.doc;
    seedShapeAndConnector(doc);
    await flush();
    const connectors = harness.container.querySelectorAll('[data-testid="connector-object"]');
    expect(connectors.length).toBe(1);
  });

  it('connector has SVG line element', async () => {
    const harness = renderApp([], { canEdit: true });
    seedShapeAndConnector(harness.doc);
    await flush();
    const conn = harness.container.querySelector('[data-testid="connector-object"]');
    expect(conn).not.toBeNull();
    const line = conn!.querySelector('line');
    expect(line).not.toBeNull();
  });

  it('shape has SVG shape element', async () => {
    const harness = renderApp([], { canEdit: true });
    createShape(harness.doc, {
      kind: 'rect',
      rect: { x: 50, y: 50, width: 200, height: 200 },
      at: { x: 150, y: 150 },
    }, 'test');
    await flush();
    const shape = harness.container.querySelector('[data-testid="shape-object"]');
    expect(shape).not.toBeNull();
    const rect = shape!.querySelector('rect');
    expect(rect).not.toBeNull();
  });
});

describe('toolbar', () => {
  it('shape button exists and activates shape tool', async () => {
    const harness = renderApp([], { canEdit: true });
    const shapeBtn = harness.container.querySelector('[data-testid="tool-shape"]');
    expect(shapeBtn).not.toBeNull();
    expect(shapeBtn!.getAttribute('aria-pressed')).toBe('false');
    // Click the shape button.
    (shapeBtn as HTMLElement).click();
    await flush();
    expect(shapeBtn!.getAttribute('aria-pressed')).toBe('true');
  });

  it('connector button exists and activates connector tool', async () => {
    const harness = renderApp([], { canEdit: true });
    const connBtn = harness.container.querySelector('[data-testid="tool-connector"]');
    expect(connBtn).not.toBeNull();
    expect(connBtn!.getAttribute('aria-pressed')).toBe('false');
    (connBtn as HTMLElement).click();
    await flush();
    expect(connBtn!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('keyboard shortcuts', () => {
  it('pressing S activates shape tool', async () => {
    const harness = renderApp([], { canEdit: true });
    // Press S key.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await flush();
    const shapeBtn = harness.container.querySelector('[data-testid="tool-shape"]');
    expect(shapeBtn!.getAttribute('aria-pressed')).toBe('true');
  });

  it('pressing L activates connector tool', async () => {
    const harness = renderApp([], { canEdit: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    await flush();
    const connBtn = harness.container.querySelector('[data-testid="tool-connector"]');
    expect(connBtn!.getAttribute('aria-pressed')).toBe('true');
  });

  it('pressing V returns to select tool', async () => {
    const harness = renderApp([], { canEdit: true });
    // Activate shape tool first.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await flush();
    // Now press V.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    await flush();
    const selectBtn = harness.container.querySelector('[data-testid="tool-select"]');
    expect(selectBtn!.getAttribute('aria-pressed')).toBe('true');
    const shapeBtn = harness.container.querySelector('[data-testid="tool-shape"]');
    expect(shapeBtn!.getAttribute('aria-pressed')).toBe('false');
  });

  it('pressing Escape returns to select tool', async () => {
    const harness = renderApp([], { canEdit: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await flush();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    const selectBtn = harness.container.querySelector('[data-testid="tool-select"]');
    expect(selectBtn!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('connector stays attached on move', () => {
  it('connector remains when one shape is deleted', async () => {
    const harness = renderApp([], { canEdit: true });
    const { shapeId, connId } = seedShapeAndConnector(harness.doc);
    await flush();
    // Verify connector is rendered.
    expect(harness.container.querySelectorAll('[data-testid="connector-object"]').length).toBe(1);
    // Delete shape A.
    deleteObjects(harness.doc, [shapeId!]);
    await flush();
    // Connector should still be there but detached.
    const conn = snapshot(harness.doc).find((s) => s.id === connId);
    expect(conn).toBeDefined();
    expect((conn as any).from.kind).toBe('free');
  });
});
