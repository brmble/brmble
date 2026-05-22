import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceRoot = join(process.cwd(), 'src');

const excludedDirectories = new Set(['themes']);
const excludedFiles = new Set([
  'uiGuideCompliance.test.ts',
  'components/Icon/Icon.tsx',
]);

const scannedExtensions = /\.(css|tsx)$/;

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

const textInputClassAllowList = [
  'components/ChatPanel/ChatPanel.tsx',
  'components/ChatPanel/MessageInput.tsx',
  'components/DMContactList/DMContactList.tsx',
];

const titleAttributeAllowList = [
  'App.tsx',
  'components/BrokenCertNotification/BrokenCertNotification.tsx',
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
  /^style=\{\{\s*'--stagger-index':\s*[^,}]+\}\s*as CSSProperties\}$/,
  /^style=\{\{\s*bottom:\s*`\$\{[^`]+\}px`,\s*right:\s*`\$\{[^`]+\}px`,\s*\}\}$/,
  /^style=\{\{\s*'--grad-center':\s*`url\(#\$\{[^`]+\}-grad-center\)`,\s*'--grad-inner':\s*`url\(#\$\{[^`]+\}-grad-inner\)`,\s*'--grad-middle':\s*`url\(#\$\{[^`]+\}-grad-middle\)`,\s*'--grad-outer':\s*`url\(#\$\{[^`]+\}-grad-outer\)`,\s*\}\s*as CSSProperties\}$/,
];

const filesToScan = collectFiles(sourceRoot).filter((file) => {
  const rel = toPosix(relative(sourceRoot, file));
  if (excludedFiles.has(rel)) return false;
  return scannedExtensions.test(rel);
});

const componentFilesToScan = filesToScan.filter((file) => {
  const rel = toPosix(relative(sourceRoot, file));
  return !rel.endsWith('.test.tsx');
});

const focusedCssTokenFiles = [
  'components/ChatPanel/MessageBubble.css',
  'components/VadLevelMeter/VadLevelMeter.css',
  'components/Notification/Notification.css',
  'components/Game/contracts/ContractSlot.css',
  'components/Brmblegotchi/Brmblegotchi.css',
  'components/Sidebar/ChannelTree.css',
  'components/Sidebar/Sidebar.css',
  'components/SettingsModal/AdminSettingsTab.css',
  'components/Game/GameUI.css',
  'components/ServerList/ServerList.css',
].map((file) => join(sourceRoot, ...file.split('/')));

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

function findViolations(pattern: RegExp, allowList: string[] = [], files: string[] = componentFilesToScan): string[] {
  const violations: string[] = [];

  for (const file of files) {
    const rel = toPosix(relative(sourceRoot, file));
    if (allowList.includes(rel)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || /issue #\d+/i.test(trimmed)) return;
      if (trimmed.startsWith('--')) return;

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

  for (const file of componentFilesToScan) {
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

function findNativeSelectViolations(): string[] {
  return findViolations(/<select\b/g);
}

function findToastArtifacts(): string[] {
  const toastDir = join(sourceRoot, 'components', 'Toast');
  const toastFiles = existsSync(toastDir)
    ? collectFiles(toastDir).map((file) => toPosix(relative(sourceRoot, file)))
    : [];

  const toastReferences = findViolations(/\bToast\b|components\/Toast|components\\Toast/g);
  return [...toastFiles, ...toastReferences];
}

function findSettingsPatternViolations(): string[] {
  const violations: string[] = [];
  const connectionSettings = readFileSync(join(sourceRoot, 'components', 'SettingsModal', 'ConnectionSettingsTab.tsx'), 'utf8');
  const audioSettings = readFileSync(join(sourceRoot, 'components', 'SettingsModal', 'AudioSettingsTab.tsx'), 'utf8');
  const settingsFiles = componentFilesToScan.filter((file) => toPosix(relative(sourceRoot, file)).startsWith('components/SettingsModal/'));

  if (connectionSettings.includes('server-dropdown-row')) {
    violations.push('components/SettingsModal/ConnectionSettingsTab.tsx: uses server-dropdown-row instead of settings-item');
  }

  if (!connectionSettings.includes('<SettingsHelp content={tooltipText}')) {
    violations.push('components/SettingsModal/ConnectionSettingsTab.tsx: auto-connect help does not use SettingsHelp');
  }

  if (!audioSettings.includes('<div className="settings-item">\n          <span className="settings-label">Capture API</span>')) {
    violations.push('components/SettingsModal/AudioSettingsTab.tsx: capture API controls are not in a settings-item row');
  }

  for (const file of settingsFiles) {
    const rel = toPosix(relative(sourceRoot, file));
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!line.includes('type="checkbox"')) return;

      const precedingMarkup = lines.slice(Math.max(0, index - 3), index).join('\n');
      if (!precedingMarkup.includes('className="brmble-toggle"')) {
        violations.push(`${rel}:${index + 1}: checkbox input is not using label.brmble-toggle`);
      }
    });
  }

  return violations;
}

function findFocusedCssTokenViolations(): string[] {
  const timingPattern = /(?:transition|animation):[^;]*(?:\d+(?:\.\d+)?m?s)\b|animation-duration:\s*\d+(?:\.\d+)?m?s\b|font-size:\s*(?:\d+(?:\.\d+)?px|\d+(?:\.\d+)?em|\d+(?:\.\d+)?rem)\b|font-family:\s*var\([^;]+,[^)]+\)|(?:^|\s)(?:padding|gap|margin-top|margin-bottom|bottom|top|right):\s*(?:\d+(?:\.\d+)?px|\d+(?:\.\d+)?rem)\b|border-radius:\s*(?:\d+(?:\.\d+)?px\b|[^;]*\d+(?:\.\d+)?px)|box-shadow:[^;]*\d+(?:\.\d+)?px|filter:\s*drop-shadow\([^)]*\d+(?:\.\d+)?px|backdrop-filter:\s*blur\(\d+(?:\.\d+)?px\)/g;
  return findViolations(timingPattern, [], focusedCssTokenFiles);
}

function findTextInputClassViolations(): string[] {
  const violations: string[] = [];
  const inputPattern = /<(input|textarea)\b[\s\S]*?>/g;

  for (const file of componentFilesToScan) {
    const rel = toPosix(relative(sourceRoot, file));
    if (textInputClassAllowList.includes(rel)) continue;

    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(inputPattern)) {
      const tag = match[0];
      if (tag.includes('type="file"') || tag.includes('type="range"') || tag.includes('type="checkbox"')) continue;
      if (!/\b(brmble-input)\b/.test(tag)) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${rel}:${line}: text input is not using brmble-input`);
      }
    }
  }

  return violations;
}

function findHeadingTierViolations(): string[] {
  const violations: string[] = [];
  const headingPattern = /<h([2-5])\b[^>]*className="([^"]*)"/g;

  for (const file of componentFilesToScan) {
    const rel = toPosix(relative(sourceRoot, file));
    const content = readFileSync(file, 'utf8');

    for (const match of content.matchAll(headingPattern)) {
      const [, level, className] = match;
      const expected = level === '2' ? 'heading-title' : level === '3' ? 'heading-section' : level === '4' ? 'heading-label' : null;
      const hasHeadingClass = /\bheading-(title|section|label)\b/.test(className);
      if ((expected && hasHeadingClass && !className.includes(expected)) || (!expected && hasHeadingClass)) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${rel}:${line}: h${level} uses incorrect heading tier class`);
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
    expect(findViolations(/<[^>]+\stitle=("[^"]+"|\{[^}]+\})/g, titleAttributeAllowList)).toEqual([]);
  });

  test('forms use shared Select instead of native select elements', () => {
    expect(findNativeSelectViolations()).toEqual([]);
  });

  test('toast components are not present or referenced', () => {
    expect(findToastArtifacts()).toEqual([]);
  });

  test('settings tabs use shared settings row and help patterns', () => {
    expect(findSettingsPatternViolations()).toEqual([]);
  });

  test('focused component css uses tokens for static visual values', () => {
    expect(findFocusedCssTokenViolations()).toEqual([]);
  });

  test('text-style form fields use brmble-input outside chat surfaces', () => {
    expect(findTextInputClassViolations()).toEqual([]);
  });

  test('heading classes match the documented heading tiers', () => {
    expect(findHeadingTierViolations()).toEqual([]);
  });
});
