/**
 * Local SQLite Backend for Zotero MCP Server.
 * Directly reads from the Zotero SQLite database (read-only).
 */

import * as path from "path";
import * as fs from "fs";
import Database from "better-sqlite3";
import type { ZoteroConfig } from "../config.js";
import { getSqlitePath, getStoragePath } from "../config.js";
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
import type { ZoteroCreator, ZoteroTag } from "./types.js";
import { extractPdfText } from "../utils/pdf-extractor.js";

// Field name mappings from fieldID to field name
const FIELD_NAMES: Record<number, string> = {};
// Item type mappings
const ITEM_TYPES: Record<number, string> = {};
// Creator type mappings
const CREATOR_TYPES: Record<number, string> = {};

export class LocalBackend implements ZoteroBackend {
  private db: Database.Database;
  private config: ZoteroConfig;
  private storagePath: string | undefined;

  constructor(config: ZoteroConfig) {
    this.config = config;
    const dbPath = getSqlitePath(config);
    if (!dbPath || !fs.existsSync(dbPath)) {
      throw new Error(`Zotero database not found at: ${dbPath}`);
    }

    // Open in read-only mode
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    this.storagePath = getStoragePath(config);

    // Load field/type mappings
    this.loadMappings();
  }

  private loadMappings(): void {
    // Load field names
    const fields = this.db
      .prepare("SELECT fieldID, fieldName FROM fields")
      .all() as Array<{ fieldID: number; fieldName: string }>;
    for (const field of fields) {
      FIELD_NAMES[field.fieldID] = field.fieldName;
    }

    // Load item types
    const itemTypes = this.db
      .prepare("SELECT itemTypeID, typeName FROM itemTypes")
      .all() as Array<{ itemTypeID: number; typeName: string }>;
    for (const type of itemTypes) {
      ITEM_TYPES[type.itemTypeID] = type.typeName;
    }

    // Load creator types
    const creatorTypes = this.db
      .prepare("SELECT creatorTypeID, creatorType FROM creatorTypes")
      .all() as Array<{ creatorTypeID: number; creatorType: string }>;
    for (const type of creatorTypes) {
      CREATOR_TYPES[type.creatorTypeID] = type.creatorType;
    }
  }

  private rowToItem(row: Record<string, unknown>): ZoteroItem {
    const item: ZoteroItem = {
      key: row.key as string,
      itemType: ITEM_TYPES[row.itemTypeID as number] || "unknown",
      version: row.version as number,
      dateAdded: row.dateAdded as string,
      dateModified: row.dateModified as string,
    };

    return item;
  }

  private loadItemFields(itemId: number, item: ZoteroItem): void {
    const fields = this.db
      .prepare(`
        SELECT f.fieldName, iv.value
        FROM itemData id
        JOIN itemDataValues iv ON id.valueID = iv.valueID
        JOIN fields f ON id.fieldID = f.fieldID
        WHERE id.itemID = ?
      `)
      .all(itemId) as Array<{ fieldName: string; value: string }>;

    for (const field of fields) {
      const key = this.fieldNameToKey(field.fieldName);
      (item as Record<string, unknown>)[key] = field.value;
    }
  }

  private fieldNameToKey(fieldName: string): string {
    // Convert snake_case or lowercased field names to camelCase
    const mapping: Record<string, string> = {
      title: "title",
      abstractnote: "abstractNote",
      date: "date",
      url: "url",
      accessdate: "accessDate",
      language: "language",
      publicationtitle: "publicationTitle",
      journalabbreviation: "journalAbbreviation",
      volume: "volume",
      issue: "issue",
      pages: "pages",
      edition: "edition",
      series: "series",
      seriesnumber: "seriesNumber",
      doi: "DOI",
      isbn: "ISBN",
      issn: "ISSN",
      publisher: "publisher",
      place: "place",
      institution: "institution",
      shorttitle: "shortTitle",
      numpages: "numPages",
      extra: "extra",
      callnumber: "callNumber",
      archive: "archive",
      archivelocation: "archiveLocation",
      librarycatalog: "libraryCatalog",
      rights: "rights",
    };
    return mapping[fieldName.toLowerCase()] || fieldName;
  }

  private loadItemCreators(itemId: number): ZoteroCreator[] {
    const creators = this.db
      .prepare(`
        SELECT c.firstName, c.lastName, ic.creatorTypeID, ic.orderIndex
        FROM itemCreators ic
        JOIN creators c ON ic.creatorID = c.creatorID
        WHERE ic.itemID = ?
        ORDER BY ic.orderIndex
      `)
      .all(itemId) as Array<{
      firstName: string | null;
      lastName: string | null;
      creatorTypeID: number;
      orderIndex: number;
    }>;

    return creators.map((c) => ({
      creatorType: CREATOR_TYPES[c.creatorTypeID] || "author",
      firstName: c.firstName || undefined,
      lastName: c.lastName || undefined,
      name: !c.firstName && c.lastName ? c.lastName : undefined,
    }));
  }

  private loadItemTags(itemId: number): ZoteroTag[] {
    const tags = this.db
      .prepare(`
        SELECT t.name, it.type
        FROM itemTags it
        JOIN tags t ON it.tagID = t.tagID
        WHERE it.itemID = ?
      `)
      .all(itemId) as Array<{ name: string; type: number }>;

    return tags.map((t) => ({
      tag: t.name,
      type: t.type,
    }));
  }

  private loadItemCollections(itemId: number): string[] {
    const collections = this.db
      .prepare(`
        SELECT c.key
        FROM collectionItems ci
        JOIN collections c ON ci.collectionID = c.collectionID
        WHERE ci.itemID = ?
      `)
      .all(itemId) as Array<{ key: string }>;

    return collections.map((c) => c.key);
  }

  async searchItems(
    query?: string,
    filters?: SearchFilters
  ): Promise<SearchResult> {
    const limit = filters?.limit || this.config.defaultLimit;
    const offset = filters?.start || 0;

    let sql = `
      SELECT DISTINCT i.itemID, i.key, i.itemTypeID, i.version, i.dateAdded, i.dateModified
      FROM items i
      LEFT JOIN deletedItems di ON i.itemID = di.itemID
      WHERE di.itemID IS NULL
        AND i.itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment', 'note', 'annotation'))
    `;
    const params: (string | number)[] = [];

    // Text search
    if (query) {
      sql += `
        AND i.itemID IN (
          SELECT id.itemID FROM itemData id
          JOIN itemDataValues iv ON id.valueID = iv.valueID
          WHERE iv.value LIKE ?
          UNION
          SELECT ic.itemID FROM itemCreators ic
          JOIN creators c ON ic.creatorID = c.creatorID
          WHERE c.firstName LIKE ? OR c.lastName LIKE ?
        )
      `;
      const searchTerm = `%${query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Item type filter
    if (filters?.itemType) {
      const types = filters.itemType.split(",").map((t) => t.trim());
      const placeholders = types.map(() => "?").join(", ");
      sql += ` AND i.itemTypeID IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN (${placeholders}))`;
      params.push(...types);
    }

    // Tags filter
    if (filters?.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        sql += `
          AND i.itemID IN (
            SELECT it.itemID FROM itemTags it
            JOIN tags t ON it.tagID = t.tagID
            WHERE t.name = ?
          )
        `;
        params.push(tag);
      }
    }

    // Collection filter
    if (filters?.collectionKey) {
      sql += `
        AND i.itemID IN (
          SELECT ci.itemID FROM collectionItems ci
          JOIN collections c ON ci.collectionID = c.collectionID
          WHERE c.key = ?
        )
      `;
      params.push(filters.collectionKey);
    }

    // Sort
    const sortField = filters?.sort || "dateModified";
    const direction = filters?.direction || "desc";
    sql += ` ORDER BY i.${sortField === "dateModified" ? "dateModified" : "dateAdded"} ${direction.toUpperCase()}`;

    // Count total
    const countSql = sql.replace(
      /SELECT DISTINCT i\.itemID, i\.key, i\.itemTypeID, i\.version, i\.dateAdded, i\.dateModified/,
      "SELECT COUNT(DISTINCT i.itemID) as count"
    ).replace(/ORDER BY.*$/, "");
    const countResult = this.db.prepare(countSql).get(...params) as { count: number };
    const totalResults = countResult.count;

    // Add pagination
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const items: ZoteroItem[] = [];
    for (const row of rows) {
      const item = this.rowToItem(row);
      this.loadItemFields(row.itemID as number, item);
      item.creators = this.loadItemCreators(row.itemID as number);
      item.tags = this.loadItemTags(row.itemID as number);
      item.collections = this.loadItemCollections(row.itemID as number);
      items.push(item);
    }

    return {
      items,
      totalResults,
      hasMore: offset + items.length < totalResults,
      nextStart: offset + items.length,
    };
  }

  async getItem(key: string, includeChildren = true): Promise<ZoteroItem | null> {
    const row = this.db
      .prepare(`
        SELECT i.itemID, i.key, i.itemTypeID, i.version, i.dateAdded, i.dateModified
        FROM items i
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE i.key = ? AND di.itemID IS NULL
      `)
      .get(key) as Record<string, unknown> | undefined;

    if (!row) return null;

    const item = this.rowToItem(row);
    this.loadItemFields(row.itemID as number, item);
    item.creators = this.loadItemCreators(row.itemID as number);
    item.tags = this.loadItemTags(row.itemID as number);
    item.collections = this.loadItemCollections(row.itemID as number);

    if (includeChildren) {
      item.attachments = await this.getItemAttachments(key);
      item.notes = await this.getItemNotes(key);
      item.annotations = await this.getItemAnnotations(key);
    }

    return item;
  }

  async getItemFullText(key: string): Promise<string | null> {
    const item = await this.getItem(key);
    if (!item) return null;

    const texts: string[] = [];

    // Check for indexed full text in database
    const fulltextRow = this.db
      .prepare(`
        SELECT fi.content
        FROM fulltextItemWords fiw
        JOIN fulltextItems fi ON fiw.itemID = fi.itemID
        JOIN items i ON fi.itemID = i.itemID
        WHERE i.key = ?
        LIMIT 1
      `)
      .get(key) as { content: string } | undefined;

    if (fulltextRow?.content) {
      texts.push(fulltextRow.content);
    }

    // Try extracting from PDF attachments
    const attachments = item.attachments || [];
    for (const attachment of attachments) {
      if (attachment.contentType === "application/pdf" && this.storagePath) {
        const pdfPath = path.join(this.storagePath, attachment.key, attachment.filename || "");
        if (fs.existsSync(pdfPath)) {
          const pdfText = await extractPdfText(pdfPath);
          if (pdfText) {
            texts.push(pdfText);
          }
        }
      }
    }

    return texts.length > 0 ? texts.join("\n\n---\n\n") : null;
  }

  async getCollections(): Promise<ZoteroCollection[]> {
    const rows = this.db
      .prepare(`
        SELECT c.collectionID, c.key, c.collectionName, c.parentCollectionID, c.version
        FROM collections c
        LEFT JOIN deletedCollections dc ON c.collectionID = dc.collectionID
        WHERE dc.collectionID IS NULL
        ORDER BY c.collectionName
      `)
      .all() as Array<{
      collectionID: number;
      key: string;
      collectionName: string;
      parentCollectionID: number | null;
      version: number;
    }>;

    // Get parent keys
    const idToKey: Record<number, string> = {};
    for (const row of rows) {
      idToKey[row.collectionID] = row.key;
    }

    return rows.map((row) => ({
      key: row.key,
      name: row.collectionName,
      parentCollection: row.parentCollectionID
        ? idToKey[row.parentCollectionID] || false
        : false,
      version: row.version,
    }));
  }

  async getCollection(key: string): Promise<ZoteroCollection | null> {
    const row = this.db
      .prepare(`
        SELECT c.collectionID, c.key, c.collectionName, c.parentCollectionID, c.version
        FROM collections c
        LEFT JOIN deletedCollections dc ON c.collectionID = dc.collectionID
        WHERE c.key = ? AND dc.collectionID IS NULL
      `)
      .get(key) as {
      collectionID: number;
      key: string;
      collectionName: string;
      parentCollectionID: number | null;
      version: number;
    } | undefined;

    if (!row) return null;

    let parentKey: string | false = false;
    if (row.parentCollectionID) {
      const parent = this.db
        .prepare("SELECT key FROM collections WHERE collectionID = ?")
        .get(row.parentCollectionID) as { key: string } | undefined;
      parentKey = parent?.key || false;
    }

    return {
      key: row.key,
      name: row.collectionName,
      parentCollection: parentKey,
      version: row.version,
    };
  }

  async getCollectionItems(
    collectionKey: string,
    recursive = false,
    filters?: SearchFilters
  ): Promise<SearchResult> {
    const updatedFilters = { ...filters, collectionKey };

    if (recursive) {
      // Get all subcollection keys
      const allKeys = [collectionKey];
      const getSubcollections = (parentKey: string): void => {
        const subs = this.db
          .prepare(`
            SELECT c.key
            FROM collections c
            JOIN collections pc ON c.parentCollectionID = pc.collectionID
            WHERE pc.key = ?
          `)
          .all(parentKey) as Array<{ key: string }>;
        for (const sub of subs) {
          allKeys.push(sub.key);
          getSubcollections(sub.key);
        }
      };
      getSubcollections(collectionKey);

      // Search in all collections
      // For now, we'll just use the main collection; full recursive would need OR logic
    }

    return this.searchItems(undefined, updatedFilters);
  }

  async getTags(filterQuery?: string): Promise<Array<{ tag: string; count: number }>> {
    let sql = `
      SELECT t.name as tag, COUNT(DISTINCT it.itemID) as count
      FROM tags t
      JOIN itemTags it ON t.tagID = it.tagID
      JOIN items i ON it.itemID = i.itemID
      LEFT JOIN deletedItems di ON i.itemID = di.itemID
      WHERE di.itemID IS NULL
    `;
    const params: string[] = [];

    if (filterQuery) {
      sql += " AND t.name LIKE ?";
      params.push(`%${filterQuery}%`);
    }

    sql += " GROUP BY t.tagID ORDER BY count DESC, t.name";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      tag: string;
      count: number;
    }>;

    return rows;
  }

  async getItemNotes(key: string): Promise<ZoteroNote[]> {
    // First get the item ID
    const item = this.db
      .prepare("SELECT itemID FROM items WHERE key = ?")
      .get(key) as { itemID: number } | undefined;

    if (!item) return [];

    const notes = this.db
      .prepare(`
        SELECT i.key, i.dateAdded, i.dateModified, n.note
        FROM itemNotes n
        JOIN items i ON n.itemID = i.itemID
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE n.parentItemID = ? AND di.itemID IS NULL
      `)
      .all(item.itemID) as Array<{
      key: string;
      dateAdded: string;
      dateModified: string;
      note: string;
    }>;

    return notes.map((n) => ({
      key: n.key,
      itemType: "note" as const,
      note: n.note,
      parentItem: key,
      dateAdded: n.dateAdded,
      dateModified: n.dateModified,
    }));
  }

  async getItemAttachments(key: string): Promise<ZoteroAttachment[]> {
    const item = this.db
      .prepare("SELECT itemID FROM items WHERE key = ?")
      .get(key) as { itemID: number } | undefined;

    if (!item) return [];

    const attachments = this.db
      .prepare(`
        SELECT i.key, ia.contentType, ia.path, ia.linkMode
        FROM itemAttachments ia
        JOIN items i ON ia.itemID = i.itemID
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE ia.parentItemID = ? AND di.itemID IS NULL
      `)
      .all(item.itemID) as Array<{
      key: string;
      contentType: string | null;
      path: string | null;
      linkMode: number;
    }>;

    const linkModes = ["imported_file", "imported_url", "linked_file", "linked_url"];

    return attachments.map((a) => {
      // Get title from item data
      const titleRow = this.db
        .prepare(`
          SELECT iv.value
          FROM items i
          JOIN itemData id ON i.itemID = id.itemID
          JOIN itemDataValues iv ON id.valueID = iv.valueID
          JOIN fields f ON id.fieldID = f.fieldID
          WHERE i.key = ? AND f.fieldName = 'title'
        `)
        .get(a.key) as { value: string } | undefined;

      const filename = a.path?.replace(/^storage:/, "") || undefined;

      return {
        key: a.key,
        title: titleRow?.value || filename || a.key,
        itemType: "attachment" as const,
        linkMode: linkModes[a.linkMode] || "imported_file",
        contentType: a.contentType || undefined,
        filename,
        path: this.storagePath && filename
          ? path.join(this.storagePath, a.key, filename)
          : undefined,
        parentItem: key,
      };
    });
  }

  async getItemAnnotations(key: string): Promise<ZoteroAnnotation[]> {
    // Get attachments first, then annotations from each PDF
    const attachments = await this.getItemAttachments(key);
    const annotations: ZoteroAnnotation[] = [];

    for (const attachment of attachments) {
      if (attachment.contentType === "application/pdf") {
        const attachmentItem = this.db
          .prepare("SELECT itemID FROM items WHERE key = ?")
          .get(attachment.key) as { itemID: number } | undefined;

        if (attachmentItem) {
          const rows = this.db
            .prepare(`
              SELECT i.key, i.dateAdded, i.dateModified,
                     ian.type, ian.text, ian.comment, ian.color,
                     ian.pageLabel, ian.position
              FROM itemAnnotations ian
              JOIN items i ON ian.itemID = i.itemID
              LEFT JOIN deletedItems di ON i.itemID = di.itemID
              WHERE ian.parentItemID = ? AND di.itemID IS NULL
            `)
            .all(attachmentItem.itemID) as Array<{
            key: string;
            dateAdded: string;
            dateModified: string;
            type: string;
            text: string | null;
            comment: string | null;
            color: string | null;
            pageLabel: string | null;
            position: string | null;
          }>;

          for (const row of rows) {
            annotations.push({
              key: row.key,
              itemType: "annotation",
              annotationType: row.type,
              annotationText: row.text || undefined,
              annotationComment: row.comment || undefined,
              annotationColor: row.color || undefined,
              annotationPageLabel: row.pageLabel || undefined,
              annotationPosition: row.position || undefined,
              parentItem: attachment.key,
              dateAdded: row.dateAdded,
              dateModified: row.dateModified,
            });
          }
        }
      }
    }

    return annotations;
  }

  async getRelatedItems(key: string): Promise<ZoteroItem[]> {
    const item = this.db
      .prepare("SELECT itemID FROM items WHERE key = ?")
      .get(key) as { itemID: number } | undefined;

    if (!item) return [];

    const relations = this.db
      .prepare(`
        SELECT i2.key
        FROM itemRelations ir
        JOIN items i1 ON ir.itemID = i1.itemID
        JOIN items i2 ON ir.linkedItemID = i2.itemID
        WHERE i1.key = ?
      `)
      .all(key) as Array<{ key: string }>;

    const items: ZoteroItem[] = [];
    for (const rel of relations) {
      const relatedItem = await this.getItem(rel.key, false);
      if (relatedItem) {
        items.push(relatedItem);
      }
    }

    return items;
  }

  async getRecentItems(days = 7, limit = 25): Promise<ZoteroItem[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().replace("T", " ").replace("Z", "");

    const rows = this.db
      .prepare(`
        SELECT i.itemID, i.key, i.itemTypeID, i.version, i.dateAdded, i.dateModified
        FROM items i
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL
          AND i.itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment', 'note', 'annotation'))
          AND (i.dateModified >= ? OR i.dateAdded >= ?)
        ORDER BY i.dateModified DESC
        LIMIT ?
      `)
      .all(cutoffStr, cutoffStr, limit) as Array<Record<string, unknown>>;

    const items: ZoteroItem[] = [];
    for (const row of rows) {
      const item = this.rowToItem(row);
      this.loadItemFields(row.itemID as number, item);
      item.creators = this.loadItemCreators(row.itemID as number);
      item.tags = this.loadItemTags(row.itemID as number);
      items.push(item);
    }

    return items;
  }

  async getLibraryStats(): Promise<LibraryStats> {
    // Total items (excluding attachments, notes, annotations)
    const itemCount = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM items i
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL
          AND i.itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment', 'note', 'annotation'))
      `)
      .get() as { count: number };

    // Collections
    const collectionCount = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM collections c
        LEFT JOIN deletedCollections dc ON c.collectionID = dc.collectionID
        WHERE dc.collectionID IS NULL
      `)
      .get() as { count: number };

    // Tags
    const tagCount = this.db
      .prepare("SELECT COUNT(DISTINCT tagID) as count FROM itemTags")
      .get() as { count: number };

    // Attachments
    const attachmentCount = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM itemAttachments ia
        JOIN items i ON ia.itemID = i.itemID
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL
      `)
      .get() as { count: number };

    // Items by type
    const typeRows = this.db
      .prepare(`
        SELECT it.typeName, COUNT(*) as count
        FROM items i
        JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL
          AND it.typeName NOT IN ('attachment', 'note', 'annotation')
        GROUP BY i.itemTypeID
        ORDER BY count DESC
      `)
      .all() as Array<{ typeName: string; count: number }>;

    const itemsByType: Record<string, number> = {};
    for (const row of typeRows) {
      itemsByType[row.typeName] = row.count;
    }

    // Recent items
    const oneDay = new Date();
    oneDay.setDate(oneDay.getDate() - 1);
    const oneDayStr = oneDay.toISOString().replace("T", " ").replace("Z", "");

    const sevenDays = new Date();
    sevenDays.setDate(sevenDays.getDate() - 7);
    const sevenDaysStr = sevenDays.toISOString().replace("T", " ").replace("Z", "");

    const recentlyAdded = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM items i
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL AND i.dateAdded >= ?
      `)
      .get(oneDayStr) as { count: number };

    const recentlyModified = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM items i
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL AND i.dateModified >= ?
      `)
      .get(sevenDaysStr) as { count: number };

    return {
      totalItems: itemCount.count,
      totalCollections: collectionCount.count,
      totalTags: tagCount.count,
      totalAttachments: attachmentCount.count,
      itemsByType,
      recentlyAdded: recentlyAdded.count,
      recentlyModified: recentlyModified.count,
    };
  }

  async getBibliography(_keys: string[], _style = "apa"): Promise<string> {
    // Local backend doesn't have citation formatting capability
    // Would need citeproc-js integration for this
    return "Bibliography generation requires Web API mode or citeproc-js integration.";
  }

  async searchFullText(query: string, limit = 25): Promise<ZoteroItem[]> {
    // Search in fulltextItems content
    const rows = this.db
      .prepare(`
        SELECT DISTINCT i.key
        FROM fulltextItems fi
        JOIN items i ON fi.itemID = i.itemID
        JOIN itemAttachments ia ON fi.itemID = ia.itemID
        LEFT JOIN deletedItems di ON i.itemID = di.itemID
        WHERE di.itemID IS NULL AND fi.content LIKE ?
        LIMIT ?
      `)
      .all(`%${query}%`, limit) as Array<{ key: string }>;

    // Get parent items
    const items: ZoteroItem[] = [];
    const seenKeys = new Set<string>();

    for (const row of rows) {
      // Get parent item key
      const attachment = this.db
        .prepare(`
          SELECT i2.key
          FROM itemAttachments ia
          JOIN items i1 ON ia.itemID = i1.itemID
          JOIN items i2 ON ia.parentItemID = i2.itemID
          WHERE i1.key = ?
        `)
        .get(row.key) as { key: string } | undefined;

      const parentKey = attachment?.key || row.key;
      if (!seenKeys.has(parentKey)) {
        seenKeys.add(parentKey);
        const item = await this.getItem(parentKey, false);
        if (item) {
          items.push(item);
        }
      }
    }

    return items;
  }

  close(): void {
    this.db.close();
  }
}
