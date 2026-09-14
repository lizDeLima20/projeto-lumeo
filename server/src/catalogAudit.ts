import { Config } from "./config/Config.js";
import { GoogleCatalogDriveClient } from "./catalog/GoogleCatalogDriveClient.js";
import { CatalogIntegrityAuditor } from "./catalog/CatalogIntegrityAuditor.js";

const config = Config.fromEnvironment();
if (!config.googleCatalogServiceAccountJson.trim()) {
  throw new Error("CATALOG_AUDIT_REQUIRES_SERVICE_ACCOUNT");
}

const sources = config.catalogSources.filter((source) => source.enabled);
const reports = await Promise.all(sources.map(async (source) => {
  const drive = new GoogleCatalogDriveClient(config.googleCatalogServiceAccountJson, source.folderId, config.catalogSyncMaxFileBytes);
  return { sourceId: source.sourceId, locale: source.locale, report: await new CatalogIntegrityAuditor(drive).audit() };
}));
const sum = (selector: (report: (typeof reports)[number]["report"]) => number): number => reports.reduce((total, value) => total + selector(value.report), 0);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: reports,
  totals: {
    totalFoundInSource: sum((report) => report.totalFoundInSource),
    totalValid: sum((report) => report.totalValid), totalInvalid: sum((report) => report.totalInvalid),
    totalWithSha256: sum((report) => report.totalWithSha256), totalWithoutSourceSize: sum((report) => report.totalWithoutSourceSize),
    totalHashMismatch: sum((report) => report.totalHashMismatch), totalSizeMismatch: sum((report) => report.totalSizeMismatch),
    totalDriveErrors: sum((report) => report.totalDriveErrors), totalNotFound: sum((report) => report.totalNotFound), totalDuplicates: sum((report) => report.totalDuplicates),
  },
}, null, 2));
