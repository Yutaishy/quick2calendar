import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const APP_SUPPORT_DIR_NAME = "Quick2Calendar";
const LOG_DIR_NAME = "logs";
const LOG_FILE_NAME = "app.log";

function resolveLogFilePath() {
  try {
    return path.join(
      app.getPath("appData"),
      APP_SUPPORT_DIR_NAME,
      LOG_DIR_NAME,
      LOG_FILE_NAME
    );
  } catch {
    return path.join(process.cwd(), LOG_FILE_NAME);
  }
}

async function ensureLogDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function toSafeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function getLogFilePath() {
  return resolveLogFilePath();
}

export async function appendLog(level, event, data = {}) {
  const filePath = resolveLogFilePath();
  const payload = {
    timestamp: new Date().toISOString(),
    level: String(level || "info"),
    event: String(event || "unknown"),
    data: toSafeJson(data)
  };

  await ensureLogDirectory(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
}

export async function readRecentLogs(limit = 200) {
  const filePath = resolveLogFilePath();
  const maxLines = Math.max(1, Math.min(Number(limit) || 200, 1000));

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const recent = lines.slice(-maxLines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {
          timestamp: null,
          level: "raw",
          event: "raw_line",
          data: line
        };
      }
    });

    return {
      path: filePath,
      entries: recent
    };
  } catch {
    return {
      path: filePath,
      entries: []
    };
  }
}
