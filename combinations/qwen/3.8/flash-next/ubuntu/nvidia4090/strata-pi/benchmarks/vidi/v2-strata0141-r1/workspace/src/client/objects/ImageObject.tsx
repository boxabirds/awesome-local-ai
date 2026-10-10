import { useCallback, useEffect, useState } from 'react';
import { deleteObjects } from '../../shared/board-model';
import { displayStatus, markImageUnavailable, type ImageSnap } from '../../shared/objects/image';
import { useImageAdditions } from '../images/useImageInsert';
import { useBoardUndo } from '../board/useUndo';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One image, in whichever state it is in (`image.object`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Uploading : placeholder created (image.uploading)
 *     Uploading --> Ready : the upload finished (image.shared)
 *     Uploading --> Failed : the upload was refused or broke (image.failed)
 *     Failed --> Uploading : Retry, by the client that has the file
 *     Failed --> [*] : Remove
 *     Uploading --> Unfinished : uploading longer than IMAGE_UPLOAD_STALE_MS (image.unfinished)
 *     Unfinished --> [*] : Remove, by anyone
 *     Ready --> Unavailable : this browser cannot load the bytes (image.unavailable)
 *     Ready --> [*] : Remove
 * ```
 *
 * The component is written as a mapping from `displayStatus` to a box, because
 * every state in that diagram is a state of the *document* and the document is
 * what everyone shares. The two things that are not in the document are read from
 * the client that is adding the images (`useImageAdditions`): how far its upload
 * has got, and whether it still holds the file. That is why a person who did not
 * drop the file never sees a percentage and never sees Retry, and why a reload
 * leaves a failed image with Remove and nothing else - by design, the file is gone
 * with the page that had it.
 */

/** How often a board with an uploading image looks at the clock (`image.unfinished`). */
export const IMAGE_CLOCK_TICK_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* One clock for the whole board                                              */
/* -------------------------------------------------------------------------- */

/**
 * `image.unfinished` is a rule about time, and no one publishes it: the client that
 * started an upload may be gone, and a threshold nobody rechecks would then never
 * be noticed. So a board that is showing an image rechecks the clock on a timer.
 *
 * One interval, shared by every image on every board in this tab, started when the
 * first image is rendered and stopped when the last one goes. A board full of
 * images ticks once every 30 seconds, not once per image.
 */
const ticks = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(listener: () => void): () => void {
  ticks.add(listener);
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      for (const tick of ticks) {
        tick();
      }
    }, IMAGE_CLOCK_TICK_MS);
  }
  return () => {
    ticks.delete(listener);
    if (ticks.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** The moment this render is being made at, refreshed while an image is uploading. */
export function useImageClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    return subscribeToClock(() => setNow(Date.now()));
  }, []);
  return now;
}

/* -------------------------------------------------------------------------- */
/* The states that are not an image                                           */
/* -------------------------------------------------------------------------- */

/** The grey box every not-yet-picture state is drawn in. */
function stateBox(
  testid: string,
  label: string,
  tone: 'uploading' | 'unfinished' | 'failed' | 'unavailable',
) {
  return (
    <div className={`image-object__state image-object__state--${tone}`} data-testid={testid}>
      {tone === 'failed' || tone === 'unavailable' ? (
        <svg
          className="image-object__broken"
          viewBox="0 0 24 24"
          width="28"
          height="28"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M4.5 17l4.5-4.5 3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M14 8l6 8M20 8l-6 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
      <span className="image-object__message">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

export type ImageObjectProps = ObjectProps<ImageSnap>;

export function ImageObject(props: ImageObjectProps) {
  const { obj: image, doc, zoom, selected, dragging, editable = true, onSelect, onObjectPointerDown } = props;

  const additions = useImageAdditions();
  const undo = useBoardUndo();
  const now = useImageClock();

  /**
   * A `ready` image whose bytes this browser cannot fetch (`image.unavailable`).
   *
   * Local, because the asset may be unreachable *here* - offline, or a proxy that
   * dropped it - while another person's browser loads it fine. The document is not
   * rewritten over it: an image is not made broken for everyone by one board that
   * could not fetch it. A board that may write records it (`markImageUnavailable`)
   * only when the document itself says the bytes should be there and they are not,
   * which is the one case every board agrees about: a 404.
   */
  const [unreachable, setUnreachable] = useState(false);
  const assetKey = image.assetKey;

  useEffect(() => {
    // A Retry, or another client finishing the upload, hands this box new bytes:
    // whatever this browser concluded about the old ones is void.
    setUnreachable(false);
  }, [assetKey]);

  const status = displayStatus(image, now);
  const isUploader = image.uploaderId !== null && image.uploaderId === additions.identityId;
  const progress = additions.progressFor(image.id);
  const canRetry = additions.canRetry(image.id);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.button !== 0) {
        return;
      }
      // Move and resize are the board's gesture, exactly as for every other type
      // (`sel.transform`, `sel.registry`).
      onObjectPointerDown(event as unknown as PointerEventLike, image.id);
    },
    [image.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // An image has no text to edit (`image.registry`: `editableText: false`), and a
    // double-click must not fall through and create a sticky note on top of it.
    event.stopPropagation();
    event.preventDefault();
    onSelect(image.id, false);
  }, [image.id, onSelect]);

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const handleRetry = useCallback(() => {
    additions.retry(image.id);
  }, [additions, image.id]);

  const handleRemove = useCallback(() => {
    if (!editable) {
      return;
    }
    // Whoever removes an image stops it being sent as well as deleting it, whatever
    // state it is in (`image.remove`); the deletion is one undo step for the person
    // who pressed the button, which is how story 7's Undo puts the image back.
    additions.abandon(image.id);
    undo?.boundary();
    deleteObjects(doc, [image.id]);
    undo?.boundary();
  }, [additions, doc, editable, image.id, undo]);

  const bounds = { width: image.width, height: image.height };
  const showButtons =
    (status === 'failed' && isUploader && editable) || (status === 'unfinished' && editable);
  const chromeScale = `scale(${1 / (zoom || 1)})`;

  let body: React.ReactNode;
  if (status === 'ready' && assetKey !== null && !unreachable) {
    body = (
      <img
        className="image-object__img"
        data-testid={`image-${image.id}`}
        data-image={image.id}
        src={additions.assetUrlOf(assetKey)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => {
          setUnreachable(true);
          if (editable && image.status === 'ready') {
            // The bytes this board was told to fetch are not there for anybody to
            // fetch (`image.unavailable`), so the board says so, once, in the way
            // every board reads.
            markImageUnavailable(doc, image.id);
          }
        }}
      />
    );
  } else if (status === 'ready' || status === 'unavailable' || unreachable) {
    body = stateBox(`image-unavailable-${image.id}`, 'Image unavailable', 'unavailable');
  } else if (status === 'uploading') {
    body =
      isUploader && progress !== undefined ? (
        <div className="image-object__state image-object__state--uploading" data-testid={`image-uploading-${image.id}`}>
          <span className="image-object__message">Uploading…</span>
          <span className="image-object__percent" data-testid={`image-progress-${image.id}`}>
            {Math.round(progress * 100)}%
          </span>
        </div>
      ) : (
        stateBox(`image-uploading-${image.id}`, 'Uploading…', 'uploading')
      );
  } else if (status === 'unfinished') {
    body = stateBox(`image-unfinished-${image.id}`, "Image upload didn't finish", 'unfinished');
  } else if (isUploader) {
    // The uploader's failure is one they can act on: the file is in this client's
    // memory and Retry can send it (`image.upload_failure`).
    body = stateBox(`image-failed-${image.id}`, 'Upload failed', 'failed');
  } else {
    // For everyone else a failed upload is simply an image that is not there, and it
    // looks the way every image that is not there looks.
    body = stateBox(`image-unavailable-${image.id}`, 'Image unavailable', 'unavailable');
  }

  return (
    <div
      className={`image-object image-object--${status}`}
      data-image-object={image.id}
      data-testid={`image-object-${image.id}`}
      data-status={status}
      data-uploader={isUploader ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-width={bounds.width}
      data-height={bounds.height}
      role="group"
      aria-label={status === 'ready' ? 'Image' : `Image: ${status}`}
      tabIndex={0}
      style={{
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        transform: `translate(${image.x}px, ${image.y}px)`,
        zIndex: image.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {body}
      {showButtons ? (
        <div
          className="image-object__buttons"
          data-testid={`image-buttons-${image.id}`}
          style={{ transform: chromeScale, transformOrigin: '0 100%' }}
          onPointerDown={stop}
          onPointerUp={stop}
          onClick={stop}
        >
          {status === 'failed' && isUploader && canRetry ? (
            <button
              type="button"
              className="image-object__button"
              data-testid={`image-retry-${image.id}`}
              aria-label="Retry upload"
              onClick={handleRetry}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            className="image-object__button image-object__button--remove"
            data-testid={`image-remove-${image.id}`}
            aria-label="Remove image"
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

