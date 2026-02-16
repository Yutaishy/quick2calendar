import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    arch: "",
    dir: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dir") {
      args.dir = true;
      continue;
    }
    if (token === "--arch") {
      args.arch = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--arch=")) {
      args.arch = token.slice("--arch=".length).trim();
      continue;
    }
  }

  return args;
}

function resolveBuilderBin(projectDir) {
  return path.join(projectDir, "node_modules", ".bin", "electron-builder");
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      ...options
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyArtifacts(tmpOutDir, projectDistDir) {
  const entries = await fs.readdir(tmpOutDir);
  const artifacts = entries
    .filter((name) => name.endsWith(".dmg") || name.endsWith(".zip"))
    .map((name) => path.join(tmpOutDir, name));

  if (artifacts.length === 0) {
    throw new Error(`成果物（.dmg/.zip）が見つかりません: ${tmpOutDir}`);
  }

  await ensureDir(projectDistDir);
  await Promise.all(
    artifacts.map(async (srcPath) => {
      const destPath = path.join(projectDistDir, path.basename(srcPath));
      await fs.copyFile(srcPath, destPath);
    })
  );

  return artifacts.map((p) => path.join(projectDistDir, path.basename(p)));
}

async function main() {
  const projectDir = process.cwd();
  const { arch, dir } = parseArgs(process.argv.slice(2));

  const tmpRoot = process.env.ELECTRON_BUILDER_TMP_ROOT
    ? path.resolve(process.env.ELECTRON_BUILDER_TMP_ROOT)
    : path.join(os.tmpdir(), "quick2calendar-electron-builder");
  const tmpOutDir = path.join(tmpRoot, `out-${Date.now()}`);

  // Google Drive / iCloud など File Provider 管理配下だと FinderInfo が自動付与され、
  // codesign が失敗しやすい。出力だけ /tmp に逃がしてビルドする。
  const builder = resolveBuilderBin(projectDir);

  const builderArgs = [
    "--mac",
    "--publish",
    "never",
    "-c.directories.output=" + tmpOutDir
  ];

  if (dir) {
    builderArgs.push("--dir");
  }

  if (arch === "arm64") {
    builderArgs.push("--arm64");
  } else if (arch === "x64") {
    builderArgs.push("--x64");
  } else if (arch) {
    throw new Error(`未対応 arch: ${arch}（arm64 / x64 / 空 を指定）`);
  }

  await ensureDir(tmpOutDir);
  await run(builder, builderArgs, { cwd: projectDir });

  if (dir) {
    console.log("");
    console.log(`[dist] unpacked output: ${tmpOutDir}`);
    return;
  }

  const projectDistDir = path.join(projectDir, "dist");
  const copied = await copyArtifacts(tmpOutDir, projectDistDir);
  console.log("");
  console.log("[dist] copied artifacts:");
  copied.forEach((p) => console.log(`- ${p}`));

  if (String(process.env.KEEP_ELECTRON_BUILDER_TMP || "").trim() === "1") {
    console.log("");
    console.log(`[dist] KEEP_ELECTRON_BUILDER_TMP=1 のため一時出力を保持します: ${tmpOutDir}`);
    return;
  }

  await fs.rm(tmpOutDir, { recursive: true, force: true });
}

await main();

