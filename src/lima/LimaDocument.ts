export type LimaSourceFormat="pdf"|"epub"|"lima";export type LimaBlockType="heading"|"paragraph"|"image"|"quote"|"list"|"separator";
export interface LimaManifest{format:"lima";version:1;documentId:string;createdAt:string;generator:string;sourceFormat:LimaSourceFormat;capabilities:{reflow:boolean;images:boolean;chapters:boolean;highlights:boolean;annotations:boolean;search:boolean};}
export interface LimaMetadata{id:string;title:string;author:string;language:string;genre:string;collection?:string;coverAssetId?:string;sourceFormat:LimaSourceFormat;createdAt:string;summary?:string;description?:string;publicationYear?:number;series?:string;volume?:number|string;}
export interface LimaChapter{id:string;title:string;order:number;startBlockId:string;endBlockId:string;}
export interface LimaBlock{id:string;type:LimaBlockType;order:number;content:string;chapterId:string;level?:number;assetId?:string;}
export interface LimaAsset{id:string;type:"cover"|"image";mimeType:string;data?:Uint8Array;localReference?:string;width?:number;height?:number;}
export interface LimaAnchor{blockId:string;offset:number;}
export interface LimaNavigationItem{id:string;title:string;chapterId:string;blockId:string;order:number;}
export class LimaDocument{public constructor(public readonly manifest:LimaManifest,public readonly metadata:LimaMetadata,public readonly chapters:LimaChapter[],public readonly blocks:LimaBlock[],public readonly assets:LimaAsset[],public readonly navigation:LimaNavigationItem[]){}}
export interface LimaPackage{document:LimaDocument;fileName:string;mimeType:"application/x-lima-book";}
