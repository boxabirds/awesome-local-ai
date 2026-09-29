/**
 * The image object renderer (story 12).
 *
 * Three render states and no fourth: `uploading` paints a placeholder box at
 * the aspect ratio the image was measured at (opacity down, dashed outline —
 * it is *not the picture yet*, and it looks that way); `ready` paints the
 * picture through a direct `GET /assets/…` URL, no Worker round trip before
 * the bytes; and `failed`/`unfinished` paint the shared error state with the
 * one button that may start another upload.
 *
 * The four interaction rules the story asks for live here too: click selects,
 * Escape deselects (the shared keyboard hook), and the bbox for resize
 * handles is the box the document carries — the placeholder box included —
 * so a still-uploading image resizes and rotates on the same geometry as a
 * finished one. That is what "the bbox comes from the last committed rect"
 * means with images: the rect is committed when the placeholder is, not when
 * the bytes land.
 */
import { useState, type JSX } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { assetUrl } from '../images/uploader';
import { ImageErrorState } from './ImageErrorState';

export interface ImageObjectProps {
  image: ImageSnap;
  /** The render clock: `unfinished` is derived from it, never stored. */
  now: number;
  selected: boolean;
  canEdit: boolean;
  onSelect(id: string): void;
  /** The only path that may upload again: `retryUpload`. */
  onRetry(id: string): void;
}

export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, now, selected, canEdit, onSelect, onRetry } = props;
  // A `ready` entry whose bytes turn out not to serve (404 from the bucket,
  // or a broken picture) drops to the error state exactly like a failed
  // upload did — "404 → failed" applied to the render side too. The stamp
  // is the attempt, not just a flag: a retry restarts `uploadStartedAt`, and
  // a new attempt earns a new look at the bytes.
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  const servedBroken = brokenAt === image.uploadStartedAt;

  const box = {
    position: 'absolute' as const,
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    zIndex: selected ? 2 : 1,
  };

  const status = displayStatus(image, now);

  if (status === 'failed' || (status === 'ready' && servedBroken)) {
    return (
      <div style={box}>
        <ImageErrorState
          kind="failed"
          canEdit={canEdit}
          onRetry={() => onRetry(image.id)}
        />
      </div>
    );
  }
  if (status === 'unfinished') {
    return (
      <div style={box}>
        <ImageErrorState
          kind="unfinished"
          canEdit={canEdit}
          onRetry={() => onRetry(image.id)}
        />
      </div>
    );
  }
  if (status === 'uploading') {
    return (
      <div
        style={{ ...box, opacity: 0.55 }}
        className="image-placeholder-box"
        data-testid="image-placeholder"
        data-image-id={image.id}
      >
        {/* Placeholder opacity: 0.5–0.6 (design), 0.55 — the box must read
            as "not the picture yet" from across the room. */}
      </div>
    );
  }
  // ready
  const key = `${image.assetKey}:${image.width}x${image.height}:${image.uploadStartedAt}`;
  return (
    <div
      style={box}
      data-testid="image-object"
      data-board-object="image"
      data-image-id={image.id}
      role="img"
      aria-label={`image ${Math.round(image.naturalWidth)}×${Math.round(image.naturalHeight)}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(image.id);
      }}
    >
      <img
        // Remount on asset-or-size change so a fresh load gets a fresh
        // `servedBroken`: the same component must be able to recover.
        key={key}
        src={image.assetKey === null ? '' : assetUrl(image.assetKey)}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onError={() => setBrokenAt(image.uploadStartedAt)}
      />
    </div>
  );
}