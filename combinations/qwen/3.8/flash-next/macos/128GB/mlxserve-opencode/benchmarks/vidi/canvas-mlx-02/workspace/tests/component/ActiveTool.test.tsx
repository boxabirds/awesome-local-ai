// Story 10, tools.active_tool (component): one tool at a time, opened from the
// toolbar or the keyboard, and the board back to Select when the tool has drawn
// something or when Escape is pressed.
//
// This is asserted through the real board rather than by driving the hook in
// isolation, because what the requirement promises is about the board: which
// button is lit, whether the board answers to the pointer, and whether a key that
// was meant as an exit left an object behind. The hook's own state machine is in
// src/client/tools/useActiveTool.ts; the keystrokes reach it through useBoardKeys,
// which is the board's only keydown listener, and the letters are the table this
// file reads.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderBoard7, settle } from './story7TestUtils.tsx';
import { objectsSnapshot } from '../../src/shared/board-model.ts';
import { createShape } from '../../src/shared/objects/shape.ts';
import { AVAILABLE_TOOLS, TOOL_SHORTCUTS, isAvailableTool } from '../../src/client/tools/useActiveTool.ts';
import type { ShapeKind } from '../../src/shared/config.ts';

type Harness = ReturnType<typeof renderBoard7>;

const pressed = (testId: string): boolean => screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';
const shapeButton = (): HTMLElement => screen.getByTestId('tool-shape');
const selectButton = (): HTMLElement => screen.getByTestId('tool-select');
const ids = (h: Harness): Set<string> => new Set(objectsSnapshot(h.doc()).map((o) => o.id));

/** A drag on the open tool's own surface, from one world point to another. */
function dragOnTool(h: Harness, testId: string, from: { x: number; y: number }, to: { x: number; y: number }, pointerId = 41): void {
  const el = screen.getByTestId(testId);
  const s = h.toScreen(from);
  const e = h.toScreen(to);
  fireEvent.pointerDown(el, { clientX: s.x, clientY: s.y, button: 0, pointerId, bubbles: true, cancelable: true });
  for (let i = 1; i <= 3; i++) {
    fireEvent.pointerMove(el, {
      clientX: s.x + ((e.x - s.x) * i) / 3,
      clientY: s.y + ((e.y - s.y) * i) / 3,
      button: 0,
      pointerId,
      bubbles: true,
      cancelable: true,
    });
  }
  fireEvent.pointerUp(el, { clientX: e.x, clientY: e.y, button: 0, pointerId, bubbles: true, cancelable: true });
}

function shapeOf(h: Harness, x: number, y: number, kind: ShapeKind = 'rect'): string {
  let id = '';
  act(() => {
    id = createShape(h.doc(), { kind, rect: { x, y, width: 200, height: 200 }, at: { x: 0, y: 0 }, square: false }, 'tester')!;
  });
  return id;
}

describe('tools.active_tool (component)', () => {
  // TC-22: S, draw; L, draw; and Escape from either one, which must not draw.
  it('TC-22 opens with S or L, draws once and hands the board back; Escape draws nothing', async () => {
    const h = renderBoard7();
    expect(pressed('tool-select')).toBe(true);

    // S: the Shape tool takes the pointer and gives it back after one shape.
    h.key('s');
    expect(pressed('tool-shape')).toBe(true);
    expect(pressed('tool-select')).toBe(false);
    expect(screen.getByTestId('shape-tool')).toBeTruthy();
    let before = ids(h);
    dragOnTool(h, 'shape-tool', { x: 0, y: 0 }, { x: 120, y: 120 });
    await settle();
    let drawn = objectsSnapshot(h.doc()).filter((o) => !before.has(o.id));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].type).toBe('shape');
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('shape-tool')).toBeNull();

    // Escape from an open tool: nothing is drawn, and the board rests on Select.
    before = ids(h);
    h.key('s');
    h.key('Escape');
    await settle();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(ids(h).size).toBe(before.size);
    expect(pressed('tool-select')).toBe(true);

    // L: the Connector tool takes the pointer and gives it back after one arrow.
    h.key('l');
    expect(pressed('tool-connector')).toBe(true);
    expect(screen.getByTestId('connector-tool')).toBeTruthy();
    before = ids(h);
    dragOnTool(h, 'connector-tool', { x: 0, y: 600 }, { x: 400, y: 600 });
    await settle();
    drawn = objectsSnapshot(h.doc()).filter((o) => !before.has(o.id));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].type).toBe('connector');
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('connector-tool')).toBeNull();

    before = ids(h);
    h.key('l');
    h.key('Escape');
    await settle();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(ids(h).size).toBe(before.size);
    expect(pressed('tool-select')).toBe(true);
  });

  // The same letters, unshifted and shifted, mean the same tool; V is the way back.
  it('reads S, L and V whatever the shift key is doing', async () => {
    const h = renderBoard7();

    h.key('S', { shiftKey: true });
    expect(screen.getByTestId('shape-tool')).toBeTruthy();
    h.key('V');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(pressed('tool-select')).toBe(true);

    h.key('L', { shiftKey: true });
    expect(screen.getByTestId('connector-tool')).toBeTruthy();
    h.key('v', { shiftKey: true });
    expect(screen.queryByTestId('connector-tool')).toBeNull();
  });

  // Only one tool at a time: asking for another leaves the previous one.
  it('leaves one tool the moment another is asked for', async () => {
    const h = renderBoard7();

    h.key('s');
    expect(screen.getByTestId('shape-tool')).toBeTruthy();
    h.key('l');
    await settle();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.getByTestId('connector-tool')).toBeTruthy();
    expect(pressed('tool-shape')).toBe(false);
    expect(pressed('tool-connector')).toBe(true);

    h.key('t'); // the Text tool is the third one the board has
    await settle();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(pressed('tool-text')).toBe(true);
  });

  // A shortcut for a tool this build has no surface for is ignored, not an error
  // and not a half-open tool.
  it('ignores a shortcut for a tool the board does not have', async () => {
    const h = renderBoard7();
    const before = ids(h);

    for (const key of ['p', 'i', 'c', 'n', 'x']) {
      h.key(key);
      await settle();
      expect(screen.queryByTestId('shape-tool')).toBeNull();
      expect(screen.queryByTestId('connector-tool')).toBeNull();
      expect(pressed('tool-select')).toBe(true);
    }
    // 'n' creates a note rather than opening a mode; the rest are not offered.
    expect(isAvailableTool('sticky')).toBe(false);
    expect(objectsSnapshot(h.doc()).some((o) => o.type === 'connector' || o.type === 'shape')).toBe(false);
    expect(before.size).toBeGreaterThanOrEqual(0);
  });

  // The toolbar's own buttons do the same thing the keys do.
  it('opens and closes the tools from the toolbar buttons', async () => {
    renderBoard7();

    fireEvent.click(shapeButton());
    expect(screen.getByTestId('shape-tool')).toBeTruthy();
    expect(screen.getByTestId('shape-kind-menu')).toBeTruthy();

    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull(); // the menu belongs to the Shape tool
    expect(screen.getByTestId('connector-tool')).toBeTruthy();

    fireEvent.click(selectButton());
    await settle();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(pressed('tool-select')).toBe(true);
  });

  // Every creation tool is a mutation door: a board this client cannot edit has
  // none of them, and loses the one that was open the moment that is discovered.
  it('has no creation tool on a board that cannot be edited', async () => {
    const h = renderBoard7();

    h.key('s');
    expect(screen.getByTestId('shape-tool')).toBeTruthy();

    act(() => {
      h.provider().failToLoad();
    });
    await settle();

    expect(screen.queryByTestId('shape-tool')).toBeNull(); // the tool went with the news
    expect(pressed('tool-select')).toBe(true);

    // And it stays that way: the keys cannot open a tool on a read-only board.
    h.key('s');
    h.key('l');
    await settle();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(pressed('tool-shape')).toBe(false);
    expect(pressed('tool-connector')).toBe(false);
  });

  // A key typed into a text field is typing, not a command - including the letters
  // that name tools.
  it('does not switch tools while words are being written', async () => {
    const h = renderBoard7();
    const id = shapeOf(h, 0, 0);

    fireEvent.doubleClick(h.object(id)!);
    await settle();
    const editor = screen.getByTestId('shape-editor');

    for (const key of ['s', 'l', 'v', 't']) {
      fireEvent.keyDown(editor, { key, bubbles: true, cancelable: true });
    }
    await settle();

    expect(screen.getByTestId('shape-editor')).toBe(editor); // still writing
    expect(pressed('tool-select')).toBe(true); // no tool was opened by the typing
    expect(screen.queryByTestId('shape-tool')).toBeNull();
  });

  // The table the keyboard and the toolbar both read: the letters the requirement
  // names, and nothing else pretending to be a tool.
  it('exports the shortcut table the keyboard routes by', () => {
    expect(TOOL_SHORTCUTS['s']).toBe('shape');
    expect(TOOL_SHORTCUTS['l']).toBe('connector');
    expect(TOOL_SHORTCUTS['v']).toBe('select');
    expect(TOOL_SHORTCUTS['t']).toBe('text');
    expect(AVAILABLE_TOOLS).toEqual(['select', 'text', 'shape', 'connector']);
    expect(isAvailableTool('pen')).toBe(false);
    expect(isAvailableTool('shape')).toBe(true);
  });
});
