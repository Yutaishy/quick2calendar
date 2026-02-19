import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_INSTRUCTION_PRESETS,
  DEFAULT_SETTINGS,
  MAX_HISTORY_ITEMS,
  SETTINGS_FILE_NAME
} from "./constants.js";

const APP_SUPPORT_DIR_NAME = "Quick2Calendar";

function getSettingsDirectory() {
  return path.join(app.getPath("appData"), APP_SUPPORT_DIR_NAME);
}

function getSettingsPath() {
  return path.join(getSettingsDirectory(), SETTINGS_FILE_NAME);
}

function sanitizePreset(preset, fallbackId) {
  return {
    id: String(preset?.id || fallbackId),
    name: String(preset?.name || "名称未設定"),
    text: String(preset?.text || "")
  };
}

function mergeWithDefaults(rawSettings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...rawSettings
  };

  const sourcePresets = Array.isArray(rawSettings.customInstructionPresets)
    ? rawSettings.customInstructionPresets
    : DEFAULT_INSTRUCTION_PRESETS;

  const uniquePresets = [];
  const seenIds = new Set();

  sourcePresets.forEach((preset, index) => {
    const sanitized = sanitizePreset(preset, `preset-${index + 1}`);
    if (seenIds.has(sanitized.id)) {
      return;
    }
    seenIds.add(sanitized.id);
    uniquePresets.push(sanitized);
  });

  merged.customInstructionPresets =
    uniquePresets.length > 0 ? uniquePresets : DEFAULT_INSTRUCTION_PRESETS;

  const activeExists = merged.customInstructionPresets.some(
    (preset) => preset.id === merged.activeInstructionPresetId
  );
  if (!activeExists) {
    merged.activeInstructionPresetId = merged.customInstructionPresets[0].id;
  }

  if (typeof merged.geminiInstruction !== "string" || !merged.geminiInstruction.trim()) {
    const activePreset = merged.customInstructionPresets.find(
      (preset) => preset.id === merged.activeInstructionPresetId
    );
    merged.geminiInstruction = String(
      activePreset?.text || rawSettings.timeResolutionRulesText || ""
    );
  }

  if (!Array.isArray(merged.history)) {
    merged.history = [];
  }
  merged.history = merged.history.slice(0, MAX_HISTORY_ITEMS);

  merged.defaultDurationMinutes = Number(merged.defaultDurationMinutes) || 60;
  merged.shortcut = String(merged.shortcut || DEFAULT_SETTINGS.shortcut);
  merged.inputMode = "ai";
  merged.aiEnabled = true;
  merged.launchAtLogin = Boolean(merged.launchAtLogin);
  merged.calendarId = String(merged.calendarId || "primary");
  merged.model = String(merged.model || DEFAULT_SETTINGS.model);
  delete merged.oauthClientId;
  delete merged.oauthClientSecret;
  delete merged.oauthRedirectUri;

  return merged;
}

export async function ensureSettingsFile() {
  const directory = getSettingsDirectory();
  const settingsPath = getSettingsPath();

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.access(settingsPath);
  } catch {
    await fs.writeFile(
      settingsPath,
      JSON.stringify(DEFAULT_SETTINGS, null, 2),
      "utf-8"
    );
  }

  return settingsPath;
}

export async function getSettings() {
  const settingsPath = await ensureSettingsFile();
  const raw = await fs.readFile(settingsPath, "utf-8");

  try {
    const parsed = JSON.parse(raw);
    const normalized = mergeWithDefaults(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await fs.writeFile(settingsPath, JSON.stringify(normalized, null, 2), "utf-8");
    }

    return normalized;
  } catch {
    const fallback = mergeWithDefaults();
    await fs.writeFile(settingsPath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

export async function saveSettings(nextSettings) {
  const settingsPath = await ensureSettingsFile();
  const normalized = mergeWithDefaults(nextSettings);
  await fs.writeFile(settingsPath, JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch
  };

  return saveSettings(next);
}

export async function appendHistory(entry) {
  const current = await getSettings();
  const history = [entry, ...current.history].slice(0, MAX_HISTORY_ITEMS);
  return saveSettings({
    ...current,
    history
  });
}

export function getSettingsFilePath() {
  return getSettingsPath();
}
