import { describe, expect, it } from 'vitest';
import { normalizeCompanionId, normalizeOverlaySettings, DEFAULT_OVERLAY } from './InterfaceSettingsTypes';

describe('InterfaceSettingsTypes', () => {
  describe('normalizeCompanionId', () => {
    it('returns valid companion IDs unchanged', () => {
      expect(normalizeCompanionId('bee')).toBe('bee');
      expect(normalizeCompanionId('engineer')).toBe('engineer');
      expect(normalizeCompanionId('floppy')).toBe('floppy');
      expect(normalizeCompanionId('patch')).toBe('patch');
      expect(normalizeCompanionId('pip')).toBe('pip');
      expect(normalizeCompanionId('retro')).toBe('retro');
    });

    it('migrates legacy companion ID "clip" to "floppy"', () => {
      expect(normalizeCompanionId('clip')).toBe('floppy');
    });

    it('handles invalid string values by returning "floppy"', () => {
      expect(normalizeCompanionId('invalid')).toBe('floppy');
      expect(normalizeCompanionId('unknown')).toBe('floppy');
      expect(normalizeCompanionId('')).toBe('floppy');
    });

    it('handles non-string values by returning "floppy"', () => {
      expect(normalizeCompanionId(null)).toBe('floppy');
      expect(normalizeCompanionId(undefined)).toBe('floppy');
      expect(normalizeCompanionId(123)).toBe('floppy');
      expect(normalizeCompanionId({})).toBe('floppy');
      expect(normalizeCompanionId([])).toBe('floppy');
    });
  });

  describe('normalizeOverlaySettings', () => {
    it('normalizes settings with legacy companion ID', () => {
      const result = normalizeOverlaySettings({
        myCompanion: 'clip' as any,
        overlayEnabled: true,
      });

      expect(result.myCompanion).toBe('floppy');
      expect(result.overlayEnabled).toBe(true);
      // Should merge with defaults for missing properties
      expect(result.mode).toBe(DEFAULT_OVERLAY.mode);
      expect(result.position).toBe(DEFAULT_OVERLAY.position);
    });

    it('preserves valid companion ID', () => {
      const result = normalizeOverlaySettings({
        myCompanion: 'engineer',
      });

      expect(result.myCompanion).toBe('engineer');
    });

    it('returns complete settings when given empty object', () => {
      const result = normalizeOverlaySettings({});

      expect(result).toEqual(DEFAULT_OVERLAY);
    });

    it('merges partial settings with defaults', () => {
      const result = normalizeOverlaySettings({
        overlayEnabled: true,
        showChannelMessages: false,
      });

      expect(result).toEqual({
        ...DEFAULT_OVERLAY,
        overlayEnabled: true,
        showChannelMessages: false,
      });
    });

    it('handles invalid companion ID in partial settings', () => {
      const result = normalizeOverlaySettings({
        myCompanion: 'invalid' as any,
        mode: 'full',
      });

      expect(result.myCompanion).toBe('floppy');
      expect(result.mode).toBe('full');
    });
  });
});
