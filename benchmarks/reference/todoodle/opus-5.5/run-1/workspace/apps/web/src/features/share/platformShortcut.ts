type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

const APPLE_PLATFORM = /mac|iphone|ipad|ipod|ios/i;

/** The bookmark shortcut for this device: ⌘D on macOS/iOS, Ctrl+D elsewhere. */
export function platformShortcut(nav: Navigator = navigator): '⌘D' | 'Ctrl+D' {
  const platform = (nav as NavigatorWithUAData).userAgentData?.platform || nav.platform || '';
  return APPLE_PLATFORM.test(platform) ? '⌘D' : 'Ctrl+D';
}
