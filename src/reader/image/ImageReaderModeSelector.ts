import type{DocumentCapability}from"./DocumentCapabilityAnalyzer";
export type ReaderPipelineMode="text"|"image"|"hybrid";
export class ImageReaderModeSelector{public select(capability:DocumentCapability):ReaderPipelineMode{return capability.kind==="IMAGE_SCANNED"?"image":capability.kind==="MIXED"||capability.kind==="TEXT_PARTIAL"?"hybrid":"text";}}
