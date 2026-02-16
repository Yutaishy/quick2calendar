import { v4 as uuidv4 } from "uuid";
import {
  addMinutesToLocalDateTime,
  formatLocalDateTime,
  isStartBeforeEnd,
  parseFlexibleDateTime,
  toDate
} from "./date-utils.js";
import { interpretWithGemini, refineWithGemini } from "./gemini-client.js";
import {
  findDuplicateCandidates,
  insertCalendarEvent
} from "./google-calendar-client.js";
import { appendHistory, getSettings } from "./settings-store.js";
import { appendLog } from "./app-logger.js";

function isAffirmative(input) {
  const raw = String(input || "").trim();
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[\s　。、,.!！?？]/g, "");

  if (/\b(?:y|yes|ok|okay)\b/.test(lower)) {
    return true;
  }

  return [
    "はい",
    "登録",
    "進めて",
    "お願いします",
    "おねがいします",
    "実行"
  ].some((token) => compact.includes(token));
}

function isNegative(input) {
  const raw = String(input || "").trim();
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[\s　。、,.!！?？]/g, "");

  if (/\b(?:n|no)\b/.test(lower)) {
    return true;
  }

  return ["いいえ", "キャンセル", "やめる", "中止", "停止"].some((token) =>
    compact.includes(token)
  );
}

function sanitizeDraft(draft, defaultDurationMinutes) {
  const normalized = {
    title: String(draft?.title || "").trim(),
    start: String(draft?.start || "").trim(),
    end: String(draft?.end || "").trim(),
    location: String(draft?.location || "").trim(),
    description: String(draft?.description || "").trim(),
    confidence: Number(draft?.confidence || 0),
    uncertain: Boolean(draft?.uncertain),
    needsClarification: Boolean(draft?.needsClarification),
    clarificationQuestion: String(draft?.clarificationQuestion || "").trim(),
    userConfirmed: Boolean(draft?.userConfirmed),
    duplicateConfirmed: Boolean(draft?.duplicateConfirmed)
  };

  if (normalized.start && !normalized.end) {
    normalized.end = addMinutesToLocalDateTime(
      normalized.start,
      defaultDurationMinutes
    );
  }

  return normalized;
}

function buildDraftPreview(draft) {
  return {
    title: draft.title,
    start: draft.start,
    end: draft.end,
    location: draft.location,
    description: draft.description
  };
}

function normalizeImageInputs(rawInputs) {
  if (!Array.isArray(rawInputs)) {
    return [];
  }

  return rawInputs
    .map((item) => {
      const mimeType = String(item?.mimeType || "").trim().toLowerCase();
      const dataBase64 = String(item?.dataBase64 || "").trim();
      const name = String(item?.name || "image").trim() || "image";
      if (!mimeType || !dataBase64) {
        return null;
      }
      const estimatedSize = Math.floor((dataBase64.length * 3) / 4);
      const sizeBytes = Number(item?.sizeBytes || estimatedSize);
      return {
        name,
        mimeType,
        dataBase64,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : estimatedSize
      };
    })
    .filter(Boolean);
}

function normalizeCreateInput(rawInput) {
  if (typeof rawInput === "string") {
    return {
      text: rawInput,
      imageInputs: []
    };
  }
  return {
    text: String(rawInput?.text || ""),
    imageInputs: normalizeImageInputs(rawInput?.imageInputs)
  };
}

function normalizeAnswerInput(rawInput) {
  if (typeof rawInput === "string") {
    return {
      text: rawInput,
      imageInputs: []
    };
  }
  return {
    text: String(rawInput?.text || ""),
    imageInputs: normalizeImageInputs(rawInput?.imageInputs)
  };
}

function mergeImageInputs(baseInputs, additionalInputs) {
  const merged = [...normalizeImageInputs(baseInputs), ...normalizeImageInputs(additionalInputs)];
  return merged.slice(-3);
}

function logScheduler(level, event, data = {}) {
  return appendLog(level, event, data).catch(() => {
    // ログ失敗で本処理は止めない。
  });
}

export class SchedulerService {
  constructor() {
    this.sessions = new Map();
  }

  async resolveDateTimeFromClarification(session, answer, field, answerImages = []) {
    try {
      const refined = await refineWithGemini({
        draft: session.draft,
        question: session.question,
        answer,
        imageInputs: mergeImageInputs(session.sourceImages, answerImages),
        settings: session.settings,
        instructionText: session.instructionText
      });
      const candidate = field === "end" ? refined?.end : refined?.start;
      const strict = parseFlexibleDateTime(String(candidate || ""));
      if (strict) {
        return strict;
      }

      const dateValue = toDate(String(candidate || ""));
      if (dateValue) {
        return formatLocalDateTime(dateValue);
      }

      return null;
    } catch {
      return null;
    }
  }

  async createFromInput(rawInput) {
    const { text, imageInputs } = normalizeCreateInput(rawInput);
    if (!String(text || "").trim() && imageInputs.length === 0) {
      return {
        status: "error",
        message: "入力文または画像を指定してください。"
      };
    }

    const settings = await getSettings();
    const instructionText = this.getActiveInstructionText(settings);
    await logScheduler("info", "schedule.create.start", {
      inputPreview: String(text || "").slice(0, 120),
      imageCount: imageInputs.length,
      model: settings.model,
      calendarId: settings.calendarId || "primary"
    });

    let initialDraft = null;
    try {
      initialDraft = await interpretWithGemini({
        text,
        imageInputs,
        settings,
        instructionText
      });
    } catch (error) {
      await logScheduler("error", "schedule.create.interpret_error", {
        message: String(error.message || error)
      });
      return {
        status: "error",
        message: `Gemini解釈に失敗しました: ${String(error.message || error)}`
      };
    }

    if (!initialDraft || typeof initialDraft !== "object") {
      await logScheduler("error", "schedule.create.invalid_draft", {
        draftType: typeof initialDraft
      });
      return {
        status: "error",
        message: "Geminiの応答を解釈できませんでした。プロンプトを見直してください。"
      };
    }

    await logScheduler("info", "schedule.create.interpreted", {
      hasTitle: Boolean(initialDraft.title),
      hasStart: Boolean(initialDraft.start),
      hasEnd: Boolean(initialDraft.end),
      needsClarification: Boolean(initialDraft.needsClarification)
    });

    return this.progressDraft({
      settings,
      draft: initialDraft,
      sourceText: text,
      sourceImages: imageInputs,
      instructionText
    });
  }

  async answerClarification(sessionId, rawAnswer) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      await logScheduler("warn", "schedule.answer.session_not_found", {
        sessionId: String(sessionId || "")
      });
      return {
        status: "error",
        message: "確認セッションが見つかりません。もう一度入力してください。"
      };
    }

    const answerInput = normalizeAnswerInput(rawAnswer);
    const answer = String(answerInput.text || "").trim();
    const answerImages = answerInput.imageInputs;
    const mergedSourceImages = mergeImageInputs(session.sourceImages, answerImages);
    const { questionType } = session;
    await logScheduler("info", "schedule.answer.start", {
      sessionId,
      questionType,
      answerPreview: answer.slice(0, 120),
      imageCount: answerImages.length
    });

    if (!answer && answerImages.length === 0 && questionType !== "confirm_before_create") {
      return {
        status: "needs_clarification",
        sessionId,
        question: session.question,
        draft: buildDraftPreview(session.draft)
      };
    }

    try {
      switch (questionType) {
        case "missing_title": {
          if (!answer && answerImages.length > 0) {
            const refined = await refineWithGemini({
              draft: session.draft,
              question: session.question,
              answer: "",
              imageInputs: mergedSourceImages,
              settings: session.settings,
              instructionText: session.instructionText
            });
            session.draft.title = String(refined?.title || "").trim();
          } else {
            session.draft.title = answer;
          }
          session.draft.needsClarification = false;
          session.draft.clarificationQuestion = "";
          break;
        }
        case "missing_start": {
          const parsed = await this.resolveDateTimeFromClarification(
            session,
            answer,
            "start",
            answerImages
          );
          if (!parsed) {
            return this.askQuestion(
              {
                ...session,
                sourceImages: mergedSourceImages,
                question:
                  "開始日時を確定できませんでした。もう少し具体的に入力してください（例: 2026-02-14 19:00）"
              },
              sessionId
            );
          }
          session.draft.start = parsed;
          session.draft.needsClarification = false;
          session.draft.clarificationQuestion = "";
          break;
        }
        case "missing_end": {
          const parsed = await this.resolveDateTimeFromClarification(
            session,
            answer,
            "end",
            answerImages
          );
          if (!parsed) {
            return this.askQuestion(
              {
                ...session,
                sourceImages: mergedSourceImages,
                question:
                  "終了日時を確定できませんでした。もう少し具体的に入力してください（例: 2026-02-14 20:00）"
              },
              sessionId
            );
          }
          session.draft.end = parsed;
          session.draft.needsClarification = false;
          session.draft.clarificationQuestion = "";
          break;
        }
        case "invalid_time_range": {
          const parsed = await this.resolveDateTimeFromClarification(
            session,
            answer,
            "end",
            answerImages
          );
          if (!parsed) {
            return this.askQuestion(
              {
                ...session,
                sourceImages: mergedSourceImages,
                question:
                  "終了日時を再確認したいです。開始より後になる時刻を具体的に入力してください（例: 2026-02-14 20:00）"
              },
              sessionId
            );
          }
          session.draft.end = parsed;
          session.draft.needsClarification = false;
          session.draft.clarificationQuestion = "";
          break;
        }
        case "model_followup": {
          const refined = await refineWithGemini({
            draft: session.draft,
            question: session.question,
            answer,
            imageInputs: mergedSourceImages,
            settings: session.settings,
            instructionText: session.instructionText
          });
          session.draft = {
            ...session.draft,
            ...refined
          };
          break;
        }
        case "confirm_before_create": {
          if (isNegative(answer)) {
            this.sessions.delete(sessionId);
            return {
              status: "cancelled",
              message: "登録をキャンセルしました。"
            };
          }

          if (!isAffirmative(answer)) {
            return this.askQuestion(
              {
                ...session,
                sourceImages: mergedSourceImages,
                question: "登録してよければ「はい」、中止なら「いいえ」と入力してください。"
              },
              sessionId
            );
          }
          session.draft.userConfirmed = true;
          break;
        }
        case "duplicate_confirm": {
          if (!isAffirmative(answer)) {
            this.sessions.delete(sessionId);
            return {
              status: "cancelled",
              message: "重複候補があるため登録を中止しました。"
            };
          }
          session.draft.duplicateConfirmed = true;
          break;
        }
        default:
          break;
      }

      return this.progressDraft({
        settings: session.settings,
        draft: session.draft,
        sourceText: session.sourceText,
        sourceImages: mergedSourceImages,
        instructionText: session.instructionText,
        existingSessionId: sessionId
      });
    } catch (error) {
      await logScheduler("error", "schedule.answer.error", {
        sessionId,
        questionType,
        message: String(error.message || error)
      });
      return {
        status: "error",
        message: `確認処理に失敗しました: ${error.message || error}`
      };
    }
  }

  cancelSession(sessionId) {
    this.sessions.delete(sessionId);
    return {
      status: "cancelled",
      message: "登録をキャンセルしました。"
    };
  }

  getActiveInstructionText(settings) {
    if (typeof settings.geminiInstruction === "string") {
      return settings.geminiInstruction.trim();
    }
    const presets = settings.customInstructionPresets || [];
    const active = presets.find(
      (preset) => preset.id === settings.activeInstructionPresetId
    );
    return active?.text || "";
  }

  async completeMissingFieldsWithGemini({
    draft,
    sourceText,
    sourceImages,
    settings,
    instructionText
  }) {
    const hasMissing = !draft?.title || !draft?.start || !draft?.end;
    if (!hasMissing) {
      return draft;
    }

    await logScheduler("info", "schedule.refine_missing.start", {
      hasTitle: Boolean(draft?.title),
      hasStart: Boolean(draft?.start),
      hasEnd: Boolean(draft?.end)
    });

    try {
      const refined = await refineWithGemini({
        draft,
        question:
          "元の入力文から不足項目を補完してください。推定できる場合は補完し、どうしても不明な場合のみ needsClarification=true にしてください。",
        answer: sourceText,
        imageInputs: sourceImages,
        settings,
        instructionText
      });
      return sanitizeDraft(
        {
          ...draft,
          ...refined
        },
        settings.defaultDurationMinutes
      );
    } catch (error) {
      await logScheduler("warn", "schedule.refine_missing.failed", {
        message: String(error?.message || error)
      });
      return draft;
    }
  }

  async progressDraft({
    settings,
    draft,
    sourceText,
    sourceImages = [],
    instructionText,
    existingSessionId = null
  }) {
    let normalized = sanitizeDraft(draft, settings.defaultDurationMinutes);
    normalized = await this.completeMissingFieldsWithGemini({
      draft: normalized,
      sourceText,
      sourceImages,
      settings,
      instructionText
    });

    await logScheduler("info", "schedule.progress.normalized", {
      hasTitle: Boolean(normalized.title),
      hasStart: Boolean(normalized.start),
      hasEnd: Boolean(normalized.end),
      needsClarification: Boolean(normalized.needsClarification),
      confidence: Number(normalized.confidence || 0)
    });

    if (!normalized.title) {
      await logScheduler("warn", "schedule.progress.ask_missing_title", {});
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "missing_title",
          question: "予定タイトルを教えてください。",
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    if (!normalized.start) {
      await logScheduler("warn", "schedule.progress.ask_missing_start", {});
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "missing_start",
          question: "開始日時を教えてください（例: 2026-02-14 19:00）。",
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    if (!normalized.end) {
      await logScheduler("warn", "schedule.progress.ask_missing_end", {});
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "missing_end",
          question: "終了日時を教えてください（例: 2026-02-14 20:00）。",
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    if (!isStartBeforeEnd(normalized.start, normalized.end)) {
      await logScheduler("warn", "schedule.progress.ask_invalid_time_range", {
        start: normalized.start,
        end: normalized.end
      });
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "invalid_time_range",
          question:
            "開始日時より後の終了日時を入力してください（例: 2026-02-14 20:00）。",
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    if (normalized.needsClarification && normalized.clarificationQuestion) {
      await logScheduler("info", "schedule.progress.ask_model_followup", {
        question: normalized.clarificationQuestion
      });
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "model_followup",
          question: normalized.clarificationQuestion,
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    const needsExplicitConfirm =
      settings.askPolicy === "always" ||
      (settings.askPolicy === "uncertain_only" &&
        (normalized.uncertain || normalized.confidence < 0.6));

    if (needsExplicitConfirm && !normalized.userConfirmed) {
      const preview = `以下で登録しますか？\nタイトル: ${normalized.title}\n開始: ${normalized.start}\n終了: ${normalized.end}\n場所: ${normalized.location || "(なし)"}`;
      await logScheduler("info", "schedule.progress.ask_confirm_before_create", {
        confidence: Number(normalized.confidence || 0),
        uncertain: Boolean(normalized.uncertain)
      });
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "confirm_before_create",
          question: `${preview}\n\n登録するなら「はい」、中止するなら「いいえ」と入力してください。`,
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    let duplicateCandidates = [];
    try {
      duplicateCandidates = await findDuplicateCandidates({
        draft: normalized,
        settings
      });
    } catch (error) {
      await logScheduler("warn", "schedule.progress.duplicate_check_failed", {
        message: String(error?.message || error)
      });
      duplicateCandidates = [];
    }

    await logScheduler("info", "schedule.progress.duplicate_check_done", {
      count: duplicateCandidates.length
    });

    if (duplicateCandidates.length > 0 && !normalized.duplicateConfirmed) {
      const candidate = duplicateCandidates[0];
      await logScheduler("info", "schedule.progress.ask_duplicate_confirm", {
        candidateSummary: candidate.summary || "",
        candidateStart: candidate.start?.dateTime || candidate.start?.date || ""
      });
      return this.askQuestion(
        {
          draft: normalized,
          questionType: "duplicate_confirm",
          question:
            `重複候補があります（${candidate.summary || "無題"} / ${candidate.start?.dateTime || candidate.start?.date}）。それでも登録しますか？\n登録するなら「はい」、中止するなら「いいえ」と入力してください。`,
          settings,
          sourceText,
          sourceImages,
          instructionText
        },
        existingSessionId
      );
    }

    try {
      await logScheduler("info", "calendar.insert.start", {
        calendarId: settings.calendarId || "primary",
        title: normalized.title,
        start: normalized.start,
        end: normalized.end
      });
      const created = await insertCalendarEvent({
        draft: normalized,
        settings
      });

      await logScheduler("info", "calendar.insert.success", {
        eventId: created?.id || "",
        htmlLink: created?.htmlLink || ""
      });

      await appendHistory({
        id: created.id,
        title: normalized.title,
        start: normalized.start,
        end: normalized.end,
        createdAt: new Date().toISOString(),
        htmlLink: created.htmlLink || ""
      });

      if (existingSessionId) {
        this.sessions.delete(existingSessionId);
      }

      return {
        status: "success",
        message: "Googleカレンダーに登録しました。",
        event: {
          id: created.id,
          htmlLink: created.htmlLink,
          title: normalized.title,
          start: normalized.start,
          end: normalized.end
        }
      };
    } catch (error) {
      await logScheduler("error", "calendar.insert.failed", {
        message: String(error?.message || error)
      });
      return {
        status: "error",
        message: `Googleカレンダー登録に失敗しました: ${error.message || error}`
      };
    }
  }

  askQuestion(payload, existingSessionId) {
    const sessionId = existingSessionId || uuidv4();

    this.sessions.set(sessionId, {
      ...payload
    });

    logScheduler("info", "schedule.question.issued", {
      sessionId,
      questionType: payload.questionType,
      question: payload.question
    });

    return {
      status: "needs_clarification",
      sessionId,
      question: payload.question,
      draft: buildDraftPreview(payload.draft)
    };
  }
}
