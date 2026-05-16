import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceRoot = join(process.cwd(), 'src');

const excludedDirectories = new Set(['themes']);
const excludedFiles = new Set([
  'uiGuideCompliance.test.ts',
  'components/Icon/Icon.tsx',
]);

const colorAllowList = [
  'components/Icon/Icon.tsx',
  'components/Header/BrmbleLogo.css',
  'components/Tooltip/Tooltip.tsx',
  'utils/linkifyText.tsx',
  'test-setup.ts',
];

const glyphAllowList = [
  'components/Icon/Icon.tsx',
  'components/Header/BrmbleLogo.css',
  'components/Game/contracts/ContractSlot.tsx',
  'components/NeonD/NeonDGame.tsx',
];

const titleAttributeAllowList = [
  'App.tsx',
  'components/BrokenCertNotification/BrokenCertNotification.tsx',
  'components/Toast/Toast.tsx',
  'components/UpdateNotification/UpdateNotification.tsx',
];

const inlineStyleAllowList = [
  /^style=\{\{\s*width\s*\}\}$/,
  /^style=\{\{\s*fontSize\s*\}\}$/,
  /^style=\{\{\s*width:\s*size,\s*height:\s*size,\s*minWidth:\s*size,\s*minHeight:\s*size\s*\}\}$/,
  /^style=\{\{\s*width:\s*`\$\{[^`]+\}%`\s*\}\}$/,
  /^style=\{\{\s*flex:\s*`0 0 \$\{[^`]+\}%`\s*\}\}$/,
  /^style=\{\{\s*paddingLeft:\s*`calc\([^`]+\$\{[^`]+\}px\)`\s*\}\}$/,
  /^style=\{\{\s*animationDelay:\s*`\$\{[^`]+\}ms`\s*\}\}$/,
  /^style=\{\{\s*animationDuration:\s*`\$\{[^`]+\}ms`\s*\}\}$/,
  /^style=\{\{\s*display:\s*'none'\s*\}\}$/,
  /^style=\{\{\s*'--dx':\s*'[^']+',\s*'--dy':\s*'[^']+'\s*\}\s*as CSSProperties\}$/,
  /^style=\{\{\s*bottom:\s*`\$\{[^`]+\}px`,\s*right:\s*`\$\{[^`]+\}px`,\s*\}\}$/,
  /^style=\{\{\s*'--grad-center':\s*`url\(#\$\{[^`]+\}-grad-center\)`,\s*'--grad-inner':\s*`url\(#\$\{[^`]+\}-grad-inner\)`,\s*'--grad-middle':\s*`url\(#\$\{[^`]+\}-grad-middle\)`,\s*'--grad-outer':\s*`url\(#\$\{[^`]+\}-grad-outer\)`,\s*\}\s*as CSSProperties\}$/,
];

const filesToScan = collectFiles(sourceRoot).filter((file) => {
  const rel = toPosix(relative(sourceRoot, file));
  if (excludedFiles.has(rel)) return false;
  return /\.(css|tsx)$/.test(rel);
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (excludedDirectories.has(entry)) return [];
      return collectFiles(fullPath);
    }
    return [fullPath];
  });
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

function findViolations(pattern: RegExp, allowList: string[] = []): string[] {
  const violations: string[] = [];

  for (const file of filesToScan) {
    const rel = toPosix(relative(sourceRoot, file));
    if (allowList.includes(rel)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || /issue #\d+/i.test(trimmed)) return;

      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push(`${rel}:${index + 1}: ${trimmed}`);
      }
    });
  }

  return violations;
}

function findInlineStyleViolations(): string[] {
  const violations: string[] = [];

  for (const file of filesToScan) {
    const rel = toPosix(relative(sourceRoot, file));
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.includes('style={{')) continue;

      const expressionLines = [line.slice(line.indexOf('style={{')).trim()];
      let cursor = index;
      while (!isStyleExpressionClosed(expressionLines.join(' ')) && cursor < lines.length - 1) {
        cursor += 1;
        expressionLines.push(lines[cursor].trim());
      }

      const expression = normalizeStyleExpression(expressionLines.join(' '));
      if (!inlineStyleAllowList.some((pattern) => pattern.test(expression))) {
        violations.push(`${rel}:${index + 1}: ${expression}`);
      }
    }
  }

  return violations;
}

function isStyleExpressionClosed(expression: string): boolean {
  return /\}\}\s*|\}\s+as CSSProperties\}\s*/.test(expression);
}

function normalizeStyleExpression(expression: string): string {
  const normalized = expression.replace(/\s+/g, ' ');
  const cssPropertiesEnd = normalized.match(/^(.*?\}\s+as CSSProperties\})/);
  if (cssPropertiesEnd) return cssPropertiesEnd[1];

  const objectEnd = normalized.match(/^(.*?\}\})/);
  return objectEnd ? objectEnd[1] : normalized;
}

describe('UI guide compliance', () => {
  test('component styles do not hardcode colors or token fallback colors', () => {
    expect(findViolations(/#[0-9a-fA-F]{3,8}|rgba?\(/g, colorAllowList)).toEqual([]);
  });

  test('component code does not use emoji or glyph icons in UI text', () => {
    expect(findViolations(/[\u{1F300}-\u{1FAFF}]|[★☆×🔄🔒]/gu, glyphAllowList)).toEqual([]);
  });

  test('static visual styles live in CSS classes instead of inline style props', () => {
    expect(findInlineStyleViolations()).toEqual([]);
  });

  test('tooltips use Tooltip instead of native title attributes', () => {
    expect(findViolations(/title="[^"]+"|title=\{[^}]+\}/g, titleAttributeAllowList)).toEqual([]);
  });
});
