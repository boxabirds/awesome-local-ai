// Uploads one image file to the asset API (story 12, assets.api client
// side). Returns the assetKey on success.
//
// Rejections:
//  - `AssetUploadHttpError` on any non-2xx (status preserved; 413/415 are
//    permanent → the image shows "failed", 429/500 are retryable).
//  - `AssetUploadNetworkError` when the fetch itself fails (offline) →
//    the image stays "uploading" and is retried (image.uploads,
//    image.unfinished).

/** An HTTP error from the asset API (non-2xx). */
export class AssetUploadHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AssetUploadHttpError';
  }
}

/** The fetch itself failed (network down / board lost). */
export class AssetUploadNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetUploadNetworkError';
  }
}

/** True for statuses that will never succeed for the same bytes (4xx
 *  except 429): the placeholder is marked failed, not retried. */
export function isPermanentUploadError(err: unknown): boolean {
  if (err instanceof AssetUploadHttpError) {
    return err.status >= 400 && err.status < 500 && err.status !== 429;
  }
  return false;
}

export async function uploadImage(boardId: string, file: File): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: file,
    });
  } catch (err) {
    throw new AssetUploadNetworkError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    throw new AssetUploadHttpError(res.status, `asset upload failed: ${res.status}`);
  }
  const body = (await res.json()) as { assetKey?: string };
  if (typeof body.assetKey !== 'string' || body.assetKey.length === 0) {
    throw new AssetUploadHttpError(res.status, 'asset upload failed: no assetKey');
  }
  return body.assetKey;
}
