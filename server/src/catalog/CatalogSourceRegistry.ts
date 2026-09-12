import { LegacyDriveCatalogProvider } from "./LegacyDriveCatalogProvider.js";
import { StructuredDriveCatalogProvider } from "./StructuredDriveCatalogProvider.js";
import type { CatalogSourceProvider } from "./CatalogSourceProvider.js";
import type { CatalogSourceConfig } from "./types.js";

interface StructuredCandidate extends CatalogSourceProvider { hasCatalog(): Promise<boolean>; }
interface ProviderFactory {
  legacy(source: CatalogSourceConfig): CatalogSourceProvider;
  structured(source: CatalogSourceConfig): StructuredCandidate;
}

/** Resolves `auto` sources once per process and keeps legacy sources fully supported. */
export class CatalogSourceRegistry {
  private readonly resolved = new Map<string, CatalogSourceProvider>();
  public constructor(private readonly sources: readonly CatalogSourceConfig[], private readonly factory: ProviderFactory = {
    legacy: (source) => new LegacyDriveCatalogProvider(source), structured: (source) => new StructuredDriveCatalogProvider(source),
  }) {}

  public async providers(locale = "pt-BR"): Promise<readonly CatalogSourceProvider[]> {
    const eligible = this.sources.filter((source) => source.enabled && source.locale === locale).sort((left, right) => left.priority - right.priority || left.sourceId.localeCompare(right.sourceId));
    return (await Promise.all(eligible.map((source) => this.provider(source)))).filter((provider): provider is CatalogSourceProvider => provider !== null);
  }

  private async provider(source: CatalogSourceConfig): Promise<CatalogSourceProvider | null> {
    const cached = this.resolved.get(source.sourceId); if (cached) return cached;
    try {
      let provider: CatalogSourceProvider;
      if (source.mode === "legacy") provider = this.factory.legacy(source);
      else if (source.mode === "structured") provider = this.factory.structured(source);
      else {
        const candidate = this.factory.structured(source);
        provider = await candidate.hasCatalog() ? candidate : this.factory.legacy(source);
      }
      this.resolved.set(source.sourceId, provider);
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
      return [{ sourceId: source.sourceId, locale: source.locale.trim(), folderId: source.folderId, mode, enabled: source.enabled !== false, priority: Number.isFinite(source.priority) ? Math.trunc(source.priority as number) : 100 }];
    });
    return sources.length ? sources : fallback;
  } catch { return fallback; }
}
