/*! One picture on the board (story 12).
 *
 * A picture is an object like any other: it has a box, a click in that box selects
 * it, a drag of that box moves it, a corner resizes it — aspect-locked, so a corner
 * makes the picture bigger rather than wider — and Delete removes it. All of that is
 * the machinery of stories 5 to 8 and is not repeated here. What is here is the part
 * that belongs to a picture alone: a picture's bytes are not in the board, so what
 * the board can honestly say about them depends on where they are in relation to the
 * person asking.
 *
 * ## Two people, two truths, one document
 *
 * The document holds one object and one status. What it cannot hold is which of the
 * two people reading it is the one the upload belongs to, because that is a fact
 * about the present moment and not about the board. So the board passes down one
 * boolean, `canRetry`, which means *this tab is the one holding the file this upload
 * was made from*, and it is the whole of the difference between these two sentences:
 *
 *   "Uploading…  63 %"        the person whose bytes are on the wire
 *   "Uploading…"              everybody else, who is being told it is coming
 *
 * and between "Upload failed" with two buttons and "Image unavailable" with none.
 * A reload turns the first person into the second, which is correct: the tab that
 * reloaded no longer has the file, and is now exactly as uninformed as everybody
 * else about what happened to it.
 *
 * ## Why `unfinished` is derived rather than stored
 *
 * Nothing in the document says `unfinished`. An object is `uploading` and its
 * `uploadStartedAt` is a time, and `displayStatus` asks what that time means *now*
 * — so a board which was told about an upload and never heard another word about it
 * stops saying "Uploading…" by itself, without anybody having to write anything,
 * which is the only way a fact about time can be true on a screen (image.unfinished).
 * That is why this component is given `now`: a clock is an input to what a person
 * sees, and a test has to be able to say what time it is.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { ImageSnap } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';
import { assetPath } from '../../shared/routes';
import { IMAGE_ALT_TEXT, IMAGE_STATUS_TEXT } from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { useNow } from '../ui/useNow';

export interface ImageObjectProps {
  /** The picture as the board stores it: its box, the ratio the file came with, and
   *  how far its bytes have got. */
  object: ImageSnap;
  doc: Y.Doc;
  /** Camera zoom. It scales the box and the picture inside it together, which is the
   *  whole of what zooming a board has to do with a picture. */
  zoom: number;
  selected: boolean;
  /** A picture has no text to edit, so these arrive with the others and go unused. */
  editing?: boolean;
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the picture in and out of the selection. */
  onToggle?(id: string): void;
  onStartEdit?(id: string): void;
  onEndEdit?(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this object. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;

  /** What time the board is being looked at: the moment `displayStatus` measures the
   *  upload against. The board passes the page's shared clock; a test passes the
   *  moment it means. */
  now?: number;
  /** How far this upload has got, as a fraction of its file. Absent until the first
   *  progress event, which is why an upload at nothing and an upload nobody has heard
   *  from are drawn the same way. */
  progress?: number;
  /** Whether *this tab* still holds the file this upload was made from. It is what
   *  says which of the two truths above is being read, and it is the only thing that
   *  makes a Retry possible. */
  canRetry?: boolean;
  /** Send that file up again. */
  onRetry?(id: string): void;
  /** Take this picture off the board. The same delete the Delete key performs, from
   *  a button — including for a picture whose bytes never arrived, which is the one
   *  thing a person can always do about it. */
  onRemove?(id: string): void;
}

/** What a fraction of a file is worth to a person: a whole number of per cent. */
function percentOf(progress: number | undefined): number {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0;
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

/** The little picture of a picture, for the states which are about a picture's
 *  absence. Drawn rather than a font glyph, because a glyph for "no image" is a
 *  font's opinion and this board owns no fonts. */
function PictureIcon(props: { broken: boolean }): JSX.Element {
  const paint = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' } as const;
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <rect x="2.5" y="4.5" width="17" height="13" rx="1.5" {...paint} />
      {props.broken ? (
        <path d="M4 17L18 5" {...paint} strokeLinecap="round" />
      ) : (
        <>
          <circle cx="8" cy="9" r="1.5" {...paint} />
          <path d="M3.6 16.4l4.9-5 3.4 3.4 3-2.7 3.5 3.9" {...paint} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function ImageObject(props: ImageObjectProps): JSX.Element {
  const propsRef = useRef(props);
  // The props are read at the moment the pointer answers, not at the moment the
  // picture was painted: a press that began before the bytes arrived must still
  // select the picture it was on top of.
  useEffect(() => {
    propsRef.current = props;
  });

  const object = props.object;
  const [broken, setBroken] = useState(false);
  // The clock is asked for on every render, whatever this picture's caller does:
  // a hook in a `??` would be a hook that appears and disappears with a prop, and
  // a test that passes `now` and one that does not would be two different numbers
  // of hooks in the same component.
  const shared = useNow();
  const status = displayStatus(object, props.now ?? shared);
  const mine = props.canRetry === true;

  // A different address is a different picture, and whatever went wrong with the
  // last one is not evidence about this one. This is also the whole of what a Retry
  // that worked has to do to the screen: the key comes back, the box goes away.
  useEffect(() => {
    setBroken(false);
  }, [object.assetKey]);

  /** Is a press of ours in flight? */
  const held = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on a picture is never a pan.
    e.stopPropagation();
    if (e.shiftKey) {
      propsRef.current.onToggle?.(object.id);
      return;
    }
    held.current = true;
    propsRef.current.onGesturePointerDown?.(e, object.id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!held.current) return;
    e.stopPropagation();
    propsRef.current.onGesturePointerMove?.(e);
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!held.current) return;
    e.stopPropagation();
    held.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup') propsRef.current.onGesturePointerUp?.(e);
    else propsRef.current.onGesturePointerCancel?.(e);
    // A press that did not become a drag has selected the picture.
    propsRef.current.onSelect(object.id);
  };

  /** A button on a picture is a click on the button and not on the picture: the
   *  selection is not what somebody aiming at "Retry" was asking for. */
  const fromButtons = (e: { stopPropagation(): void }): void => {
    e.stopPropagation();
  };

  const zoom = props.zoom > 0 ? props.zoom : 1;
  const style = {
    left: `${object.x}px`,
    top: `${object.y}px`,
    width: `${object.width}px`,
    height: `${object.height}px`,
    zIndex: object.z,
  } as CSSProperties;

  const percent = percentOf(props.progress);

  /** The box for a picture whose bytes are not where this person can see them: the
   *  sentence, the icon, and whichever of the two buttons this person is allowed. */
  const refusal = (words: string, options: { failed?: boolean; unavailable?: boolean; remove: boolean }) => (
    <div
      className={`image-status${options.failed ? ' is-failed' : ''}`}
      data-testid={options.failed ? 'image-failed' : 'image-unavailable'}
    >
      {options.unavailable === true ? <PictureIcon broken={true} /> : null}
      <p className="image-status-text">{words}</p>
      {mine && object.status === 'failed' ? (
        <button
          type="button"
          className="image-action image-retry"
          data-testid="image-retry"
          onClick={(e) => {
            e.stopPropagation();
            propsRef.current.onRetry?.(object.id);
          }}
          onPointerDown={fromButtons}
        >
          Retry
        </button>
      ) : null}
      {options.remove ? (
        <button
          type="button"
          className="image-action image-remove"
          data-testid="image-remove"
          onClick={(e) => {
            e.stopPropagation();
            propsRef.current.onRemove?.(object.id);
          }}
          onPointerDown={fromButtons}
        >
          Remove
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className={[
        'image-object',
        `image-object-${status}`,
        mine ? 'is-mine' : '',
        props.selected ? 'is-selected' : '',
        broken ? 'is-broken' : '',
      ]
        .filter((name) => name !== '')
        .join(' ')}
      data-testid="image-object"
      data-object-id={object.id}
      data-selected={props.selected ? 'true' : 'false'}
      // The stored status and the one this person is shown, side by side: a test
      // needs the first to know what the document holds and the other to know what
      // the person holding the mouse is being told.
      data-status={object.status}
      data-display={status}
      data-natural-width={object.naturalWidth}
      data-natural-height={object.naturalHeight}
      // The box in board units, as every painted object reports it: a resize of a
      // picture is a change of this box and of nothing else about the picture.
      data-box-x={object.x}
      data-box-y={object.y}
      data-box-width={object.width}
      data-box-height={object.height}
      role="group"
      aria-label={IMAGE_ALT_TEXT}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
    >
      {/* An `uploading` picture is not an empty box: it is the box the finished
          picture will be, at the size the file's own ratio made it, so nothing on
          the board moves when the bytes turn up. */}
      {status === 'uploading' ? (
        mine ? (
          <div
            className="image-uploading image-uploading-mine"
            data-testid="image-uploading-mine"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={IMAGE_STATUS_TEXT.uploading}
          >
            <PictureIcon broken={false} />
            <span className="image-progress-value">{percent}%</span>
            <div className="image-progress" aria-hidden="true">
              <div className="image-progress-bar" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : (
          <div className="image-uploading" data-testid="image-uploading" role="status">
            <p className="image-status-text">{IMAGE_STATUS_TEXT.uploading}</p>
          </div>
        )
      ) : null}

      {/* A ready picture, painted from the ratio the file came with into the box
          somebody else sized, so the two cannot disagree about its shape. */}
      {status === 'ready' && object.assetKey !== null && !broken ? (
        <img
          className="image-img"
          data-testid="image-img"
          src={assetPath(object.assetKey)}
          alt={IMAGE_ALT_TEXT}
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setBroken(false)}
          onError={() => setBroken(true)}
        />
      ) : null}

      {status === 'failed' && mine
        ? refusal(IMAGE_STATUS_TEXT.failed, { failed: true, remove: true })
        : null}
      {/* Everybody else is told the truth they can be told: the picture is not
          there, and their own buttons would not have helped. */}
      {status === 'failed' && !mine
        ? refusal(IMAGE_STATUS_TEXT.unavailable, { unavailable: true, remove: true })
        : null}
      {/* The upload is somebody else's unfinished business — the tab that had the
          file reloaded, or was closed — and the one thing still worth offering is
          taking it off the board. */}
      {status === 'unfinished'
        ? refusal(IMAGE_STATUS_TEXT.unfinished, { remove: true })
        : null}
      {/* A stored picture which will not load. The status stays `ready`, because the
          store is not what is wrong, and the box is drawn at the size and place the
          picture has, which is the only promise the story asks for (image.unavailable).
          Remove is offered here too: the Delete key would do it as well, and a person
          staring at a grey box should not have to know that. Retry is not, because
          there is no file in this tab to send. */}
      {status === 'ready' && (broken || object.assetKey === null)
        ? refusal(IMAGE_STATUS_TEXT.unavailable, { unavailable: true, remove: true })
        : null}
    </div>
  );
}
