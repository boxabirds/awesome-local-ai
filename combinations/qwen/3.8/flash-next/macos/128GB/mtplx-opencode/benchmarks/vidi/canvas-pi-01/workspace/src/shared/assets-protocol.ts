/**
 * Story 12 · the shape shared by the upload endpoint and the client.
 *
 * Kept in `shared` because both sides name the same outcomes: the Worker replies
 * with one of these JSON bodies, and the client maps a failure to a toast and a
 * `failed` placeholder. `too_large` and `unsupported` are distinguishable in the
 * *body* even though both are HTTP 413, because the reason is what drives the
 * message (PRD image.upload_failure).
 */

/** A successful upload: the R2 key the file was stored under. */
export interface AssetSuccess {
  ok: true;
  /** `<boardId>/<assetId>` — see {@link assetKeyFor}. */
  assetKey: string;
}

/** Why an upload did not store the file. */
export type AssetFailureReason =
  /** Body larger than the limit, or more files than one add allows. */
  | 'too_large'
  /** A file whose *content* is not PNG / JPEG / GIF / WebP. */
  | 'unsupported'
  /** A storage outage or anything else that is not the file's fault. */
  | 'failed'
  /** The board id in the URL was not a valid board. */
  | 'bad_board';

/** A failed upload, with the reason and the HTTP status it was reported with. */
export interface AssetFailure {
  ok: false;
  reason: AssetFailureReason;
  status: number;
}

export type AssetResult = AssetSuccess | AssetFailure;
