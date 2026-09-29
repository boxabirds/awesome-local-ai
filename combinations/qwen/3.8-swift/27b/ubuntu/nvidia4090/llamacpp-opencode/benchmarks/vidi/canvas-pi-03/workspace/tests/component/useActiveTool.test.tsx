/**
 * Story 10 component test — tools.active_tool (TC-22): return-to-Select
 * after creating with the Shape or Connector tool, and Escape returning to
 * Select without creating anything (negative).
 *
 * jsdom: 1024x768 window, world (0,0) at screen (512,384), zoom 1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects } from 'src/shared/board-model';
import { createShape } from 'src/shared/objects/shape';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function selectButton(): HTMLElement {
  return screen.getByTestId('select-tool-button');
}
function shapeButton(): HTMLElement {
  return screen.getByTestId('shape-tool-button');
}
function connectorButton(): HTMLElement {
  return screen.getByTestId('connector-tool-button');
}

describe('tools.active_tool (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-22: S then create, L then create → Select active; S then Escape, L then Escape → Select active and nothing created (negative)', async () => {
    const doc = getDoc();
    const user = userEvent.setup();

    // --- S then create: the shape is created and the tool returns to Select.
    await user.keyboard('s');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    let layer = screen.getByTestId('shape-tool-layer');
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 712, clientY: 514 });
    expect(allObjects(doc).filter((o) => o.type === 'shape')).toHaveLength(1);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');

    // --- L then create: seed two shapes in the doc, drag A→B, the arrow is
    // created and the tool returns to Select.
    createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 100, height: 100 }, at: { x: 100, y: 100 } }, 'test');
    createShape(doc, { kind: 'rect', rect: { x: 400, y: 100, width: 100, height: 100 }, at: { x: 400, y: 100 } }, 'test');
    // Wait for the seeded shapes to render.
    await screen.findAllByTestId('shape-object');

    await user.keyboard('l');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    layer = screen.getByTestId('connector-tool-layer');
    fireEvent.pointerDown(layer, { button: 0, clientX: 662, clientY: 534 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 962, clientY: 534 });
    const connectors = allObjects(doc).filter((o) => o.type === 'connector');
    expect(connectors).toHaveLength(1);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');

    // --- S then Escape: Select active, nothing created.
    await user.keyboard('s');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    // 1 (drag-created) + 2 (seeded for the L section) = 3 shapes.
    expect(allObjects(doc).filter((o) => o.type === 'shape')).toHaveLength(3);

    // --- L then Escape: Select active, no new connector.
    await user.keyboard('l');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
    expect(allObjects(doc).filter((o) => o.type === 'connector')).toHaveLength(1);
  });

  it('the Shape button kind menu sets the drawn kind (Rectangle / Ellipse / Diamond)', async () => {
    const doc = getDoc();
    const user = userEvent.setup();

    await user.keyboard('s');
    // The kind menu is visible while the Shape tool is active.
    const menu = screen.getByTestId('shape-kind-menu');
    expect(menu).toBeTruthy();
    expect(screen.getByTestId('shape-kind-rect')).toHaveAttribute('aria-pressed', 'true');

    // Pick Diamond, then click-create.
    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    const layer = screen.getByTestId('shape-tool-layer');
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 612, clientY: 434 });
    const [shape] = allObjects(doc);
    expect(shape.type).toBe('shape');
    expect(screen.getByTestId('shape-object')).toHaveAttribute('data-shape-kind', 'diamond');
  });
});
