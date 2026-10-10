import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  activeTool,
  createShapeObject,
  docConnectors,
  docShapes,
  flushFrame,
  pointerEvent,
  pressKey,
  renderBoard,
  selectionCount,
  shapeCentre,
  shapeEditorElement,
  shapeSvgElement,
  toolButton,
  toolPressed,
} from './harness';
import { TOOL_SHORTCUTS } from '../../src/shared/config';
import { ARMLED_TOOL_IDS } from '../../src/client/tools/useActiveTool';
import type { BoardProvider, ProviderStatus } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';

/**
 * Which tool the board is holding (`tool.shortcuts`, `tool.return_to_select`:
 * TC-22).
 *
 * The tool is per-client state that never reaches the document, so it is read off
 * the rendered board (`data-tool`, the toolbar's `aria-pressed`) rather than from a
 * hook in isolation - the same way every other story in this app tests it. What
 * matters is the whole round trip: a letter arms a tool, the tool makes one object,
 * that object is the selection, and the tool is put away again.
 */

/** The board's editability, which only a failed board load takes away. */
const boardEditable = (): string | undefined => screen.getByTestId('app').dataset.boardEditable;

class RefusingProvider implements BoardProvider {
  private status: ((event: { status: ProviderStatus }) => void)[] = [];
  private close: ((event: { code: number } | null) => void)[] = [];

  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  on(name: 'connection-close', handler: (event: { code: number } | null) => void): void;
  on(name: string, handler: (event: never) => void): void {
    if (name === 'status') {
      this.status.push(handler as (event: { status: ProviderStatus }) => void);
    } else if (name === 'connection-close') {
      this.close.push(handler as (event: { code: number } | null) => void);
    }
  }

  refuseToLoad(): void {
    for (const handler of this.status) {
      handler({ status: 'connecting' });
    }
    for (const handler of this.close) {
      handler({ code: CLOSE_BOARD_LOAD_FAILED });
    }
  }

  destroy(): void {}
}

describe('the tool this client is holding (tool.shortcuts, tool.return_to_select)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-22: a shape drawn with the Shape tool becomes the selection, and the tool is put away', async () => {
    renderBoard({ doc });
    await flushFrame();
    expect(activeTool()).toBe('select');
    expect(toolPressed('select')).toBe(true);

    pressKey('s');
    await flushFrame();
    expect(activeTool()).toBe('shape');
    expect(toolPressed('shape')).toBe(true);
    expect(toolPressed('select')).toBe(false);

    const at = { x: 400, y: 300 };
    pointerEvent('pointerdown', at.x, at.y);
    await flushFrame();
    pointerEvent('pointerup', at.x, at.y);
    await flushFrame();

    expect(docShapes(doc)).toHaveLength(1);
    expect(selectionCount()).toBe(1);
    expect(activeTool()).toBe('select');
    expect(toolPressed('select')).toBe(true);

    // The next click is a normal board click, not a second shape (`tool.return`).
    const elsewhere = { x: 700, y: 500 };
    pointerEvent('pointerdown', elsewhere.x, elsewhere.y);
    await flushFrame();
    pointerEvent('pointerup', elsewhere.x, elsewhere.y);
    await flushFrame();
    expect(docShapes(doc)).toHaveLength(1);
    expect(selectionCount()).toBe(0);
  });

  it('TC-22: a connector drawn with the Connector tool becomes the selection, and the tool is put away', async () => {
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    const b = createShapeObject(doc, { at: { x: 600, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    pressKey('l');
    await flushFrame();
    expect(activeTool()).toBe('connector');
    expect(toolPressed('connector')).toBe(true);

    const from = shapeCentre(a, doc);
    const to = shapeCentre(b, doc);
    pointerEvent('pointerdown', from.x, from.y);
    await flushFrame();
    pointerEvent('pointermove', to.x, to.y);
    await flushFrame();
    pointerEvent('pointerup', to.x, to.y);
    await flushFrame();

    const connectors = docConnectors(doc);
    expect(connectors).toHaveLength(1);
    expect(selectionCount()).toBe(1);
    expect(activeTool()).toBe('select');
  });

  it('TC-22: Escape puts the tool down - before a shape is drawn, and in the middle of drawing a connector', async () => {
    renderBoard({ doc });
    await flushFrame();

    pressKey('s');
    await flushFrame();
    expect(activeTool()).toBe('shape');

    pressKey('Escape');
    await flushFrame();
    expect(activeTool()).toBe('select');

    // With the tool gone, the same click that would have drawn a shape is a board click.
    pointerEvent('pointerdown', 300, 300);
    await flushFrame();
    pointerEvent('pointerup', 300, 300);
    await flushFrame();
    expect(docShapes(doc)).toHaveLength(0);

    // The same in the middle of a connector drag: nothing is created, because the
    // drag went away with the tool.
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    const b = createShapeObject(doc, { at: { x: 600, y: 300 } });
    await flushFrame();

    pressKey('l');
    await flushFrame();
    const from = shapeCentre(a, doc);
    const to = shapeCentre(b, doc);
    pointerEvent('pointerdown', from.x, from.y);
    await flushFrame();
    pointerEvent('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
    await flushFrame();

    pressKey('Escape');
    await flushFrame();
    pointerEvent('pointerup', to.x, to.y);
    await flushFrame();

    expect(docConnectors(doc)).toHaveLength(0);
    expect(activeTool()).toBe('select');
    expect(screen.queryByTestId('connector-preview-line')).toBeNull();
  });

  it('every tool shortcut the app names is answered, and one nobody has built yet changes nothing', async () => {
    renderBoard({ doc });
    await flushFrame();

    // The keys the board answers today, read from the same table it was written in.
    for (const [key, wanted] of [
      ['s', 'shape'],
      ['l', 'connector'],
      ['t', 'text'],
      ['v', 'select'],
    ] as const) {
      expect(TOOL_SHORTCUTS[key]).toBe(wanted);
      pressKey(key);
      await flushFrame();
      expect(activeTool()).toBe(wanted);
    }

    // `tool.shortcuts` names Pen, Image and Comment too, and no board can hold a
    // tool nothing has built a drawing for: the tool stays where it was. (`n` is
    // left out because it is not a tool to hold - story 2 answers it by creating a
    // sticky note at the centre of the view.)
    for (const [key, tool] of Object.entries(TOOL_SHORTCUTS)) {
      if (ARMLED_TOOL_IDS.includes(tool) || key === 'n') {
        continue;
      }
      pressKey(key);
      await flushFrame();
      expect(activeTool()).toBe('select');
    }
    expect(docShapes(doc)).toHaveLength(0);
    expect(docConnectors(doc)).toHaveLength(0);
  });

  it('a tool letter typed into a label being edited is a letter, not a tool (text.tool_ui)', async () => {
    const id = createShapeObject(doc, { at: { x: 300, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    fireEvent.doubleClick(shapeSvgElement(id));
    await flushFrame();
    const editor = shapeEditorElement(id);
    expect(editor).not.toBeNull();

    // A real browser delivers the key to the field, and the field is the target.
    fireEvent.keyDown(editor!, { key: 's' });
    fireEvent.keyDown(editor!, { key: 'l' });
    await flushFrame();
    expect(activeTool()).toBe('select');

    // And the board as a whole does not switch tools either while something is
    // being typed into.
    pressKey('s');
    pressKey('l');
    await flushFrame();
    expect(activeTool()).toBe('select');
    fireEvent.change(editor!, { target: { value: 'typed' } });
    await flushFrame();
    expect(docShapes(doc)).toHaveLength(1);
    expect(docConnectors(doc)).toHaveLength(0);
  });

  it('a board this client may not edit cannot hold a creation tool', async () => {
    createShapeObject(doc, { at: { x: 200, y: 300 } });
    const provider = new RefusingProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();
    expect(boardEditable()).toBe('true');

    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();
    expect(boardEditable()).toBe('false');

    pressKey('s');
    await flushFrame();
    expect(activeTool()).toBe('select');
    fireEvent.click(toolButton('connector'));
    await flushFrame();
    expect(activeTool()).toBe('select');

    const before = Y.encodeStateAsUpdate(doc);
    pointerEvent('pointerdown', 300, 300);
    await flushFrame();
    pointerEvent('pointerup', 300, 300);
    await flushFrame();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(docConnectors(doc)).toHaveLength(0);
  });
});
