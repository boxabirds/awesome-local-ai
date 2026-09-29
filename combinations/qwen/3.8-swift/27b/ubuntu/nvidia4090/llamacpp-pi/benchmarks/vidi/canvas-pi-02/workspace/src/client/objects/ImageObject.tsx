// The board's image object (story 12, image.render / image.statuses /
// image.unavailable): rendered in world coordinates in the world layer.
//
//  - ready: the <img> at the stored asset URL (img.src is
//    `${LOCAL_ORIGIN}/api/assets/<assetKey>`; the server re-serves the
//    sniffed Content-Type with nosniff + null CSP).
//  - uploading (fresh): a status box with a spinner, "Uploading…".
//  - unfinished (derived: upload older than IMAGE_UPLOAD_STALE_MS): the
//    box reads "Upload in progress" — the uploader is responsible, the
//    object syncs to everyone (image.unfinished).
//  - failed: "Image unavailable" (image.unavailable); the uploader gets
//    Retry (markImageRetrying + re-upload) and Remove (delete the object,
//    one undo step).
//
// Selection / move / resize use the GENERIC transform gesture (story 7)
// like every other object; resize is aspect-locked (image.aspect_resize)
// via the registry spec. The status box is non-interactive except the
// uploader's Retry/Remove buttons.

import { type CSSProperties, type ReactElement } from 'react';
import { displayStatus } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

/** ImageObject receives the generic ObjectProps (the `image?` snapshot and
 *  the image-* helpers are declared there, matching the note/shape/stroke
 *  pattern); this alias keeps the component's prop name local. */
export type ImageObjectProps = ObjectProps;

export function ImageObject(props: ImageObjectProps): ReactElement | null {
  const { obj, image: snap } = props;
  if (snap === null || snap === undefined) return null;
  const now = props.imageNow ?? Date.now();
  const status = displayStatus(snap, now);

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    zIndex: obj.z,
  };

  if (status === 'ready') {
    return (
      <div
        data-testid="image-object"
        data-id={obj.id}
        data-status="ready"
        className={`image-object${props.selected ? ' image-object--selected' : ''}`}
        style={containerStyle}
        onPointerDown={(e) => props.onPointerDown(e, obj.id)}
      >
        <img
          src={`/api/assets/${snap.assetKey}`}
          alt=""
          draggable={false}
          className="image-object-img"
          data-testid="image-object-img"
        />
      </div>
    );
  }

  const isUploader = props.imageIsUploader === true;
  return (
    <div
      data-testid="image-object"
      data-id={obj.id}
      data-status={status}
      className={`image-object image-object--${status}${props.selected ? ' image-object--selected' : ''}`}
      style={containerStyle}
      onPointerDown={(e) => props.onPointerDown(e, obj.id)}
    >
      {status === 'uploading' && (
        <>
          <span className="image-object-spinner" aria-hidden="true" />
          <span>Uploading…</span>
        </>
      )}
      {status === 'unfinished' && <span>Upload in progress</span>}
      {status === 'failed' && (
        <>
          <span>Image unavailable</span>
          {isUploader && props.imageCanRetry && (
            <span className="image-object-actions">
              <button
                type="button"
                data-testid="image-retry"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onImageRetry?.(obj.id);
                }}
              >
                Retry
              </button>
              <button
                type="button"
                data-testid="image-remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onImageRemove?.(obj.id);
                }}
              >
                Remove
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}
