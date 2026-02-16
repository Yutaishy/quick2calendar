/* eslint-disable no-console */
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function resolveAppPath(context) {
  const appOutDir = context.appOutDir;
  const productFilename =
    context.packager?.appInfo?.productFilename ||
    context.packager?.appInfo?.productName ||
    "Quick2Calendar";
  return path.join(appOutDir, `${productFilename}.app`);
}

module.exports = async function afterPackHook(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  // Google Drive / iCloud / 一部同期フォルダ配下だと xattr が付与され、
  // codesign verify で "resource fork, Finder information ... not allowed" が出ることがある。
  const appPath = resolveAppPath(context);
  try {
    await execFileAsync("xattr", ["-cr", appPath]);
    console.log(`[afterPack] xattr をクリアしました: ${appPath}`);
  } catch (error) {
    console.warn(
      `[afterPack] xattr クリアに失敗しました（継続します）: ${String(error?.message || error)}`
    );
  }
};

