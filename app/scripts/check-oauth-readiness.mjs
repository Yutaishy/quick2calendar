import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GOOGLE_SCOPES } from "../src/main/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

const metadataCandidates = [
  path.join(appRoot, "review", "release-metadata.local.json"),
  path.join(appRoot, "review", "release-metadata.example.json")
];

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function parseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function hasPlaceholder(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("example.com") || text.includes("your_");
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) {
    return [];
  }
  return [...new Set(scopes.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function loadMetadata() {
  for (const candidate of metadataCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const raw = fs.readFileSync(candidate, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      path: candidate,
      data: parsed
    };
  }
  throw new Error(
    "review/release-metadata.local.json が見つかりません。example からコピーして作成してください。"
  );
}

function validateRequiredUrl(name, value, errors) {
  const parsed = parseUrl(value);
  if (!parsed) {
    errors.push(`${name} がURL形式ではありません。`);
    return null;
  }
  if (parsed.protocol !== "https:") {
    errors.push(`${name} は https URL である必要があります。`);
  }
  return parsed;
}

function isAuthorizedDomain(hostname, authorizedDomains) {
  return authorizedDomains.some((domain) => {
    const normalized = String(domain || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function validateRedirectUri(uri, errors) {
  const parsed = parseUrl(uri);
  if (!parsed) {
    errors.push(`redirect URI が不正です: ${uri}`);
    return;
  }

  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!isLoopback && parsed.protocol !== "https:") {
    errors.push(
      `redirect URI は loopback 以外は https が必要です: ${String(uri)}`
    );
  }
}

function printList(label, list) {
  if (list.length === 0) {
    return;
  }
  console.log(`\n${label}`);
  list.forEach((item, index) => {
    console.log(`${index + 1}. ${item}`);
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    strict: args.includes("--strict")
  };
}

function main() {
  const { strict } = parseArgs();
  const { path: metadataPath, data } = loadMetadata();
  const errors = [];
  const warnings = [];

  const appName = String(data.appName || "").trim();
  if (!appName) {
    errors.push("appName は必須です。");
  }

  const supportEmail = String(data.supportEmail || "").trim();
  if (!isValidEmail(supportEmail)) {
    errors.push("supportEmail が不正です。");
  }

  const devEmail = String(data.developerContactEmail || "").trim();
  if (!isValidEmail(devEmail)) {
    errors.push("developerContactEmail が不正です。");
  }

  const homepageUrl = validateRequiredUrl("homepageUrl", data.homepageUrl, errors);
  const privacyPolicyUrl = validateRequiredUrl(
    "privacyPolicyUrl",
    data.privacyPolicyUrl,
    errors
  );
  const termsUrl = validateRequiredUrl(
    "termsOfServiceUrl",
    data.termsOfServiceUrl,
    errors
  );
  const deletionUrl = validateRequiredUrl(
    "dataDeletionUrl",
    data.dataDeletionUrl,
    errors
  );

  const authorizedDomains = Array.isArray(data.authorizedDomains)
    ? data.authorizedDomains
        .map((domain) => String(domain || "").trim().toLowerCase())
        .filter(Boolean)
    : [];

  if (authorizedDomains.length === 0) {
    errors.push("authorizedDomains は1件以上必要です。");
  } else {
    const checkTargets = [
      ["homepageUrl", homepageUrl],
      ["privacyPolicyUrl", privacyPolicyUrl],
      ["termsOfServiceUrl", termsUrl],
      ["dataDeletionUrl", deletionUrl]
    ];
    for (const [name, parsed] of checkTargets) {
      if (!parsed) {
        continue;
      }
      if (!isAuthorizedDomain(parsed.hostname.toLowerCase(), authorizedDomains)) {
        errors.push(
          `${name} のドメイン (${parsed.hostname}) が authorizedDomains に含まれていません。`
        );
      }
    }
  }

  const oauthClientType = String(data.oauthClientType || "").trim().toLowerCase();
  if (!oauthClientType) {
    errors.push("oauthClientType は必須です。");
  } else if (oauthClientType !== "desktop") {
    warnings.push(
      `oauthClientType=${oauthClientType} です。デスクトップアプリ用途では desktop を推奨します。`
    );
  }

  const redirectUris = Array.isArray(data.oauthRedirectUris)
    ? data.oauthRedirectUris
    : [];
  if (redirectUris.length === 0) {
    errors.push("oauthRedirectUris は1件以上必要です。");
  }
  redirectUris.forEach((uri) => validateRedirectUri(uri, errors));

  const requestedScopes = normalizeScopes(data.requestedScopes);
  const runtimeScopes = normalizeScopes(GOOGLE_SCOPES);
  if (requestedScopes.length === 0) {
    errors.push("requestedScopes は1件以上必要です。");
  }

  const missingInMetadata = runtimeScopes.filter(
    (scope) => !requestedScopes.includes(scope)
  );
  const extraInMetadata = requestedScopes.filter(
    (scope) => !runtimeScopes.includes(scope)
  );
  if (missingInMetadata.length > 0) {
    errors.push(
      `requestedScopes に実装スコープが不足しています: ${missingInMetadata.join(", ")}`
    );
  }
  if (extraInMetadata.length > 0) {
    errors.push(
      `requestedScopes に実装未使用スコープがあります: ${extraInMetadata.join(", ")}`
    );
  }

  const justification = data.scopeJustification || {};
  for (const scope of requestedScopes) {
    const description = String(justification[scope] || "").trim();
    if (!description) {
      errors.push(`scopeJustification が不足しています: ${scope}`);
    }
  }

  const verificationVideoUrl = String(data.verificationVideoUrl || "").trim();
  if (!verificationVideoUrl) {
    warnings.push("verificationVideoUrl が未設定です。審査提出時に必要です。");
  } else {
    const parsed = parseUrl(verificationVideoUrl);
    if (!parsed) {
      warnings.push("verificationVideoUrl の形式が不正です。");
    } else if (parsed.protocol !== "https:") {
      warnings.push("verificationVideoUrl は https URL を推奨します。");
    }
  }

  const placeholderChecks = [
    ["appName", appName],
    ["supportEmail", supportEmail],
    ["developerContactEmail", devEmail],
    ["homepageUrl", String(data.homepageUrl || "")],
    ["privacyPolicyUrl", String(data.privacyPolicyUrl || "")],
    ["termsOfServiceUrl", String(data.termsOfServiceUrl || "")],
    ["dataDeletionUrl", String(data.dataDeletionUrl || "")],
    ["verificationVideoUrl", verificationVideoUrl]
  ];
  const placeholderFields = placeholderChecks
    .filter((item) => hasPlaceholder(item[1]))
    .map((item) => item[0]);
  if (placeholderFields.length > 0) {
    warnings.push(
      `example値が残っている項目があります: ${placeholderFields.join(
        ", "
      )}。提出前に実値へ更新してください。`
    );
  }

  console.log(`OAuth審査チェック: ${metadataPath}`);
  console.log(`実装スコープ: ${runtimeScopes.join(", ")}`);
  console.log(`提出スコープ: ${requestedScopes.join(", ")}`);
  printList("Errors", errors);
  printList("Warnings", warnings);

  const shouldFail = errors.length > 0 || (strict && warnings.length > 0);
  if (shouldFail) {
    console.log(
      `\nResult: NG (errors=${errors.length}, warnings=${warnings.length}, strict=${strict})`
    );
    process.exit(1);
  }

  console.log(`\nResult: OK (errors=0, warnings=${warnings.length}, strict=${strict})`);
}

main();
