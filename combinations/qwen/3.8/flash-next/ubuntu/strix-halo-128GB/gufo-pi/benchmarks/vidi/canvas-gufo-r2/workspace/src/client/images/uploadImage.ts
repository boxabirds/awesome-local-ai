/**
 * Uploading one image file (story 12, image.insert).
 *
 * XMLHttpRequest rather than fetch because fetch cannot report *upload* progress,
 * and the placeholder has to show a percentage while the bytes travel
 * (PRD image.uploading).
 */
import { ASSET_URL_PREFIX } from '../../shared/config';

export type UploadResult =
  | { kind: 'ok'; assetKey: string; contentType: string }
  | { kind: 'rate_limited' }
  | { kind: 'aborted' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/** Public address of a stored asset. The key is opaque, so the URL is unguessable. */
export function assetUrlFor(assetKey: string): string {
  const [boardPart, assetPart] = assetKey.split('/');
  return `${ASSET_URL_PREFIX}/${encodeURIComponent(boardPart ?? '')}/${encodeURIComponent(
    assetPart ?? '',
  )}`;
}

/**
 * POST `file` to the board's asset route, reporting 0..1 progress.
 *
 * Never rejects: every outcome (including network failure) is a result value, so
 * a failed upload can never surface as an unhandled promise rejection.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void = () => undefined,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });

    xhr.addEventListener('load', () => {
      if (settled) return;
      settled = true;
      if (xhr.status === 201) {
        let parsed: { assetKey?: string; contentType?: string } = {};
        try {
          parsed = JSON.parse(xhr.responseText) as typeof parsed;
        } catch {
          parsed = {};
        }
        if (typeof parsed.assetKey === 'string' && parsed.assetKey.length > 0) {
          resolve({ kind: 'ok', assetKey: parsed.assetKey, contentType: parsed.contentType ?? file.type });
          return;
        }
        resolve({ kind: 'failed', status: xhr.status });
        return;
      }
      if (xhr.status === 429) {
        resolve({ kind: 'rate_limited' });
        return;
      }
      resolve({ kind: 'failed', status: xhr.status });
    });

    xhr.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'failed' });
    });

    xhr.addEventListener('timeout', () => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'failed' });
    });

    xhr.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'aborted' });
    });

    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.responseType = 'text';
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      if (settled) return;
      // `abort` fires the listener above, which resolves with 'aborted'.
      xhr.abort();
    },
  };
}
