import { Book } from "../models/Book";
import { Genre } from "../models/Genre";
import { Library } from "../models/Library";

export interface User { id: string; email: string; }
/** Explicit boot phases prevent a persisted session being mistaken for a logout. */
export type AuthStatus = "AUTH_INITIALIZING" | "SESSION_RESTORED" | "USER_DATA_LOADING" | "READY" | "UNKNOWN" | "AUTHENTICATED" | "UNAUTHENTICATED" | "REFRESHING" | "OFFLINE_AUTHENTICATED" | "EXPIRED" | "loading" | "authenticated" | "unauthenticated";
export type DeviceStatus = "unknown" | "authorized" | "conflict" | "revoked";
export type LicenseStatus = "unknown" | "active" | "inactive" | "trial" | "grace" | "expired" | "revoked" | "offline_grace";
export interface ConflictingDevice { deviceName: string; lastSeenAt: string; }

export interface AppSettings {
  theme: "light" | "dark";
}

type StateListener = () => void;

export class AppState {
  public currentUser: User | null = null;
  public authStatus: AuthStatus = "loading";
  public deviceStatus: DeviceStatus = "unknown";
  public licenseStatus: LicenseStatus = "unknown";
  public conflictingDevice: ConflictingDevice | null = null;
  public onboardingCompleted = false;
  public readonly library = new Library();
  public readonly settings: AppSettings = { theme: "light" };
  private readonly listeners = new Set<StateListener>();

  public get genres(): readonly Genre[] {
    return this.library.getGenres();
  }

  public get books(): readonly Book[] {
    return this.library.getBooks();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
