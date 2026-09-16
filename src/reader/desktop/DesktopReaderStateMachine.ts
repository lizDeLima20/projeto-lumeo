export type DesktopReaderState =
  | "CLOSED"
  | "OPENING"
  | "OPEN"
  | "DRAGGING_NEXT"
  | "DRAGGING_PREVIOUS"
  | "SETTLING_NEXT"
  | "SETTLING_PREVIOUS"
  | "CLOSING";

/**
 * The desktop scene has a small, explicit visual state separate from the document
 * position.  A saved position of 0% is still a closed physical book; a position
 * greater than 0% resumes as an open spread.
 */
export class DesktopReaderStateMachine {
  private value: DesktopReaderState = "CLOSED";

  public get state(): DesktopReaderState { return this.value; }
  public get isClosed(): boolean { return this.value === "CLOSED" || this.value === "CLOSING"; }

  public restore(progressPercent: number | undefined): void {
    this.value = (progressPercent ?? 0) > 0 ? "OPEN" : "CLOSED";
  }

  public beginOpening(): boolean {
    if (this.value !== "CLOSED") return false;
    this.value = "OPENING";
    return true;
  }

  public opened(): void { this.value = "OPEN"; }

  public beginClosing(): boolean {
    if (this.value !== "OPEN") return false;
    this.value = "CLOSING";
    return true;
  }

  public closed(): void { this.value = "CLOSED"; }

  public beginDrag(direction: 1 | -1): boolean {
    if (this.value !== "OPEN" && this.value !== "OPENING") return false;
    this.value = direction === 1 ? "DRAGGING_NEXT" : "DRAGGING_PREVIOUS";
    return true;
  }

  public beginSettling(direction: 1 | -1): void {
    this.value = direction === 1 ? "SETTLING_NEXT" : "SETTLING_PREVIOUS";
  }

  /** Pointer cancellation, lost capture, blur and unmount always release the lock. */
  public settle(): void {
    if (this.value !== "CLOSED" && this.value !== "CLOSING") this.value = "OPEN";
  }

  public forceOpen(): void { this.value = "OPEN"; }
}
