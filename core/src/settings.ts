import { z } from 'zod';
import { getSetting, setSetting } from './db.js';

/**
 * Runtime settings that users change from the UI. They live in the database
 * rather than config.json so the gateway configuration stays a small, stable
 * file that can be edited by hand.
 */
export const DEFAULT_SETTINGS = {
  auto_switch: {
    enabled: false,
    remaining_threshold: 0,
    interval_seconds: 60,
    allow_refresh: true,
    target: 'codex' as 'cli' | 'codex',
  },
  notifications: {
    auto_switch: true,
    low_quota: true,
    account_errors: true,
    low_quota_threshold: 10,
  },
};

export const SettingsSchema = z.object({
  auto_switch: z
    .object({
      enabled: z.boolean().default(DEFAULT_SETTINGS.auto_switch.enabled),
      remaining_threshold: z
        .number()
        .int()
        .min(0)
        .max(50)
        .default(DEFAULT_SETTINGS.auto_switch.remaining_threshold),
      interval_seconds: z
        .number()
        .int()
        .min(60)
        .max(3600)
        .default(DEFAULT_SETTINGS.auto_switch.interval_seconds),
      allow_refresh: z.boolean().default(DEFAULT_SETTINGS.auto_switch.allow_refresh),
      target: z.enum(['cli', 'codex']).default(DEFAULT_SETTINGS.auto_switch.target),
    })
    .default(DEFAULT_SETTINGS.auto_switch),
  notifications: z
    .object({
      auto_switch: z.boolean().default(DEFAULT_SETTINGS.notifications.auto_switch),
      low_quota: z.boolean().default(DEFAULT_SETTINGS.notifications.low_quota),
      account_errors: z.boolean().default(DEFAULT_SETTINGS.notifications.account_errors),
      low_quota_threshold: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(DEFAULT_SETTINGS.notifications.low_quota_threshold),
    })
    .default(DEFAULT_SETTINGS.notifications),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z.object({
  auto_switch: z
    .object({
      enabled: z.boolean().optional(),
      remaining_threshold: z.number().int().min(0).max(50).optional(),
      interval_seconds: z.number().int().min(60).max(3600).optional(),
      allow_refresh: z.boolean().optional(),
      target: z.enum(['cli', 'codex']).optional(),
    })
    .optional(),
  notifications: z
    .object({
      auto_switch: z.boolean().optional(),
      low_quota: z.boolean().optional(),
      account_errors: z.boolean().optional(),
      low_quota_threshold: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
});

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

const SETTINGS_KEY = 'app_settings_v1';

export function loadSettings(): AppSettings {
  return SettingsSchema.parse(getSetting<unknown>(SETTINGS_KEY, {}));
}

export function saveSettings(settings: AppSettings): AppSettings {
  const validated = SettingsSchema.parse(settings);
  setSetting(SETTINGS_KEY, validated);
  return validated;
}

export function updateSettings(patch: SettingsPatch): AppSettings {
  const current = loadSettings();
  return saveSettings({
    auto_switch: { ...current.auto_switch, ...(patch.auto_switch ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
  });
}
