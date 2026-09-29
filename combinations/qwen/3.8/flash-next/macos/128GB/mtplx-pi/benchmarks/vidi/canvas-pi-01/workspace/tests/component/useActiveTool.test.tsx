/**
 * Story 10 · task 14 — the active-tool state (TC-22).
 *
 * The tool is per-client state that never reaches the `Y.Doc`; what a test can
 * observe is its three visible consequences: the toolbar button stays pressed
 * while a tool is active, one gesture creates at most one object, and the board
 * is back on Select afterwards — whether that happened by creating something or
 * by pressing Escape. A read-only board refuses to leave Select at all, and a
 * tool letter typed inside an open label is a character, not a shortcut.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

function key(keyName: string) {
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
  });
}

function pressed(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';
}

function objects(doc: Y.Doc) {
  return snapshot(doc).map((obj) => obj.type);
}

describe('Active tool (TC-22)', () => {
  // TC-22, part 1: each creating tool activates, creates exactly one object, and
  // hands the board back to Select.
  it('a Shape drag and a Connector drag each end back on Select', () => {
    const doc = freshDoc();
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    expect(pressed('tool-select')).toBe(true);

    key('s');
    expect(pressed('tool-shape')).toBe(true);
    const shapeTool = screen.getByTestId('shape-tool');
    fireEvent(shapeTool, pointer('pointerdown', 100, 100));
    fireEvent(shapeTool, pointer('pointermove', 260, 200));
    fireEvent(shapeTool, pointer('pointerup', 260, 200));
    expect(pressed('tool-shape')).toBe(false);
    expect(pressed('tool-select')).toBe(true);
    expect(objects(doc)).toEqual(['shape']);

    key('l');
    expect(pressed('tool-connector')).toBe(true);
    const connectorTool = screen.getByTestId('connector-tool');
    fireEvent(connectorTool, pointer('pointerdown', 400, 200));
    fireEvent(connectorTool, pointer('pointermove', 600, 320));
    fireEvent(connectorTool, pointer('pointerup', 600, 320));
    expect(pressed('tool-connector')).toBe(false);
    expect(pressed('tool-select')).toBe(true);
    expect(objects(doc)).toEqual(['shape', 'connector']);
  });

  // TC-22, part 2: Escape leaves Select active and writes nothing — including
  // when a gesture was in progress when Escape was pressed.
  it('Escape from Shape or Connector returns to Select and creates nothing', () => {
    const doc = freshDoc();
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    key('s');
    const shapeTool = screen.getByTestId('shape-tool');
    fireEvent(shapeTool, pointer('pointerdown', 100, 100));
    fireEvent(shapeTool, pointer('pointermove', 300, 200));
    key('Escape');
    expect(pressed('tool-shape')).toBe(false);
    expect(objects(doc)).toEqual([]);
    // The abandoned gesture left no in-progress preview behind either.
    key('s');
    expect(screen.queryByTestId('shape-preview')).toBeNull();

    key('Escape');
    key('l');
    const connectorTool = screen.getByTestId('connector-tool');
    fireEvent(connectorTool, pointer('pointerdown', 300, 300));
    fireEvent(connectorTool, pointer('pointermove', 500, 400));
    key('Escape');
    expect(pressed('tool-connector')).toBe(false);
    expect(objects(doc)).toEqual([]);
  });

  // The toolbar and the keyboard drive the same state, and `V` is Select.
  it('the Shape button, the Shape menu and V all agree with the keyboard', () => {
    const doc = freshDoc();
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    fireEvent.click(screen.getByTestId('tool-shape'));
    expect(pressed('tool-shape')).toBe(true);
    // The menu remembers the kind: choosing Ellipse makes that the next draw.
    fireEvent.click(screen.getByTestId('shape-kind-ellipse'));
    const shapeTool = screen.getByTestId('shape-tool');
    fireEvent(shapeTool, pointer('pointerdown', 150, 150));
    fireEvent(shapeTool, pointer('pointerup', 150, 150));
    const shapes = snapshot(doc).filter((obj) => obj.type === 'shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.kind).toBe('ellipse');

    // `V` clears an active tool without touching the document.
    fireEvent.click(screen.getByTestId('tool-connector'));
    expect(pressed('tool-connector')).toBe(true);
    key('v');
    expect(pressed('tool-connector')).toBe(false);
    expect(pressed('tool-select')).toBe(true);
    expect(objects(doc)).toEqual(['shape']);
  });

  // A read-only board cannot be drawn on: neither the keyboard nor the buttons
  // take it out of Select.
  it('a read-only board stays on Select and writes nothing', () => {
    const doc = freshDoc();
    render(<BoardShell viewport={VIEWPORT} doc={doc} connectionState="load_failed" />);
    expect((screen.getByTestId('tool-shape') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('tool-connector') as HTMLButtonElement).disabled).toBe(true);

    key('s');
    key('l');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(objects(doc)).toEqual([]);
  });

  // A tool letter typed into an open label stays a character.
  it('S inside an open label edits text instead of switching tools', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: -100, y: -60, width: 200, height: 120 }, at: { x: 0, y: 0 } },
      'tester',
    )!;
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    const shape = screen.getByTestId(`shape-${id}`) as HTMLElement;
    fireEvent.doubleClick(shape);
    const editor = screen.getByTestId(`shape-editor-${id}`) as HTMLTextAreaElement;
    editor.focus();

    key('s');
    expect(pressed('tool-shape')).toBe(false);
    expect(objects(doc)).toEqual(['shape']);
  });
});
