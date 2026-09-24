export class Genre {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly createdAt: Date = new Date(),
    public readonly isDefault: boolean = false,
  ) {}

  /** A genre is one shelf, whatever id it arrived with: "Aventura", "aventura" and
   *  " Aventura " name the same genre. Used to find it before ever creating another. */
  public static sameName(left: string, right: string): boolean {
    const key = (name: string): string => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
    return key(left) === key(right);
  }
}
