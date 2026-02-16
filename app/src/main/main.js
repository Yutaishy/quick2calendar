import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  shell,
  Tray,
  nativeImage,
  screen
} from "electron";
import { SchedulerService } from "./scheduler-service.js";
import { DEFAULT_SHORTCUT } from "./constants.js";
import { revokeGoogleTokens, startGoogleOAuthFlow } from "./google-auth.js";
import { getOAuthClientConfigStatus } from "./oauth-config.js";
import {
  clearGoogleTokens,
  getGoogleTokens,
  getSecretStatus,
  setGeminiApiKey,
  setGoogleTokens
} from "./secure-store.js";
import {
  ensureSettingsFile,
  getSettings,
  updateSettings
} from "./settings-store.js";
import { appendLog, getLogFilePath, readRecentLogs } from "./app-logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let quickWindow = null;
let settingsWindow = null;
let tray = null;
let registeredShortcut = "";
let isQuitting = false;
let googleOAuthInProgress = false;
let allowQuickWindowHide = false;
let quickWindowExpanded = false;
let quickWindowImeComposing = false;
let quickWindowFocusRetryTimers = [];
let quickShortcutAwaitRelease = false;
let quickShortcutReleaseTimer = null;

const QUICK_WINDOW_WIDTH = 700;
const QUICK_WINDOW_COLLAPSED_HEIGHT = 52; // 高さを減らす
const QUICK_WINDOW_EXPANDED_HEIGHT = 400;
const QUICK_WINDOW_PIN_LEVEL_DEFAULT = "screen-saver";
const QUICK_WINDOW_PIN_LEVEL_IME = "floating";
const QUICK_SHORTCUT_RELEASE_GUARD_MS = 220;

const schedulerService = new SchedulerService();

function buildTrayIcon() {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAW0lEQVR4AWP4DwQMWAThP4QxMjAwkI2NjY1BvP///w8GJgYGBm4mBiYGBv7//x8lI6P8/3+gmYGBwYb8////FwYGBjYqKioeJxcXF4jMTEzEDAwMDAwAACjVDqvJsteUAAAAAElFTkSuQmCC";
  return nativeImage.createFromDataURL(`data:image/png;base64,${base64}`);
}

function showNotification(title, body) {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({ title, body });
  notification.show();
}

function getQuickWindowBounds(display, options = {}) {
  const width = QUICK_WINDOW_WIDTH;
  const height = options.expanded
    ? QUICK_WINDOW_EXPANDED_HEIGHT
    : QUICK_WINDOW_COLLAPSED_HEIGHT;
  
  // 画面中央（水平）、垂直方向は上から1/4あたり（Spotlight/ChatGPT風）
  const x = Math.round(display.bounds.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.bounds.y + (display.workArea.height * 0.2)); 

  return { x, y, width, height };
}

function positionQuickWindowOnCursorDisplay() {
  if (!quickWindow) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const bounds = getQuickWindowBounds(targetDisplay, {
    expanded: quickWindowExpanded
  });
  quickWindow.setBounds(bounds);
}

function setQuickWindowExpanded(expanded) {
  if (!quickWindow || quickWindow.isDestroyed()) {
    return;
  }

  const nextExpanded = Boolean(expanded);
  const targetHeight = nextExpanded
    ? QUICK_WINDOW_EXPANDED_HEIGHT
    : QUICK_WINDOW_COLLAPSED_HEIGHT;
  const targetWidth = QUICK_WINDOW_WIDTH;
  const currentBounds = quickWindow.getBounds();

  if (
    quickWindowExpanded === nextExpanded &&
    currentBounds.width === targetWidth &&
    currentBounds.height === targetHeight
  ) {
    return;
  }

  quickWindowExpanded = nextExpanded;
  const display = screen.getDisplayMatching(currentBounds);
  const workArea = display.workArea;
  const maxX = workArea.x + workArea.width - targetWidth;
  const maxY = workArea.y + workArea.height - targetHeight;
  const x = Math.min(Math.max(currentBounds.x, workArea.x), Math.max(workArea.x, maxX));
  const y = Math.min(Math.max(currentBounds.y, workArea.y), Math.max(workArea.y, maxY));

  quickWindow.setBounds({
    x,
    y,
    width: targetWidth,
    height: targetHeight
  });
  pinQuickWindowOnTop();
}

function pinQuickWindowOnTop() {
  if (!quickWindow || quickWindow.isDestroyed()) {
    return;
  }
  if (!quickWindow.isVisible()) {
    return;
  }

  const pinLevel = quickWindowImeComposing
    ? QUICK_WINDOW_PIN_LEVEL_IME
    : QUICK_WINDOW_PIN_LEVEL_DEFAULT;
  quickWindow.setAlwaysOnTop(true, pinLevel, 1);
  quickWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  quickWindow.moveTop();
}

function setQuickWindowImeComposing(active) {
  quickWindowImeComposing = Boolean(active);
  pinQuickWindowOnTop();
}

function focusQuickWindowInput() {
  if (!quickWindow || quickWindow.isDestroyed()) {
    return;
  }
  if (!quickWindow.isVisible()) {
    return;
  }

  // app.focus({ steal: true }) はSpace遷移を引き起こす可能性があるため削除
  // app.focus({ steal: true });
  
  pinQuickWindowOnTop();
  quickWindow.focus();
  quickWindow.webContents.focus();
  quickWindow.webContents.send("quick:focus");
}

function clearQuickWindowFocusRetries() {
  for (const timer of quickWindowFocusRetryTimers) {
    clearTimeout(timer);
  }
  quickWindowFocusRetryTimers = [];
}

function clearQuickShortcutReleaseTimer() {
  if (quickShortcutReleaseTimer) {
    clearTimeout(quickShortcutReleaseTimer);
    quickShortcutReleaseTimer = null;
  }
}

function startQuickShortcutReleaseGuard() {
  clearQuickShortcutReleaseTimer();
  quickShortcutAwaitRelease = true;
  quickShortcutReleaseTimer = setTimeout(() => {
    quickShortcutAwaitRelease = false;
    quickShortcutReleaseTimer = null;
  }, QUICK_SHORTCUT_RELEASE_GUARD_MS);
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: QUICK_WINDOW_WIDTH,
    height: QUICK_WINDOW_COLLAPSED_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-quick.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  quickWindow.loadFile(path.join(__dirname, "../renderer/quick.html"));
  pinQuickWindowOnTop();
  quickWindow.setFullScreenable(false);
  quickWindow.on("show", () => {
    pinQuickWindowOnTop();
    quickWindow?.webContents.send("quick:focus");
  });
  quickWindow.on("focus", () => {
    pinQuickWindowOnTop();
  });
  quickWindow.on("blur", () => {
    if (allowQuickWindowHide || isQuitting) {
      return;
    }
    if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) {
      return;
    }
    // フォーカスが外れたら隠す (ChatGPT風)
    hideQuickWindow();
  });
  quickWindow.on("hide", () => {
    allowQuickWindowHide = false;
    // hide時の自動復帰は行わない（Raycast型トグル優先）。
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 620,
    show: false,
    title: "Quick2Calendar - 設定",
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "../renderer/settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });
}

function showQuickWindow() {
  if (!quickWindow) {
    return;
  }

  allowQuickWindowHide = false;
  clearQuickWindowFocusRetries();
  quickWindowImeComposing = false;
  // quickWindowExpanded = false; // 状態を維持するためリセットしない
  positionQuickWindowOnCursorDisplay();
  
  // 表示前にすべてのワークスペースで表示可能にする（Space遷移防止の要）
  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  quickWindow.show();
  focusQuickWindowInput();

  // macOS側で直後にフォーカスが戻るケースに備えて短時間だけ再試行する。
  const retryDelays = [60, 180, 360];
  for (const delay of retryDelays) {
    const timer = setTimeout(() => {
      if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) {
        return;
      }
      focusQuickWindowInput();
    }, delay);
    quickWindowFocusRetryTimers.push(timer);
  }
}

function hideQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) {
    return;
  }

  clearQuickWindowFocusRetries();
  allowQuickWindowHide = true;
  quickWindowImeComposing = false;
  quickWindow.hide();
}

function toggleQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed()) {
    return;
  }

  if (quickWindow.isVisible()) {
    hideQuickWindow();
    return;
  }

  showQuickWindow();
}

function toggleQuickWindowFromShortcut() {
  if (quickShortcutAwaitRelease) {
    return;
  }

  startQuickShortcutReleaseGuard();
  toggleQuickWindow();
}

function showSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow();
  }

  hideQuickWindow();
  if (settingsWindow.isMinimized()) {
    settingsWindow.restore();
  }
  settingsWindow.show();
  settingsWindow.moveTop();
  settingsWindow.focus();
  app.focus({ steal: true });
}

function setupTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip("Quick2Calendar");

  const menu = Menu.buildFromTemplate([
    {
      label: "クイック入力を開く",
      click: () => toggleQuickWindow()
    },
    {
      label: "設定",
      click: () => showSettingsWindow()
    },
    { type: "separator" },
    {
      label: "終了",
      click: () => {
        app.exit(0);
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", showQuickWindow);
}

function setupApplicationMenu() {
  const template = [
    {
      label: "アプリ",
      submenu: [
        {
          label: "設定",
          accelerator: "CommandOrControl+,",
          click: () => showSettingsWindow()
        },
        { type: "separator" },
        {
          role: "quit",
          label: "終了"
        }
      ]
    },
    {
      label: "編集",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "操作",
      submenu: [
        {
          label: "クイック入力",
          click: () => toggleQuickWindow()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function unregisterShortcut() {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = "";
  }
}

function registerShortcut(shortcut, options = { allowFallback: true }) {
  unregisterShortcut();

  const targetShortcut = shortcut || DEFAULT_SHORTCUT;
  let success = false;
  try {
    success = globalShortcut.register(targetShortcut, () => {
      toggleQuickWindowFromShortcut();
    });
  } catch {
    success = false;
  }

  if (!success) {
    if (options.allowFallback && targetShortcut !== DEFAULT_SHORTCUT) {
      registerShortcut(DEFAULT_SHORTCUT, { allowFallback: false });
      showNotification(
        "ショートカット登録失敗",
        `ショートカット ${targetShortcut} を登録できなかったため、既定値に戻しました。`
      );
    } else {
      showNotification(
        "ショートカット登録失敗",
        `ショートカット ${targetShortcut} を登録できませんでした。`
      );
    }
    return false;
  }

  registeredShortcut = targetShortcut;
  return true;
}

async function applyLoginItemSettings(settingsOverride = null) {
  const settings = settingsOverride || (await getSettings());
  if (!settings.launchAtLogin) {
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: true
    });
  } catch (error) {
    console.warn(
      `[loginItem] 自動起動設定の反映に失敗しました: ${String(error.message || error)}`
    );
  }
}

async function handleScheduleResult(result) {
  try {
    await appendLog("info", "schedule.result", {
      status: result?.status || "unknown",
      message: result?.message || "",
      event: result?.event
        ? {
            id: result.event.id || "",
            htmlLink: result.event.htmlLink || "",
            title: result.event.title || "",
            start: result.event.start || "",
            end: result.event.end || ""
          }
        : null
    });
  } catch {
    // ログ失敗で本処理は止めない。
  }

  if (result.status === "success") {
    showNotification("予定を登録しました", result.event.title);
  } else if (result.status === "error") {
    showNotification("登録に失敗しました", result.message);
  }

  return result;
}

function normalizeImageInputs(rawInputs) {
  if (!Array.isArray(rawInputs)) {
    return [];
  }

  return rawInputs
    .map((item) => {
      const mimeType = String(item?.mimeType || "").trim().toLowerCase();
      const dataBase64 = String(item?.dataBase64 || "").trim();
      const name = String(item?.name || "image").trim() || "image";
      if (!mimeType || !dataBase64) {
        return null;
      }
      const estimatedSize = Math.floor((dataBase64.length * 3) / 4);
      const sizeBytes = Number(item?.sizeBytes || estimatedSize);
      return {
        name,
        mimeType,
        dataBase64,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : estimatedSize
      };
    })
    .filter(Boolean);
}

function normalizeScheduleCreatePayload(rawInput) {
  if (typeof rawInput === "string") {
    return {
      text: rawInput,
      imageInputs: []
    };
  }

  return {
    text: String(rawInput?.text || ""),
    imageInputs: normalizeImageInputs(rawInput?.imageInputs)
  };
}

function normalizeScheduleAnswerPayload(rawInput) {
  if (typeof rawInput === "string") {
    return {
      text: rawInput,
      imageInputs: []
    };
  }

  return {
    text: String(rawInput?.text || ""),
    imageInputs: normalizeImageInputs(rawInput?.imageInputs)
  };
}

function setupIpcHandlers() {
  ipcMain.handle("schedule:create", async (_event, rawInput) => {
    const input = normalizeScheduleCreatePayload(rawInput);
    try {
      await appendLog("info", "schedule.create.request", {
        textPreview: String(input.text || "").slice(0, 200),
        imageCount: input.imageInputs.length,
        imageTotalBytes: input.imageInputs.reduce(
          (sum, image) => sum + Number(image.sizeBytes || 0),
          0
        )
      });
    } catch {
      // ログ失敗で本処理は止めない。
    }
    const result = await schedulerService.createFromInput(input);
    return handleScheduleResult(result);
  });

  ipcMain.handle("schedule:answer", async (_event, payload) => {
    const sessionId = payload?.sessionId;
    const answer = normalizeScheduleAnswerPayload(payload?.answer);
    try {
      await appendLog("info", "schedule.answer.request", {
        sessionId: String(sessionId || ""),
        answerPreview: String(answer.text || "").slice(0, 120),
        imageCount: answer.imageInputs.length,
        imageTotalBytes: answer.imageInputs.reduce(
          (sum, image) => sum + Number(image.sizeBytes || 0),
          0
        )
      });
    } catch {
      // ログ失敗で本処理は止めない。
    }
    const result = await schedulerService.answerClarification(sessionId, answer);
    return handleScheduleResult(result);
  });

  ipcMain.handle("schedule:cancel", async (_event, sessionId) => {
    try {
      await appendLog("info", "schedule.cancel.request", {
        sessionId: String(sessionId || "")
      });
    } catch {
      // ログ失敗で本処理は止めない。
    }
    return schedulerService.cancelSession(sessionId);
  });

  ipcMain.handle("settings:get", async () => {
    return getSettings();
  });

  ipcMain.handle("settings:save", async (_event, patch) => {
    const next = await updateSettings(patch || {});
    registerShortcut(next.shortcut);
    await applyLoginItemSettings(next);
    return next;
  });

  ipcMain.handle("settings:get-secrets-status", async () => {
    return getSecretStatus();
  });

  ipcMain.handle("settings:get-oauth-status", async () => {
    return getOAuthClientConfigStatus();
  });

  ipcMain.handle("settings:set-gemini-key", async (_event, value) => {
    await setGeminiApiKey(value || "");
    return { ok: true };
  });

  ipcMain.handle("settings:connect-google", async () => {
    if (googleOAuthInProgress) {
      throw new Error(
        "Google認証が進行中です。ブラウザの認証を完了してから再試行してください。"
      );
    }

    googleOAuthInProgress = true;
    try {
      const tokens = await startGoogleOAuthFlow();
      await setGoogleTokens(tokens);
      try {
        await appendLog("info", "google.oauth.connected", {
          hasAccessToken: Boolean(tokens?.access_token),
          hasRefreshToken: Boolean(tokens?.refresh_token),
          expiryDate: tokens?.expiry_date || null
        });
      } catch {
        // ignore logging failure
      }
      return { ok: true };
    } finally {
      googleOAuthInProgress = false;
    }
  });

  ipcMain.handle("settings:disconnect-google", async () => {
    const currentTokens = await getGoogleTokens();
    let revokeResult = null;
    if (currentTokens) {
      try {
        revokeResult = await revokeGoogleTokens(currentTokens);
      } catch (error) {
        revokeResult = {
          revoked: false,
          errors: [String(error.message || error)]
        };
      }
    }
    await clearGoogleTokens();
    try {
      await appendLog("info", "google.oauth.disconnected", {
        revoked: Boolean(revokeResult?.revoked),
        revokedCount: Number(revokeResult?.revokedCount || 0),
        revokeErrors: revokeResult?.errors || []
      });
    } catch {
      // ignore logging failure
    }
    return {
      ok: true,
      revokeResult
    };
  });

  ipcMain.handle("app:open-settings", async () => {
    try {
      showSettingsWindow();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: String(error.message || error)
      };
    }
  });

  ipcMain.handle("quick:hide", async () => {
    hideQuickWindow();
    return { ok: true };
  });

  ipcMain.handle("quick:resize", async (_event, height) => {
    if (!quickWindow || quickWindow.isDestroyed()) {
      return { ok: false };
    }
    const current = quickWindow.getBounds();
    const targetHeight = Math.max(52, Math.min(height, 600)); // 最小52px, 最大600px
    if (current.height !== targetHeight) {
      quickWindow.setBounds({
        x: current.x,
        y: current.y,
        width: current.width,
        height: targetHeight
      });
    }
    return { ok: true };
  });

  ipcMain.handle("quick:set-expanded", async (_event, expanded) => {
    try {
      setQuickWindowExpanded(Boolean(expanded));
      return { ok: true, expanded: quickWindowExpanded };
    } catch (error) {
      return {
        ok: false,
        message: String(error.message || error)
      };
    }
  });

  ipcMain.handle("quick:set-ime-composing", async (_event, active) => {
    try {
      setQuickWindowImeComposing(Boolean(active));
      return { ok: true, composing: quickWindowImeComposing };
    } catch (error) {
      return {
        ok: false,
        message: String(error.message || error)
      };
    }
  });

  ipcMain.handle("quick:copy-text", async (_event, text) => {
    const value = String(text || "").trim();
    if (!value) {
      return { ok: false, reason: "empty" };
    }
    clipboard.writeText(value);
    return { ok: true };
  });

  ipcMain.handle("quick:open-external", async (_event, rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return {
        ok: false,
        message: "外部リンクの形式が不正です。"
      };
    }

    const openResult = await shell.openExternal(url);
    if (openResult) {
      try {
        await appendLog("warn", "quick.open_external.failed", {
          url,
          message: openResult
        });
      } catch {
        // ログ失敗で本処理は止めない。
      }
      return {
        ok: false,
        message: openResult
      };
    }

    try {
      await appendLog("info", "quick.open_external.success", { url });
    } catch {
      // ログ失敗で本処理は止めない。
    }
    return { ok: true };
  });

  ipcMain.handle("debug:get-log-path", async () => {
    return {
      path: getLogFilePath()
    };
  });

  ipcMain.handle("debug:get-recent-logs", async (_event, limit) => {
    return readRecentLogs(limit);
  });

  ipcMain.handle("debug:open-log-file", async () => {
    const filePath = getLogFilePath();
    const openResult = await shell.openPath(filePath);
    return {
      ok: !openResult,
      path: filePath,
      message: openResult || ""
    };
  });
}

// Dockアイコンを非表示にする（常駐アプリ化してSpace遷移を防ぐ）
if (app.dock) {
  app.dock.hide();
}

app.whenReady().then(async () => {
  await ensureSettingsFile();
  try {
    await appendLog("info", "app.started", {
      version: app.getVersion(),
      isPackaged: app.isPackaged
    });
  } catch {
    // ignore logging failure
  }

  createQuickWindow();
  createSettingsWindow();
  setupTray();
  setupApplicationMenu();
  setupIpcHandlers();

  const settings = await getSettings();
  registerShortcut(settings.shortcut);
  await applyLoginItemSettings(settings);

  app.on("activate", () => {
    if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) {
      return;
    }
    focusQuickWindowInput();
  });
});

app.on("will-quit", () => {
  clearQuickWindowFocusRetries();
  clearQuickShortcutReleaseTimer();
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  isQuitting = true;
});
