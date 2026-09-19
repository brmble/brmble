import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The realtime connection is game-agnostic: nothing in this folder may import from
 * a game's folder or name the arena. A second realtime game trips over every such
 * leak, so the boundary is pinned by reading the source.
 */
describe('realtime boundary', () => {
  it('imports nothing from a game folder and names no game', () => {
    const folder = join(process.cwd(), 'src', 'components', 'Games', 'Realtime');
    const leaks = readdirSync(folder)
      .filter(name => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
      .flatMap(name => readFileSync(join(folder, name), 'utf8').split('\n')
        .map((line, index) => ({ name, line, number: index + 1 }))
        .filter(({ line }) => /from '\.\.\/(Arena|Rps|Deathroll)/.test(line) || /\bArena\b/.test(line)))
      .map(({ name, number, line }) => `${name}:${number}: ${line.trim()}`);
    expect(leaks).toEqual([]);
  });
});
