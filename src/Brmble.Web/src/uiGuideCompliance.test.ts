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
  /style=\{\{\s*width\s*\}\}/,
  /style=\{\{\s*width:/,
  /style=\{\{\s*flex:/,
  /style=\{\{\s*bottom:/,
  /style=\{\{\s*\r?$/,
  /style=\{\{\s*paddingLeft:/,
  /style=\{\{\s*animationDelay:/,
  /style=\{\{\s*animationDuration:/,
  /style=\{\{\s*display: 'none'/,
  /style=\{\{\s*'--dx':/,
  /style=\{\{\s*width: size/,
  /style=\{\{\s*fontSize\s*\}\}/,
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
  return findViolations(/style=\{\{/g).filter((violation) => {
    const sourceLine = violation.slice(violation.indexOf(': ') + 2);
    return !inlineStyleAllowList.some((pattern) => pattern.test(sourceLine));
  });
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
