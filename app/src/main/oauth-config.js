import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { DEFAULT_REDIRECT_URI } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE_NAMES = ["oauth-client.local.json", "oauth-client.json"];

function normalizeConfig(raw = {}) {
  const direct = {
    clientId: String(raw.clientId || raw.client_id || "").trim(),
    clientSecret: String(raw.clientSecret || raw.client_secret || "").trim(),
    redirectUri: String(
      raw.redirectUri ||
        raw.redirect_uri ||
        raw.redirectURL ||
        raw.redirect_url ||
        ""
    ).trim()
  };

  if (direct.clientId) {
    return {
      clientId: direct.clientId,
      clientSecret: direct.clientSecret,
      redirectUri: direct.redirectUri || DEFAULT_REDIRECT_URI
    };
  }

  const installed = raw.installed || {};
  const installedClientId = String(installed.client_id || "").trim();
  if (!installedClientId) {
    return null;
  }

  const redirectUri =
    (Array.isArray(installed.redirect_uris)
      ? installed.redirect_uris[0]
      : installed.redirect_uri) || DEFAULT_REDIRECT_URI;

  return {
    clientId: installedClientId,
    clientSecret: String(installed.client_secret || "").trim(),
    redirectUri: String(redirectUri).trim()
  };
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];

  for (const filePath of paths) {
    const normalized = path.normalize(filePath);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getConfigFileCandidates() {
  const candidates = [];
  const explicit = String(process.env.GOOGLE_OAUTH_CONFIG_PATH || "").trim();
  if (explicit) {
    candidates.push(path.resolve(explicit));
  }

  for (const fileName of CONFIG_FILE_NAMES) {
    candidates.push(path.resolve(__dirname, "../../", fileName));
    candidates.push(path.resolve(process.cwd(), fileName));
  }

  try {
    const appPath = app.getAppPath();
    for (const fileName of CONFIG_FILE_NAMES) {
      candidates.push(path.resolve(appPath, fileName));
    }
  } catch {
    // ignore (app未初期化タイミング)
  }

  const resourcesPath = String(process.resourcesPath || "").trim();
  if (resourcesPath) {
    for (const fileName of CONFIG_FILE_NAMES) {
      candidates.push(path.resolve(resourcesPath, fileName));
      candidates.push(path.resolve(resourcesPath, "app", fileName));
    }
  }

  return uniquePaths(candidates);
}

function readConfigFile() {
  for (const filePath of getConfigFileCandidates()) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const normalized = normalizeConfig(raw);
      if (normalized?.clientId) {
        return {
          ...normalized,
          source: `file:${filePath}`
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readFromEnvironment() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  if (!clientId) {
    return null;
  }

  return {
    clientId,
    clientSecret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
    redirectUri:
      String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim() ||
      DEFAULT_REDIRECT_URI,
    source: "env"
  };
}

export function getOAuthClientConfig() {
  const fromEnv = readFromEnvironment();
  if (fromEnv?.clientId) {
    return fromEnv;
  }

  const fromFile = readConfigFile();
  if (fromFile?.clientId) {
    return fromFile;
  }

  throw new Error(
    "Google OAuth設定が見つかりません。開発時は oauth-client.local.json（または環境変数）を設定してください。"
  );
}

export function getOAuthClientConfigStatus() {
  const fromEnv = readFromEnvironment();
  if (fromEnv?.clientId) {
    return {
      configured: true,
      source: fromEnv.source,
      redirectUri: fromEnv.redirectUri
    };
  }

  const fromFile = readConfigFile();
  if (fromFile?.clientId) {
    return {
      configured: true,
      source: fromFile.source,
      redirectUri: fromFile.redirectUri
    };
  }

  return {
    configured: false,
    source: "none",
    redirectUri: DEFAULT_REDIRECT_URI
  };
}

export function getOAuthClientConfigCandidates() {
  return {
    envConfigured: Boolean(readFromEnvironment()?.clientId),
    fileCandidates: getConfigFileCandidates()
  };
}

export function getOAuthClientConfigDebugSummary() {
  try {
    const config = getOAuthClientConfig();
    return {
      configured: true,
      source: config.source || "unknown",
      redirectUri: config.redirectUri
    };
  } catch (error) {
    return {
      configured: false,
      error: String(error.message || error),
      candidates: getConfigFileCandidates()
    };
  }
}
