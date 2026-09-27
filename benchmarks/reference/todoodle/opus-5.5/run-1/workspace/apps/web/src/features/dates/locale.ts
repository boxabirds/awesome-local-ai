/** The viewer's locale for date labels (navigator.language); undefined lets Intl use the runtime default. */
export function viewerLocale(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language || undefined;
}
