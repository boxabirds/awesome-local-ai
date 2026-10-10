// Story 9 TC-14…TC-18: the board tool mode. T/V/Escape switch between
// Select and Text, the Text tool places text on the next board click, and a
// load-failed board refuses the Text tool entirely.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import type { TextSnapshot } from '../../src/shared/board-model';
import {
  App,
  board,
  createNote,
  flush,
  keyDown,
  notes,
  noteEl,
  readCamera,
} from './stickyHelpers';

vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    static instances: MockWebsocketProvider[] = [];
    private handlers = new Map<string, Set<(arg?: unknown) => void>>();
    awareness = { setLocalState: (_state: unknown) => undefined };

    constructor(_server: string, _room: string, _doc: unknown, _opts?: unknown) {
      MockWebsocketProvider.instances.push(this);
    }
    on(event: string, cb: (arg?: unknown) => void): void {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(cb);
    }
    off(event: string, cb: (arg?: unknown) => void): void {
      this.handlers.get(event)?.delete(cb);
    }
    emit(event: string, arg?: unknown): void {
      this.handlers.get(event)?.forEach((cb) => cb(arg));
    }
    destroy(): void {
      /* no-op */
    }
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

type MockProvider = { emit(event: string, arg?: unknown): void };

function lastProvider(): MockProvider {
  const instances = (WebsocketProvider as unknown as { instances: MockProvider[] }).instances;
  const provider = instances[instances.length - 1];
  if (!provider) throw new Error('no provider constructed');
  return provider;
}

function textObjects(): TextSnapshot[] {
  return (board().getObjectSnapshots!() as TextSnapshot[]).filter((o) => o.type === 'text');
}

function pressed(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text.tool', () => {
  it('TC-14: T activates the Text tool; Escape and V return to Select', () => {
    render(<App />);
    flush();
    expect(pressed('tool-select')).toBe(true);
    expect(pressed('tool-text')).toBe(false);

    keyDown(window, 't');
    flush();
    expect(pressed('tool-text')).toBe(true);

    keyDown(window, 'Escape');
    flush();
    expect(pressed('tool-select')).toBe(true);

    keyDown(window, 't');
    flush();
    expect(pressed('tool-text')).toBe(true);
    keyDown(window, 'v');
    flush();
    expect(pressed('tool-select')).toBe(true);
  });

  it('TC-15: a load-failed board disables the Text button and ignores T', () => {
    render(<App />);
    const provider = lastProvider();
    act(() => provider.emit('sync', true));
    act(() => provider.emit('connection-close', { code: 4500 }));
    flush();

    expect(screen.getByTestId('tool-text')).toBeDisabled();
    keyDown(window, 't');
    flush();
    expect(pressed('tool-text')).toBe(false);
    expect(screen.queryByTestId('text-tool-catcher')).toBeNull();
  });

  it('TC-16: pressing T while editing a note types into it, tool unchanged', () => {
    render(<App />);
    flush();
    const id = createNote(100, 100);
    fireEvent.dblClick(noteEl(id));
    flush();
    const textarea = screen.getByTestId('sticky-textarea');
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 't' });
    flush();
    expect(pressed('tool-text')).toBe(false);
    expect(screen.queryByTestId('text-tool-catcher')).toBeNull();
  });

  it('TC-17: with Text active, a board click creates text at that world point, returns to Select and starts editing', () => {
    render(<App />);
    flush();
    keyDown(window, 't');
    flush();
    expect(screen.queryByTestId('text-tool-catcher')).not.toBeNull();

    fireEvent.pointerDown(screen.getByTestId('text-tool-catcher'), {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
    });
    flush();

    const texts = textObjects();
    expect(texts).toHaveLength(1);
    const cam = readCamera();
    expect(texts[0].x).toBeCloseTo(cam.x + 400 / cam.zoom, 6);
    expect(texts[0].y).toBeCloseTo(cam.y + 300 / cam.zoom, 6);
    expect(pressed('tool-select')).toBe(true);
    // Editing starts immediately so the first keystroke lands in the new text.
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-18: N still creates a sticky at the view centre (regression)', () => {
    render(<App />);
    flush();
    keyDown(window, 'n');
    flush();

    expect(notes()).toHaveLength(1);
    const cam = readCamera();
    expect(notes()[0].x).toBeCloseTo(cam.x + 1280 / cam.zoom / 2 - 100, 6);
    expect(notes()[0].y).toBeCloseTo(cam.y + 800 / cam.zoom / 2 - 100, 6);
    expect(pressed('tool-select')).toBe(true);
  });
});
