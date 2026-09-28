// Story 9 (text.tool, text.tool_ui) component tests: TC-14 to TC-18.
//
// The y-websocket provider is replaced with a fake (as in the story 7
// selection tests) so every test deterministically reaches
// connected + synced (editable), and TC-15 can drive the load-failed
// (locked) state.

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';

/** Fake provider: records the doc it was given and lets tests emit the
 *  provider events the tracker listens for. */
interface FakeProvider {
  doc: Y.Doc;
  open(): void;
  doSync(): void;
  close(code: number): void;
}

vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    static instances: FakeProvider[] = [];
    doc: Y.Doc;
    private listeners: Record<string, Array<(arg: unknown) => void>> = {};
    constructor(_url: string, _room: string, doc: Y.Doc, _opts: unknown) {
      this.doc = doc;
      FakeWebsocketProvider.instances.push(this);
    }
    on(ev: string, fn: (arg: unknown) => void): void {
      (this.listeners[ev] ??= []).push(fn);
    }
    off(ev: string, fn: (arg: unknown) => void): void {
      this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== fn);
    }
    destroy(): void {
      this.listeners = {};
    }
    private emit(ev: string, arg: unknown): void {
      (this.listeners[ev] ?? []).slice().forEach((f) => f(arg));
    }
    open(): void {
      this.emit('status', { status: 'connected' });
    }
    doSync(): void {
      this.emit('sync', true);
    }
    close(code: number): void {
      this.emit('connection-close', { code, reason: 'test' });
      this.emit('status', { status: 'disconnected' });
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

function key(type: string, props: Record<string, unknown> = {}): Event {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

/** Renders the app and drives the fake provider to connected + synced
 *  (editable), or closes with the load-failed code (locked). */
async function setupApp(fail = false): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  if (fail) act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
  return provider.doc;
}

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story 9: tool mode and Text tool', () => {
  it('TC-14: T → Text active (aria-pressed), Escape → Select, T then V → Select', async () => {
    await setupApp();

    // Default: Select active.
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    // T → Text active.
    windowKey(key('keydown', { key: 't' }));
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'false');

    // Escape → Select.
    windowKey(key('keydown', { key: 'Escape' }));
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    // T then V → Select (V reverts the tool).
    windowKey(key('keydown', { key: 't' }));
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    windowKey(key('keydown', { key: 'v' }));
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-15: non-editable board → T ignored, Text button disabled (negative)', async () => {
    await setupApp(true);

    expect(textBtn()).toBeDisabled();

    // T is ignored: the tool stays on Select.
    windowKey(key('keydown', { key: 't' }));
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-16: T pressed while editing a sticky → character typed, tool unchanged (negative)', async () => {
    await setupApp();
    const id = window.__vidi6?.createSticky(0, 0);
    expect(id).not.toBeNull();
    await act(async () => {});

    // Select the note (click) and start editing (Enter).
    const note = document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`)!;
    act(() => {
      const e = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(e, { clientX: 100, clientY: 100, pointerId: 1, isPrimary: true });
      note.dispatchEvent(e);
      const up = new Event('pointerup', { bubbles: true, cancelable: true });
      Object.assign(up, { clientX: 100, clientY: 100, pointerId: 1, isPrimary: true });
      note.dispatchEvent(up);
    });
    windowKey(key('keydown', { key: 'Enter' }));
    const input = screen.getByTestId('sticky-editor-input');
    expect(document.activeElement).toBe(input);

    // T while typing is swallowed by the editor (not a tool switch).
    act(() => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 't' });
      input.dispatchEvent(e);
    });
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    // …and the character goes into the note's text.
    const ta = input as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'a' } });
    expect(ta.value).toBe('a');
    expect((window.__vidi6?.getStickyNotes() ?? []).find((n) => n.id === id)?.text).toBe('a');
  });

  it('TC-17: Text active, click board at (300,200) → text at that world point, tool back to Select, editor mounted', async () => {
    await setupApp();
    windowKey(key('keydown', { key: 't' }));
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');

    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      viewport.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }),
      );
    });

    // One text object, top-left at the clicked world point (camera 0,0,1),
    // size M, auto width, empty content.
    const texts = window.__vidi6?.getTextObjects() ?? [];
    expect(texts).toHaveLength(1);
    expect(texts[0].x).toBe(300);
    expect(texts[0].y).toBe(200);
    expect(texts[0].text).toBe('');
    expect(texts[0].size).toBe('M');
    expect(texts[0].widthMode).toBe('auto');

    // The tool reverted to Select (one-shot).
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    // The editor is mounted and focused for the new object.
    const el = document.querySelector(`[data-testid="text-object"][data-id="${texts[0].id}"]`);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('data-editing', 'true');
    const input = screen.getByTestId('text-editor-input');
    expect(document.activeElement).toBe(input);
  });

  it('TC-18: N still creates a sticky at the view centre (regression)', async () => {
    await setupApp();
    // Even with the Text tool active, N creates a sticky (not a text).
    windowKey(key('keydown', { key: 't' }));
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');

    windowKey(key('keydown', { key: 'n' }));

    const notes = window.__vidi6?.getStickyNotes() ?? [];
    expect(notes).toHaveLength(1);
    // jsdom has no layout: the viewport is 0×0, so the view centre is
    // world (0,0) and a 200×200 note centred there sits at (-100,-100).
    // (The real centre behaviour is covered by the e2e tests.)
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
    expect(window.__vidi6?.getTextObjects()).toHaveLength(0);
    // The tool is unchanged by the sticky button (it is not a tool).
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
  });
});
