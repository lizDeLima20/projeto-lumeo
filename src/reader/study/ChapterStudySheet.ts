import type{LimaAnchor}from"../../lima/LimaDocument";
export interface StudyTopic{id:string;text:string;order:number;sourceAnchor?:LimaAnchor;sourceText?:string;}
export interface StudyQuestionAnswer{text:string;}
export interface StudyQuestion{id:string;question:string;answer?:StudyQuestionAnswer;order:number;sourceAnchor?:LimaAnchor;sourceText?:string;}
export interface StudyDoubt{id:string;text:string;observation?:string;resolved:boolean;order:number;sourceAnchor?:LimaAnchor;sourceText?:string;}
export interface ChapterStudySheet{id:string;userId:string;bookId:string;chapterId:string;summary:string;topics:StudyTopic[];questions:StudyQuestion[];doubts:StudyDoubt[];createdAt:string;updatedAt:string;}
export type ChapterSheetSourceKind="topic"|"question"|"doubt";
