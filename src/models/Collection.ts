export type CollectionType = "author" | "custom";
export class Collection {
  public constructor(public readonly id: string, public readonly name: string, public readonly type: CollectionType,
    public readonly createdAt = new Date()) {}
}
