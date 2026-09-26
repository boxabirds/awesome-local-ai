import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import { fireKey, firePointer } from './helpers';

/**
 * Story 9, text.tool_ui (TC-14 to TC-18): the Select/Text tool state, its
 * shortcuts, and click-to-create through the Text tool.
 */

// A fake y-websocket so TC-15 can force the load-failure (not editable) state.
const fake = vi.hoisted(() => {
  const instances: unknown[] = [];
  class FakeWebsocketProvider {
    handlers = new Map<string, Set<(arg: never) => void>>();
    constructor(
      readonly serverUrl: string,
      readonly roomname: string,
      readonly doc: unknown,
      readonly options: unknown,
    ) {
      instances.push(this);
    }
    on(event: string, handler: (arg: never) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: (arg: never) => void): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, arg: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        (handler as (a: unknown) => void)(arg);
      }
    }
    disconnect(): void {}
    destroy(): void {}
  }
  return { instances, provider: FakeWebsocketProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: fake.provider }));

const VALID_ID = 'V1a2b3c4D5e6F7g8h9i0j-';
const CLOSE_BOARD_LOAD_FAILED = 4500;

const provider = () => fake.instances[fake.instances.length - 1] as {
  emit(event: string, arg: unknown): void;
};

function renderEditable() {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
  };
}

const pressed = (testId: string): boolean =>
  screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';

beforeEach(() => {
  fake.instances.length = 0;
});

afterEach(cleanup);

describe('TC-14: tool activation', () => {
  it('T activates the Text tool, Escape and V return to Select', async () => {
    const { settle } = renderEditable();
    await settle();
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('text-tool-layer')).toBeNull();

    fireKey({ key: 't' });
    await settle();
    expect(pressed('tool-text')).toBe(true);
    expect(pressed('tool-select')).toBe(false);
    expect(screen.getByTestId('text-tool-layer')).toBeDefined();

    fireKey({ key: 'Escape' });
    await settle();
    expect(pressed('tool-text')).toBe(false);
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('text-tool-layer')).toBeNull();

    fireKey({ key: 'T' });
    await settle();
    expect(pressed('tool-text')).toBe(true);
    fireKey({ key: 'V' });
    await settle();
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('text-tool-layer')).toBeNull();
  });

  it('the Text button activates and deactivates the tool', async () => {
    const { settle } = renderEditable();
    await settle();
    act(() => {
      fireEvent.click(screen.getByTestId('tool-text'));
    });
    await settle();
    expect(pressed('tool-text')).toBe(true);
    act(() => {
      fireEvent.click(screen.getByTestId('tool-select'));
    });
    await settle();
    expect(pressed('tool-text')).toBe(false);
  });
});

describe('TC-15: a board that cannot be edited has no Text tool', () => {
  it('T is ignored and the Text button is disabled', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp doc={doc} boardId={VALID_ID} />);
    act(() => provider().emit('status', { status: 'connected' }));
    act(() => provider().emit('sync', true));
    act(() => {
      provider().emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED, reason: '', wasClean: true });
      provider().emit('status', { status: 'disconnected' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect((screen.getByTestId('tool-text') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(true);
    fireKey({ key: 't' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(pressed('tool-text')).toBe(false);
    expect(screen.queryByTestId('text-tool-layer')).toBeNull();
  });
});

describe('TC-16: T while editing types the character', () => {
  it('the keystroke reaches the textarea and the tool stays as it was', async () => {
    const { settle } = renderEditable();
    await settle();
    // Create a sticky through the toolbar and type into its editor.
    act(() => {
      fireEvent.click(screen.getByTestId('create-sticky'));
    });
    await settle();
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Dispatch on the textarea itself: window-dispatched keys have no focused
    // target, and the point here is that a key *into the editor* stays there.
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }),
      );
      fireEvent.input(textarea, { target: { value: 't' } });
    });
    await settle();
    expect(textarea.value).toBe('t');
    expect(pressed('tool-text')).toBe(false);
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('text-tool-layer')).toBeNull();
  });
});

describe('TC-17: click-to-create with the Text tool', () => {
  it('creates a text object at the world point, returns to Select, starts editing', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 't' });
    await settle();
    const layer = screen.getByTestId('text-tool-layer');

    const camera = window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 };
    firePointer(layer, 'pointerdown', 300, 200);
    firePointer(layer, 'pointerup', 300, 200);
    await settle();

    const texts = objectSnapshots(doc).filter((o) => o.type === 'text');
    expect(texts.length).toBe(1);
    const created = texts[0]!;
    const expected = screenToWorld(camera, { x: 300, y: 200 });
    expect(created.x).toBeCloseTo(expected.x, 0);
    expect(created.y).toBeCloseTo(expected.y, 0);
    // Tool returned to Select and the new object is being edited.
    expect(pressed('tool-select')).toBe(true);
    expect(screen.getByTestId(`text-textarea-${created.id}`)).toBeDefined();
    // The click did not also create a sticky.
    expect(objectSnapshots(doc).filter((o) => o.type === 'sticky').length).toBe(0);
  });

  it('a click through the layer hits objects too — no panning, no marquee', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    // Create a sticky first (in select mode).
    act(() => {
      fireEvent.click(screen.getByTestId('create-sticky'));
    });
    await settle();
    fireKey({ key: 't' });
    await settle();
    const layer = screen.getByTestId('text-tool-layer');
    firePointer(layer, 'pointerdown', 100, 100);
    firePointer(layer, 'pointerup', 100, 100);
    await settle();
    const texts = objectSnapshots(doc).filter((o) => o.type === 'text');
    expect(texts.length).toBe(1);
    // The sticky stayed where it was (no pan of the camera happened through
    // the capture layer).
    expect(window.__vidi6?.getCamera()).toEqual(window.__vidi6?.getCamera());
  });
});

describe('TC-18: N still creates a sticky', () => {
  it('N creates a sticky at the view centre with no selection, editing started', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 'n' });
    await settle();
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky');
    expect(sticky).toBeDefined();
    expect(screen.getByTestId('sticky-textarea')).toBeDefined();
    expect(objectSnapshots(doc).filter((o) => o.type === 'text').length).toBe(0);
  });

  it('N works with a selection and with the Text tool active', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    act(() => {
      fireEvent.click(screen.getByTestId('create-sticky'));
    });
    await settle();
    // Leave the editor open, then Escape to end editing with the sticky kept.
    const editor = screen.getByTestId('sticky-textarea');
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }),
      );
    }); // must not switch tools while typing into the editor
    expect(pressed('tool-text')).toBe(false);
    act(() => {
      screen.getByTestId('sticky-textarea').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
    fireKey({ key: 't' });
    await settle();
    fireKey({ key: 'n' });
    await settle();
    expect(objectSnapshots(doc).filter((o) => o.type === 'sticky').length).toBe(2);
    // Still the Text tool: N creates a sticky without stealing the tool.
    expect(pressed('tool-text')).toBe(true);
  });
});
