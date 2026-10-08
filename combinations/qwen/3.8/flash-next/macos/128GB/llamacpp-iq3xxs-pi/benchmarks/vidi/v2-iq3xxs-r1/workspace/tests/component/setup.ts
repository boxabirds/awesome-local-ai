import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Enable React's act() environment so act() works outside RTL's auto-wrappers.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has `Blob` and `File`, and it can read one with `FileReader`, but it never
 * grew `blob.arrayBuffer()` — which is how story 12 gets at a file's first bytes before
 * uploading it. This is the missing method spelled out of what jsdom does have, so the
 * code under test runs the way it does in a browser instead of being rewritten around
 * this environment.
 */
function arrayBufferThroughFileReader(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

const blobPrototype = Blob.prototype as unknown as {
  arrayBuffer?: (this: Blob) => Promise<ArrayBuffer>;
};
if (typeof blobPrototype.arrayBuffer !== 'function') {
  blobPrototype.arrayBuffer = function (this: Blob) {
    return arrayBufferThroughFileReader(this);
  };
}

afterEach(() => cleanup());
