import http from "node:http";
import { URL } from "node:url";
import { shell } from "electron";
import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";
import { GOOGLE_SCOPES } from "./constants.js";
import { getOAuthClientConfig } from "./oauth-config.js";

function createOAuthClient() {
  const config = getOAuthClientConfig();
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret || undefined,
    config.redirectUri
  );
}

function sendHtmlPage(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  res.end(`<!doctype html><html><head><meta charset="UTF-8" /></head><body>${html}</body></html>`);
}

async function waitForAuthorizationCode(redirectUri, expectedState) {
  const redirectUrl = new URL(redirectUri);
  if (!redirectUrl.port) {
    throw new Error(
      "redirectUri にポート番号がありません。例: http://127.0.0.1:53682/oauth2callback"
    );
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Google認証がタイムアウトしました。再試行してください。"));
    }, 180000);

    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || "/", redirectUri);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        sendHtmlPage(res, 404, "<p>Not found</p>");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        clearTimeout(timeout);
        server.close();
        sendHtmlPage(
          res,
          400,
          "<h2>認証がキャンセルされました。</h2><p>アプリへ戻って再試行してください。</p>"
        );
        reject(new Error(`Google認証エラー: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        clearTimeout(timeout);
        server.close();
        const reason = !code ? "code_missing" : "state_mismatch";
        sendHtmlPage(
          res,
          400,
          "<h2>認証コードの検証に失敗しました。</h2><p>アプリへ戻って再試行してください。</p><p>認証タブを複数開いている場合は閉じてから再実行してください。</p>"
        );
        if (reason === "state_mismatch") {
          reject(
            new Error(
              "認証コードの検証に失敗しました（state不一致）。認証タブをすべて閉じて再試行してください。"
            )
          );
        } else {
          reject(new Error("認証コードの検証に失敗しました（code欠落）。"));
        }
        return;
      }

      clearTimeout(timeout);
      server.close();
      sendHtmlPage(
        res,
        200,
        "<h2>認証が完了しました。</h2><p>このタブを閉じてアプリに戻ってください。</p>"
      );
      resolve(code);
    });

    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(Number(redirectUrl.port), redirectUrl.hostname);
  });
}

export function createOAuthClientFromConfig() {
  return createOAuthClient();
}

export async function startGoogleOAuthFlow() {
  const config = getOAuthClientConfig();
  const oauth2Client = createOAuthClient();
  const state = uuidv4();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state
  });

  const waitForCodePromise = waitForAuthorizationCode(config.redirectUri, state);

  await shell.openExternal(authUrl);

  const code = await waitForCodePromise;
  const tokenResponse = await oauth2Client.getToken(code);
  if (!tokenResponse.tokens) {
    throw new Error("Googleトークンの取得に失敗しました。");
  }

  return tokenResponse.tokens;
}

async function revokeToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    return;
  }

  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      token: value
    }).toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Googleトークン失効に失敗しました: ${response.status} ${body}`);
  }
}

export async function revokeGoogleTokens(tokens) {
  const candidates = [
    String(tokens?.refresh_token || "").trim(),
    String(tokens?.access_token || "").trim()
  ].filter(Boolean);

  if (candidates.length === 0) {
    return {
      revoked: false,
      reason: "no_token"
    };
  }

  let revokedCount = 0;
  const errors = [];

  for (const token of candidates) {
    try {
      await revokeToken(token);
      revokedCount += 1;
    } catch (error) {
      errors.push(String(error.message || error));
    }
  }

  return {
    revoked: revokedCount > 0,
    revokedCount,
    errors
  };
}
