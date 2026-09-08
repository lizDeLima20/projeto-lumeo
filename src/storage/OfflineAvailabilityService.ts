import type { Book } from "../models/Book";

export class OfflineAvailabilityService {
  public static readonly REMOTE_ONLY_MESSAGE_KEY = "offline.bookRemoteOnly";
  public static readonly NEEDS_INTERNET_MESSAGE_KEY = "offline.needsInternet";

  public canOpenOffline(book: Book, hasLocalFile: boolean): boolean {
    return hasLocalFile && book.offlineAvailability === "AVAILABLE";
  }

  public messageKey(book: Book): "offline.bookRemoteOnly" | "offline.needsInternet" | null {
    if (book.offlineAvailability === "REMOTE_ONLY") return OfflineAvailabilityService.REMOTE_ONLY_MESSAGE_KEY;
    if (book.offlineAvailability === "PARTIAL" || book.offlineAvailability === "ERROR") return OfflineAvailabilityService.NEEDS_INTERNET_MESSAGE_KEY;
    return null;
  }
}
