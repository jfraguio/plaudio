export interface Chapter {
  title: string;
  startTime: number;
  endTime?: number;
}

export interface AudiobookState {
  id: string;
  filename: string;
  position: number;
  playbackRate: number;
  duration?: number;
  title?: string;
  author?: string;
  schemaVersion: number;
  updatedAt: number;
}

export interface Artwork {
  bytes: Uint8Array;
  mime: string;
}

export interface BookMetadata {
  title?: string;
  author?: string;
  subtitle?: string;
  artwork?: Artwork;
  duration?: number;
  chapters: Chapter[];
}

export interface AppState {
  file?: File;
  objectUrl?: string;
  bookId?: string;

  title: string;
  author?: string;
  coverUrl?: string;
  genericCover: boolean;

  duration: number;
  currentTime: number;

  playbackRate: number;
  playing: boolean;
  canPlay: boolean;
  loading: boolean;

  chapters: Chapter[];
  currentChapterIndex: number;
}

export const SCHEMA_VERSION = 1;

export function createInitialState(): AppState {
  return {
    title: "",
    duration: 0,
    currentTime: 0,
    playbackRate: 1,
    playing: false,
    canPlay: false,
    loading: false,
    coverUrl: undefined,
    genericCover: true,
    chapters: [],
    currentChapterIndex: -1,
  };
}
