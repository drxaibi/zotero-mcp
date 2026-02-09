/**
 * MCP Resources for Zotero.
 * Exposes library data as resources that can be attached to conversations.
 */

import type { ZoteroBackend } from "../backends/interface.js";

/**
 * Register all Zotero resources with the MCP server.
 */
export function registerResources(
  server: {
    resource: (
      uri: string,
      name: string,
      handler: () => Promise<{
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      }>
    ) => void;
  },
  getBackend: () => ZoteroBackend
) {
  // Library statistics
  server.resource(
    "zotero://library/stats",
    "Zotero Library Statistics - Overview of library contents including item counts, collections, and tags",
    async () => {
      const backend = getBackend();
      const stats = await backend.getLibraryStats();

      const text = [
        "# Zotero Library Statistics",
        "",
        `- **Total Items:** ${stats.totalItems}`,
        `- **Collections:** ${stats.totalCollections}`,
        `- **Tags:** ${stats.totalTags}`,
        `- **Attachments:** ${stats.totalAttachments}`,
        `- **Recently Added (24h):** ${stats.recentlyAdded}`,
        `- **Recently Modified (7d):** ${stats.recentlyModified}`,
        "",
        "## Items by Type",
        "",
        ...Object.entries(stats.itemsByType)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => `- ${type}: ${count}`),
      ].join("\n");

      return {
        contents: [
          {
            uri: "zotero://library/stats",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );

  // Collections tree
  server.resource(
    "zotero://collections",
    "Zotero Collections - Complete list of all collections in the library",
    async () => {
      const backend = getBackend();
      const collections = await backend.getCollections();

      // Build tree structure
      const byParent: Record<string, typeof collections> = { root: [] };
      for (const col of collections) {
        const parent = (col.parentCollection as string) || "root";
        if (!byParent[parent]) byParent[parent] = [];
        byParent[parent].push(col);
      }

      function renderTree(parentKey: string, indent: number): string {
        const children = byParent[parentKey] || [];
        return children
          .map((col) => {
            const prefix = "  ".repeat(indent);
            let line = `${prefix}- ${col.name} (key: ${col.key})`;
            const subTree = renderTree(col.key, indent + 1);
            if (subTree) {
              line += "\n" + subTree;
            }
            return line;
          })
          .join("\n");
      }

      const text = [
        "# Zotero Collections",
        "",
        `Total: ${collections.length} collections`,
        "",
        renderTree("root", 0),
      ].join("\n");

      return {
        contents: [
          {
            uri: "zotero://collections",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );

  // Tags list
  server.resource(
    "zotero://tags",
    "Zotero Tags - All tags in the library with item counts",
    async () => {
      const backend = getBackend();
      const tags = await backend.getTags();

      const text = [
        "# Zotero Tags",
        "",
        `Total: ${tags.length} tags`,
        "",
        ...tags.map((t) => `- ${t.tag} (${t.count} items)`),
      ].join("\n");

      return {
        contents: [
          {
            uri: "zotero://tags",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );

  // Recent items
  server.resource(
    "zotero://recent",
    "Zotero Recent Items - Items added or modified in the last 7 days",
    async () => {
      const backend = getBackend();
      const items = await backend.getRecentItems(7, 50);

      const text = [
        "# Recent Zotero Items",
        "",
        `Showing ${items.length} items from the last 7 days:`,
        "",
        ...items.map((item) => {
          const date = item.dateModified || item.dateAdded;
          return `- **${item.title || "Untitled"}** (${item.itemType}) - ${date}\n  Key: ${item.key}`;
        }),
      ].join("\n");

      return {
        contents: [
          {
            uri: "zotero://recent",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );

  // Item types schema
  server.resource(
    "zotero://schema/item-types",
    "Zotero Item Types - List of all item types supported by Zotero",
    async () => {
      const itemTypes = [
        "artwork",
        "audioRecording",
        "bill",
        "blogPost",
        "book",
        "bookSection",
        "case",
        "computerProgram",
        "conferencePaper",
        "dataset",
        "dictionaryEntry",
        "document",
        "email",
        "encyclopediaArticle",
        "film",
        "forumPost",
        "hearing",
        "instantMessage",
        "interview",
        "journalArticle",
        "letter",
        "magazineArticle",
        "manuscript",
        "map",
        "newspaperArticle",
        "patent",
        "podcast",
        "preprint",
        "presentation",
        "radioBroadcast",
        "report",
        "standard",
        "statute",
        "thesis",
        "tvBroadcast",
        "videoRecording",
        "webpage",
      ];

      const text = [
        "# Zotero Item Types",
        "",
        "Supported item types for filtering and creating items:",
        "",
        ...itemTypes.map((t) => `- ${t}`),
      ].join("\n");

      return {
        contents: [
          {
            uri: "zotero://schema/item-types",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );
}
