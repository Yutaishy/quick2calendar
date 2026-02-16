function pad(value) {
  return String(value).padStart(2, "0");
}

function toHalfWidthDigits(text) {
  return String(text || "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 65248)
  );
}

function parseJaNumberToken(token) {
  const normalized = toHalfWidthDigits(String(token || "").trim());
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const digitMap = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9
  };

  let total = 0;
  let current = 0;

  for (const char of normalized) {
    if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }

    if (!(char in digitMap)) {
      return null;
    }
    current += digitMap[char];
  }

  return total + current;
}

function buildRelativeDateTime(dayKeyword, hourToken, minuteToken, hasHalf, now) {
  const hour = parseJaNumberToken(hourToken);
  const minute = hasHalf
    ? 30
    : minuteToken !== undefined
      ? parseJaNumberToken(minuteToken)
      : 0;

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  const base = new Date(now);
  if (dayKeyword === "明日") {
    base.setDate(base.getDate() + 1);
  }

  const validated = buildValidatedDate({
    year: base.getFullYear(),
    month: base.getMonth() + 1,
    day: base.getDate(),
    hour,
    minute
  });
  if (!validated) {
    return null;
  }

  return formatLocalDateTime(validated);
}

function resolveRelativeDateTime(text, now, options = {}) {
  const loose = Boolean(options.loose);
  const patterns = [
    {
      re: loose
        ? /(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})\s*(?::|：)\s*([0-9〇零一二三四五六七八九十]{1,3})/
        : /^(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})\s*(?::|：)\s*([0-9〇零一二三四五六七八九十]{1,3})$/,
      parse: (match) =>
        buildRelativeDateTime(match[1], match[2], match[3], false, now)
    },
    {
      re: loose
        ? /(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時\s*([0-9〇零一二三四五六七八九十]{1,3})\s*分?/
        : /^(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時\s*([0-9〇零一二三四五六七八九十]{1,3})\s*分?$/,
      parse: (match) =>
        buildRelativeDateTime(match[1], match[2], match[3], false, now)
    },
    {
      re: loose
        ? /(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時半/
        : /^(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時半$/,
      parse: (match) => buildRelativeDateTime(match[1], match[2], undefined, true, now)
    },
    {
      re: loose
        ? /(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時/
        : /^(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})時$/,
      parse: (match) =>
        buildRelativeDateTime(match[1], match[2], undefined, false, now)
    },
    {
      re: loose
        ? /(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})\b/
        : /^(今日|明日)\s*([0-9〇零一二三四五六七八九十]{1,3})$/,
      parse: (match) =>
        buildRelativeDateTime(match[1], match[2], undefined, false, now)
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.re);
    if (!match) {
      continue;
    }
    const parsed = pattern.parse(match);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function buildValidatedDate({
  year,
  month,
  day,
  hour = 9,
  minute = 0
}) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mm = Number(minute);

  if (
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    !Number.isInteger(h) ||
    !Number.isInteger(mm)
  ) {
    return null;
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mm < 0 || mm > 59) {
    return null;
  }

  const date = new Date(y, m - 1, d, h, mm, 0, 0);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mm
  ) {
    return null;
  }

  return date;
}

export function getLocalTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
}

export function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:00`;
}

export function parseFlexibleDateTime(input, now = new Date()) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const text = toHalfWidthDigits(input.trim());
  if (!text) {
    return null;
  }

  // 「今日/明日」は先に判定する。先に「日」を除去すると語が壊れるため。
  const relativePrepared = text
    .replace(/：/g, ":")
    .replace(/\s+/g, " ")
    .trim();

  const strictRelative = resolveRelativeDateTime(relativePrepared, now, {
    loose: false
  });
  if (strictRelative) {
    return strictRelative;
  }

  // 文中の「明日五時から」のような表現にも対応する。
  const looseRelative = resolveRelativeDateTime(relativePrepared, now, {
    loose: true
  });
  if (looseRelative) {
    return looseRelative;
  }

  const normalized = text
    .replace(/：/g, ":")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/時/g, ":")
    .replace(/分/g, "")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const fullMatch = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?)?$/
  );
  if (fullMatch) {
    const date = buildValidatedDate({
      year: fullMatch[1],
      month: fullMatch[2],
      day: fullMatch[3],
      hour: fullMatch[4] || 9,
      minute: fullMatch[5] || 0
    });
    if (date) {
      return formatLocalDateTime(date);
    }
  }

  const shortMatch = normalized.match(
    /^(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?)?$/
  );
  if (shortMatch) {
    const date = buildValidatedDate({
      year: now.getFullYear(),
      month: shortMatch[1],
      day: shortMatch[2],
      hour: shortMatch[3] || 9,
      minute: shortMatch[4] || 0
    });
    if (date) {
      return formatLocalDateTime(date);
    }
  }

  return null;
}

export function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    const fallback = new Date(value.replace("T", " "));
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  }

  return null;
}

export function addMinutesToLocalDateTime(localDateTime, minutes) {
  const base = toDate(localDateTime);
  if (!base) {
    return null;
  }

  const next = new Date(base.getTime() + minutes * 60 * 1000);
  return formatLocalDateTime(next);
}

export function isStartBeforeEnd(start, end) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) {
    return false;
  }

  return startDate.getTime() < endDate.getTime();
}

export function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[!-/:-@[-`{-~]/g, "");
}
