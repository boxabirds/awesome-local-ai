import { afterEach, describe, expect, it } from 'vitest';
import { focusAfterRemoval, nextFocusTarget } from '@/features/tasks/focusAfterAction';

// Story 6, TC-U13: where focus goes when a row leaves the list (only / first / middle / last).

describe('TC-U13 nextFocusTarget', () => {
  it.each([
    ['only row', ['a'], 0, { kind: 'addTask' }],
    ['first of many', ['a', 'b', 'c'], 0, { kind: 'row', id: 'b' }],
    ['middle', ['a', 'b', 'c'], 1, { kind: 'row', id: 'c' }],
    ['last of many', ['a', 'b', 'c'], 2, { kind: 'row', id: 'b' }],
  ])('%s -> %j', (_label, ids, index, expected) => {
    expect(nextFocusTarget(ids, index)).toEqual(expected);
  });
});

describe('focusAfterRemoval (DOM)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(ids: string[]) {
    document.body.innerHTML = `<ul role="listbox">${ids.map((id) => `<li role="option" tabindex="-1" data-task-id="${id}">${id}</li>`).join('')}</ul><button data-add-task>Add task</button>`;
    return document.querySelector<HTMLElement>('ul')!;
  }

  it('focuses the next row, or the previous one for the last row', () => {
    const list = mount(['a', 'b', 'c']);
    expect(focusAfterRemoval(list, 'a')?.dataset.taskId).toBe('b');
    expect(document.activeElement).toBe(list.children[1]);
    expect(focusAfterRemoval(list, 'c')?.dataset.taskId).toBe('b');
  });

  it("focuses the list's add-task control when the only row leaves", () => {
    const list = mount(['a']);
    focusAfterRemoval(list, 'a');
    expect(document.activeElement).toBe(document.querySelector('[data-add-task]'));
  });

  it('does nothing for an id that is not in the list', () => {
    const list = mount(['a', 'b']);
    expect(focusAfterRemoval(list, 'zzz')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
