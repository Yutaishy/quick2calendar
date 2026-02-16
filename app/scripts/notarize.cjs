/* eslint-disable no-console */
const path = require("node:path");
const { notarize } = require("@electron/notarize");

function resolveAppPath(context) {
  const appOutDir = context.appOutDir;
  const productFilename =
    context.packager?.appInfo?.productFilename ||
    context.packager?.appInfo?.productName ||
    "Quick2Calendar";
  return path.join(appOutDir, `${productFilename}.app`);
}

function resolveNotarizeOptions(appPath) {
  // 1) Keychain profile（ローカル推奨: 事前に notarytool store-credentials 済み）
  const keychainProfile = String(process.env.APPLE_NOTARIZE_KEYCHAIN_PROFILE || "").trim();
  if (keychainProfile) {
    const keychain = String(process.env.APPLE_NOTARIZE_KEYCHAIN || "").trim();
    return {
      appPath,
      keychainProfile,
      ...(keychain ? { keychain } : {})
    };
  }

  // 2) App Store Connect API key（CI推奨）
  const appleApiKey = String(process.env.APPLE_API_KEY || "").trim();
  const appleApiKeyId = String(process.env.APPLE_API_KEY_ID || "").trim();
  if (appleApiKey && appleApiKeyId) {
    const appleApiIssuer = String(process.env.APPLE_API_ISSUER || "").trim();
    return {
      appPath,
      appleApiKey,
      appleApiKeyId,
      ...(appleApiIssuer ? { appleApiIssuer } : {})
    };
  }

  // 3) Apple ID + app-specific password
  const appleId = String(process.env.APPLE_ID || "").trim();
  const appleIdPassword = String(process.env.APPLE_ID_PASSWORD || "").trim();
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  if (appleId && appleIdPassword && teamId) {
    return {
      appPath,
      appleId,
      appleIdPassword,
      teamId
    };
  }

  return null;
}

module.exports = async function notarizeHook(context) {
  // electron-builder afterSign hook
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (String(process.env.SKIP_NOTARIZE || "").trim() === "1") {
    console.log("[notarize] SKIP_NOTARIZE=1 のためスキップします");
    return;
  }

  const appPath = resolveAppPath(context);
  const options = resolveNotarizeOptions(appPath);
  if (!options) {
    console.log("[notarize] 認証情報が未設定のためスキップします");
    console.log(
      "[notarize] 利用可能: APPLE_NOTARIZE_KEYCHAIN_PROFILE / APPLE_API_KEY(+_ID,+_ISSUER) / APPLE_ID(+_PASSWORD,+_TEAM_ID)"
    );
    return;
  }

  console.log(`[notarize] Notarization 開始: ${appPath}`);
  await notarize(options);
  console.log("[notarize] Notarization 完了");
};

