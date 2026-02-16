import { google } from "googleapis";
import { createOAuthClientFromConfig } from "./google-auth.js";
import { getGoogleTokens, setGoogleTokens } from "./secure-store.js";
import { getLocalTimezone, normalizeTitle, toDate } from "./date-utils.js";
import { appendLog } from "./app-logger.js";

async function getAuthorizedCalendar(settings) {
  const storedTokens = await getGoogleTokens();
  if (!storedTokens) {
    throw new Error("Google連携が未接続です。設定画面で接続してください。");
  }

  const oauth2Client = createOAuthClientFromConfig();
  oauth2Client.setCredentials(storedTokens);

  oauth2Client.on("tokens", (tokens) => {
    const merged = {
      ...storedTokens,
      ...tokens
    };
    setGoogleTokens(merged).catch((error) => {
      console.warn(
        `[googleTokens] トークン保存に失敗しました: ${String(error.message || error)}`
      );
    });
  });

  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client
  });

  return { calendar, oauth2Client };
}

function buildEventPayload(eventDraft, settings) {
  const timezone = getLocalTimezone();

  return {
    summary: eventDraft.title,
    location: eventDraft.location || undefined,
    description: eventDraft.description || undefined,
    start: {
      dateTime: eventDraft.start,
      timeZone: timezone
    },
    end: {
      dateTime: eventDraft.end,
      timeZone: timezone
    }
  };
}

export async function insertCalendarEvent({ draft, settings }) {
  const { calendar } = await getAuthorizedCalendar(settings);
  const requestBody = buildEventPayload(draft, settings);
  const calendarId = settings.calendarId || "primary";

  try {
    await appendLog("info", "calendar.insert.request", {
      calendarId,
      summary: requestBody.summary || "",
      start: requestBody.start?.dateTime || "",
      end: requestBody.end?.dateTime || "",
      timeZone: requestBody.start?.timeZone || ""
    });
  } catch {
    // ignore logging failure
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody
  });

  try {
    await appendLog("info", "calendar.insert.response", {
      calendarId,
      eventId: response.data?.id || "",
      htmlLink: response.data?.htmlLink || "",
      status: response.data?.status || "",
      organizer: response.data?.organizer?.email || "",
      start: response.data?.start?.dateTime || response.data?.start?.date || "",
      end: response.data?.end?.dateTime || response.data?.end?.date || ""
    });
  } catch {
    // ignore logging failure
  }

  return response.data;
}

export async function findDuplicateCandidates({ draft, settings }) {
  const start = toDate(draft.start);
  if (!start) {
    return [];
  }

  const { calendar } = await getAuthorizedCalendar(settings);

  const min = new Date(start.getTime() - 30 * 60 * 1000).toISOString();
  const max = new Date(start.getTime() + 30 * 60 * 1000).toISOString();
  const normalizedTargetTitle = normalizeTitle(draft.title);

  const response = await calendar.events.list({
    calendarId: settings.calendarId || "primary",
    timeMin: min,
    timeMax: max,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20
  });

  const items = response.data.items || [];
  return items.filter((item) => {
    const itemTitle = normalizeTitle(item.summary || "");
    if (!itemTitle || itemTitle !== normalizedTargetTitle) {
      return false;
    }

    const itemStartRaw = item.start?.dateTime || item.start?.date;
    const itemStartDate = toDate(itemStartRaw);
    if (!itemStartDate) {
      return false;
    }

    const diffMinutes = Math.abs(itemStartDate.getTime() - start.getTime()) / 60000;
    return diffMinutes <= 30;
  });
}
