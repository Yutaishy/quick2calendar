import keytar from "keytar";
import { APP_ID, SECRET_KEYS } from "./constants.js";

function getAccountKey(key) {
  return `${APP_ID}:${key}`;
}

async function setSecret(key, value) {
  const account = getAccountKey(key);
  if (value === undefined || value === null || value === "") {
    await keytar.deletePassword(APP_ID, account);
    return;
  }

  await keytar.setPassword(APP_ID, account, String(value));
}

async function getSecret(key) {
  const account = getAccountKey(key);
  return keytar.getPassword(APP_ID, account);
}

export async function setGeminiApiKey(apiKey) {
  await setSecret(SECRET_KEYS.geminiApiKey, apiKey);
}

export async function getGeminiApiKey() {
  return getSecret(SECRET_KEYS.geminiApiKey);
}

export async function setGoogleTokens(tokens) {
  const serialized = JSON.stringify(tokens);
  await setSecret(SECRET_KEYS.googleTokens, serialized);
}

export async function getGoogleTokens() {
  const raw = await getSecret(SECRET_KEYS.googleTokens);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearGoogleTokens() {
  await setSecret(SECRET_KEYS.googleTokens, "");
}

export async function getSecretStatus() {
  const [geminiApiKey, googleTokens] = await Promise.all([
    getGeminiApiKey(),
    getGoogleTokens()
  ]);

  return {
    hasGeminiApiKey: Boolean(geminiApiKey),
    hasGoogleTokens: Boolean(googleTokens)
  };
}
