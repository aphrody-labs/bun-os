/**
 * Frontend Constants
 *
 * Centralized configuration and constants for the frontend application.
 * Eliminates hardcoded values throughout the codebase.
 */

// ==================== Application Config ====================

export const APP_CONFIG = {
  APP_NAME: 'Bun OS WSL',
  APP_DESCRIPTION: 'Manage your Linux distributions',
  REFRESH_INTERVAL_MS: 5000,
  DEBOUNCE_DELAY_MS: 300,
  TOAST_DURATION_MS: 3000,
} as const;

// ==================== Animation Timings ====================

export const ANIMATION_DELAYS = {
  STAGGER_MS: 50,
  TRANSITION_MS: 150,
  LONG_TRANSITION_MS: 300,
} as const;

// ==================== Default Settings ====================

export const DEFAULT_SETTINGS = {
  WSL_VERSION: 2 as const,
  MEMORY: '4GB',
  PROCESSORS: 4,
  SWAP: '8GB',
  LOCALHOST_FORWARDING: true,
  GUI_APPLICATIONS: true,
  NESTED_VIRTUALIZATION: false,
  DEBUG_CONSOLE: false,
  AUTO_MEMORY_RECLAIM: 'gradual',
  NETWORKING_MODE: 'NAT',
} as const;
