import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../shared/config';

// Pure helpers of board-store.ts, kept free of Workers types so unit tests can load them in plain Node.

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
