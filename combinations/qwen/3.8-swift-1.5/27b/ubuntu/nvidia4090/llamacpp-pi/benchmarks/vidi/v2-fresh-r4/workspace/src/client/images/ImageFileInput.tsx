/**
 * Hidden file input for the image picker (story 12).
 */
import type { JSX } from 'react';

export function ImageFileInput({
  ref: inputRef,
  onFileChange,
}: {
  ref: React.RefObject<HTMLInputElement | null>;
  onFileChange(e: React.ChangeEvent<HTMLInputElement>): void;
}): JSX.Element {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      style={{ display: 'none' }}
      data-vidi6="image-file-input"
      onChange={onFileChange}
    />
  );
}
