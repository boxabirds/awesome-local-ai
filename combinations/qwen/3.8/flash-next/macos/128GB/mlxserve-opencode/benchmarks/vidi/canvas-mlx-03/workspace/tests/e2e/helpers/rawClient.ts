// A Node-side Yjs collaborator over a real WebSocket, using y-protocols framing
// — the same wire protocol a browser speaks. Used to seed boards and to act as
// "another collaborator" whose connection we can drop abruptly. No mocks.

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  createSticky,
  moveObject,
  deleteObject,
} from '../../../src/shared/board-model.ts';
import { createText, getTextContent } from '../../../src/shared/objects/text.ts';
import type { StickyColor } from '../../../src/shared/config.ts';
import type { TextSize } from '../../../src/shared/config.ts';
import { wsBaseUrl } from './board.ts';

const MSG_SYNC = 0;

export interface StickySeed {
  text: string;
  x: number;
  y: number;
  color?: StickyColor;
}

export class RawClient {
  readonly doc: Y.Doc;
  readonly url: string;
  private ws: WebSocket | null = null;
  private readonly updateHandler: (update: Uint8Array) => void;
  private _open = false;

  constructor(public readonly roomid: string) {
    this.doc = new Y.Doc();
    this.url = `${wsBaseUrl()}/api/rooms/${roomid}`;
    this.updateHandler = (update: Uint8Array) => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_SYNC);
      syncProtocol.writeUpdate(e, update);
      this.send(encoding.toUint8Array(e));
    };
    this.doc.on('update', this.updateHandler as never);
  }

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => this.route(ev.data);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('RawClient connect timeout')), 10000);
      this.ws!.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws!.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('RawClient socket error'));
      });
    });
    this._open = true;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    syncProtocol.writeSyncStep1(e, this.doc);
    this.send(encoding.toUint8Array(e));
  }

  get connected(): boolean {
    return this._open;
  }

  private route(buf: ArrayBuffer): void {
    const decoder = decoding.createDecoder(new Uint8Array(buf));
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    }
    // MSG_AWARENESS frames are intentionally ignored.
    const out = encoding.toUint8Array(encoder);
    if (out.length > 0) this.send(out);
  }

  private send(m: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(m.slice().buffer);
    }
  }

  // --- operations (each fires a Y.Doc update that is transmitted) ---

  addSticky(seed: StickySeed): string {
    let id = '';
    Y.transact(this.doc, () => {
      id = createSticky(this.doc, { x: seed.x, y: seed.y }, seed.color);
      const obj = this.doc.getMap('objects').get(id) as Y.Map<unknown>;
      (obj.get('text') as Y.Text).insert(0, seed.text);
    });
    return id;
  }

  move(noteId: string, x: number, y: number): void {
    Y.transact(this.doc, () => moveObject(this.doc, noteId, x, y));
  }

  /** Seed a free-text object (story 9), optionally with content and a size. */
  addText(seed: { x: number; y: number; text?: string; size?: TextSize }): string {
    let id = '';
    Y.transact(this.doc, () => {
      id = createText(this.doc, { x: seed.x, y: seed.y }, 'peer')!;
      const obj = this.doc.getMap('objects').get(id) as Y.Map<unknown>;
      if (seed.size) obj.set('size', seed.size);
      if (seed.text) getTextContent(this.doc, id)!.insert(0, seed.text);
    });
    return id;
  }

  /** The first text object's id, or undefined. */
  textIdByText(text: string): string | undefined {
    for (const [k, v] of this.doc.getMap('objects')) {
      if (k === 'meta') continue;
      const m = v as Y.Map<unknown>;
      if ((m.get('type') as string) === 'text' && (m.get('text') as Y.Text).toString() === text)
        return k;
    }
    return undefined;
  }

  remove(noteId: string): void {
    Y.transact(this.doc, () => deleteObject(this.doc, noteId));
  }

  noteTexts(): string[] {
    const out: string[] = [];
    for (const [k, v] of this.doc.getMap('objects')) {
      if (k === 'meta') continue;
      const m = v as Y.Map<unknown>;
      if ((m.get('type') as string) !== 'sticky') continue;
      const s = (m.get('text') as Y.Text).toString();
      if (s) out.push(s);
    }
    return out.sort();
  }

  noteCount(): number {
    let n = 0;
    for (const [k, v] of this.doc.getMap('objects')) {
      if (k === 'meta') continue;
      if ((v as Y.Map<unknown>).get('type') === 'sticky') n++;
    }
    return n;
  }

  noteIdByText(text: string): string | undefined {
    for (const [k, v] of this.doc.getMap('objects')) {
      if (k === 'meta') continue;
      const m = v as Y.Map<unknown>;
      if ((m.get('type') as string) === 'sticky' && (m.get('text') as Y.Text).toString() === text)
        return k;
    }
    return undefined;
  }

  /** Poll until `predicate` holds (proves the relay round-trip). */
  async waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('RawClient waitFor timed out');
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /** Wait until our doc contains all of `texts`. */
  expectTexts(texts: string[], timeoutMs = 8000): Promise<void> {
    const has = (arr: string[], needle: string) => arr.some((a) => a === needle);
    return this.waitFor(() => texts.every((t) => has(this.noteTexts(), t)), timeoutMs);
  }

  close(): void {
    this._open = false;
    this.doc.off('update', this.updateHandler as never);
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }

  /** Abrupt drop — terminate the socket with an abnormal close code. */
  kill(): void {
    this._open = false;
    try {
      this.ws?.close(1006);
    } catch {
      /* ignore */
    }
  }
}

/** Let queued Y.Doc updates flush to the wire before returning. */
export function flush(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
