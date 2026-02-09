/**
 * Type definitions for Zotero data structures.
 */

export interface ZoteroCreator {
  creatorType: string; // author, editor, translator, etc.
  firstName?: string;
  lastName?: string;
  name?: string; // For single-field names
}

export interface ZoteroTag {
  tag: string;
  type?: number; // 0 = manual, 1 = automatic
}

export interface ZoteroAttachment {
  key: string;
  title: string;
  itemType: "attachment";
  linkMode: string; // imported_file, imported_url, linked_file, linked_url
  contentType?: string; // MIME type
  filename?: string;
  path?: string; // Local file path
  url?: string;
  md5?: string;
  mtime?: number;
  parentItem?: string;
}

export interface ZoteroNote {
  key: string;
  itemType: "note";
  note: string; // HTML content
  parentItem?: string;
  dateAdded?: string;
  dateModified?: string;
  tags?: ZoteroTag[];
}

export interface ZoteroAnnotation {
  key: string;
  itemType: "annotation";
  annotationType: string; // highlight, note, underline, image, ink
  annotationText?: string; // Highlighted/annotated text
  annotationComment?: string; // User comment
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationPosition?: string; // JSON position data
  parentItem?: string; // Attachment key
  dateAdded?: string;
  dateModified?: string;
  tags?: ZoteroTag[];
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection?: string | false;
  version?: number;
  data?: {
    key: string;
    name: string;
    parentCollection?: string | false;
    version?: number;
  };
  meta?: {
    numCollections?: number;
    numItems?: number;
  };
}

export interface ZoteroItem {
  key: string;
  version?: number;
  itemType: string;

  // Core fields
  title?: string;
  abstractNote?: string;
  date?: string;
  language?: string;
  url?: string;
  accessDate?: string;

  // Publication fields
  publicationTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  series?: string;
  seriesNumber?: string;
  seriesTitle?: string;

  // Identifiers
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  PMID?: string;
  PMCID?: string;
  extra?: string; // Often contains arXiv ID and other identifiers

  // Publisher/place
  publisher?: string;
  place?: string;

  // Academic
  institution?: string;
  university?: string;
  thesisType?: string;

  // Other
  shortTitle?: string;
  numPages?: string;
  rights?: string;
  callNumber?: string;
  archive?: string;
  archiveLocation?: string;
  libraryCatalog?: string;

  // Relationships
  creators?: ZoteroCreator[];
  tags?: ZoteroTag[];
  collections?: string[];
  relations?: Record<string, string | string[]>;

  // Timestamps
  dateAdded?: string;
  dateModified?: string;

  // Children (populated separately)
  attachments?: ZoteroAttachment[];
  notes?: ZoteroNote[];
  annotations?: ZoteroAnnotation[];

  // Full text (populated separately)
  fullText?: string;

  // Raw data for additional fields
  [key: string]: unknown;
}

export interface SearchFilters {
  itemType?: string; // Single type or comma-separated
  tags?: string[];
  collectionKey?: string;
  sinceVersion?: number;
  includeTrashed?: boolean;
  sort?: string;
  direction?: "asc" | "desc";
  limit?: number;
  start?: number;
}

export interface SearchResult {
  items: ZoteroItem[];
  totalResults: number;
  hasMore: boolean;
  nextStart: number;
}

export interface LibraryStats {
  totalItems: number;
  totalCollections: number;
  totalTags: number;
  totalAttachments: number;
  itemsByType: Record<string, number>;
  recentlyAdded: number;
  recentlyModified: number;
}

/**
 * Get display name for a creator.
 */
export function getCreatorDisplayName(creator: ZoteroCreator): string {
  if (creator.name) {
    return creator.name;
  }
  const parts = [creator.firstName, creator.lastName].filter(Boolean);
  return parts.join(" ");
}

/**
 * Format creators list for display.
 */
export function formatCreators(creators?: ZoteroCreator[]): string {
  if (!creators || creators.length === 0) {
    return "";
  }
  const authors = creators.filter((c) => c.creatorType === "author");
  const toFormat = authors.length > 0 ? authors : creators;
  const names = toFormat.map(getCreatorDisplayName);

  if (names.length > 3) {
    return `${names[0]} et al.`;
  }
  return names.join(", ");
}

/**
 * Extract plain text from HTML note content.
 */
export function noteToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Generate a citation key from item.
 */
export function generateCitationKey(item: ZoteroItem): string {
  let author = "";
  if (item.creators && item.creators.length > 0) {
    const first = item.creators[0];
    author = first.lastName || first.name || "";
  }
  let year = "";
  if (item.date) {
    const match = item.date.match(/\d{4}/);
    if (match) {
      year = match[0];
    }
  }
  return `${author}${year}`.toLowerCase().replace(/\s+/g, "");
}
