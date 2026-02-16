import {
  addMinutesToLocalDateTime,
  parseFlexibleDateTime,
  formatLocalDateTime
} from "./date-utils.js";

function extractLineValue(lines, label) {
  const line = lines.find((item) => item.startsWith(label));
  if (!line) {
    return "";
  }

  return line.replace(label, "").trim();
}

function extractRangeDateTime(text, now) {
  const rangeMatch = text.match(
    /(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\s+(\d{1,2}:\d{2})\s*[-~〜]\s*(\d{1,2}:\d{2})/
  );

  if (!rangeMatch) {
    return null;
  }

  const dateText = rangeMatch[1].replace(/\//g, "-");
  const start = parseFlexibleDateTime(`${dateText} ${rangeMatch[2]}`, now);
  const end = parseFlexibleDateTime(`${dateText} ${rangeMatch[3]}`, now);

  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function extractDateCandidates(text, now) {
  const matches = text.match(
    /(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}(?::\d{2})?)?|\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}(?::\d{2})?)?|(?:今日|明日)\s*[0-9０-９〇零一二三四五六七八九十]{1,3}(?:(?::|：)\s*[0-9０-９〇零一二三四五六七八九十]{1,3}|時\s*[0-9０-９〇零一二三四五六七八九十]{0,3}\s*分?|時半|時)?)/g
  );

  if (!matches) {
    return [];
  }

  return matches
    .map((candidate) => parseFlexibleDateTime(candidate, now))
    .filter(Boolean);
}

function stripLeadingSchedulePrefix(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "";
  }

  return source
    .replace(
      /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}\s*[-~〜]\s*\d{1,2}:\d{2}\s*/,
      ""
    )
    .replace(/^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}(?::\d{2})?\s*/, "")
    .replace(/^\d{1,2}[\/-]\d{1,2}\s+\d{1,2}(?::\d{2})?\s*/, "")
    .replace(/^(今日|明日)\s*\d{1,2}(?::\d{2})?\s*/, "")
    .replace(
      /^(今日|明日)\s*[0-9０-９〇零一二三四五六七八九十]{1,3}(?:(?::|：)\s*[0-9０-９〇零一二三四五六七八九十]{1,3}|時\s*[0-9０-９〇零一二三四五六七八九十]{0,3}\s*分?|時半|時)?\s*(?:から|より)?\s*/,
      ""
    )
    .trim();
}

export function parseDirectInput(text, defaultDurationMinutes = 60, now = new Date()) {
  const normalizedText = String(text || "").trim();
  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitTitle = extractLineValue(lines, "タイトル:");
  const explicitStart = extractLineValue(lines, "開始:");
  const explicitEnd = extractLineValue(lines, "終了:");
  const explicitLocation = extractLineValue(lines, "場所:");
  const explicitDescription = extractLineValue(lines, "説明:");

  const range = extractRangeDateTime(normalizedText, now);
  const inferredFromWholeText = parseFlexibleDateTime(normalizedText, now);
  const dateCandidates = extractDateCandidates(normalizedText, now);

  const start =
    parseFlexibleDateTime(explicitStart, now) ||
    range?.start ||
    inferredFromWholeText ||
    dateCandidates[0] ||
    null;

  const end =
    parseFlexibleDateTime(explicitEnd, now) ||
    range?.end ||
    dateCandidates[1] ||
    (start ? addMinutesToLocalDateTime(start, defaultDurationMinutes) : null);

  let title = explicitTitle;
  if (!title) {
    const firstLine = lines[0] || "";
    const strippedFirstLine = stripLeadingSchedulePrefix(firstLine);
    if (strippedFirstLine) {
      title = strippedFirstLine;
    }
  }

  if (!title && start) {
    title = "予定";
  }

  const description = explicitDescription || normalizedText;

  const parsed = {
    title,
    start,
    end,
    location: explicitLocation || "",
    description,
    confidence: start && end && title ? 0.8 : 0.4,
    uncertain: !(start && end && title),
    needsClarification: false,
    clarificationQuestion: ""
  };

  if (!parsed.title) {
    parsed.needsClarification = true;
    parsed.clarificationQuestion = "予定タイトルを教えてください。";
  } else if (!parsed.start) {
    parsed.needsClarification = true;
    parsed.clarificationQuestion =
      "開始日時を教えてください（例: 2026-02-14 19:00）。";
  } else if (!parsed.end) {
    parsed.needsClarification = true;
    parsed.clarificationQuestion =
      "終了日時を教えてください（例: 2026-02-14 20:00）。";
  }

  return parsed;
}

export function buildFallbackDraftFromNow(title, defaultDurationMinutes = 60) {
  const startDate = new Date();
  startDate.setMinutes(Math.ceil(startDate.getMinutes() / 5) * 5, 0, 0);
  const start = formatLocalDateTime(startDate);
  const end = addMinutesToLocalDateTime(start, defaultDurationMinutes);

  return {
    title: title || "予定",
    start,
    end,
    location: "",
    description: "",
    confidence: 0.2,
    uncertain: true,
    needsClarification: true,
    clarificationQuestion: "開始日時を教えてください（例: 2026-02-14 19:00）。"
  };
}
