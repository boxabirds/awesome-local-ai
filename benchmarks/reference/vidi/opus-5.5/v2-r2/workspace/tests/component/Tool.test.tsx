import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useTool } from '../../src/client/board/useTool';
import { createSticky, initDoc, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { flushFrame, stickyNotes } from './helpers';

// Captures connectBoard's state callback so a test can make the board fail to load.
const connectCalls = vi.hoisted(() => [] as ((s: string) => void)[]);
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
      connectCalls.push(onState);
      onState('connecting');
      return { destroy() {} };
    },
  };
});

const { App } = await import('../../src/client/App');

// jsdom has no layout: the camera starts centred on world (0, 0) at 100%.
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function setup(opts: { boardId?: string } = {}) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const doc = new Y.Doc();
  initDoc(doc);
  connectCalls.length = 0;
  render(<App doc={doc} boardId={opts.boardId} />);
  return { doc, viewport: () => screen.getByTestId('board-viewport') };
}

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
const textButton = () => screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });
const texts = (doc: Y.Doc) => objectsSnapshot(doc).filter((o) => o.type === 'text');

describe('text.tool_ui useTool', () => {
  it('Text cannot be chosen without canEdit, and reverts to Select when canEdit turns false', () => {
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

describe('text.tool_ui Toolbar and shortcuts', () => {
  it('TC-14 T → Text active and pressed; Escape → Select; T then V → Select', () => {
    const { viewport } = setup();
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    key('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    expect(selectButton().getAttribute('aria-pressed')).toBe('false');
    expect(viewport().dataset.tool).toBe('text');
    expect(viewport().classList.contains('is-text-tool')).toBe(true);
    key('Escape');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(viewport().dataset.tool).toBe('select');
    key('T');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    key('v');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    // The buttons do the same.
    fireEvent.click(textButton());
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(selectButton());
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('Ctrl+V and Ctrl+T are not tool shortcuts', () => {
    setup();
    fireEvent.keyDown(window, { key: 't', ctrlKey: true });
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-15 board failed to load → T ignored, Text button disabled', () => {
    const { doc, viewport } = setup({ boardId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    const onState = connectCalls.at(-1)!;
    act(() => onState('connected'));
    key('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    // Load fails while the Text tool is active: back to Select.
    act(() => onState('load_failed'));
    expect(textButton().disabled).toBe(true);
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    key('t');
    fireEvent.click(textButton());
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    expect(texts(doc)).toHaveLength(0);
  });

  it('TC-16 T while editing a sticky note types into it; the tool is unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    render(<App doc={doc} />);
    fireEvent.doubleClick(stickyNotes()[0]!);
    const editor = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
    const notCancelled = fireEvent.keyDown(editor, { key: 't' });
    expect(notCancelled).toBe(true);
    fireEvent.input(editor, { target: { value: 't' } });
    expect(snapshot(doc)[0]!.text).toBe('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(stickyNotes()[0]!.dataset.editing).toBe('true');
  });

  it('TC-17 Text active, click the board → text at the world point, back to Select, editing', () => {
    const { doc, viewport } = setup();
    window.__vidi6?.setCamera({ x: 1000, y: -500, zoom: 2 });
    flushFrame();
    key('t');
    fireEvent.pointerDown(viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    const [text] = texts(doc);
    expect(text).toMatchObject({ x: 1000 + 300 / 2, y: -500 + 200 / 2, size: 'M', widthMode: 'auto', text: '' });
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    const editor = screen.getByRole('textbox', { name: 'Text' });
    expect(document.activeElement).toBe(editor);
    expect(document.querySelector(`[data-id="${text!.id}"]`)?.getAttribute('data-editing')).toBe('true');
    expect(window.__vidi6?.getSelection?.()).toEqual([text!.id]);
  });

  it('Text tool click on top of an existing object creates text on top there', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    render(<App doc={doc} />);
    key('t');
    const before = snapshot(doc)[0]!;
    fireEvent.pointerDown(stickyNotes()[0]!, { clientX: CENTRE.x + 10, clientY: CENTRE.y + 20, button: 0, pointerId: 1 });
    const [text] = texts(doc);
    expect(text).toMatchObject({ x: 10, y: 20 });
    expect(text!.z).toBeGreaterThan(before.z);
    expect(snapshot(doc)[0]).toEqual(before);
  });

  it('TC-18 N creates a sticky note at the view centre (like the Sticky note button)', () => {
    const { doc } = setup();
    key('n');
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
    expect(stickyNotes()[0]!.dataset.editing).toBe('true');
    expect(screen.getByRole('button', { name: 'Sticky note (N)' }).getAttribute('title')).toBe(
      'Sticky note (N) – or double-click the board',
    );
  });
});
