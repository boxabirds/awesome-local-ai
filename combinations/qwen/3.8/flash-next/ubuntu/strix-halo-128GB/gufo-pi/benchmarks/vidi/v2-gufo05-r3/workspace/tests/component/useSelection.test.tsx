import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';

const snap = (id: string): ObjectSnapshot => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  z: 1,
  createdAt: 0,
});

describe('useSelection hook (pruning against the snapshot)', () => {
  it('a remote delete takes the object out of the selection and out of the editor', () => {
    const { result, rerender } = renderHook(
      ({ objects }: { objects: ObjectSnapshot[] }) => useSelection(objects),
      { initialProps: { objects: [snap('a'), snap('b'), snap('c')] } },
    );

    act(() => result.current.setMany(['a', 'b', 'c']));
    act(() => result.current.startEdit('b'));
    expect(result.current.count).toBe(3);
    expect(result.current.editingId).toBe('b');

    // Somebody else deletes b.
    rerender({ objects: [snap('a'), snap('c')] });
    expect([...result.current.ids]).toEqual(['a', 'c']);
    expect(result.current.editingId).toBeNull();

    // ... and deletes the rest.
    rerender({ objects: [] });
    expect(result.current.count).toBe(0);
  });

  it('an id list naming an object that is not on the board selects only what exists', () => {
    const { result } = renderHook(() => useSelection([snap('a')]));
    act(() => result.current.setMany(['a', 'ghost']));
    expect([...result.current.ids]).toEqual(['a']);
    act(() => result.current.setMany(['ghost'], true));
    expect([...result.current.ids]).toEqual(['a']);
  });

  it('an object this client just created is selectable before the snapshot catches up', () => {
    // Creating a note selects and edits it in the same tick, before the document
    // change has reached the snapshot, so a click cannot require it to exist yet.
    const { result, rerender } = renderHook(
      ({ objects }: { objects: ObjectSnapshot[] }) => useSelection(objects),
      { initialProps: { objects: [] as ObjectSnapshot[] } },
    );
    act(() => {
      result.current.click('fresh');
      result.current.startEdit('fresh');
    });
    expect(result.current.count).toBe(1);
    expect(result.current.editingId).toBe('fresh');
    rerender({ objects: [snap('fresh')] });
    expect(result.current.editingId).toBe('fresh');
    expect(result.current.count).toBe(1);
  });

  it('endEdit keeps the selection, endEdit("unselected") drops it', () => {
    const { result } = renderHook(() => useSelection([snap('a'), snap('b')]));
    act(() => result.current.setMany(['a', 'b']));
    act(() => result.current.startEdit('a'));

    act(() => result.current.endEdit());
    expect(result.current.editingId).toBeNull();
    expect(result.current.count).toBe(2);

    act(() => result.current.startEdit('a'));
    act(() => result.current.endEdit('unselected'));
    expect(result.current.editingId).toBeNull();
    expect(result.current.count).toBe(0);
  });

  it('click(null) and clear() empty the selection', () => {
    const { result } = renderHook(() => useSelection([snap('a'), snap('b')]));
    act(() => result.current.setMany(['a', 'b']));
    act(() => result.current.click(null));
    expect(result.current.count).toBe(0);
    act(() => result.current.setMany(['a', 'b']));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });
});
