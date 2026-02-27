import { getTheme, getDefaultTheme } from './theme-registry';

const FONT_LINK_ID = 'brmble-theme-fonts';

/**
 * Load the fonts for a given theme by updating the <link> tag in <head>.
 * Creates the link element if it doesn't exist.
 */
export function loadThemeFonts(themeId: string): void {
  const theme = getTheme(themeId) ?? getDefaultTheme();

  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  if (link.href !== theme.fontUrl) {
    link.href = theme.fontUrl;
  }
}

/**
 * Apply a theme: set data-theme attribute and load fonts.
 */
export function applyTheme(themeId: string): void {
  document.documentElement.setAttribute('data-theme', themeId);
  loadThemeFonts(themeId);
}
