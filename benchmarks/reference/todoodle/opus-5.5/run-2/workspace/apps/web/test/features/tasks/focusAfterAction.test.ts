import { afterEach, describe, expect, it } from 'vitest';
import { focusAfterRemoval, nextFocusTarget } from '@/features/tasks/focusAfterAction';

describe('TC-U13 nextFocusTarget', () => {
  it.each([
    ['only row', ['a'], 0, { kind: 'addTask' }],
    ['first of many', ['a', 'b', 'c'], 0, { kind: 'row', id: 'b' }],
    ['middle', ['a', 'b', 'c'], 1, { kind: 'row', id: 'c' }],
    ['last of many', ['a', 'b', 'c'], 2, { kind: 'row', id: 'b' }],
  ])('%s', (_label, ids, index, expected) => {
    expect(nextFocusTarget(ids, index)).toEqual(expected);
  });
});

describe('focusAfterRemoval (DOM)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(ids: string[]) {
    document.body.innerHTML = `<main><ul>${ids.map((id) => `<li data-task-id="${id}" tabindex="-1">${id}</li>`).join('')}</ul><button data-add-task>Add task</button></main>`;
    return document.querySelector('ul') as HTMLElement;
  }

  it('focuses the next row and makes it the tab stop', () => {
    const list = mount(['a', 'b', 'c']);
    focusAfterRemoval(list, 'a');
    expect(document.activeElement).toBe(list.querySelector('[data-task-id="b"]'));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
  });

  it('the last row hands focus to the previous one; the only row to the add-task control', () => {
    const list = mount(['a', 'b']);
    focusAfterRemoval(list, 'b');
    expect(document.activeElement).toBe(list.querySelector('[data-task-id="a"]'));
    const single = mount(['a']);
    focusAfterRemoval(single, 'a');
    expect(document.activeElement).toBe(document.querySelector('[data-add-task]'));
  });
});
