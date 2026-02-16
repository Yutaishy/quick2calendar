const oauthConfigStatus = document.getElementById("oauthConfigStatus");
const connectGoogleButton = document.getElementById("connectGoogleButton");
const disconnectGoogleButton = document.getElementById("disconnectGoogleButton");
const googleStatus = document.getElementById("googleStatus");
const shortcutCaptureInput = document.getElementById("shortcutCaptureInput");
const recordShortcutButton = document.getElementById("recordShortcutButton");
const resetShortcutButton = document.getElementById("resetShortcutButton");
const shortcutStatus = document.getElementById("shortcutStatus");

const geminiApiKey = document.getElementById("geminiApiKey");
const modelPreset = document.getElementById("modelPreset");
const modelCustomWrap = document.getElementById("modelCustomWrap");
const modelCustom = document.getElementById("modelCustom");
const saveGeminiKeyButton = document.getElementById("saveGeminiKeyButton");
const geminiStatus = document.getElementById("geminiStatus");

const geminiInstruction = document.getElementById("geminiInstruction");

const saveSettingsButton = document.getElementById("saveSettingsButton");
const saveStatus = document.getElementById("saveStatus");
const logPathStatus = document.getElementById("logPathStatus");
const reloadLogsButton = document.getElementById("reloadLogsButton");
const openLogFileButton = document.getElementById("openLogFileButton");
const recentLogs = document.getElementById("recentLogs");

const DEFAULT_SHORTCUT = "CommandOrControl+Shift+G";
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MODIFIER_ONLY_KEYS = new Set([
  "Shift",
  "Control",
  "Meta",
  "Alt",
  "AltGraph"
]);
const ALLOWED_PRINTABLE_KEYS = new Set([
  ",",
  ".",
  "/",
  ";",
  "'",
  "[",
  "]",
  "\\",
  "-",
  "=",
  "`"
]);
const CODE_TO_ACCELERATOR_KEY = {
  Space: "Space",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/"
};
const DISPLAY_TOKEN_MAP_MAC = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Return: "↩",
  Escape: "⎋",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Space: "Space"
};
const DISPLAY_TOKEN_MAP_DEFAULT = {
  CommandOrControl: "Ctrl",
  Command: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Return: "Enter",
  Escape: "Esc",
  Space: "Space"
};

const MODEL_PRESET_OPTIONS = [
  { value: "gemini-3-flash-preview", label: "Gemini 3.0 Flash（Preview）" },
  { value: "gemini-3-pro-preview", label: "Gemini 3.0 Pro（Preview）" },
  { value: "gemini-2.0-flash", label: "gemini-2.0-flash（推奨）" },
  { value: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
  { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
  { value: "gemini-1.5-flash", label: "gemini-1.5-flash" },
  { value: "gemini-1.5-flash-8b", label: "gemini-1.5-flash-8b" },
  { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
  { value: "gemini-2.0-flash-thinking-exp", label: "gemini-2.0-flash-thinking-exp" }
];
const MODEL_CUSTOM_VALUE = "__custom__";
const DEFAULT_MODEL_PRESET = "gemini-2.0-flash";

let currentSettings = null;
let googleConnectInProgress = false;
let shortcutCaptureInProgress = false;
let activeShortcut = DEFAULT_SHORTCUT;
const connectGoogleButtonLabel = connectGoogleButton.textContent;
const recordShortcutButtonLabel = recordShortcutButton.textContent;

function markStatus(message, tone = "default") {
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
}

function formatShortcutForDisplay(shortcut) {
  const tokens = String(shortcut || "")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return "未設定";
  }

  const tokenMap = IS_MAC ? DISPLAY_TOKEN_MAP_MAC : DISPLAY_TOKEN_MAP_DEFAULT;
  const formatted = tokens.map((token) => tokenMap[token] || token.toUpperCase());
  return IS_MAC ? formatted.join(" ") : formatted.join(" + ");
}

function setShortcutDisplay(shortcut) {
  const value = String(shortcut || "").trim() || DEFAULT_SHORTCUT;
  const formatted = formatShortcutForDisplay(value);
  activeShortcut = value;
  shortcutCaptureInput.value = formatted;
  shortcutCaptureInput.title = value;
  shortcutCaptureInput.dataset.accelerator = value;
  shortcutStatus.textContent = `現在: ${formatted}`;
  shortcutStatus.dataset.tone = "default";
}

function stopShortcutCapture(cancelled = false) {
  if (!shortcutCaptureInProgress) {
    return;
  }

  shortcutCaptureInProgress = false;
  recordShortcutButton.textContent = recordShortcutButtonLabel;
  recordShortcutButton.dataset.recording = "false";
  if (cancelled) {
    setShortcutDisplay(activeShortcut);
  }
}

function startShortcutCapture() {
  if (shortcutCaptureInProgress) {
    return;
  }

  shortcutCaptureInProgress = true;
  recordShortcutButton.textContent = "入力待機中...";
  recordShortcutButton.dataset.recording = "true";
  shortcutCaptureInput.value = "キー入力を待機中...";
  shortcutCaptureInput.focus({ preventScroll: true });
  markStatus(
    "登録したいショートカットを押してください（Escでキャンセル）",
    "warn"
  );
}

function resolveAcceleratorKey(event) {
  const code = String(event?.code || "");
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }

  if (CODE_TO_ACCELERATOR_KEY[code]) {
    return CODE_TO_ACCELERATOR_KEY[code];
  }

  const key = String(event?.key || "");
  if (!key) {
    return "";
  }

  const specialKeyMap = {
    Enter: "Return",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    " ": "Space"
  };
  if (specialKeyMap[key]) {
    return specialKeyMap[key];
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
    return key.toUpperCase();
  }

  if (MODIFIER_ONLY_KEYS.has(key)) {
    return "";
  }

  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }

  if (/^[0-9]$/.test(key)) {
    return key;
  }

  if (ALLOWED_PRINTABLE_KEYS.has(key)) {
    return key;
  }

  return "";
}

function buildShortcutFromKeydown(event) {
  const key = resolveAcceleratorKey(event);
  if (!key) {
    return {
      ok: false,
      message: "修飾キー以外のキーも押してください。"
    };
  }

  const modifiers = [];
  if (event.metaKey || event.ctrlKey) {
    modifiers.push("CommandOrControl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey;
  if (!hasPrimaryModifier) {
    return {
      ok: false,
      message:
        "ショートカットには Command / Control / Option のいずれかを含めてください。"
    };
  }

  return {
    ok: true,
    accelerator: [...modifiers, key].join("+")
  };
}

async function saveShortcut(shortcut) {
  const result = await window.settingsApi.saveSettings({
    shortcut: String(shortcut || "").trim()
  });
  currentSettings = result;
  setShortcutDisplay(result?.shortcut || DEFAULT_SHORTCUT);
}

function renderModelPresetOptions() {
  modelPreset.innerHTML = "";

  const fragment = document.createDocumentFragment();
  MODEL_PRESET_OPTIONS.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    fragment.appendChild(option);
  });

  const customOption = document.createElement("option");
  customOption.value = MODEL_CUSTOM_VALUE;
  customOption.textContent = "カスタム入力";
  fragment.appendChild(customOption);

  modelPreset.appendChild(fragment);
}

function updateModelCustomVisibility() {
  const isCustom = modelPreset.value === MODEL_CUSTOM_VALUE;
  modelCustomWrap.hidden = !isCustom;
}

function syncModelFields(modelValue) {
  const value = String(modelValue || "").trim();
  if (!value) {
    modelPreset.value = DEFAULT_MODEL_PRESET;
    modelCustom.value = "";
    updateModelCustomVisibility();
    return;
  }

  const hasPreset = Array.from(modelPreset.options).some(
    (option) => option.value === value
  );

  if (hasPreset) {
    modelPreset.value = value;
    modelCustom.value = "";
  } else {
    modelPreset.value = MODEL_CUSTOM_VALUE;
    modelCustom.value = value;
  }

  updateModelCustomVisibility();
}

function getSelectedModel() {
  if (modelPreset.value === MODEL_CUSTOM_VALUE) {
    return modelCustom.value.trim();
  }
  return modelPreset.value;
}

function deriveInstructionText(settings) {
  if (typeof settings?.geminiInstruction === "string") {
    return settings.geminiInstruction;
  }

  const presets = Array.isArray(settings?.customInstructionPresets)
    ? settings.customInstructionPresets
    : [];
  const active = presets.find(
    (preset) => preset.id === settings?.activeInstructionPresetId
  );
  return String(active?.text || "");
}

function formatLogEntry(entry) {
  const timestamp = entry?.timestamp || "-";
  const level = String(entry?.level || "info").toUpperCase();
  const event = String(entry?.event || "unknown");
  const data = JSON.stringify(entry?.data || {}, null, 0);
  return `[${timestamp}] ${level} ${event} ${data}`;
}

async function refreshLogs() {
  const [pathResult, logsResult] = await Promise.all([
    window.settingsApi.getLogPath(),
    window.settingsApi.getRecentLogs(200)
  ]);

  const path = String(pathResult?.path || logsResult?.path || "");
  if (path) {
    logPathStatus.textContent = `ログファイル: ${path}`;
    logPathStatus.dataset.tone = "default";
  } else {
    logPathStatus.textContent = "ログファイル: パス取得失敗";
    logPathStatus.dataset.tone = "error";
  }

  const entries = Array.isArray(logsResult?.entries) ? logsResult.entries : [];
  const lines = entries
    .slice()
    .reverse()
    .map((entry) => formatLogEntry(entry));
  recentLogs.value = lines.join("\n");
}

function buildInstructionPreset(text) {
  return [
    {
      id: "default",
      name: "カスタム指示",
      text
    }
  ];
}

function collectPatch() {
  const instruction = geminiInstruction.value.trim();

  return {
    calendarId: "primary",
    model: getSelectedModel(),
    aiEnabled: true,
    inputMode: "ai",
    launchAtLogin: false,
    askPolicy: "uncertain_only",
    confirmationPolicy: "uncertain_only",
    geminiInstruction: instruction,
    timeResolutionRulesText: "",
    customInstructionPresets: buildInstructionPreset(instruction),
    activeInstructionPresetId: "default"
  };
}

async function refreshSecretStatus() {
  const secrets = await window.settingsApi.getSecretStatus();
  geminiStatus.textContent = secrets.hasGeminiApiKey
    ? "状態: APIキー設定済み"
    : "状態: APIキー未設定";
  googleStatus.textContent = secrets.hasGoogleTokens
    ? "状態: Google接続済み"
    : "状態: Google未接続";
}

async function refreshOAuthStatus() {
  const oauth = await window.settingsApi.getOAuthStatus();
  if (oauth.configured) {
    const sourceLabel =
      String(oauth.source || "").startsWith("file:") ? "bundled" : oauth.source;
    oauthConfigStatus.textContent = `OAuth設定: ${sourceLabel} (${oauth.redirectUri})`;
    oauthConfigStatus.dataset.tone = "success";
    connectGoogleButton.disabled = googleConnectInProgress;
  } else {
    oauthConfigStatus.textContent =
      "OAuth設定: 未構成（配布版には内蔵されます）";
    oauthConfigStatus.dataset.tone = "error";
    connectGoogleButton.disabled = true;
  }
}

async function loadSettings() {
  currentSettings = await window.settingsApi.getSettings();

  setShortcutDisplay(currentSettings.shortcut || DEFAULT_SHORTCUT);
  syncModelFields(currentSettings.model || "");
  geminiInstruction.value = deriveInstructionText(currentSettings);

  await refreshOAuthStatus();
  await refreshSecretStatus();
  await refreshLogs();
  markStatus("設定を読み込みました", "success");
}

recordShortcutButton.addEventListener("click", () => {
  if (shortcutCaptureInProgress) {
    stopShortcutCapture(true);
    markStatus("ショートカット登録をキャンセルしました", "warn");
    return;
  }
  startShortcutCapture();
});

resetShortcutButton.addEventListener("click", async () => {
  try {
    stopShortcutCapture(false);
    await saveShortcut(DEFAULT_SHORTCUT);
    markStatus("ショートカットを既定値に戻しました", "success");
  } catch (error) {
    markStatus(`ショートカット更新失敗: ${error.message || error}`, "error");
  }
});

shortcutCaptureInput.addEventListener("keydown", async (event) => {
  if (!shortcutCaptureInProgress) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startShortcutCapture();
    }
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    stopShortcutCapture(true);
    markStatus("ショートカット登録をキャンセルしました", "warn");
    return;
  }

  const candidate = buildShortcutFromKeydown(event);
  if (!candidate.ok) {
    markStatus(candidate.message, "warn");
    return;
  }

  try {
    stopShortcutCapture(false);
    await saveShortcut(candidate.accelerator);
    markStatus(
      `ショートカットを更新しました: ${formatShortcutForDisplay(activeShortcut)}`,
      "success"
    );
  } catch (error) {
    stopShortcutCapture(true);
    markStatus(`ショートカット更新失敗: ${error.message || error}`, "error");
  }
});

saveGeminiKeyButton.addEventListener("click", async () => {
  try {
    await window.settingsApi.setGeminiApiKey(geminiApiKey.value.trim());
    geminiApiKey.value = "";
    await refreshSecretStatus();
    markStatus("Gemini APIキーを保存しました", "success");
  } catch (error) {
    markStatus(`APIキー保存失敗: ${error.message || error}`, "error");
  }
});

connectGoogleButton.addEventListener("click", async () => {
  if (googleConnectInProgress) {
    return;
  }

  googleConnectInProgress = true;
  connectGoogleButton.disabled = true;
  disconnectGoogleButton.disabled = true;
  connectGoogleButton.textContent = "認証中...";

  try {
    markStatus("ブラウザでGoogle認証を進めてください...", "default");
    await window.settingsApi.saveSettings(collectPatch());
    await window.settingsApi.connectGoogle();
    await refreshSecretStatus();
    markStatus("Google連携が完了しました", "success");
  } catch (error) {
    markStatus(`Google接続失敗: ${error.message || error}`, "error");
  } finally {
    googleConnectInProgress = false;
    disconnectGoogleButton.disabled = false;
    connectGoogleButton.textContent = connectGoogleButtonLabel;
    await refreshOAuthStatus();
  }
});

disconnectGoogleButton.addEventListener("click", async () => {
  try {
    const result = await window.settingsApi.disconnectGoogle();
    await refreshSecretStatus();
    if (result?.revokeResult?.errors?.length) {
      markStatus(
        "Google連携を解除しました（トークン失効は一部失敗。後でGoogle側のアクセス権確認を推奨）",
        "warn"
      );
    } else {
      markStatus("Google連携を解除しました", "success");
    }
  } catch (error) {
    markStatus(`接続解除失敗: ${error.message || error}`, "error");
  }
});

reloadLogsButton.addEventListener("click", async () => {
  try {
    await refreshLogs();
    markStatus("診断ログを更新しました", "success");
  } catch (error) {
    markStatus(`ログ更新失敗: ${error.message || error}`, "error");
  }
});

openLogFileButton.addEventListener("click", async () => {
  try {
    const result = await window.settingsApi.openLogFile();
    if (!result?.ok) {
      throw new Error(result?.message || "ログファイルを開けませんでした");
    }
    markStatus("ログファイルを開きました", "success");
  } catch (error) {
    markStatus(`ログファイルを開けません: ${error.message || error}`, "error");
  }
});

saveSettingsButton.addEventListener("click", async () => {
  try {
    currentSettings = await window.settingsApi.saveSettings(collectPatch());
    syncModelFields(currentSettings.model || "");
    geminiInstruction.value = deriveInstructionText(currentSettings);
    markStatus("設定を保存しました", "success");
  } catch (error) {
    markStatus(`設定保存失敗: ${error.message || error}`, "error");
  }
});

modelPreset.addEventListener("change", () => {
  updateModelCustomVisibility();
  markStatus("未保存の変更があります", "warn");
});

modelCustom.addEventListener("input", () => {
  markStatus("未保存の変更があります", "warn");
});

geminiInstruction.addEventListener("input", () => {
  markStatus("未保存の変更があります", "warn");
});

renderModelPresetOptions();

loadSettings().catch((error) => {
  markStatus(`設定読み込み失敗: ${error.message || error}`, "error");
});
