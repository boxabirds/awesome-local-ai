import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { CONNECTOR_BUTTON_LABEL, SHAPE_BUTTON_LABEL } from '../../src/client/board/Toolbar';
import { dispatchKey, TEST_BOARD_ID } from './util';
import { getSelection, getSnapshot } from './stickyUtil';
import { toolButton, toolState } from './textUtil';
import {
  clickTestId,
  connectorLayer,
  connectorToolEl,
  createShapeByClick,
  dragOn,
  editShapeLabel,
  getConnectors,
  getShapes,
  seedShapes,
  seedShape,
  shapeLayer,
  shapeToolEl,
} from './shapeUtil';

/**
 * Story 10 — the active tool (tools.active_tool).
 *
 * Which tool is active belongs to this tab alone: it lives in React state and never in
 * the shared document, so two people on one board are never in each other's mode. Both
 * drawing tools hand the board back to Select once they have drawn something, so the
 * next thing you do to what you drew is a move, not another shape.
 */
describe('the active tool (tools.active_tool)', () => {
  // TC-22: S, draw, and the board is on Select again; the same for L.
  it('TC-22 returns to Select after each tool has drawn, with the new thing selected', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    expect(toolState()).toBe('select');

    // S, then draw.
    const shape = createShapeByClick({ x: 200, y: 200 });
    expect(getShapes()).toHaveLength(1);
    expect(toolState()).toBe('select');
    expect(getSelection().selectedId).toBe(shape.id);
    expect(toolButton('shape').getAttribute('aria-pressed')).toBe('false');
    expect(shapeToolEl()).toBeNull();

    // L, then draw an arrow between two shapes.
    seedShapes([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 400, y: 0, width: 200, height: 100 },
    ]);
    const layer = connectorLayer();
    expect(toolState()).toBe('connector');
    dragOn(layer, { x: 100, y: 50 }, { x: 500, y: 50 });

    const connectors = getConnectors();
    expect(connectors).toHaveLength(1);
    expect(toolState()).toBe('select');
    expect(connectorToolEl()).toBeNull();
    expect(getSelection().selectedId).toBe(connectors[0]!.id);
    expect(toolButton('connector').getAttribute('aria-pressed')).toBe('false');
  });

  // TC-22's negative half: Escape abandons the tool and draws nothing.
  it('TC-22 leaves the tool on Escape without creating anything', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);

    dispatchKey({ key: 's' });
    expect(toolState()).toBe('shape');
    expect(shapeToolEl()).not.toBeNull();
    dispatchKey({ key: 'Escape' });
    expect(toolState()).toBe('select');
    expect(shapeToolEl()).toBeNull();

    dispatchKey({ key: 'l' });
    expect(toolState()).toBe('connector');
    expect(connectorToolEl()).not.toBeNull();
    dispatchKey({ key: 'Escape' });
    expect(toolState()).toBe('select');
    expect(connectorToolEl()).toBeNull();

    // Neither tool left anything behind on the way out.
    expect(getShapes()).toHaveLength(0);
    expect(getConnectors()).toHaveLength(0);
    expect(getSelection().selectedId).toBeNull();
  });

  // Both ways in: the letters and the buttons, and V back out.
  it('switches tools by letter and by button, and marks the button that is in use', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);

    dispatchKey({ key: 's' });
    expect(toolState()).toBe('shape');
    expect(toolButton('shape').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('false');
    dispatchKey({ key: 'l' });
    expect(toolState()).toBe('connector');
    expect(toolButton('connector').getAttribute('aria-pressed')).toBe('true');
    dispatchKey({ key: 'v' });
    expect(toolState()).toBe('select');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');

    // The kind menu belongs to the Shape tool: it comes up with the tool, and picking a
    // kind stays in the tool rather than firing it off.
    clickTestId('tool-shape');
    expect(toolState()).toBe('shape');
    expect(screen.getByTestId('shape-kind-menu')).toBeTruthy();
    clickTestId('tool-shape-kind-diamond');
    expect(toolState()).toBe('shape');
    expect(screen.getByTestId('tool-shape-kind-diamond').getAttribute('aria-pressed')).toBe('true');

    clickTestId('tool-connector');
    expect(toolState()).toBe('connector');
    // The menu went with the tool it belongs to.
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull();
  });

  // A letter typed into a label is a letter, not a change of tool.
  it('leaves the tool alone while a label is being written (negative)', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    seedShape({ x: 0, y: 0, width: 200, height: 120, label: 'Draft' });
    editShapeLabel();
    expect(getSelection().editingId).not.toBeNull();

    const input = screen.getByTestId('shape-label-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    expect(toolState()).toBe('select');
    expect(shapeToolEl()).toBeNull();
    expect(getShapes()[0]!.label).toBe('Draft');
  });

  // N is not a tool: it keeps story 2's behaviour of making a note straight away.
  it('leaves N alone as the way of making a note, and does not draw anything for it', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    dispatchKey({ key: 'n' });
    expect(toolState()).toBe('select');
    expect(shapeToolEl()).toBeNull();
    expect(connectorToolEl()).toBeNull();
    expect(getShapes()).toHaveLength(0);
    expect(getConnectors()).toHaveLength(0);
    // A note appeared, which is what N has always done.
    expect(getSnapshot()).toHaveLength(1);
  });
});

/** The two new tools live in the toolbar beside the old ones, with their letters. */
describe('the Shape and Connector buttons', () => {
  it('names both tools with their shortcuts and offers the three shape kinds', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const shape = screen.getByTestId('tool-shape');
    const connector = screen.getByTestId('tool-connector');
    // The design's exact names, so they are the same words everywhere.
    expect(shape.getAttribute('aria-label')).toBe(SHAPE_BUTTON_LABEL);
    expect(SHAPE_BUTTON_LABEL).toBe('Shape (S)');
    expect(connector.getAttribute('aria-label')).toBe(CONNECTOR_BUTTON_LABEL);
    expect(CONNECTOR_BUTTON_LABEL).toBe('Connector (L)');

    // The kind menu comes up with the tool, and names each kind.
    shapeLayer();
    expect(screen.getByTestId('shape-kind-menu')).toBeTruthy();
    expect((screen.getByTestId('tool-shape-kind-rect') as HTMLButtonElement).textContent).toBe(
      'Rectangle',
    );
    expect((screen.getByTestId('tool-shape-kind-ellipse') as HTMLButtonElement).textContent).toBe(
      'Ellipse',
    );
    expect((screen.getByTestId('tool-shape-kind-diamond') as HTMLButtonElement).textContent).toBe(
      'Diamond',
    );
    // One kind is chosen at a time, and the rectangle is the default.
    expect(screen.getByTestId('tool-shape-kind-rect').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tool-shape-kind-diamond').getAttribute('aria-pressed')).toBe('false');
  });
});
