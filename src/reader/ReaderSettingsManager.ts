import { StorageService } from "../services/StorageService";
import { marginValues, spacingValues, textColorValues, type ReaderFontFamily } from "./settings/ReaderPreferences";
import { Capacitor } from "@capacitor/core";
import type { ScanEnhancementSettings } from "./image/ScanEnhancementPipeline";
import { ReaderPreferencesService } from "./settings/ReaderPreferencesService";

export type ReaderFitMode = "custom" | "width" | "page";
export type ReaderTheme = "light" | "dark" | "paper";
export type PageAnimation = "slide" | "page-turn" | "carousel";
export interface ReflowSettings { fontFamily:ReaderFontFamily;fontSize:number;fontWeight:number;textColor:string;lineHeight:number;paragraphSpacing:number;margins:number;alignment:"left"|"justify";readingWidth:number; }
export interface ReaderSettings extends ReflowSettings { zoom: number; fitMode: ReaderFitMode; theme: ReaderTheme; brightness: number; animation: PageAnimation; }

export class ReaderSettingsManager {
  private static readonly KEY = "reader-settings";
  private value: ReaderSettings = { zoom:100,fitMode:"width",theme:"light",brightness:100,animation:"page-turn",fontFamily:"classic",fontSize:18,fontWeight:400,textColor:"",lineHeight:1.65,paragraphSpacing:1,margins:28,alignment:"left",readingWidth:680 };
  public readonly preferencesService: ReaderPreferencesService;
  public constructor(private readonly storage: StorageService) { this.preferencesService = new ReaderPreferencesService(storage, ReaderSettingsManager.isAndroid()); }
  private static isAndroid(): boolean { try { return typeof window !== "undefined" && Capacitor.getPlatform() === "android"; } catch { return false; } }
  public async initialize(globalTheme: "light" | "dark"): Promise<void> {
    const [saved] = await Promise.all([this.storage.load<ReaderSettings>(ReaderSettingsManager.KEY), this.preferencesService.restorePreferences()]);
    this.value = saved ? { ...this.value, ...saved } : { ...this.value, theme: globalTheme };
    this.syncPreferences(); this.normalize();
  }
  public syncPreferences(): void { const preferences=this.preferencesService.preferences;const spacing=spacingValues[preferences.lineSpacing];this.value={...this.value,fontFamily:preferences.fontFamily,fontSize:preferences.fontSize,fontWeight:preferences.fontWeight,textColor:textColorValues[preferences.textColor],lineHeight:spacing.lineHeight,paragraphSpacing:spacing.paragraphSpacing,margins:marginValues[preferences.margins],brightness:preferences.readerBrightness,animation:preferences.pageAnimation}; }
  public imageSettings(): ScanEnhancementSettings { const value=this.preferencesService.preferences;return{preset:value.imagePreset,profile:value.imageProfile,brightness:100,contrast:100,sharpness:0,grayscale:false,invert:false}; }
  public get settings(): Readonly<ReaderSettings> { return this.value; }
  public async zoomIn(): Promise<number> { return this.setZoom(this.value.zoom + 10); }
  public async zoomOut(): Promise<number> { return this.setZoom(this.value.zoom - 10); }
  public async setZoom(zoom: number): Promise<number> {
    this.value.zoom = Math.min(300, Math.max(50, Math.round(zoom))); this.value.fitMode = "custom"; await this.persist(); return this.value.zoom;
  }
  public async fitWidth(): Promise<void> { this.value.fitMode = "width"; await this.persist(); }
  public async fitPage(): Promise<void> { this.value.fitMode = "page"; await this.persist(); }
  public async setTheme(theme: ReaderTheme): Promise<void> { this.value.theme = theme; await this.persist(); }
  public async setBrightness(brightness: number): Promise<void> {
    this.value.brightness = Math.min(100, Math.max(15, Math.round(brightness))); await this.persist();
  }
  public async setAnimation(animation: PageAnimation): Promise<void> { this.value.animation = animation; await this.persist(); }
  public async updateReflow(settings:Partial<ReflowSettings>):Promise<void>{this.value={...this.value,...settings};this.normalize();await this.persist();}
  private normalize(): void {
    this.value.zoom = Math.min(300, Math.max(50, this.value.zoom)); this.value.brightness = Math.min(100, Math.max(15, this.value.brightness));
    this.value.fontSize=Math.min(36,Math.max(13,this.value.fontSize));this.value.fontWeight=Math.min(700,Math.max(300,this.value.fontWeight));this.value.lineHeight=Math.min(2.2,Math.max(1.2,this.value.lineHeight));this.value.paragraphSpacing=Math.min(2.5,Math.max(.4,this.value.paragraphSpacing));this.value.margins=Math.min(72,Math.max(12,this.value.margins));this.value.readingWidth=Math.min(900,Math.max(320,this.value.readingWidth));
  }
  private persist(): Promise<void> { return this.storage.save(ReaderSettingsManager.KEY, this.value); }
}
