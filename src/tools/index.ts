/**
 * MCP Tools for Zotero.
 * Defines all available tools that LLMs can invoke.
 */

import { z } from "zod";
import type { ZoteroBackend } from "../backends/interface.js";
import {
  formatCreators,
  noteToPlainText,
  generateCitationKey,
} from "../backends/types.js";

// Tool schemas
export const searchLibrarySchema = z.object({
  query: z.string().optional().describe("Search query for title, creators, abstract, or full text"),
  itemType: z.string().optional().describe("Filter by item type (e.g., 'journalArticle', 'book', 'thesis')"),
  tags: z.array(z.string()).optional().describe("Filter by tags (all must match)"),
  collection: z.string().optional().describe("Collection key to search within"),
  limit: z.number().optional().default(25).describe("Maximum number of results (default: 25)"),
});

export const getItemSchema = z.object({
  itemKey: z.string().describe("The unique key of the Zotero item"),
});

export const getItemFullTextSchema = z.object({
  itemKey: z.string().describe("The unique key of the Zotero item"),
});

export const getItemNotesSchema = z.object({
  itemKey: z.string().describe("The unique key of the Zotero item"),
});

export const getItemAnnotationsSchema = z.object({
  itemKey: z.string().describe("The unique key of the Zotero item"),
});

export const listCollectionsSchema = z.object({});

export const getCollectionItemsSchema = z.object({
  collectionKey: z.string().describe("The unique key of the collection"),
  recursive: z.boolean().optional().default(false).describe("Include items from subcollections"),
  limit: z.number().optional().default(25).describe("Maximum number of results"),
});

export const listTagsSchema = z.object({
  filter: z.string().optional().describe("Filter tags by name"),
});

export const searchFullTextSchema = z.object({
  query: z.string().describe("Text to search for in PDF content"),
  limit: z.number().optional().default(25).describe("Maximum number of results"),
});

export const getBibliographySchema = z.object({
  itemKeys: z.array(z.string()).describe("Array of item keys to generate bibliography for"),
  style: z.string().optional().default("apa").describe("Citation style (e.g., 'apa', 'chicago-author-date', 'mla')"),
});

export const getRelatedItemsSchema = z.object({
  itemKey: z.string().describe("The unique key of the Zotero item"),
});

export const getRecentItemsSchema = z.object({
  days: z.number().optional().default(7).describe("Number of days to look back"),
  limit: z.number().optional().default(25).describe("Maximum number of results"),
});

/**
 * Format a Zotero item for display to the LLM.
 */
function formatItem(item: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push(`## ${item.title || "Untitled"}`);
  lines.push("");

  if (item.creators) {
    const creators = formatCreators(item.creators as any);
    if (creators) {
      lines.push(`**Authors:** ${creators}`);
    }
  }

  if (item.date) {
    lines.push(`**Date:** ${item.date}`);
  }

  if (item.itemType) {
    lines.push(`**Type:** ${item.itemType}`);
  }

  if (item.publicationTitle) {
    lines.push(`**Publication:** ${item.publicationTitle}`);
  }

  // Volume, issue, pages
  const pubInfo: string[] = [];
  if (item.volume) pubInfo.push(`Vol. ${item.volume}`);
  if (item.issue) pubInfo.push(`Issue ${item.issue}`);
  if (item.pages) pubInfo.push(`pp. ${item.pages}`);
  if (pubInfo.length > 0) {
    lines.push(`**Publication Info:** ${pubInfo.join(", ")}`);
  }

  // Identifiers
  if (item.DOI) lines.push(`**DOI:** ${item.DOI}`);
  if (item.ISBN) lines.push(`**ISBN:** ${item.ISBN}`);
  if (item.url) lines.push(`**URL:** ${item.url}`);

  if (item.abstractNote) {
    lines.push("");
    lines.push("### Abstract");
    lines.push(item.abstractNote as string);
  }

  if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
    const tagNames = item.tags.map((t: any) => t.tag || t).join(", ");
    lines.push("");
    lines.push(`**Tags:** ${tagNames}`);
  }

  lines.push("");
  lines.push(`**Key:** ${item.key}`);
  lines.push(`**Citation Key:** ${generateCitationKey(item as any)}`);

  return lines.join("\n");
}

/**
 * Format a collection of items as a list.
 */
function formatItemList(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) {
    return "No items found.";
  }

  return items
    .map((item, i) => {
      const creators = formatCreators(item.creators as any);
      const year = item.date ? (item.date as string).match(/\d{4}/)?.[0] : "";
      return `${i + 1}. **${item.title || "Untitled"}** (${year})\n   ${creators}\n   Key: ${item.key}`;
    })
    .join("\n\n");
}

/**
 * Register all Zotero tools with the MCP server.
 */
export function registerTools(
  server: {
    tool: (
      name: string,
      description: string,
      schema: z.ZodType<any>,
      handler: (params: any) => Promise<{ content: Array<{ type: string; text: string }> }>
    ) => void;
  },
  getBackend: () => ZoteroBackend
) {
  // search_library
  server.tool(
    "search_library",
    "Search the Zotero library for items by query, tags, item type, or collection. Returns metadata including title, authors, abstract, publication info, and identifiers.",
    searchLibrarySchema,
    async (params) => {
      const backend = getBackend();
      const result = await backend.searchItems(params.query, {
        itemType: params.itemType,
        tags: params.tags,
        collectionKey: params.collection,
        limit: params.limit,
      });

      const text = [
        `Found ${result.totalResults} items${result.hasMore ? " (showing first " + result.items.length + ")" : ""}:`,
        "",
        formatItemList(result.items),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // get_item
  server.tool(
    "get_item",
    "Get complete details for a specific Zotero item including all metadata, abstract, creators, tags, notes, and attachments.",
    getItemSchema,
    async (params) => {
      const backend = getBackend();
      const item = await backend.getItem(params.itemKey);

      if (!item) {
        return {
          content: [{ type: "text", text: `Item not found: ${params.itemKey}` }],
        };
      }

      let text = formatItem(item);

      // Add notes summary
      if (item.notes && item.notes.length > 0) {
        text += "\n\n### Notes\n";
        for (const note of item.notes) {
          const plainText = noteToPlainText(note.note);
          text += `\n- ${plainText.substring(0, 200)}${plainText.length > 200 ? "..." : ""}`;
        }
      }

      // Add attachments summary
      if (item.attachments && item.attachments.length > 0) {
        text += "\n\n### Attachments\n";
        for (const att of item.attachments) {
          text += `\n- ${att.title} (${att.contentType || "unknown type"}) [${att.key}]`;
        }
      }

      // Add annotations summary
      if (item.annotations && item.annotations.length > 0) {
        text += `\n\n### Annotations (${item.annotations.length} total)\n`;
        for (const ann of item.annotations.slice(0, 10)) {
          if (ann.annotationText) {
            text += `\n- **Highlight (p.${ann.annotationPageLabel || "?"}):** "${ann.annotationText}"`;
            if (ann.annotationComment) {
              text += `\n  *Comment:* ${ann.annotationComment}`;
            }
          } else if (ann.annotationComment) {
            text += `\n- **Note (p.${ann.annotationPageLabel || "?"}):** ${ann.annotationComment}`;
          }
        }
        if (item.annotations.length > 10) {
          text += `\n\n... and ${item.annotations.length - 10} more annotations.`;
        }
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // get_item_fulltext
  server.tool(
    "get_item_fulltext",
    "Extract and return the full text content from an item's PDF attachments. Use this to get the complete paper/document content for analysis.",
    getItemFullTextSchema,
    async (params) => {
      const backend = getBackend();
      const fullText = await backend.getItemFullText(params.itemKey);

      if (!fullText) {
        // Try to get the item to provide more context
        const item = await backend.getItem(params.itemKey);
        if (!item) {
          return {
            content: [{ type: "text", text: `Item not found: ${params.itemKey}` }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `No full text available for "${item.title}". The item may not have indexed PDF attachments.`,
            },
          ],
        };
      }

      return { content: [{ type: "text", text: fullText }] };
    }
  );

  // get_item_notes
  server.tool(
    "get_item_notes",
    "Get all notes attached to a Zotero item. Notes may contain user annotations, summaries, or extracted information.",
    getItemNotesSchema,
    async (params) => {
      const backend = getBackend();
      const notes = await backend.getItemNotes(params.itemKey);

      if (notes.length === 0) {
        return {
          content: [{ type: "text", text: `No notes found for item: ${params.itemKey}` }],
        };
      }

      const text = notes
        .map((note, i) => {
          const plainText = noteToPlainText(note.note);
          return `### Note ${i + 1}\n\n${plainText}`;
        })
        .join("\n\n---\n\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // get_item_annotations
  server.tool(
    "get_item_annotations",
    "Get PDF annotations (highlights, comments, notes) from an item's attachments. Useful for understanding what parts of a paper the user found important.",
    getItemAnnotationsSchema,
    async (params) => {
      const backend = getBackend();
      const annotations = await backend.getItemAnnotations(params.itemKey);

      if (annotations.length === 0) {
        return {
          content: [{ type: "text", text: `No annotations found for item: ${params.itemKey}` }],
        };
      }

      const text = annotations
        .map((ann) => {
          let line = `**${ann.annotationType}** (page ${ann.annotationPageLabel || "?"})`;
          if (ann.annotationColor) {
            line += ` [${ann.annotationColor}]`;
          }
          line += ":";
          if (ann.annotationText) {
            line += `\n> "${ann.annotationText}"`;
          }
          if (ann.annotationComment) {
            line += `\n\n*Comment:* ${ann.annotationComment}`;
          }
          return line;
        })
        .join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text",
            text: `## Annotations (${annotations.length} total)\n\n${text}`,
          },
        ],
      };
    }
  );

  // list_collections
  server.tool(
    "list_collections",
    "List all collections in the Zotero library. Collections are folders used to organize items.",
    listCollectionsSchema,
    async () => {
      const backend = getBackend();
      const collections = await backend.getCollections();

      if (collections.length === 0) {
        return { content: [{ type: "text", text: "No collections found." }] };
      }

      // Build a tree structure
      const byParent: Record<string, typeof collections> = { root: [] };
      for (const col of collections) {
        const parent = col.parentCollection || "root";
        if (!byParent[parent]) byParent[parent] = [];
        byParent[parent].push(col);
      }

      function renderTree(parentKey: string, indent: string): string {
        const children = byParent[parentKey] || [];
        return children
          .map((col) => {
            let line = `${indent}- **${col.name}** (${col.key})`;
            const subTree = renderTree(col.key, indent + "  ");
            if (subTree) {
              line += "\n" + subTree;
            }
            return line;
          })
          .join("\n");
      }

      const text = `## Collections (${collections.length} total)\n\n${renderTree("root", "")}`;
      return { content: [{ type: "text", text }] };
    }
  );

  // get_collection_items
  server.tool(
    "get_collection_items",
    "Get all items in a specific Zotero collection.",
    getCollectionItemsSchema,
    async (params) => {
      const backend = getBackend();

      // Get collection info
      const collection = await backend.getCollection(params.collectionKey);
      const result = await backend.getCollectionItems(
        params.collectionKey,
        params.recursive,
        { limit: params.limit }
      );

      const header = collection
        ? `## Items in "${collection.name}"`
        : `## Items in collection ${params.collectionKey}`;

      const text = [
        header,
        `Found ${result.totalResults} items${result.hasMore ? " (showing first " + result.items.length + ")" : ""}:`,
        "",
        formatItemList(result.items),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // list_tags
  server.tool(
    "list_tags",
    "List all tags in the Zotero library with item counts. Tags are labels used to categorize items.",
    listTagsSchema,
    async (params) => {
      const backend = getBackend();
      const tags = await backend.getTags(params.filter);

      if (tags.length === 0) {
        return { content: [{ type: "text", text: "No tags found." }] };
      }

      const text = [
        `## Tags (${tags.length} total)`,
        "",
        ...tags.map((t) => `- **${t.tag}** (${t.count} items)`),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // search_fulltext
  server.tool(
    "search_fulltext",
    "Search across the full text content of all PDFs in the library. Use this to find papers that mention specific terms, methods, or concepts.",
    searchFullTextSchema,
    async (params) => {
      const backend = getBackend();
      const items = await backend.searchFullText(params.query, params.limit);

      if (items.length === 0) {
        return {
          content: [
            { type: "text", text: `No items found containing "${params.query}" in their full text.` },
          ],
        };
      }

      const text = [
        `## Full-text search results for "${params.query}"`,
        `Found ${items.length} items:`,
        "",
        formatItemList(items),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // get_bibliography
  server.tool(
    "get_bibliography",
    "Generate formatted bibliography/citations for specified items in a given citation style.",
    getBibliographySchema,
    async (params) => {
      const backend = getBackend();
      const bibliography = await backend.getBibliography(params.itemKeys, params.style);

      return {
        content: [
          {
            type: "text",
            text: `## Bibliography (${params.style} style)\n\n${bibliography}`,
          },
        ],
      };
    }
  );

  // get_related_items
  server.tool(
    "get_related_items",
    "Get items that are marked as related to a given item in Zotero.",
    getRelatedItemsSchema,
    async (params) => {
      const backend = getBackend();
      const items = await backend.getRelatedItems(params.itemKey);

      if (items.length === 0) {
        return {
          content: [{ type: "text", text: `No related items found for: ${params.itemKey}` }],
        };
      }

      const text = [
        `## Related Items (${items.length})`,
        "",
        formatItemList(items),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // get_recent_items
  server.tool(
    "get_recent_items",
    "Get recently added or modified items in the library.",
    getRecentItemsSchema,
    async (params) => {
      const backend = getBackend();
      const items = await backend.getRecentItems(params.days, params.limit);

      if (items.length === 0) {
        return {
          content: [
            { type: "text", text: `No items added or modified in the last ${params.days} days.` },
          ],
        };
      }

      const text = [
        `## Recent Items (last ${params.days} days)`,
        `Found ${items.length} items:`,
        "",
        formatItemList(items),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );
}
