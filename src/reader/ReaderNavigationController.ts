export type NavigationReason = "initial" | "next" | "previous" | "direct";
export type PageChangeHandler = (page: number, reason: NavigationReason) => void | Promise<void>;

export class ReaderNavigationController {
  private current = 1;
  public constructor(private readonly total: number, private readonly onChange: PageChangeHandler) {
    if (!Number.isInteger(total) || total < 1) throw new Error("O PDF não possui páginas válidas.");
  }
  public get currentPage(): number { return this.current; }
  public get totalPages(): number { return this.total; }
  public async initialize(page = 1): Promise<void> { this.current = this.clamp(page); await this.onChange(this.current, "initial"); }
  public async nextPage(): Promise<void> {
    if (this.current >= this.total) return;
    this.current += 1; await this.onChange(this.current, "next");
  }
  public async previousPage(): Promise<void> {
    if (this.current <= 1) return;
    this.current -= 1; await this.onChange(this.current, "previous");
  }
  public async goToPage(page: number): Promise<void> {
    if (!Number.isInteger(page) || page < 1 || page > this.total) throw new Error(`Escolha uma página entre 1 e ${this.total}.`);
    this.current = page; await this.onChange(this.current, "direct");
  }
  private clamp(page: number): number { return Math.min(this.total, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1)); }
}
