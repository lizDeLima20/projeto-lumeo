import type { StudyLanguage } from "./StudyLookupTypes";

export interface DictionaryResult {
  word: string;
  partOfSpeech?: string;
  definitions: string[];
  examples: string[];
  origin?: string;
  source: string;
  language: StudyLanguage;
  available: boolean;
}

export interface DictionaryProvider {
  lookup(word: string, language: StudyLanguage): Promise<DictionaryResult>;
}

export interface OriginProvider {
  lookup(word: string, language: StudyLanguage): Promise<string | null>;
}
