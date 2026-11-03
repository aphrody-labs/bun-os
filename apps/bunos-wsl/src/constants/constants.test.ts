import { describe, it, expect } from 'vitest';
import {
  APP_CONFIG,
  ANIMATION_DELAYS,
  DEFAULT_SETTINGS,
} from './index';

describe('constants', () => {
  describe('APP_CONFIG', () => {
    it('has app name', () => {
      expect(APP_CONFIG.APP_NAME).toBe('Bun OS WSL');
    });

    it('has refresh interval', () => {
      expect(APP_CONFIG.REFRESH_INTERVAL_MS).toBeGreaterThan(0);
    });
  });

  describe('ANIMATION_DELAYS', () => {
    it('has stagger delay', () => {
      expect(ANIMATION_DELAYS.STAGGER_MS).toBeGreaterThan(0);
    });
  });

  describe('DEFAULT_SETTINGS', () => {
    it('has WSL version default', () => {
      expect(DEFAULT_SETTINGS.WSL_VERSION).toBe(2);
    });

    it('has memory default', () => {
      expect(DEFAULT_SETTINGS.MEMORY).toBe('4GB');
    });
  });
});





