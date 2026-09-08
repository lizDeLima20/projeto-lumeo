export type FeatureFlag = "ocr" | "payment" | "cloudSync";

export class FeatureFlagManager {
  public constructor(private readonly flags: Partial<Record<FeatureFlag, boolean>> = {}) {}
  public enabled(flag: FeatureFlag): boolean { return this.flags[flag] === true; }
}
