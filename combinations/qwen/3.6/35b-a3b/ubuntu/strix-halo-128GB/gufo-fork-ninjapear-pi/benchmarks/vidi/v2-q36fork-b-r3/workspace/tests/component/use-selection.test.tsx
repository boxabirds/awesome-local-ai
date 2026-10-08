import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react/pure';
import { useSelection } from '../../src/client/board/useSelection';
import type { StickySnapshot } from '../../src/shared/board-model';
import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';

describe('useSelection hook', () => {
  function makeDocAndSnapshot(count: number) {
    const doc = new Y.Doc();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(createSticky(doc, { x: 100 + i * 20, y: 100 }));
    }
    const snapshot: StickySnapshot[] = ids.map((id, i) => ({
      id,
      x: 100 + i * 20,
      y: 100,
      text: `note ${i}`,
      color: 'yellow',
      z: 0,
      type: 'sticky',
      createdAt: Date.now() + i,
    }));
    return { doc, snapshot };
  }

  test('TC-24: initial state has empty selection', () => {
    const { doc } = makeDocAndSnapshot(1);
    const { result } = renderHook(() => useSelection(doc, []));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.editingId).toBeNull();
  });

  test('TC-25: click sets single-item selection', () => {
    const { doc, snapshot } = makeDocAndSnapshot(3);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    act(() => { result.current.click(snapshot[0].id); });
    
    expect(result.current.ids.size).toBe(1);
    expect(result.current.ids.has(snapshot[0].id)).toBe(true);
  });

  test('TC-26: toggle adds/removes items from selection', () => {
    const { doc, snapshot } = makeDocAndSnapshot(3);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    // Toggle in first item
    act(() => { result.current.toggle(snapshot[0].id); });
    expect(result.current.ids.size).toBe(1);
    
    // Toggle in second item
    act(() => { result.current.toggle(snapshot[1].id); });
    expect(result.current.ids.size).toBe(2);
    
    // Toggle out first item
    act(() => { result.current.toggle(snapshot[0].id); });
    expect(result.current.ids.size).toBe(1);
    expect(result.current.ids.has(snapshot[0].id)).toBe(false);
    expect(result.current.ids.has(snapshot[1].id)).toBe(true);
  });

  test('TC-27: setMany with additive=false replaces selection', () => {
    const { doc, snapshot } = makeDocAndSnapshot(3);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    act(() => { result.current.setMany([snapshot[0].id], false); });
    expect(result.current.ids.size).toBe(1);
    
    act(() => { result.current.setMany([snapshot[1].id, snapshot[2].id], false); });
    expect(result.current.ids.size).toBe(2);
    expect(result.current.ids.has(snapshot[0].id)).toBe(false);
    expect(result.current.ids.has(snapshot[1].id)).toBe(true);
  });

  test('TC-28: clear removes all selections', () => {
    const { doc, snapshot } = makeDocAndSnapshot(3);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    act(() => { result.current.setMany([snapshot[0].id, snapshot[1].id], false); });
    expect(result.current.ids.size).toBe(2);
    
    act(() => { result.current.clear(); });
    expect(result.current.ids.size).toBe(0);
  });

  test('TC-29: pruning removes pruned items when snapshot changes', () => {
    const { doc } = makeDocAndSnapshot(3);
    const { result, rerender } = renderHook(
      ({ snapshot }: { snapshot: StickySnapshot[] }) => useSelection(doc, snapshot),
      { initialProps: { snapshot: [
        { id: 'a', x: 0, y: 0, text: '', color: 'yellow' as any, z: 0, type: 'sticky', createdAt: Date.now() },
        { id: 'b', x: 0, y: 0, text: '', color: 'yellow' as any, z: 0, type: 'sticky', createdAt: Date.now() + 1 },
      ]} }
    );
    
    act(() => { result.current.setMany(['a', 'b'], false); });
    expect(result.current.ids.size).toBe(2);
    
    // Rerender with only one note (second was "deleted")
    rerender({ snapshot: [
      { id: 'a', x: 0, y: 0, text: '', color: 'yellow' as any, z: 0, type: 'sticky', createdAt: Date.now() },
    ]});
    
    expect(result.current.ids.size).toBe(1);
    expect(result.current.ids.has('a')).toBe(true);
    expect(result.current.ids.has('b')).toBe(false);
  });

  test('TC-30: startEdit/endEdit control editing state', () => {
    const { doc, snapshot } = makeDocAndSnapshot(1);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    expect(result.current.editingId).toBeNull();
    act(() => { result.current.startEdit(snapshot[0].id); });
    expect(result.current.editingId).toBe(snapshot[0].id);
    act(() => { result.current.endEdit('unselected'); });
    expect(result.current.editingId).toBeNull();
  });

  test('TC-31: shift-click toggles selection without clearing', () => {
    const { doc, snapshot } = makeDocAndSnapshot(3);
    const { result } = renderHook(() => useSelection(doc, snapshot));
    
    // Select first
    act(() => { result.current.click(snapshot[0].id); });
    expect(result.current.ids.size).toBe(1);
    
    // Toggle in second (simulating shift-click)
    act(() => { result.current.toggle(snapshot[1].id); });
    expect(result.current.ids.size).toBe(2);
    
    // Toggle out first
    act(() => { result.current.toggle(snapshot[0].id); });
    expect(result.current.ids.size).toBe(1);
    expect(result.current.ids.has(snapshot[1].id)).toBe(true);
  });
});
