import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";

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

async function readJsonFile(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const normalized = normalizeConfig(raw);
  if (!normalized?.clientId) {
    return null;
  }
  return normalized;
}

async function main() {
  const appDir = process.cwd();
  const outputPath = path.join(appDir, "oauth-client.json");

  const fromEnv = readFromEnvironment();
  if (fromEnv?.clientId) {
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          clientId: fromEnv.clientId,
          clientSecret: fromEnv.clientSecret,
          redirectUri: fromEnv.redirectUri
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
    console.log("[build:oauth] oauth-client.json を環境変数から生成しました");
    return;
  }

  const explicit = String(process.env.GOOGLE_OAUTH_CONFIG_PATH || "").trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    const normalized = await readJsonFile(resolved);
    if (!normalized?.clientId) {
      throw new Error(
        "GOOGLE_OAUTH_CONFIG_PATH のJSONに clientId が見つかりません。"
      );
    }
    await fs.writeFile(outputPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
    console.log("[build:oauth] oauth-client.json を指定ファイルから生成しました");
    return;
  }

  const localPath = path.join(appDir, "oauth-client.local.json");
  try {
    const normalized = await readJsonFile(localPath);
    if (!normalized?.clientId) {
      throw new Error("oauth-client.local.json に clientId が見つかりません。");
    }
    await fs.writeFile(outputPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
    console.log("[build:oauth] oauth-client.json を oauth-client.local.json から生成しました");
    return;
  } catch (error) {
    throw new Error(
      [
        "oauth-client.json を生成できませんでした。",
        "",
        "以下のいずれかを設定してください:",
        "- 環境変数 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI",
        "- 環境変数 GOOGLE_OAUTH_CONFIG_PATH（oauth-client.local.json相当のJSONへのパス）",
        "- app/oauth-client.local.json（npm run setup:oauth で雛形作成）",
        "",
        `原因: ${String(error?.message || error)}`
      ].join("\n")
    );
  }
}

await main();

