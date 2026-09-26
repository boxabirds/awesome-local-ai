import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { worldToScreen } from '../../src/client/canvas/camera';
import { fireKey, firePointer } from './helpers';

/**
 * Story 10, `tools.active_tool`: one drawing tool at a time. S and L select the
 * Shape and Connector tools; creating with either returns to Select, and Escape
 * leaves the tool without creating anything.
 */

function renderEditable() {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    },
  };
}

const camera = () => window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 };
const clientOf = (world: { x: number; y: number }) => worldToScreen(camera(), world);
const pressed = (testId: string): boolean =>
  screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';
const count = (doc: Y.Doc, type: string): number =>
  objectSnapshots(doc).filter((obj) => obj.type === type).length;

afterEach(cleanup);

describe('TC-22: one drawing tool at a time', () => {
  it('creating a shape and then an arrow leaves Select active both times', async () => {
    const { doc, settle } = renderEditable();
    await settle();

    // Shape: press S, click, done — back to Select.
    fireKey({ key: 's' });
    await settle();
    expect(pressed('tool-shape')).toBe(true);
    const shapeLayer = screen.getByTestId('shape-tool-layer');
    firePointer(shapeLayer, 'pointerdown', 200, 200);
    firePointer(shapeLayer, 'pointerup', 200, 200);
    await settle();
    expect(count(doc, 'shape')).toBe(1);
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();

    // Connector: press L, drag a long way across empty space — back to Select.
    fireKey({ key: 'l' });
    await settle();
    expect(pressed('tool-connector')).toBe(true);
    const connectorLayer = screen.getByTestId('connector-tool-layer');
    const from = clientOf({ x: 600, y: 500 });
    const to = clientOf({ x: 800, y: 620 });
    firePointer(connectorLayer, 'pointerdown', from.x, from.y);
    firePointer(connectorLayer, 'pointermove', to.x, to.y);
    firePointer(connectorLayer, 'pointerup', to.x, to.y);
    await settle();
    expect(count(doc, 'connector')).toBe(1);
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();
  });

  it('Escape leaves the tool with nothing created', async () => {
    const { doc, settle } = renderEditable();
    await settle();

    fireKey({ key: 's' });
    await settle();
    fireKey({ key: 'Escape' });
    await settle();
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();

    fireKey({ key: 'l' });
    await settle();
    fireKey({ key: 'Escape' });
    await settle();
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();

    expect(count(doc, 'shape')).toBe(0);
    expect(count(doc, 'connector')).toBe(0);
  });

  it('switching straight from Shape to Connector swaps the capture layer', async () => {
    const { settle } = renderEditable();
    await settle();

    fireKey({ key: 's' });
    await settle();
    expect(screen.getByTestId('shape-tool-layer')).toBeDefined();

    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();
    expect(pressed('tool-connector')).toBe(true);
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();
    expect(screen.getByTestId('connector-tool-layer')).toBeDefined();
  });

  it('the Shape button opens the kind menu and the kind is remembered', async () => {
    const { doc, settle } = renderEditable();
    await settle();

    fireEvent.click(screen.getByTestId('tool-shape'));
    await settle();
    expect(screen.getByTestId('shape-kind-menu')).toBeDefined();
    expect(screen.getByTestId('shape-kind-rect').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    await settle();
    expect(screen.getByTestId('shape-kind-diamond').getAttribute('aria-pressed')).toBe('true');

    // The choice survives leaving the tool and coming back to it.
    fireEvent.click(screen.getByTestId('tool-select'));
    await settle();
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull();
    fireKey({ key: 's' });
    await settle();
    expect(screen.getByTestId('shape-kind-diamond').getAttribute('aria-pressed')).toBe('true');

    const layer = screen.getByTestId('shape-tool-layer');
    firePointer(layer, 'pointerdown', 100, 100);
    firePointer(layer, 'pointerup', 100, 100);
    await settle();
    const created = objectSnapshots(doc).find((obj) => obj.type === 'shape') as {
      kind?: string;
    };
    expect(created.kind).toBe('diamond');
  });
});
