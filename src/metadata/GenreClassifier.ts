import type { DetectedValue, NativeBookMetadata } from "./MetadataTypes";
interface Rule { genre: string; patterns: RegExp[]; }
export class GenreClassifier {
  private readonly rules: Rule[] = [
    { genre: "Desenvolvimento Pessoal", patterns: [/napoleon hill/i, /autoajuda/i, /hábitos?\b/i, /sucesso pessoal/i] },
    { genre: "Finanças", patterns: [/finanças?/i, /riqueza/i, /investimentos?/i, /dinheiro/i] },
    { genre: "ENEM", patterns: [/\benem\b/i, /vestibular/i, /redação/i] },
    { genre: "Estudos", patterns: [/matemática/i, /física/i, /química/i, /estudos?/i] },
    { genre: "História", patterns: [/história/i, /histórico/i, /guerra mundial/i] },
    { genre: "Terror", patterns: [/terror/i, /horror/i, /assombração/i] },
    { genre: "Romance", patterns: [/romance/i, /amor/i] },
  ];
  public classify(metadata: NativeBookMetadata, title: string, author?: string): DetectedValue | undefined {
    const haystack = [title, author, metadata.subject, metadata.keywords, metadata.firstPageText?.slice(0, 1600)].filter(Boolean).join(" ");
    let best: { genre: string; score: number } | undefined;
    this.rules.forEach(rule => { const score = rule.patterns.filter(pattern => pattern.test(haystack)).length; if (score && (!best || score > best.score)) best = { genre: rule.genre, score }; });
    return best ? { value: best.genre, confidence: best.score >= 2 || /napoleon hill/i.test(haystack) ? "high" : "medium" } : undefined;
  }
}
