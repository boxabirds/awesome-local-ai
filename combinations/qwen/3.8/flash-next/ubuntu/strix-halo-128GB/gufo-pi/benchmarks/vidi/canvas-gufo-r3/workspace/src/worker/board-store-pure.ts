import { COMPACTION_UPDATE_COUNT, COMPACTION_BYTES, SNAPSHOT_CHUNK_BYTES } from '@shared/config';

/**
 * Split data into chunks of at most `size` bytes.
 * Returns an empty array for 0-length input.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.byteLength === 0) return [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.byteLength) {
    const end = Math.min(offset + size, data.byteLength);
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * Concatenate chunks back into a single Uint8Array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  let totalLen = 0;
  for (const c of chunks) totalLen += c.byteLength;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.byteLength;
  }
  return result;
}

/**
 * Determine whether compaction should be triggered.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
