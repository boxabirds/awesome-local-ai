/**
 * Story 9: tool mode + Text tool component tests (TC-14 to TC-18).
 *
 * The y-websocket provider is faked (like load-failure.test.tsx) so the board
 * stays in a known state: 'connecting' (editable) by default, and 'load_failed'
 * after a 4500 close (TC-15).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { objectSnapshot } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import { createPointerEvent } from './helpers';
import { renderApp } from './sticky-helpers';

interface FakeProvider {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  emit(event: string, ...args: unknown[]): void;
}

let mockFakeProvider: FakeProvider | null = null;

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    constructor(_url: string, _room: string, _doc: Y.Doc, _opts?: unknown) {
      mockFakeProvider = this as unknown as FakeProvider;
    }
    on(event: string, h: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(h);
    }
    off(event: string, h: (...args: unknown[]) => void) {
      this.handlers[event] = (this.handlers[event] ?? []).filter((x) => x !== h);
    }
    destroy() {}
    emit(event: string, ...args: unknown[]) {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
  },
}));

function getProvider(): FakeProvider {
  if (!mockFakeProvider) throw new Error('WebsocketProvider was never constructed');
  return mockFakeProvider;
}

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' });
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' });

describe('Story 9: tool mode (ui-component)', () => {
  it('TC-14: T → Text active; Escape → Select; T then V → Select', () => {
    renderApp();

    // Select is the default active tool.
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    pressKey('t');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'false');

    pressKey('Escape');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');

    pressKey('t');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    pressKey('v');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-15: canEdit false → T ignored, Text button disabled', () => {
    render(<Board boardId="test-board" />);
    const p = getProvider();
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    // The board fails to load → non-editable.
    act(() => {
      p.emit('connection-close', { code: 4500 });
      p.emit('status', { status: 'disconnected' });
    });

    expect(textBtn()).toBeDisabled();

    // T is ignored while the board cannot be edited.
    pressKey('t');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-16: N → one sticky note at view centre', () => {
    const { getDoc } = renderApp();
    const before = objectSnapshot(getDoc()).length;

    pressKey('n');

    const after = objectSnapshot(getDoc());
    expect(after.length).toBe(before + 1);
    const created = after.find((o) => o.type === 'sticky');
    expect(created).toBeDefined();
  });

  it('TC-17: Text active, click board → createText at screenToWorld point, tool → Select, editor mounts', () => {
    const { getDoc } = renderApp();
    const vp = screen.getByTestId('board-viewport');

    // Enter the text tool; the viewport shows a text cursor.
    pressKey('t');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(vp).toHaveStyle({ cursor: 'text' });

    // Click on empty board space.
    const clientPt = { clientX: 300, clientY: 200 };
    act(() => {
      vp.dispatchEvent(createPointerEvent('pointerdown', { ...clientPt, pointerId: 1 }));
      vp.dispatchEvent(createPointerEvent('pointerup', { ...clientPt, pointerId: 1 }));
    });

    // A text object was created at the world point under the click.
    const objs = objectSnapshot(getDoc()).filter((o) => o.type === 'text');
    expect(objs).toHaveLength(1);
    // Default camera in renderApp is { x: -640, y: -400, zoom: 1 }.
    const world = screenToWorld({ x: -640, y: -400, zoom: 1 }, { x: 300, y: 200 });
    expect(objs[0].x).toBeCloseTo(world.x, 3);
    expect(objs[0].y).toBeCloseTo(world.y, 3);

    // The tool reverted to Select and the editor mounted.
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-editor')).not.toBeNull();
  });

  it('TC-18: V → Select active', () => {
    renderApp();
    // Switch to Text, then back with V.
    pressKey('t');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'true');
    pressKey('v');
    expect(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn()).toHaveAttribute('aria-pressed', 'false');
  });
});
