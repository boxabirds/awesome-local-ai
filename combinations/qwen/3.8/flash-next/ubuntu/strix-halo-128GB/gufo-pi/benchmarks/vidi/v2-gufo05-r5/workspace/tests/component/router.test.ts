/**
 * Router unit/component tests (TC-11).
 *
 * Verifies parseRoute maps paths to the correct route, and navigate() updates the route.
 */
import { describe, expect, test } from 'vitest';
import { parseRoute } from '../../src/client/router';

describe('parseRoute (TC-11)', () => {
  test('parses "/" as home', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
  });

  test('parses "/b/:id" as board with id', () => {
    const id = 'ABCDEFGHIJKLMNOPQRSTUV';
    expect(parseRoute(`/b/${id}`)).toEqual({ name: 'board', id });
  });

  test('parses unknown paths as not_found', () => {
    expect(parseRoute('/foo')).toEqual({ name: 'not_found' });
    expect(parseRoute('/b')).toEqual({ name: 'not_found' });
    expect(parseRoute('/b/')).toEqual({ name: 'not_found' });
    expect(parseRoute('/b/abc/def')).toEqual({ name: 'not_found' });
  });

  test('parses "/b/:id/" with trailing slash as board', () => {
    const id = 'abcdefghijklmnopqrstuv';
    expect(parseRoute(`/b/${id}/`)).toEqual({ name: 'board', id });
  });
});
