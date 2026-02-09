/**
 * Abstract interface for Zotero backends.
 */

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
  /**
   * Search for items in the library.
   */
  searchItems(
    query?: string,
    filters?: SearchFilters
  ): Promise<SearchResult>;

  /**
   * Get a single item by key with full metadata.
   */
  getItem(key: string, includeChildren?: boolean): Promise<ZoteroItem | null>;

  /**
   * Get full text content for an item's attachments.
   */
  getItemFullText(key: string): Promise<string | null>;

  /**
   * Get all collections.
   */
  getCollections(): Promise<ZoteroCollection[]>;

  /**
   * Get a single collection by key.
   */
  getCollection(key: string): Promise<ZoteroCollection | null>;

  /**
   * Get items in a collection.
   */
  getCollectionItems(
    collectionKey: string,
    recursive?: boolean,
    filters?: SearchFilters
  ): Promise<SearchResult>;

  /**
   * Get all tags with item counts.
   */
  getTags(filterQuery?: string): Promise<Array<{ tag: string; count: number }>>;

  /**
   * Get notes attached to an item.
   */
  getItemNotes(key: string): Promise<ZoteroNote[]>;

  /**
   * Get attachments for an item.
   */
  getItemAttachments(key: string): Promise<ZoteroAttachment[]>;

  /**
   * Get PDF annotations for an item.
   */
  getItemAnnotations(key: string): Promise<ZoteroAnnotation[]>;

  /**
   * Get items related to a given item.
   */
  getRelatedItems(key: string): Promise<ZoteroItem[]>;

  /**
   * Get recently added or modified items.
   */
  getRecentItems(days?: number, limit?: number): Promise<ZoteroItem[]>;

  /**
   * Get library statistics.
   */
  getLibraryStats(): Promise<LibraryStats>;

  /**
   * Generate formatted bibliography for items.
   */
  getBibliography(keys: string[], style?: string): Promise<string>;

  /**
   * Search across full-text content of all items.
   */
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
