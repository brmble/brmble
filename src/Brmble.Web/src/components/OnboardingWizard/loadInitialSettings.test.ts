import { describe, it, expect, beforeEach } from 'vitest';
import { loadInitialSettings } from './OnboardingWizard';

describe('loadInitialSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('prefers the applied data-theme over stale localStorage (#476)', () => {
    document.documentElement.setAttribute('data-theme', 'midnight');
    localStorage.setItem('brmble-settings', JSON.stringify({ appearance: { theme: 'classic' } }));

    expect(loadInitialSettings().theme).toBe('midnight');
  });

  it('uses the applied data-theme when localStorage is empty', () => {
    document.documentElement.setAttribute('data-theme', 'retro-terminal');

    expect(loadInitialSettings().theme).toBe('retro-terminal');
  });

  it('falls back to localStorage theme when no data-theme is applied', () => {
    localStorage.setItem('brmble-settings', JSON.stringify({ appearance: { theme: 'blue-lagoon' } }));

    expect(loadInitialSettings().theme).toBe('blue-lagoon');
  });

  it('defaults to classic when nothing is stored or applied', () => {
    expect(loadInitialSettings().theme).toBe('classic');
  });
});
