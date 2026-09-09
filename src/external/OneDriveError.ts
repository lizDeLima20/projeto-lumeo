import { I18nManager } from "../i18n/I18nManager";
import type { ExternalLibraryTranslationKey } from "../i18n/ExternalLibraryTranslations";
export class OneDriveError extends Error {
  public constructor(public readonly code: ExternalLibraryTranslationKey) { super(I18nManager.shared.t(code)); }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OneDriveError("import.download.cancelled");
}
