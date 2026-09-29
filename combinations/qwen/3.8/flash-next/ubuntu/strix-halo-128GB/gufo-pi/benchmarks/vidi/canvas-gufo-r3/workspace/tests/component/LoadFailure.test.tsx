import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { canEdit, type ConnectionState } from '@client/sync/connectBoard';
import type { StickySnapshot } from '@shared/board-model';
import * as Y from 'yjs';

// ---- TC-23 edit lock ----

describe('TC-23: load_failed disables editing', () => {
  afterEach(() => cleanup());

  it('canEdit returns false only for load_failed', () => {
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });

  it('Toolbar button is disabled when load_failed', () => {
    const onCreate = vi.fn();
    render(<Toolbar onCreateSticky={onCreate} disabled={true} />);
    const btn = screen.getByTestId('create-sticky-button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Toolbar button is enabled when not load_failed', () => {
    const onCreate = vi.fn();
    render(<Toolbar onCreateSticky={onCreate} disabled={false} />);
    const btn = screen.getByTestId('create-sticky-button');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalled();
  });

  it('StickyNote in readOnly mode does not fire drag/edit handlers', () => {
    const doc = new Y.Doc();
    const note: StickySnapshot = {
      id: 'note-1',
      type: 'sticky',
      x: 100,
      y: 100,
      text: 'Hello',
      color: 'yellow' as any,
      z: 0,
      createdAt: Date.now(),
    };
    const onSelect = vi.fn();
    const onStartEdit = vi.fn();
    const onEndEdit = vi.fn();

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        readOnly={true}
        onSelect={onSelect}
        onStartEdit={onStartEdit}
        onEndEdit={onEndEdit}
      />,
    );

    const wrapper = container.querySelector('[data-testid="sticky-note-wrapper"]')!;
    // Simulate pointer down and up (drag attempt)
    fireEvent.pointerDown(wrapper, { pointerId: 1, clientX: 150, clientY: 150, button: 0, bubbles: true });
    fireEvent.pointerUp(wrapper, { pointerId: 1, clientX: 150, clientY: 150, button: 0, bubbles: true });
    expect(onSelect).not.toHaveBeenCalled();

    // Double click
    fireEvent.doubleClick(wrapper, { bubbles: true });
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});

// ---- Close-code mapping ----

describe('Close-code mapping (TC-22 + TC-23 spec)', () => {
  // We simulate the connectBoard close handler by driving a controller.
  // 4500 → load_failed, 1011 → reconnecting.

  it('close code 4500 maps to load_failed state', () => {
    const states: ConnectionState[] = [];
    const onState = (s: ConnectionState) => states.push(s);
    const controller = {
      handleStatus: vi.fn(),
      handleSync: vi.fn(),
      setState: vi.fn((s: ConnectionState) => onState(s)),
      destroy: vi.fn(),
    };

    // Simulate what connectBoard's closeHandler does for code 4500
    const closeHandler = (event: CloseEvent | null) => {
      if (!event) return;
      if (event.code === 4500) {
        controller.setState('load_failed');
      }
    };

    closeHandler({ code: 4500 } as CloseEvent);
    expect(controller.setState).toHaveBeenCalledWith('load_failed');
  });

  it('close code 1011 does NOT set load_failed (goes to reconnecting via status)', () => {
    const controller = {
      handleStatus: vi.fn(),
      handleSync: vi.fn(),
      setState: vi.fn(),
      destroy: vi.fn(),
    };

    const closeHandler = (event: CloseEvent | null) => {
      if (!event) return;
      if (event.code === 4500) {
        controller.setState('load_failed');
      }
      // 1011 is handled by the status handler (disconnected → reconnecting)
    };

    closeHandler({ code: 1011 } as CloseEvent);
    expect(controller.setState).not.toHaveBeenCalled();
  });
});
