export type Book3DMode = "FRONT" | "ANGLED" | "FOCUSED_ANGLED";

export interface Book3DDimensions {
  widthRem: number;
  aspectRatio: number;
  depthRem: number;
  spineRem: number;
}

export interface Book3DModel {
  bookId: string;
  cover: string;
  title: string;
  author: string;
  showAuthor: boolean;
  volume?: string;
  series?: string;
  publicationYear?: number;
  genre: string;
  spineColor: string;
  dimensions: Book3DDimensions;
  mode: Book3DMode;
}
