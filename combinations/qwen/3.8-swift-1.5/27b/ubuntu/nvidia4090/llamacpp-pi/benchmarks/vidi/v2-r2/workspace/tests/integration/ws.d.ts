// Minimal type declarations for the `ws` package (present in the lockfile
// as a dependency of y-websocket). Only the surface used by the
// integration test clients is declared.
declare module 'ws' {
  export default class WebSocket {
    constructor(address: string, options?: { headers?: Record<string, string> });
    binaryType: 'nodebuffer' | 'arraybuffer';
    readyState: number;
    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: ArrayBuffer | Buffer, isBinary: boolean) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    send(data: Uint8Array | string): void;
    close(code?: number, reason?: string): void;
  }
}
