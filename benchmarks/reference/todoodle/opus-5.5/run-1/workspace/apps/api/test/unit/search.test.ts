import { normaliseForSearch } from '@todoodle/shared/search';
import { describe, expect, it } from 'vitest';

// TC-93: the shared search normaliser, run in workerd (the server side of story 11 uses the same function).

describe('TC-93 normaliseForSearch', () => {
  it.each([
    ['Café', 'cafe'],
    ['ÅNGSTRÖM', 'angstrom'],
    ['a   b', 'a b'],
    ['', ''],
    ['  Trip to  Lisbon ', 'trip to lisbon'],
    ['Woodwork', 'woodwork'],
    ['ﬁle', 'file'],
  ])('%j -> %j', (input, expected) => {
    expect(normaliseForSearch(input)).toBe(expected);
  });
});
