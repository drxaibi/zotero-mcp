import type {
  ZoteroItem,
  ZoteroCollection,
  ZoteroAttachment,
  ZoteroNote,
  ZoteroAnnotation,
  SearchFilters,
  SearchResult,
  LibraryStats,
} from "./types.js";

export interface ZoteroBackend {
  searchItems(
    query?: string,
    filters?: SearchFilters
  ): Promise<SearchResult>;
  getItem(key: string, includeChildren?: boolean): Promise<ZoteroItem | null>;
  getItemFullText(key: string): Promise<string | null>;
  getCollections(): Promise<ZoteroCollection[]>;
  getCollection(key: string): Promise<ZoteroCollection | null>;
  getCollectionItems(
    collectionKey: string,
    recursive?: boolean,
    filters?: SearchFilters
  ): Promise<SearchResult>;
  getTags(filterQuery?: string): Promise<Array<{ tag: string; count: number }>>;
  getItemNotes(key: string): Promise<ZoteroNote[]>;
  getItemAttachments(key: string): Promise<ZoteroAttachment[]>;
  getItemAnnotations(key: string): Promise<ZoteroAnnotation[]>;
  getRelatedItems(key: string): Promise<ZoteroItem[]>;
  getRecentItems(days?: number, limit?: number): Promise<ZoteroItem[]>;
  getLibraryStats(): Promise<LibraryStats>;
  getBibliography(keys: string[], style?: string): Promise<string>;
  searchFullText(query: string, limit?: number): Promise<ZoteroItem[]>;
}

export type { 
  ZoteroItem, 
  ZoteroCollection, 
  ZoteroAttachment, 
  ZoteroNote,
  ZoteroAnnotation,
  SearchFilters,
  SearchResult,
  LibraryStats,
};
