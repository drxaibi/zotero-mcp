/**
 * Web API Backend for Zotero MCP Server.
 * Uses the Zotero Web API v3.
 */

import type { ZoteroConfig } from "../config.js";
import { getLibraryPrefix } from "../config.js";
import type {
  ZoteroBackend,
  ZoteroItem,
  ZoteroCollection,
  ZoteroAttachment,
  ZoteroNote,
  ZoteroAnnotation,
  SearchFilters,
  SearchResult,
  LibraryStats,
} from "./interface.js";

interface ApiResponse<T> {
  data: T;
  headers: Headers;
}

// Zotero API response wraps item data in a 'data' property
interface ApiItemResponse {
  key: string;
  version: number;
  library?: unknown;
  links?: unknown;
  meta?: unknown;
  data: Record<string, unknown>;
}

/**
 * Transform API response item to our ZoteroItem format.
 * The Zotero API wraps actual item fields in a 'data' property.
 */
function mapApiItem(apiItem: ApiItemResponse): ZoteroItem {
  // Merge top-level key/version with the data fields
  return {
    key: apiItem.key,
    version: apiItem.version,
    ...apiItem.data,
  } as ZoteroItem;
}

export class WebAPIBackend implements ZoteroBackend {
  private config: ZoteroConfig;
  private headers: Record<string, string>;
  private libraryPrefix: string;

  constructor(config: ZoteroConfig) {
    this.config = config;
    this.libraryPrefix = getLibraryPrefix(config);
    this.headers = {
      "Zotero-API-Version": "3",
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      this.headers["Zotero-API-Key"] = config.apiKey;
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - extract retry-after
        const retryAfter = response.headers.get("Retry-After") || "5";
        throw new Error(`Rate limited. Retry after ${retryAfter} seconds.`);
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return { data: data as T, headers: response.headers };
  }

  private buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, String(value));
      }
    }
    const qs = searchParams.toString();
    return qs ? `?${qs}` : "";
  }

  async searchItems(
    query?: string,
    filters?: SearchFilters
  ): Promise<SearchResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      format: "json",
      limit: filters?.limit || this.config.defaultLimit,
      start: filters?.start || 0,
      sort: filters?.sort || "dateModified",
      direction: filters?.direction || "desc",
    };

    if (query) {
      params.q = query;
      params.qmode = "everything"; // Search full text too
    }
    if (filters?.itemType) {
      params.itemType = filters.itemType;
    }
    if (filters?.tags && filters.tags.length > 0) {
      // Multiple tags require separate params
      params.tag = filters.tags.join(" || ");
    }
    if (filters?.collectionKey) {
      // Use collection endpoint instead
      const endpoint = `/${this.libraryPrefix}/collections/${filters.collectionKey}/items${this.buildQueryString(params)}`;
      return this.fetchItemsWithTotal(endpoint);
    }
    if (filters?.sinceVersion !== undefined) {
      params.since = filters.sinceVersion;
    }

    const endpoint = `/${this.libraryPrefix}/items/top${this.buildQueryString(params)}`;
    return this.fetchItemsWithTotal(endpoint);
  }

  private async fetchItemsWithTotal(endpoint: string): Promise<SearchResult> {
    const { data, headers } = await this.request<ApiItemResponse[]>(endpoint);
    const totalResults = parseInt(headers.get("Total-Results") || "0", 10);
    const items = data.map(mapApiItem);

    // Parse Link header for pagination
    const linkHeader = headers.get("Link") || "";
    const hasMore = linkHeader.includes('rel="next"');

    return {
      items,
      totalResults,
      hasMore,
      nextStart: items.length,
    };
  }

  async getItem(key: string, includeChildren = true): Promise<ZoteroItem | null> {
    try {
      const { data: apiItem } = await this.request<ApiItemResponse>(
        `/${this.libraryPrefix}/items/${key}`
      );
      const item = mapApiItem(apiItem);

      if (includeChildren) {
        // Fetch children (notes, attachments)
        const { data: apiChildren } = await this.request<ApiItemResponse[]>(
          `/${this.libraryPrefix}/items/${key}/children`
        );
        const children = apiChildren.map(mapApiItem);

        item.attachments = children.filter(
          (c) => c.itemType === "attachment"
        ) as unknown as ZoteroAttachment[];
        item.notes = children.filter(
          (c) => c.itemType === "note"
        ) as unknown as ZoteroNote[];
        item.annotations = children.filter(
          (c) => c.itemType === "annotation"
        ) as unknown as ZoteroAnnotation[];
      }

      return item;
    } catch (error) {
      if ((error as Error).message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  async getItemFullText(key: string): Promise<string | null> {
    try {
      // Get the item first to find attachments
      const item = await this.getItem(key);
      if (!item) return null;

      const texts: string[] = [];

      // Get fulltext for PDF attachments
      const attachments = item.attachments || [];
      for (const attachment of attachments) {
        if (attachment.contentType === "application/pdf") {
          try {
            const { data } = await this.request<{ content: string }>(
              `/${this.libraryPrefix}/items/${attachment.key}/fulltext`
            );
            if (data.content) {
              texts.push(data.content);
            }
          } catch {
            // Fulltext may not be available
            continue;
          }
        }
      }

      // Also try the item itself if it's an attachment
      if (item.itemType === "attachment") {
        try {
          const { data } = await this.request<{ content: string }>(
            `/${this.libraryPrefix}/items/${key}/fulltext`
          );
          if (data.content) {
            texts.push(data.content);
          }
        } catch {
          // Ignore
        }
      }

      return texts.length > 0 ? texts.join("\n\n---\n\n") : null;
    } catch {
      return null;
    }
  }

  async getCollections(): Promise<ZoteroCollection[]> {
    const { data } = await this.request<ZoteroCollection[]>(
      `/${this.libraryPrefix}/collections?format=json`
    );
    return data;
  }

  async getCollection(key: string): Promise<ZoteroCollection | null> {
    try {
      const { data } = await this.request<ZoteroCollection>(
        `/${this.libraryPrefix}/collections/${key}`
      );
      return data;
    } catch {
      return null;
    }
  }

  async getCollectionItems(
    collectionKey: string,
    recursive = false,
    filters?: SearchFilters
  ): Promise<SearchResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      format: "json",
      limit: filters?.limit || this.config.defaultLimit,
      start: filters?.start || 0,
      sort: filters?.sort || "dateModified",
      direction: filters?.direction || "desc",
    };

    let endpoint = `/${this.libraryPrefix}/collections/${collectionKey}/items/top${this.buildQueryString(params)}`;

    if (recursive) {
      // For recursive, we need to get subcollections and their items too
      // This is a simplified version - full recursive would need multiple calls
      endpoint = `/${this.libraryPrefix}/collections/${collectionKey}/items${this.buildQueryString(params)}`;
    }

    return this.fetchItemsWithTotal(endpoint);
  }

  async getTags(filterQuery?: string): Promise<Array<{ tag: string; count: number }>> {
    let endpoint = `/${this.libraryPrefix}/tags?format=json&limit=100`;
    if (filterQuery) {
      endpoint += `&q=${encodeURIComponent(filterQuery)}`;
    }

    const { data } = await this.request<Array<{ tag: string; meta?: { numItems?: number } }>>(endpoint);
    return data.map((t) => ({
      tag: t.tag,
      count: t.meta?.numItems || 0,
    }));
  }

  async getItemNotes(key: string): Promise<ZoteroNote[]> {
    const { data: apiChildren } = await this.request<ApiItemResponse[]>(
      `/${this.libraryPrefix}/items/${key}/children?format=json`
    );
    const children = apiChildren.map(mapApiItem);
    return children.filter((c) => c.itemType === "note") as unknown as ZoteroNote[];
  }

  async getItemAttachments(key: string): Promise<ZoteroAttachment[]> {
    const { data: apiChildren } = await this.request<ApiItemResponse[]>(
      `/${this.libraryPrefix}/items/${key}/children?format=json`
    );
    const children = apiChildren.map(mapApiItem);
    return children.filter((c) => c.itemType === "attachment") as unknown as ZoteroAttachment[];
  }

  async getItemAnnotations(key: string): Promise<ZoteroAnnotation[]> {
    // Annotations are children of attachment items
    const attachments = await this.getItemAttachments(key);
    const annotations: ZoteroAnnotation[] = [];

    for (const attachment of attachments) {
      if (attachment.contentType === "application/pdf") {
        const { data: apiChildren } = await this.request<ApiItemResponse[]>(
          `/${this.libraryPrefix}/items/${attachment.key}/children?format=json`
        );
        const children = apiChildren.map(mapApiItem);
        const attachmentAnnotations = children.filter(
          (c) => c.itemType === "annotation"
        ) as unknown as ZoteroAnnotation[];
        annotations.push(...attachmentAnnotations);
      }
    }

    return annotations;
  }

  async getRelatedItems(key: string): Promise<ZoteroItem[]> {
    const item = await this.getItem(key, false);
    if (!item || !item.relations) return [];

    // Relations are stored as dc:relation URIs
    const relatedUris = item.relations["dc:relation"];
    if (!relatedUris) return [];

    const uris = Array.isArray(relatedUris) ? relatedUris : [relatedUris];
    const relatedItems: ZoteroItem[] = [];

    for (const uri of uris) {
      // Extract key from URI like "http://zotero.org/users/xxx/items/KEY"
      const match = uri.match(/\/items\/([A-Z0-9]+)$/);
      if (match) {
        const relatedItem = await this.getItem(match[1], false);
        if (relatedItem) {
          relatedItems.push(relatedItem);
        }
      }
    }

    return relatedItems;
  }

  async getRecentItems(days = 7, limit = 25): Promise<ZoteroItem[]> {
    const params = {
      format: "json",
      limit,
      sort: "dateModified",
      direction: "desc",
    };

    const { data } = await this.request<ApiItemResponse[]>(
      `/${this.libraryPrefix}/items/top${this.buildQueryString(params)}`
    );
    const items = data.map(mapApiItem);

    // Filter by date
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return items.filter((item) => {
      if (item.dateModified) {
        return new Date(item.dateModified) >= cutoff;
      }
      return false;
    });
  }

  async getLibraryStats(): Promise<LibraryStats> {
    // Get total items
    const { headers: itemHeaders } = await this.request<ZoteroItem[]>(
      `/${this.libraryPrefix}/items/top?format=json&limit=1`
    );
    const totalItems = parseInt(itemHeaders.get("Total-Results") || "0", 10);

    // Get collections count
    const { data: collections } = await this.request<ZoteroCollection[]>(
      `/${this.libraryPrefix}/collections?format=json&limit=100`
    );

    // Get tags count
    const { data: tags } = await this.request<Array<{ tag: string }>>(
      `/${this.libraryPrefix}/tags?format=json&limit=100`
    );

    // Get items by type (sample)
    const itemsByType: Record<string, number> = {};

    // Get recent items for counts
    const recentItems = await this.getRecentItems(7, 100);
    const todayItems = await this.getRecentItems(1, 100);

    return {
      totalItems,
      totalCollections: collections.length,
      totalTags: tags.length,
      totalAttachments: 0, // Would need separate query
      itemsByType,
      recentlyAdded: todayItems.length,
      recentlyModified: recentItems.length,
    };
  }

  async getBibliography(keys: string[], style = "apa"): Promise<string> {
    // Use format=bib endpoint for bibliography
    const keyList = keys.join(",");
    const response = await fetch(
      `${this.config.apiBaseUrl}/${this.libraryPrefix}/items?itemKey=${keyList}&format=bib&style=${style}`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to generate bibliography: ${response.status}`);
    }

    return response.text();
  }

  async searchFullText(query: string, limit = 25): Promise<ZoteroItem[]> {
    const params = {
      format: "json",
      q: query,
      qmode: "everything",
      limit,
    };

    const { data } = await this.request<ApiItemResponse[]>(
      `/${this.libraryPrefix}/items${this.buildQueryString(params)}`
    );

    return data.map(mapApiItem);
  }
}
