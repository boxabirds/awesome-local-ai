// src/worker/kv-fallback-store.ts
// KV-based fallback for when storage.sql is not available (wrangler 3.x).
// Uses JSON serialization and async DO storage API.

import * as Y from 'yjs';

import { chunkBytes, joinChunks, shouldCompact, LOAD_ORIGIN, type LoadResult } from './board-store';

interface AsyncDoStorage {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KvFallbackStore {
  private storage: AsyncDoStorage;
  private rowCount = 0;
  private byteTotal = 0;
  private snapshotThroughSeq = 0;

  constructor(storage: AsyncDoStorage) {
    this.storage = storage;
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.storage.get<string>(key);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw as string);
    } catch {
      return null;
    }
  }

  private async setJson(key: string, value: unknown): Promise<void> {
    await this.storage.set(key, JSON.stringify(value));
  }

  async migrate(): Promise<void> {
    const meta = await this.getJson<{ snapshot_through_seq: number }>('__meta__');
    if (!meta) {
      await this.setJson('__meta__', { snapshot_through_seq: 0 });
    }
    this.snapshotThroughSeq = meta?.snapshot_through_seq ?? 0;

    const updates = await this.getJson<{ updates: { seq: number; data: number[]; bytes: number }[]; nextSeq: number }>('__updates__');
    if (updates && Array.isArray(updates.updates)) {
      const relevant = updates.updates.filter(u => u.seq > this.snapshotThroughSeq);
      this.rowCount = relevant.length;
      this.byteTotal = relevant.reduce((sum, u) => sum + u.bytes, 0);
    }
  }

  async append(update: Uint8Array): Promise<void> {
    const data = await this.getJson<{ updates: { seq: number; data: number[]; bytes: number }[]; nextSeq: number }>('__updates__')
      ?? { updates: [], nextSeq: 1 };
    data.updates.push({ seq: data.nextSeq, data: Array.from(update), bytes: update.length });
    data.nextSeq++;
    await this.setJson('__updates__', data);
    this.rowCount++;
    this.byteTotal += update.length;
  }

  async load(doc: Y.Doc): Promise<LoadResult> {
    try {
      // Read and apply snapshot
      const snap = await this.getJson<{ chunks: number[][] }>('__snapshot__');
      if (snap && Array.isArray(snap.chunks) && snap.chunks.length > 0) {
        const chunkArrays = snap.chunks.map(c => new Uint8Array(c));
        const snapshotBytes = joinChunks(chunkArrays);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Read and apply log rows
      const data = await this.getJson<{ updates: { seq: number; data: number[]; bytes: number }[]; nextSeq: number }>('__updates__');
      let quarantined = 0;

      if (data && Array.isArray(data.updates)) {
        for (const row of data.updates) {
          if (row.seq <= this.snapshotThroughSeq) continue;
          const bytes = new Uint8Array(row.data);
          try {
            Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            const updated = await this.getJson<{ updates: { seq: number; data: number[]; bytes: number }[]; nextSeq: number }>('__updates__');
            if (updated && Array.isArray(updated.updates)) {
              updated.updates = updated.updates.filter(u => u.seq !== row.seq);
              await this.setJson('__updates__', updated);
            }
            console.error('[KvFallbackStore] Quarantined damaged update', { seq: row.seq, error });
            quarantined++;
          }
        }
      }

      return { ok: true, quarantined };
    } catch (e) {
      return {
        ok: false,
        reason: 'sql-error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async compactIfNeeded(doc: Y.Doc): Promise<boolean> {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;

    try {
      const state = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(state);
      const snapshotData = { chunks: chunks.map(c => Array.from(c)) };

      const updatesData = await this.getJson<{ updates: { seq: number; data: number[]; bytes: number }[]; nextSeq: number }>('__updates__');
      const maxSeq = updatesData ? updatesData.nextSeq - 1 : 0;

      await this.setJson('__snapshot__', snapshotData);
      if (updatesData && Array.isArray(updatesData.updates)) {
        updatesData.updates = updatesData.updates.filter(u => u.seq > maxSeq);
        await this.setJson('__updates__', updatesData);
      }
      await this.setJson('__meta__', { snapshot_through_seq: maxSeq });

      this.snapshotThroughSeq = maxSeq;
      this.rowCount = 0;
      this.byteTotal = 0;

      return true;
    } catch (e) {
      console.error('[KvFallbackStore] Compaction failed', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  resetCounters(): void {
    this.rowCount = 0;
    this.byteTotal = 0;
  }

  getCounters(): { rowCount: number; byteTotal: number; snapshotThroughSeq: number } {
    return { rowCount: this.rowCount, byteTotal: this.byteTotal, snapshotThroughSeq: this.snapshotThroughSeq };
  }
}
