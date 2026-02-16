import { formatLocalDateTime, getLocalTimezone } from "./date-utils.js";
import { DEFAULT_GEMINI_MODEL } from "./constants.js";
import { getGeminiApiKey } from "./secure-store.js";
import { appendLog } from "./app-logger.js";

const GEMINI_REQUEST_TIMEOUT_MS = 90000;
const GEMINI_TIMEOUT_RETRY_COUNT = 1;
const GEMINI_LOG_PROMPT_PREVIEW_LIMIT = 200;
const GEMINI_MAX_IMAGE_COUNT = 3;
const GEMINI_MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;
const GEMINI_MAX_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024;

function logGemini(level, event, data) {
  return appendLog(level, event, data).catch(() => {
    // ログ失敗で本処理は止めない。
  });
}

function extractJsonBlock(text) {
  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

function normalizeGeminiDraft(data) {
  return {
    title: String(data?.title || "").trim(),
    start: String(data?.start || "").trim(),
    end: String(data?.end || "").trim(),
    location: String(data?.location || "").trim(),
    description: String(data?.description || "").trim(),
    confidence: Number(data?.confidence || 0),
    uncertain: Boolean(data?.uncertain),
    needsClarification: Boolean(data?.needsClarification),
    clarificationQuestion: String(data?.clarificationQuestion || "").trim(),
    reasoning: String(data?.reasoning || "").trim()
  };
}

function normalizeImageInputsForGemini(rawInputs) {
  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    return [];
  }

  if (rawInputs.length > GEMINI_MAX_IMAGE_COUNT) {
    throw new Error(`画像は最大${GEMINI_MAX_IMAGE_COUNT}件までです。`);
  }

  const normalized = [];
  let totalBytes = 0;

  for (const input of rawInputs) {
    const mimeType = String(input?.mimeType || "").trim().toLowerCase();
    const dataBase64 = String(input?.dataBase64 || "")
      .trim()
      .replace(/\s+/g, "");
    const name = String(input?.name || "image").trim() || "image";

    if (!mimeType.startsWith("image/")) {
      throw new Error(`画像形式のみ対応しています: ${name}`);
    }
    if (!dataBase64) {
      throw new Error(`画像データが空です: ${name}`);
    }

    const estimatedSize = Math.floor((dataBase64.length * 3) / 4);
    const sizeBytes = Number(input?.sizeBytes || estimatedSize);
    const resolvedSize =
      Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : estimatedSize;

    if (resolvedSize > GEMINI_MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `画像サイズが大きすぎます（最大${Math.floor(
          GEMINI_MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
        )}MB）: ${name}`
      );
    }

    totalBytes += resolvedSize;
    if (totalBytes > GEMINI_MAX_TOTAL_IMAGE_BYTES) {
      throw new Error(
        `添付画像の合計サイズが大きすぎます（最大${Math.floor(
          GEMINI_MAX_TOTAL_IMAGE_BYTES / (1024 * 1024)
        )}MB）。`
      );
    }

    normalized.push({
      name,
      mimeType,
      dataBase64,
      sizeBytes: resolvedSize
    });
  }

  return normalized;
}

function buildGeminiUserParts(prompt, imageInputs) {
  const parts = [
    {
      text: prompt
    }
  ];

  for (const image of imageInputs) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.dataBase64
      }
    });
  }

  return parts;
}

async function generateJsonWithGemini({
  model,
  prompt,
  imageInputs = [],
  apiKey,
  allowModelFallback = true,
  timeoutRetryCount = GEMINI_TIMEOUT_RETRY_COUNT,
  attempt = 1
}) {
  const normalizedImageInputs = normalizeImageInputsForGemini(imageInputs);
  const imageTotalBytes = normalizedImageInputs.reduce(
    (sum, image) => sum + Number(image.sizeBytes || 0),
    0
  );
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const timeoutMs = GEMINI_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  await logGemini("info", "gemini.request.start", {
    model,
    attempt,
    timeoutMs,
    timeoutRetryCount,
    allowModelFallback,
    imageCount: normalizedImageInputs.length,
    imageTotalBytes,
    promptPreview: String(prompt || "").slice(0, GEMINI_LOG_PROMPT_PREVIEW_LIMIT)
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: buildGeminiUserParts(prompt, normalizedImageInputs)
          }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      await logGemini("warn", "gemini.request.timeout", {
        model,
        attempt,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        retryRemaining: timeoutRetryCount
      });
      if (timeoutRetryCount > 0) {
        return generateJsonWithGemini({
          model,
          prompt,
          imageInputs: normalizedImageInputs,
          apiKey,
          allowModelFallback,
          timeoutRetryCount: timeoutRetryCount - 1,
          attempt: attempt + 1
        });
      }
      throw new Error(
        `Gemini APIの応答が遅延したためタイムアウトしました（${Math.round(
          timeoutMs / 1000
        )}秒）。ネットワーク状態またはGemini側負荷を確認してください。`
      );
    }
    await logGemini("error", "gemini.request.network_error", {
        model,
        attempt,
        elapsedMs: Date.now() - startedAt,
        imageCount: normalizedImageInputs.length,
        message: String(error?.message || error)
      });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  await logGemini("info", "gemini.request.response", {
    model,
    attempt,
    status: response.status,
    ok: response.ok,
    imageCount: normalizedImageInputs.length,
    elapsedMs: Date.now() - startedAt
  });

  if (!response.ok) {
    const body = await response.text();
    const modelNotFound = response.status === 404 && /not found|NOT_FOUND/i.test(body);
    if (modelNotFound && allowModelFallback && model !== DEFAULT_GEMINI_MODEL) {
      await logGemini("warn", "gemini.request.model_fallback", {
        requestedModel: model,
        fallbackModel: DEFAULT_GEMINI_MODEL,
        status: response.status
      });
      return generateJsonWithGemini({
        model: DEFAULT_GEMINI_MODEL,
        prompt,
        imageInputs: normalizedImageInputs,
        apiKey,
        allowModelFallback: false,
        timeoutRetryCount,
        attempt
      });
    }
    await logGemini("error", "gemini.request.http_error", {
      model,
      attempt,
      status: response.status,
      imageCount: normalizedImageInputs.length,
      bodyPreview: String(body || "").slice(0, 300)
    });
    throw new Error(`Gemini API error: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("\n") || "";

  const jsonBlock = extractJsonBlock(text);
  if (!jsonBlock) {
    await logGemini("error", "gemini.response.invalid_json_block", {
      model,
      attempt,
      textPreview: String(text || "").slice(0, 300)
    });
    throw new Error("Gemini response did not include JSON.");
  }

  try {
    const parsed = JSON.parse(jsonBlock);
    await logGemini("info", "gemini.response.parsed", {
      model,
      attempt,
      hasTitle: Boolean(parsed?.title),
      hasStart: Boolean(parsed?.start),
      hasEnd: Boolean(parsed?.end),
      needsClarification: Boolean(parsed?.needsClarification)
    });
    return parsed;
  } catch (error) {
    await logGemini("error", "gemini.response.parse_error", {
      model,
      attempt,
      message: String(error?.message || error),
      jsonPreview: String(jsonBlock || "").slice(0, 300)
    });
    throw error;
  }
}

function buildInterpretPrompt({ text, settings, instructionText, hasImageInputs }) {
  const timezone = getLocalTimezone();
  const nowLocal = formatLocalDateTime(new Date());
  return `あなたは予定抽出アシスタントです。入力文からGoogleカレンダー予定を抽出してください。

制約:
- 出力はJSONのみ。
- 日時は ${timezone} として解釈。
- 相対表現（今日/明日/来週など）は現在日時 ${nowLocal} を基準に解釈。
- start/end は "YYYY-MM-DDTHH:mm:ss" 形式のローカル時刻。
- title/start/end が不足する場合は needsClarification=true。
- 曖昧な場合は clarificationQuestion を1つだけ日本語で返す。
- 終了時刻未指定の場合、既定は ${settings.defaultDurationMinutes} 分。
- ユーザー定義ルールを優先する。
${hasImageInputs ? "- 添付画像内の文字情報を読み取り（OCR）、入力文と統合して解釈する。" : ""}

ユーザー定義ルール:
${settings.timeResolutionRulesText || "(なし)"}

カスタム指示:
${instructionText || "(なし)"}

入力文:
${text || "(なし)"}

JSONスキーマ:
{
  "title": "string",
  "start": "YYYY-MM-DDTHH:mm:ss or empty",
  "end": "YYYY-MM-DDTHH:mm:ss or empty",
  "location": "string",
  "description": "string",
  "confidence": 0.0,
  "uncertain": false,
  "needsClarification": false,
  "clarificationQuestion": "string",
  "reasoning": "string"
}`;
}

function buildRefinePrompt({
  draft,
  question,
  answer,
  settings,
  instructionText,
  hasImageInputs
}) {
  const timezone = getLocalTimezone();
  const nowLocal = formatLocalDateTime(new Date());
  return `あなたは予定抽出アシスタントです。既存ドラフトと追加回答を反映して予定情報を更新してください。

制約:
- 出力はJSONのみ。
- 日時は ${timezone} として解釈。
- 相対表現（今日/明日/来週など）は現在日時 ${nowLocal} を基準に解釈。
- start/end は "YYYY-MM-DDTHH:mm:ss" 形式のローカル時刻。
- 必須情報不足時は needsClarification=true。
- clarificationQuestion は次に必要な質問を1つだけ日本語で返す。
${hasImageInputs ? "- 添付画像内の文字情報を読み取り（OCR）、回答文と統合して補完する。" : ""}

ユーザー定義ルール:
${settings.timeResolutionRulesText || "(なし)"}

カスタム指示:
${instructionText || "(なし)"}

現在のドラフト:
${JSON.stringify(draft, null, 2)}

直前の質問:
${question}

ユーザー回答:
${answer}

JSONスキーマ:
{
  "title": "string",
  "start": "YYYY-MM-DDTHH:mm:ss or empty",
  "end": "YYYY-MM-DDTHH:mm:ss or empty",
  "location": "string",
  "description": "string",
  "confidence": 0.0,
  "uncertain": false,
  "needsClarification": false,
  "clarificationQuestion": "string",
  "reasoning": "string"
}`;
}

export async function interpretWithGemini({
  text,
  imageInputs = [],
  settings,
  instructionText
}) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini APIキーが設定されていません。設定画面で登録してください。");
  }

  await logGemini("info", "gemini.interpret.start", {
    model: settings.model,
    imageCount: imageInputs.length,
    inputPreview: String(text || "").slice(0, 120)
  });

  const raw = await generateJsonWithGemini({
    model: settings.model,
    prompt: buildInterpretPrompt({
      text,
      settings,
      instructionText,
      hasImageInputs: imageInputs.length > 0
    }),
    imageInputs,
    apiKey
  });

  const draft = normalizeGeminiDraft(raw);
  await logGemini("info", "gemini.interpret.done", {
    model: settings.model,
    hasTitle: Boolean(draft.title),
    hasStart: Boolean(draft.start),
    hasEnd: Boolean(draft.end),
    needsClarification: Boolean(draft.needsClarification)
  });

  return draft;
}

export async function refineWithGemini({
  draft,
  question,
  answer,
  imageInputs = [],
  settings,
  instructionText
}) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini APIキーが設定されていません。設定画面で登録してください。");
  }

  await logGemini("info", "gemini.refine.start", {
    model: settings.model,
    imageCount: imageInputs.length,
    questionPreview: String(question || "").slice(0, 120),
    answerPreview: String(answer || "").slice(0, 120)
  });

  const raw = await generateJsonWithGemini({
    model: settings.model,
    prompt: buildRefinePrompt({
      draft,
      question,
      answer,
      settings,
      instructionText,
      hasImageInputs: imageInputs.length > 0
    }),
    imageInputs,
    apiKey
  });

  const normalizedDraft = normalizeGeminiDraft(raw);
  await logGemini("info", "gemini.refine.done", {
    model: settings.model,
    hasTitle: Boolean(normalizedDraft.title),
    hasStart: Boolean(normalizedDraft.start),
    hasEnd: Boolean(normalizedDraft.end),
    needsClarification: Boolean(normalizedDraft.needsClarification)
  });

  return normalizedDraft;
}
