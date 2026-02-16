export const APP_ID = "com.yuta.quick2calendar";
export const APP_NAME = "Quick2Calendar";
export const SETTINGS_FILE_NAME = "settings.json";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+G";
export const DEFAULT_DURATION_MINUTES = 60;
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events"
];

export const SECRET_KEYS = {
  geminiApiKey: "gemini_api_key",
  googleTokens: "google_tokens"
};

export const DEFAULT_INSTRUCTION_PRESETS = [
  {
    id: "work",
    name: "仕事用",
    text: "仕事関連の予定は開始時刻と終了時刻を明確にし、会議名を簡潔にタイトル化してください。"
  },
  {
    id: "private",
    name: "プライベート用",
    text: "私用予定は自然なタイトルにし、場所や持ち物があれば説明に含めてください。"
  },
  {
    id: "meal",
    name: "食事・会食用",
    text: "食事・ランチ・ディナー・会食を含む場合、終了時刻未指定なら2時間で補完してください。"
  }
];

export const DEFAULT_SETTINGS = {
  shortcut: DEFAULT_SHORTCUT,
  defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
  inputMode: "ai",
  aiEnabled: true,
  model: DEFAULT_GEMINI_MODEL,
  calendarId: "primary",
  confirmationPolicy: "uncertain_only",
  askPolicy: "uncertain_only",
  launchAtLogin: false,
  geminiInstruction:
    "入力文から予定を抽出し、曖昧な情報があれば1つずつ聞き返してからGoogleカレンダーに登録する。",
  timeResolutionRulesText:
    "食事 / ランチ / ディナー / 会食 を含む予定は、終了未指定なら2時間で補完する。",
  customInstructionPresets: DEFAULT_INSTRUCTION_PRESETS,
  activeInstructionPresetId: "work",
  history: []
};

export const MAX_HISTORY_ITEMS = 5;
