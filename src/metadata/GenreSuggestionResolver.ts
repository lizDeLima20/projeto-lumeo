import type { Genre } from "../models/Genre";
import type { DetectedValue } from "./MetadataTypes";
export type GenreSuggestion = { kind: "existing"; genre: Genre } | { kind: "new"; name: string } | { kind: "none" };
export class GenreSuggestionResolver {
  public resolve(detected: DetectedValue | undefined, genres: readonly Genre[]): GenreSuggestion {
    if (!detected) return { kind: "none" }; const existing = genres.find(item => item.name.toLocaleLowerCase() === detected.value.toLocaleLowerCase());
    return existing ? { kind: "existing", genre: existing } : { kind: "new", name: detected.value };
  }
}
