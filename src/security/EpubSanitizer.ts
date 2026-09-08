export class EpubSanitizer {
  public sanitize(markup: string): string {
    return markup
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, "");
  }

  public decodeEntities(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'",
    })[entity] ?? entity);
  }
}
