import type{SemanticReadingPosition}from"./ReadingPositionManager";
export type ReadingMode="reflow"|"original";
export class ReadingModeSwitch{public switch(_from:ReadingMode,to:ReadingMode,position:SemanticReadingPosition):{mode:ReadingMode;position:SemanticReadingPosition}{return{mode:to,position:{...position,timestamp:new Date().toISOString()}};}}
