/**
 * TC-01: classifyRequest for navigation, asset, API, WebSocket, sw.js.
 * TC-02: cachesToDelete removes old shell caches, keeps current and foreign.
 */
import { describe, it, expect } from 'vitest';
import { classifyRequest, cachesToDelete } from '../../src/client/sw/sw';
import { APP_SHELL_CACHE_PREFIX } from '../../src/shared/config';

describe('TC-01: classifyRequest', () => {
  it('navigation GET /b/abc → shell', () => {
    expect(classifyRequest({ mode: 'navigate', url: 'http://localhost/b/abc', method: 'GET' })).toBe('shell');
  });

  it('GET hashed /assets/index-3f2a.js → asset', () => {
    expect(classifyRequest({ mode: 'same-origin', url: 'http://localhost/assets/index-3f2a.js', method: 'GET' })).toBe('asset');
  });

  it('GET /api/boards/x → passthrough', () => {
    expect(classifyRequest({ mode: 'cors', url: 'http://localhost/api/boards/x', method: 'GET' })).toBe('passthrough');
  });

  it('/api/rooms/x WebSocket upgrade → passthrough', () => {
    expect(classifyRequest({ mode: 'websocket', url: 'http://localhost/api/rooms/x', method: 'GET' })).toBe('passthrough');
  });

  it('POST /api/boards → passthrough', () => {
    expect(classifyRequest({ mode: 'cors', url: 'http://localhost/api/boards', method: 'POST' })).toBe('passthrough');
  });

  it('GET /sw.js → passthrough', () => {
    expect(classifyRequest({ mode: 'same-origin', url: 'http://localhost/sw.js', method: 'GET' })).toBe('passthrough');
  });

  it('POST /b/abc → passthrough (non-GET)', () => {
    expect(classifyRequest({ mode: 'navigate', url: 'http://localhost/b/abc', method: 'POST' })).toBe('passthrough');
  });
});

describe('TC-02: cachesToDelete', () => {
  it('removes old shell caches, keeps current and foreign', () => {
    const result = cachesToDelete(
      ['vidi6-shell-a', 'vidi6-shell-b', 'other-cache'],
      'b',
    );
    expect(result).toEqual(['vidi6-shell-a']);
  });

  it('returns empty when no old caches', () => {
    expect(cachesToDelete(['vidi6-shell-a'], 'a')).toEqual([]);
  });

  it('keeps foreign caches', () => {
    expect(cachesToDelete(['other-cache', 'another'], 'a')).toEqual([]);
  });
});
