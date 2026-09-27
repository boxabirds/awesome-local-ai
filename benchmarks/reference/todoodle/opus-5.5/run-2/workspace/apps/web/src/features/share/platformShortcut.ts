type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

/** The bookmark shortcut for this device: '⌘D' on macOS and iOS, 'Ctrl+D' elsewhere. */
export function platformShortcut(nav: NavigatorWithUAData = navigator): '⌘D' | 'Ctrl+D' {
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return /mac|iphone|ipad|ipod|ios/i.test(platform) ? '⌘D' : 'Ctrl+D';
}
