// Who uploaded an image. There is no identity in this build (story 6 is not part of it), so each browser tab gets a
// random id kept in sessionStorage: it survives a reload of the same tab (the uploader still sees "Upload failed"
// with Remove), but other tabs and other people are never taken for the uploader.
const KEY = 'vidi6.uploaderId';

let fallback: string | null = null;

export function tabUploaderId(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    fallback ??= crypto.randomUUID();
    return fallback;
  }
}
