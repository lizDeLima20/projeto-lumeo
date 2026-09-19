/** "book" is Literata, a serif drawn for long reading on screens, bundled with the app. */
export type ReaderFontFamily = "book" | "classic" | "modern" | "sans" | "accessible";
export type ReaderTextColor = "soft-black" | "graphite" | "dark-brown" | "night-beige";
export type ReaderSpacing = "compact" | "normal" | "comfortable" | "wide";
export type ReaderMargins = "narrow" | "normal" | "wide";
/** "paper" is a warm, soft off-white; "pure-white" is shown as Claro. */
export type ReaderPaper = "paper" | "pure-white" | "ivory" | "cream" | "sepia" | "soft-white" | "natural" | "dark";
export type ReaderPageLayout = "single" | "double";
/** Folhear = physical page, Deslize = vertical continuous, Carrossel = horizontal snap. */
export type ReaderPageAnimation = "page-turn" | "slide" | "carousel";
export type ImageProfile = "normal" | "high-contrast" | "soft";
export type ReaderReadingMode = "standard" | "book-real";

export interface ReaderPreferences {
  fontFamily: ReaderFontFamily;
  fontSize: number;
  fontWeight: 300 | 400 | 700;
  textColor: ReaderTextColor;
  lineSpacing: ReaderSpacing;
  margins: ReaderMargins;
  paperTheme: ReaderPaper;
  readerBrightness: number;
  readingMode: ReaderReadingMode;
  pageLayout: ReaderPageLayout;
  pageAnimation: ReaderPageAnimation;
  imagePreset: "original" | "scannedText" | "oldDocument" | "manga";
  imageProfile: ImageProfile;
  /** Pomodoro Lumeo: focus/break cycle and a daily page goal. Off until the reader turns it on. */
  pomodoroEnabled: boolean;
  /** "Não obrigar tempo + páginas simultaneamente": exactly one goal drives a session. */
  pomodoroGoalType: "time" | "pages";
  pomodoroFocusMinutes: number;
  pomodoroBreakMinutes: number;
  dailyPagesGoal: number;
  /** Android reading brightness of the Lumeo window, in percent; null follows the system. */
  screenBrightness: number | null;
  /** 1 once the Android e-reader defaults were offered to this install; they are offered once. */
  androidReaderDefaults: number;
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontFamily: "classic", fontSize: 18, fontWeight: 400, textColor: "soft-black",
  lineSpacing: "normal", margins: "normal", paperTheme: "ivory", readerBrightness: 100, readingMode: "standard",
  pageLayout: "double", pageAnimation: "page-turn", imagePreset: "original", imageProfile: "normal",
  pomodoroEnabled: false, pomodoroGoalType: "time", pomodoroFocusMinutes: 25, pomodoroBreakMinutes: 5, dailyPagesGoal: 20,
  screenBrightness: null, androidReaderDefaults: 0,
};

/** What the Android e-reader starts with before the reader chooses anything. */
export const ANDROID_READER_DEFAULTS: Partial<ReaderPreferences> = { fontFamily: "book", paperTheme: "paper" };

export const spacingValues: Record<ReaderSpacing, { lineHeight: number; paragraphSpacing: number }> = {
  compact: { lineHeight: 1.35, paragraphSpacing: .55 }, normal: { lineHeight: 1.6, paragraphSpacing: .9 },
  comfortable: { lineHeight: 1.8, paragraphSpacing: 1.2 }, wide: { lineHeight: 2.05, paragraphSpacing: 1.55 },
};

export const marginValues: Record<ReaderMargins, number> = { narrow: 16, normal: 28, wide: 48 };
export const textColorValues: Record<ReaderTextColor, string> = {
  "soft-black": "#24231f", graphite: "#3c3a36", "dark-brown": "#493526", "night-beige": "#ded5c4",
};
