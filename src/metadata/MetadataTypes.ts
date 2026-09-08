export type Confidence = "high" | "medium" | "low";
export interface DetectedValue { value: string; confidence: Confidence; }
export interface NativeBookMetadata { title?: string; author?: string; subject?: string; keywords?: string; firstPageText?: string; }
export interface ExtractedBookMetadata { title: DetectedValue; author?: DetectedValue; genre?: DetectedValue; collection?: DetectedValue; sourceText: string; }
export interface MetadataSourceExtractor { extract(file: File): Promise<NativeBookMetadata>; }
