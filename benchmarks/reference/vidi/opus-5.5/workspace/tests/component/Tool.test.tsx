/**
 * text.tool_ui (story 9): useTool, the Select and Text tool buttons, V/T/N/Escape and the Text
 * tool's click-to-create on the real board (TC-14 to TC-18).
 */
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTool } from '../../src/client/board/useTool';
import { screenToWorld } from '../../src/client/canvas/camera';
import { DEFAULT_TEXT_SIZE, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { TEST_VIEWPORT } from './setup';
import { board, camera, createSelectedNote, doubleClickBoard, editor, notes, renderBoard, user } from './stickyHelpers';
import { clickBoardAt, pressKey, selectedIds, textEditor, textEls, texts, toolButton } from './textHelpers';

const HALF = 2;

function pressed(name: 'Select (V)' | 'Text (T)'): string | null {
  return toolButton(name).getAttribute('aria-pressed');
}

/** A socket the test can close with a server close code (story 4 load failure). */
class ControlledWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControlledWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = ControlledWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: unknown = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: unknown = null;
  constructor(readonly url: string) {
    super();
    ControlledWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = ControlledWebSocket.CLOSED;
  }
}

function failLoading(): void {
  const ws = ControlledWebSocket.instances.at(-1);
  if (!ws) throw new Error('no socket opened');
  act(() => {
    ws.readyState = ControlledWebSocket.OPEN;
    ws.onopen?.();
    ws.readyState = ControlledWebSocket.CLOSED;
    ws.onclose?.({ code: CLOSE_BOARD_LOAD_FAILED, reason: '' });
  });
}

describe('text.tool_ui useTool', () => {
  it('starts on Select; Text only while editable; losing editability reverts to Select', () => {
    const { result, rerender } = renderHook(({ canEdit }) => useTool(canEdit), { initialProps: { canEdit: true } });
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('text'));
    expect(result.current.tool).toBe('text');
    rerender({ canEdit: false });
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('text'));
    expect(result.current.tool).toBe('select');
    rerender({ canEdit: true });
    expect(result.current.tool).toBe('select');
  });
});

describe('text.tool_ui on the board', () => {
  it('TC-14 T → Text active and pressed; Escape → Select; T then V → Select; buttons switch too', () => {
    renderBoard();
    expect(pressed('Select (V)')).toBe('true');
    expect(pressed('Text (T)')).toBe('false');

    pressKey('t');
    expect(pressed('Text (T)')).toBe('true');
    expect(pressed('Select (V)')).toBe('false');
    expect(board().dataset.tool).toBe('text');
    expect(board().className).toContain('board-viewport--tool-text');

    pressKey('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(pressed('Text (T)')).toBe('false');

    pressKey('t');
    pressKey('v');
    expect(pressed('Select (V)')).toBe('true');

    fireEvent.click(toolButton('Text (T)'));
    expect(pressed('Text (T)')).toBe('true');
    fireEvent.click(toolButton('Select (V)'));
    expect(pressed('Select (V)')).toBe('true');
    // Switching tools never creates anything.
    expect(texts()).toHaveLength(0);
  });

  it('TC-14 Escape with the Text tool returns to Select without clearing the selection', () => {
    renderBoard();
    const note = createSelectedNote();
    pressKey('t');
    pressKey('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(selectedIds()).toEqual([note.dataset.id]);
  });

  it('TC-15 while the board failed to load: Text button disabled, T ignored, active Text reverts (negative)', () => {
    ControlledWebSocket.instances = [];
    vi.stubGlobal('WebSocket', ControlledWebSocket);
    renderBoard();
    pressKey('t');
    expect(pressed('Text (T)')).toBe('true');
    failLoading();
    expect(pressed('Select (V)')).toBe('true');
    expect(toolButton('Text (T)').disabled).toBe(true);
    pressKey('t');
    expect(pressed('Text (T)')).toBe('false');
    fireEvent.click(toolButton('Text (T)'));
    expect(pressed('Text (T)')).toBe('false');
    clickBoardAt(300, 200);
    expect(texts()).toHaveLength(0);
    expect(textEditor()).toBeNull();
  });

  it('TC-16 T typed while editing a sticky note is a character; the tool stays Select (negative)', async () => {
    renderBoard();
    const u = user();
    doubleClickBoard(400, 300);
    const textarea = editor()!;
    await u.type(textarea, 'tv');
    expect(textarea.value).toBe('tv');
    expect(notes()[0]!.text).toBe('tv');
    expect(pressed('Select (V)')).toBe('true');
    expect(pressed('Text (T)')).toBe('false');
  });

  it('TC-17 Text tool click at (300, 200) creates M text there, returns to Select and starts editing', () => {
    renderBoard();
    const cam = camera();
    pressKey('t');
    clickBoardAt(300, 200);
    const created = texts();
    expect(created).toHaveLength(1);
    const world = screenToWorld(cam, { x: 300, y: 200 });
    expect(created[0]).toMatchObject({ x: world.x, y: world.y, size: DEFAULT_TEXT_SIZE, widthMode: 'auto', text: '' });
    expect(pressed('Select (V)')).toBe('true');
    const textarea = textEditor();
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(selectedIds()).toEqual([created[0]!.id]);
    expect(textEls()[0]!.dataset.editing).toBe('true');
  });

  it('TC-17 a Text tool click on top of a sticky note creates text on top, without selecting the note', () => {
    renderBoard();
    const note = createSelectedNote(400, 300);
    const noteBefore = notes()[0]!;
    pressKey('t');
    clickBoardAt(400, 300, note);
    const [text] = texts();
    expect(text).toBeDefined();
    expect(text!.z).toBeGreaterThan(noteBefore.z);
    expect(selectedIds()).toEqual([text!.id]);
    expect(notes()[0]).toEqual(noteBefore);
  });

  it('TC-18 N still creates a sticky note in the centre of the view (regression)', () => {
    renderBoard();
    const cam = camera();
    pressKey('n');
    const all = notes();
    expect(all).toHaveLength(1);
    const centre = screenToWorld(cam, { x: TEST_VIEWPORT.width / HALF, y: TEST_VIEWPORT.height / HALF });
    expect(all[0]).toMatchObject({ x: centre.x - STICKY_SIZE_WORLD / HALF, y: centre.y - STICKY_SIZE_WORLD / HALF });
    expect(editor()).not.toBeNull();
    // N aimed at the note's editor is typing, not another note.
    fireEvent.keyDown(editor()!, { key: 'n' });
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
    expect(texts()).toHaveLength(0);
  });
});
