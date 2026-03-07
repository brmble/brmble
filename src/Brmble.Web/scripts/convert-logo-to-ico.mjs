/**
 * convert-logo-to-ico.mjs
 *
 * Converts brmble-logo.svg → .ico and .png files for all themes.
 * Each theme gets its own colored icon using --bg-avatar-start (background)
 * and --text-primary (logo fill) extracted from the theme CSS files.
 *
 * Output structure:
 *   src/Brmble.Client/Resources/
 *     brmble.ico                  (classic, used for Win32 window/tray)
 *     classic/brmble-{16,32,48,256}.png
 *     blue-lagoon/brmble-{16,32,48,256}.png
 *     ...
 *
 * Usage: node scripts/convert-logo-to-ico.mjs
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 256];

const svgPath = resolve(__dirname, '../src/assets/brmble-logo.svg');
const themesDir = resolve(__dirname, '../src/themes');
const outDir = resolve(__dirname, '../../Brmble.Client/Resources');

/**
 * Extract a CSS custom property value from a CSS file's content.
 * Looks for `--token: <value>;` and returns the raw value string.
 */
function extractToken(css, token) {
  const re = new RegExp(`${token}:\\s*([^;]+);`);
  const m = css.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse all theme CSS files and return an array of { id, bg, fill } objects.
 * Classic defines tokens in bare :root (baseline for all themes).
 * Other themes use :root[data-theme="name"].
 * Clean inherits Classic colors so it's skipped (duplicate icons).
 */
function loadThemes() {
  const classicCss = readFileSync(resolve(themesDir, 'classic.css'), 'utf-8');
  const classicBg = extractToken(classicCss, '--bg-avatar-start');
  const classicFill = extractToken(classicCss, '--text-primary');

  if (!classicBg || !classicFill) {
    throw new Error('Failed to extract --bg-avatar-start or --text-primary from classic.css');
  }

  const themes = [{ id: 'classic', bg: classicBg, fill: classicFill }];

  const files = readdirSync(themesDir).filter(
    (f) => f.endsWith('.css') && f !== 'classic.css' && f !== '_template.css'
  );

  for (const file of files) {
    const id = basename(file, '.css');
    const css = readFileSync(resolve(themesDir, file), 'utf-8');
    const bg = extractToken(css, '--bg-avatar-start');
    const fill = extractToken(css, '--text-primary');

    // Themes that don't define these tokens inherit Classic's values (e.g. clean).
    // Skip them to avoid generating duplicate icon sets.
    if (!bg && !fill) continue;

    themes.push({
      id,
      bg: bg || classicBg,
      fill: fill || classicFill,
    });
  }

  return themes;
}

function buildSvg(baseSvg, bgColor, fillColor) {
  let svg = baseSvg.replace(/fill="currentColor"/g, `fill="${fillColor}"`);
  svg = svg.replace(
    /(<svg[^>]*>)/,
    `$1<rect width="1024" height="1024" rx="180" ry="180" fill="${bgColor}"/>`
  );
  return svg;
}

async function generateTheme(baseSvg, theme) {
  const svg = buildSvg(baseSvg, theme.bg, theme.fill);
  const themeDir = resolve(outDir, theme.id);
  mkdirSync(themeDir, { recursive: true });

  const pngBuffers = await Promise.all(
    SIZES.map(async (size) => {
      const buf = await sharp(Buffer.from(svg))
        .resize(size, size)
        .png()
        .toBuffer();

      writeFileSync(resolve(themeDir, `brmble-${size}.png`), buf);
      return buf;
    })
  );

  // Generate .ico for each theme
  const ico = await pngToIco(pngBuffers);
  writeFileSync(resolve(themeDir, 'brmble.ico'), ico);

  console.log(`  ${theme.id}: ico + ${SIZES.map(s => s + 'px').join(', ')}`);
  return pngBuffers;
}

async function main() {
  const baseSvg = readFileSync(svgPath, 'utf-8');
  const themes = loadThemes();
  mkdirSync(outDir, { recursive: true });

  console.log('Generating theme icons...\n');

  for (const theme of themes) {
    await generateTheme(baseSvg, theme);
  }

  // Copy classic .ico to root as the default Win32 icon
  const classicIco = readFileSync(resolve(outDir, 'classic/brmble.ico'));
  writeFileSync(resolve(outDir, 'brmble.ico'), classicIco);

  console.log(`\n  Default icon: Resources/brmble.ico (classic)`);
  console.log(`  ${themes.length} themes generated`);
}

main().catch((err) => {
  console.error('Failed to convert logo:', err);
  process.exit(1);
});
