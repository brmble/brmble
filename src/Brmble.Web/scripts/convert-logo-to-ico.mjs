/**
 * convert-logo-to-ico.mjs
 *
 * Converts brmble-logo.svg → .ico and .png files for all themes.
 * Each theme gets its own colored icon using --bg-avatar-start (background)
 * and --text-primary (logo fill) from that theme's CSS tokens.
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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 256];

const THEMES = [
  { id: 'classic',        bg: '#4a1a6b', fill: '#f5f0e8' },
  // clean shares classic colors, skip duplicate
  { id: 'blue-lagoon',    bg: '#1a4d66', fill: '#f0f5f8' },
  { id: 'cosmopolitan',   bg: '#6b2040', fill: '#f8f0f0' },
  { id: 'aperol-spritz',  bg: '#8c4a20', fill: '#faf0e0' },
  { id: 'midori-sour',    bg: '#1a6b42', fill: '#eaf5ef' },
  { id: 'lemon-drop',     bg: '#8a6d20', fill: '#f8f0dc' },
  { id: 'retro-terminal', bg: '#1a6b1a', fill: '#d0f0c0' },
];

const svgPath = resolve(__dirname, '../src/assets/brmble-logo.svg');
const outDir = resolve(__dirname, '../../Brmble.Client/Resources');

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
  mkdirSync(outDir, { recursive: true });

  console.log('Generating theme icons...\n');

  for (const theme of THEMES) {
    await generateTheme(baseSvg, theme);
  }

  // Copy classic .ico to root as the default Win32 icon
  const classicIco = readFileSync(resolve(outDir, 'classic/brmble.ico'));
  writeFileSync(resolve(outDir, 'brmble.ico'), classicIco);

  console.log(`\n  Default icon: Resources/brmble.ico (classic)`);
  console.log(`  ${THEMES.length} themes generated`);
}

main().catch((err) => {
  console.error('Failed to convert logo:', err);
  process.exit(1);
});
