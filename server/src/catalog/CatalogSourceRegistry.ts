import { LegacyDriveCatalogProvider } from "./LegacyDriveCatalogProvider.js";
import { StructuredDriveCatalogProvider } from "./StructuredDriveCatalogProvider.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogSourceConfig } from "./types.js";

export interface StructuredCandidate extends CatalogSourceProvider { hasCatalog(): Promise<boolean>; }
export interface ProviderFactory {
  legacy(source: CatalogSourceConfig): CatalogSourceProvider;
  structured(source: CatalogSourceConfig): StructuredCandidate;
}

/** Resolves `auto` sources once per source definition and keeps legacy sources fully supported.
 *  The source list is read on every call, so sources saved at runtime take effect without a deploy. */
export class CatalogSourceRegistry {
  private readonly resolved = new Map<string, { signature: string; provider: CatalogSourceProvider }>();
  private readonly sources: () => Promise<readonly CatalogSourceConfig[]>;
  public constructor(sources: readonly CatalogSourceConfig[] | (() => Promise<readonly CatalogSourceConfig[]>), private readonly factory: ProviderFactory = {
    legacy: (source) => new LegacyDriveCatalogProvider(source), structured: (source) => new StructuredDriveCatalogProvider(source),
  }) { this.sources = typeof sources === "function" ? sources : async () => sources; }

  public async providers(locale = "pt-BR"): Promise<readonly CatalogSourceProvider[]> {
    const all = await this.sources();
    const localized = all.filter((source) => source.enabled && source.locale === locale);
    const eligible = (localized.length || locale === "pt-BR" ? localized : all.filter((source) => source.enabled && source.locale === "pt-BR"))
      .sort((left, right) => left.priority - right.priority || left.sourceId.localeCompare(right.sourceId));
    return (await Promise.all(eligible.map((source) => this.provider(source)))).filter((provider): provider is CatalogSourceProvider => provider !== null);
  }

  /** A provider built from scratch, sharing nothing cached: used to test a folder before or after saving it. */
  public fresh(source: CatalogSourceConfig): CatalogSourceProvider {
    return source.mode === "legacy" ? this.factory.legacy(source) : this.factory.structured(source);
  }

  /** The cached provider for a source, rebuilt when its folder, genre or mode changed. */
  public async provider(source: CatalogSourceConfig): Promise<CatalogSourceProvider | null> {
    const signature = [source.folderId, source.mode, source.locale, source.genre ?? ""].join("|");
    const cached = this.resolved.get(source.sourceId); if (cached?.signature === signature) return cached.provider;
    try {
      let provider: CatalogSourceProvider;
      if (source.mode === "legacy") provider = this.factory.legacy(source);
      else if (source.mode === "structured") provider = this.factory.structured(source);
      else {
        const candidate = this.factory.structured(source);
        provider = await candidate.hasCatalog() ? candidate : this.factory.legacy(source);
      }
      this.resolved.set(source.sourceId, { signature, provider });
      console.info(JSON.stringify({ event: "CATALOG_SOURCE_DETECTED", sourceId: source.sourceId, locale: source.locale, mode: provider.provider, provider: provider.provider }));
      return provider;
    } catch (error) {
      console.warn(JSON.stringify({ event: "CATALOG_SOURCE_FAILED", sourceId: source.sourceId, locale: source.locale, mode: source.mode, code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN" }));
      return null;
    }
  }
}

export function catalogSourcesFromEnvironment(raw: string | undefined, legacyFolderId: string): readonly CatalogSourceConfig[] {
  const fallback: CatalogSourceConfig[] = [{ sourceId: "legacy-br-01", locale: "pt-BR", folderId: legacyFolderId, mode: "legacy", enabled: true, priority: 10 }];
  if (!raw?.trim()) return fallback;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return fallback;
    const sources = value.flatMap((entry): CatalogSourceConfig[] => {
      if (!entry || typeof entry !== "object") return [];
      const source = entry as Partial<CatalogSourceConfig>;
      if (typeof source.sourceId !== "string" || !/^[a-z0-9-]{3,80}$/i.test(source.sourceId) || typeof source.locale !== "string" || !source.locale.trim() || typeof source.folderId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(source.folderId)) return [];
      const mode = source.mode === "legacy" || source.mode === "structured" || source.mode === "auto" ? source.mode : "auto";
      return [{ sourceId: source.sourceId, locale: source.locale.trim(), folderId: source.folderId, mode, enabled: source.enabled !== false, priority: Number.isFinite(source.priority) ? Math.trunc(source.priority as number) : 100, ...(typeof source.genre === "string" && source.genre.trim() ? { genre: source.genre.trim() } : {}) }];
    });
    return sources.length ? sources : fallback;
  } catch { return fallback; }
}
