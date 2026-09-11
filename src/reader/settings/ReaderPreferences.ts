export type ReaderFontFamily = "classic" | "modern" | "sans" | "accessible";
export type ReaderTextColor = "soft-black" | "graphite" | "dark-brown" | "night-beige";
export type ReaderSpacing = "compact" | "normal" | "comfortable" | "wide";
export type ReaderMargins = "narrow" | "normal" | "wide";
export type ReaderPaper = "pure-white" | "ivory" | "cream" | "sepia" | "soft-white" | "natural" | "dark";
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
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontFamily: "classic", fontSize: 18, fontWeight: 400, textColor: "soft-black",
  lineSpacing: "normal", margins: "normal", paperTheme: "ivory", readerBrightness: 100, readingMode: "standard",
  pageLayout: "double", pageAnimation: "page-turn", imagePreset: "original", imageProfile: "normal",
};

export const spacingValues: Record<ReaderSpacing, { lineHeight: number; paragraphSpacing: number }> = {
  compact: { lineHeight: 1.35, paragraphSpacing: .55 }, normal: { lineHeight: 1.6, paragraphSpacing: .9 },
  comfortable: { lineHeight: 1.8, paragraphSpacing: 1.2 }, wide: { lineHeight: 2.05, paragraphSpacing: 1.55 },
};

export const marginValues: Record<ReaderMargins, number> = { narrow: 16, normal: 28, wide: 48 };
export const textColorValues: Record<ReaderTextColor, string> = {
  "soft-black": "#24231f", graphite: "#3c3a36", "dark-brown": "#493526", "night-beige": "#ded5c4",
};
