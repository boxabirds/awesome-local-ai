import type { JSX } from 'react';

/**
 * The bin, drawn once for the two toolbars that delete (`NoteToolbar`,
 * `TextToolbar`). It carries no label of its own: the button around it says what
 * is being deleted, which is the part a screen reader needs.
 */
export function BinIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M6 2h4l.7.7V4H9v1h1.5v8.2c0 .5-.4.8-.8.8H6.3c-.5 0-.8-.3-.8-.8V5H7V4H5.3v-1.3L6 2Zm-.7 3v7h1.4V5H5.3Zm2.4 0v7h1.3V5H7.7Zm2.3 0v7h1.4V5h-1.4Z"
      />
    </svg>
  );
}
