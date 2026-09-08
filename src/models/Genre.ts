export class Genre {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly createdAt: Date = new Date(),
    public readonly isDefault: boolean = false,
  ) {}
}
