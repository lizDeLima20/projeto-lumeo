export type ScanPreset="original"|"scannedText"|"oldDocument"|"manga";
export type ScanProfile="normal"|"high-contrast"|"soft";
export interface ScanEnhancementSettings{preset:ScanPreset;profile:ScanProfile;brightness:number;contrast:number;sharpness:number;grayscale:boolean;invert:boolean;}
export class ScanEnhancementPipeline{
  public static readonly DEFAULT:ScanEnhancementSettings={preset:"original",profile:"normal",brightness:100,contrast:100,sharpness:0,grayscale:false,invert:false};
  public filter(settings:ScanEnhancementSettings):string{
    const preset=this.preset(settings.preset),profile=this.profile(settings.profile);
    const brightness=this.clamp(settings.brightness+preset.brightness+profile.brightness,40,180);
    const contrast=this.clamp(settings.contrast+preset.contrast+profile.contrast,40,220);
    const grayscale=settings.grayscale||preset.grayscale?1:0,invert=settings.invert?1:0;
    // sepia() first (the aged-paper cast), then the grayscale/brightness/contrast/saturate chain,
    // so a grayscale preset still fully removes the sepia tint rather than fighting it.
    return`sepia(${preset.sepia}%) brightness(${brightness}%) contrast(${contrast}%) saturate(${preset.saturation}%) grayscale(${grayscale}) invert(${invert})`;
  }
  /** Deltas large enough to be seen at a glance, small enough to stay a reading aid rather
   *  than a visual effect: "perceptível mas não agressivo". */
  private preset(preset:ScanPreset):{brightness:number;contrast:number;grayscale:boolean;saturation:number;sepia:number}{
    return{
      // Máxima preservação: no adjustment at all.
      original:{brightness:0,contrast:0,grayscale:false,saturation:100,sepia:0},
      // Scan legibility: brighten the paper, sharpen the text edge with contrast, and drop
      // any scanner colour cast - grayscale reads cleaner than a faint yellow/blue tint.
      scannedText:{brightness:14,contrast:34,grayscale:true,saturation:100,sepia:0},
      // Aged paper: a real sepia cast plus a touch of warmth and softened contrast, the way
      // old book paper actually looks - not just a slightly darker original.
      oldDocument:{brightness:-4,contrast:-6,grayscale:false,saturation:96,sepia:38},
      // Manga: crisp ink on white, high contrast, clean black and white (no dot-gain haze).
      manga:{brightness:6,contrast:46,grayscale:true,saturation:100,sepia:0},
    }[preset];
  }
  private profile(profile:ScanProfile):{brightness:number;contrast:number}{
    return{normal:{brightness:0,contrast:0},"high-contrast":{brightness:4,contrast:32},soft:{brightness:-3,contrast:-16}}[profile];
  }
  private clamp(value:number,min:number,max:number):number{return Math.min(max,Math.max(min,value));}
}
