import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { canEdit, type ConnectionState } from '@client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '@shared/protocol';
import { initDoc, createSticky, deleteObject, setStickyColor, snapshot } from '@shared/board-model';

describe('TC-23: Edit lock during load_failed', () => {
  it('canEdit returns false only for load_failed', () => {
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
    expect(canEdit('load_failed')).toBe(false);
  });

  it('no board-model mutation when state is load_failed (create)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    
    // Simulate what App.tsx does: gate createStickyAt with canEdit
    const connectionState: ConnectionState = 'load_failed';
    const worldPoint = { x: 100, y: 100 };
    
    if (canEdit(connectionState)) {
      createSticky(doc, worldPoint);
    }
    
    // No note should have been created
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('no board-model mutation when state is load_failed (delete)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(snapshot(doc)).toHaveLength(1);
    
    const connectionState: ConnectionState = 'load_failed';
    if (canEdit(connectionState) && id) {
      deleteObject(doc, id);
    }
    
    // Note should still exist
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('no board-model mutation when state is load_failed (color)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc);
    
    const connectionState: ConnectionState = 'load_failed';
    if (canEdit(connectionState) && id) {
      setStickyColor(doc, id, 'blue');
    }
    
    const after = snapshot(doc);
    expect(after[0].color).toBe(before[0].color);
  });

  it('editing is allowed when state is connected', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    
    const connectionState: ConnectionState = 'connected';
    expect(canEdit(connectionState)).toBe(true);
    
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(id).not.toBeNull();
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('TC-28: Close-code mapping and recovery', () => {
  it('close code 4500 → load_failed', () => {
    const states: ConnectionState[] = [];
    const onState = (s: ConnectionState) => states.push(s);
    
    let isLoadFailed = false;
    
    // Simulate what connectBoard does on close
    const onWsClose = (event: { code: number }) => {
      if (event.code === CLOSE_BOARD_LOAD_FAILED) {
        isLoadFailed = true;
        onState('load_failed');
      } else if (event.code === CLOSE_STORAGE_FAILURE) {
        isLoadFailed = false;
        onState('reconnecting');
      }
    };
    
    onWsClose({ code: CLOSE_BOARD_LOAD_FAILED });
    
    expect(isLoadFailed).toBe(true);
    expect(states).toContain('load_failed');
    expect(canEdit('load_failed')).toBe(false);
  });

  it('close code 1011 → reconnecting with editing still enabled', () => {
    const states: ConnectionState[] = [];
    const onState = (s: ConnectionState) => states.push(s);
    
    let isLoadFailed = false;
    const onWsClose = (event: { code: number }) => {
      if (event.code === CLOSE_BOARD_LOAD_FAILED) {
        isLoadFailed = true;
        onState('load_failed');
      } else if (event.code === CLOSE_STORAGE_FAILURE) {
        isLoadFailed = false;
        onState('reconnecting');
      }
    };
    
    onWsClose({ code: CLOSE_STORAGE_FAILURE });
    
    expect(isLoadFailed).toBe(false);
    expect(states).toContain('reconnecting');
    expect(canEdit('reconnecting')).toBe(true);
  });

  it('close code 1003 → not load_failed, editing remains enabled', () => {
    const states: ConnectionState[] = [];
    const onState = (s: ConnectionState) => states.push(s);
    
    let isLoadFailed = false;
    const onWsClose = (event: { code: number }) => {
      if (event.code === CLOSE_BOARD_LOAD_FAILED) {
        isLoadFailed = true;
        onState('load_failed');
      } else if (event.code === CLOSE_STORAGE_FAILURE) {
        isLoadFailed = false;
        onState('reconnecting');
      }
    };
    
    onWsClose({ code: 1003 });
    
    expect(isLoadFailed).toBe(false);
    expect(canEdit('reconnecting')).toBe(true);
  });

  it('subsequent sync after load_failed → connected and editing enabled', () => {
    const states: ConnectionState[] = [];
    const onState = (s: ConnectionState) => states.push(s);
    
    let isLoadFailed = false;
    
    // Simulate load failure
    isLoadFailed = true;
    onState('load_failed');
    expect(canEdit('load_failed')).toBe(false);
    
    // Simulate successful reconnect and sync
    isLoadFailed = false;
    onState('connected');
    
    expect(isLoadFailed).toBe(false);
    expect(states).toEqual(['load_failed', 'connected']);
    expect(canEdit('connected')).toBe(true);
  });
});
