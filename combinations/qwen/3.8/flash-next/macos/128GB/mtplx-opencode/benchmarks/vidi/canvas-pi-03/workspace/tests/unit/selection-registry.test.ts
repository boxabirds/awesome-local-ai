/**
 * The generic selection layer applied to a `text` block (story 9): the resize
 * mode and the size fields come from the object registry, never from a
 * per-type `if` in the widgets, and a mixed selection keeps the full box.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  resizeModeOf,
  selectionResizeMode,
  allFreeResize,
  allHorizontalHandles,
  anyResizable,
  anyAspectLocked,
  minSizeOf,
  resetObjectTypes,
} from '@shared/object-types';
import { rectContainsPoint } from '@shared/geometry';

describe('object registry: resize modes', () => {
  beforeEach(() => {
    resetObjectTypes();
  });

  it('sticky keeps its eight-handle square box', () => {
    expect(resizeModeOf('sticky')).toBe('all');
    expect(anyAspectLocked(['sticky'])).toBe(true);
  });

  it('text resizes through the e/w handles only, at any aspect', () => {
    expect(resizeModeOf('text')).toBe('horizontal');
    expect(getObjectType('text')?.aspectLocked).toBe(false);
    expect(getObjectType('text')?.editableText).toBe(true);
    expect(minSizeOf(['text'], 999)).toBe(40);
  });

  it('an unregistered type has no mode, so nothing can be done to it', () => {
    expect(resizeModeOf('mystery')).toBe('none');
    expect(selectionResizeMode(['mystery'])).toBe('none');
    expect(selectionResizeMode(['mystery', 'text'])).toBe('none');
  });

  it('a mixed selection is never narrowed to two handles', () => {
    expect(selectionResizeMode(['text'])).toBe('horizontal');
    expect(selectionResizeMode(['text', 'text'])).toBe('horizontal');
    expect(selectionResizeMode(['text', 'sticky'])).toBe('all');
    expect(allHorizontalHandles(['text', 'sticky'])).toBe(false);
    expect(allFreeResize(['text'])).toBe(false);
    expect(allFreeResize(['sticky'])).toBe(true);
    // `anyResizable` is the loose predicate (ANY member resizable); the
    // "all resizable or no gesture" rule lives in selectionResizeMode.
    expect(anyResizable(['text', 'mystery'])).toBe(true);
    expect(selectionResizeMode(['text', 'mystery'])).toBe('none');
  });

  it('a new type is added by registering it, not by editing a widget', () => {
    registerObjectType({
      type: 'widget',
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (bounds, point) => rectContainsPoint(bounds, point),
    });
    expect(resizeModeOf('widget')).toBe('none');
    expect(selectionResizeMode(['widget', 'text'])).toBe('none');
  });
});
