export type ConnectivityState = "ONLINE" | "OFFLINE" | "RECONNECTING";
export type ConnectivityListener = (state: ConnectivityState) => void;

export class ConnectivityManager {
  private state: ConnectivityState;
  private readonly listeners = new Set<ConnectivityListener>();

  public constructor(private readonly navigatorLike: Pick<Navigator, "onLine"> | null = typeof navigator === "undefined" ? null : navigator) {
    this.state = this.navigatorLike?.onLine === false ? "OFFLINE" : "ONLINE";
  }

  public bind(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => this.set("RECONNECTING"));
    window.addEventListener("offline", () => this.set("OFFLINE"));
  }

  public markReconnected(): void { this.set("ONLINE"); }
  public markOffline(): void { this.set("OFFLINE"); }
  public markReconnecting(): void { this.set("RECONNECTING"); }
  public current(): ConnectivityState { return this.state; }
  public get online(): boolean { return this.state === "ONLINE"; }

  public subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private set(state: ConnectivityState): void {
    if (state === this.state) return;
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
