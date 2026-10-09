// Story 12: upload of one image file to the assets API. XMLHttpRequest is
// used because fetch has no upload progress. Any non-201 response, network
// error or abort resolves as failed; the caller decides how to mark the
// placeholder.

export type UploadResult =
  | { ok: true; assetKey: string; contentType: string }
  | { ok: false };

export interface UploadHandlers {
  onProgress(fraction: number): void;
  onDone(result: UploadResult): void;
}

export interface UploadHandle {
  abort(): void;
}

export function uploadImage(boardId: string, file: File, handlers: UploadHandlers): UploadHandle {
  const request = new XMLHttpRequest();
  request.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
  request.responseType = 'text';
  request.upload.addEventListener('progress', (event) => {
    if (event.total > 0) handlers.onProgress(Math.min(1, event.loaded / event.total));
  });
  const failed = (): void => {
    handlers.onDone({ ok: false });
  };
  request.addEventListener('load', () => {
    if (request.status !== 201) {
      failed();
      return;
    }
    let assetKey: string | null = null;
    let contentType = file.type;
    try {
      const body = JSON.parse(request.responseText ?? '') as { assetKey?: unknown; contentType?: unknown };
      if (typeof body.assetKey === 'string') assetKey = body.assetKey;
      if (typeof body.contentType === 'string') contentType = body.contentType;
    } catch {
      assetKey = null;
    }
    if (assetKey === null) {
      failed();
      return;
    }
    handlers.onDone({ ok: true, assetKey, contentType });
  });
  request.addEventListener('error', failed);
  request.addEventListener('timeout', failed);
  request.addEventListener('abort', failed);
  request.send(file);
  return {
    abort: () => {
      request.abort();
    }
  };
}
