/**
 * ImageObject: renders an image board object in all its states.
 *
 * States (derived by displayStatus):
 * - uploading: grey box, "Uploading…" for everyone
 * - ready: <img> filling the object bounds; on error → "Image unavailable"
 * - failed: uploader → red border, "Upload failed", Retry/Remove; others → "Image unavailable"
 * - unfinished: "Image upload didn't finish" + Remove for anyone
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';
import type { ObjectComponentProps } from './registry';

/**
 * Module-level retry callback, set by useImageInsert.
 * There is only one board on screen at a time so this is safe.
 */
let retryCallback: ((id: string) => boolean) | null = null;

export function setImageRetryCallback(cb: ((id: string) => boolean) | null): void {
  retryCallback = cb;
}

/** Shared 30-second clock tick so `unfinished` appears without interaction. */
const tickListeners = new Set<() => void>();
let tickInterval: ReturnType<typeof setInterval> | null = null;

function startTicking() {
  if (tickInterval !== null) return;
  tickInterval = setInterval(() => {
    for (const listener of tickListeners) listener();
  }, 30_000);
}

function stopTicking() {
  if (tickListeners.size > 0) return;
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export function ImageObject(props: ObjectComponentProps): JSX.Element {
  const { object, bounds } = props;
  const img = object as unknown as ImageSnap;

  const [imgError, setImgError] = useState(false);

  // Re-render every 30s while there are uploading images
  useEffect(() => {
    if (img.status === 'uploading') {
      startTicking();
      const listener = () => setImgError((e) => !e); // force re-render for tick
      tickListeners.add(listener);
      return () => {
        tickListeners.delete(listener);
        stopTicking();
      };
    }
  }, [img.status]);

  // Reset error state when assetKey changes
  const prevAssetKey = useRef(img.assetKey);
  useEffect(() => {
    if (img.assetKey !== prevAssetKey.current) {
      setImgError(false);
      prevAssetKey.current = img.assetKey;
    }
  }, [img.assetKey]);

  const now = Date.now();
  const status: DisplayStatus = displayStatus(img, now);

  const style: JSX.IntrinsicElements['div']['style'] = {
    position: 'absolute',
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    zIndex: img.z
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    props.gesture.onObjectPointerDown(e, object.id);
  };

  if (status === 'ready' && !imgError) {
    return (
      <div
        className="vidi6-image-object"
        data-vidi6="image-object"
        data-status="ready"
        style={style}
        onPointerDown={handlePointerDown}
      >
        <img
          src={`/api/assets/${img.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  if (status === 'ready' && imgError) {
    return (
      <div
        className="vidi6-image-object vidi6-image-unavailable"
        data-vidi6="image-object"
        data-status="unavailable"
        style={style}
        onPointerDown={handlePointerDown}
      >
        <span className="vidi6-image-status">Image unavailable</span>
      </div>
    );
  }

  if (status === 'uploading') {
    return (
      <div
        className="vidi6-image-object vidi6-image-uploading"
        data-vidi6="image-object"
        data-status="uploading"
        style={style}
        onPointerDown={handlePointerDown}
      >
        <span className="vidi6-image-status">Uploading…</span>
      </div>
    );
  }

  if (status === 'failed') {
    const canRetry = retryCallback !== null;
    return (
      <div
        className="vidi6-image-object vidi6-image-failed"
        data-vidi6="image-object"
        data-status="failed"
        style={style}
        onPointerDown={handlePointerDown}
      >
        <span className="vidi6-image-status">Upload failed</span>
        {canRetry && (
          <button
            type="button"
            className="vidi6-image-retry"
            data-vidi6="image-retry"
            onClick={(e) => {
              e.stopPropagation();
              retryCallback?.(object.id);
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div
        className="vidi6-image-object vidi6-image-unfinished"
        data-vidi6="image-object"
        data-status="unfinished"
        style={style}
        onPointerDown={handlePointerDown}
      >
        <span className="vidi6-image-status">Image upload didn't finish</span>
      </div>
    );
  }

  return (
    <div
      className="vidi6-image-object"
      data-vidi6="image-object"
      data-status="unknown"
      style={style}
      onPointerDown={handlePointerDown}
    />
  );
}
