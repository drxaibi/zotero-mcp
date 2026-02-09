#!/usr/bin/env node
/**
 * Zotero MCP Server
 * 
 * A Model Context Protocol server that provides comprehensive access to Zotero
 * research libraries. Supports both Web API and local SQLite database access.
 * 
 * Environment Variables:
 *   ZOTERO_MODE        - "web" (default) or "local"
 *   ZOTERO_API_KEY     - API key for web mode (get from https://www.zotero.org/settings/keys)
 *   ZOTERO_USER_ID     - User ID for web mode
 *   ZOTERO_GROUP_ID    - Group ID for group libraries (optional)
 *   ZOTERO_DATA_DIR    - Path to Zotero data directory (for local mode)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, validateConfig, ZoteroMode, type ZoteroConfig } from "./config.js";
import type { ZoteroBackend } from "./backends/interface.js";
import { WebAPIBackend } from "./backends/web-api.js";
import { LocalBackend } from "./backends/local.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";

// Tool definitions for ListTools
const TOOL_DEFINITIONS = [
  {
    name: "search_library",
    description: "Search the Zotero library for items by query, tags, item type, or collection. Returns metadata including title, authors, abstract, publication info, and identifiers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query for title, creators, abstract, or full text" },
        itemType: { type: "string", description: "Filter by item type (e.g., 'journalArticle', 'book', 'thesis')" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (all must match)" },
        collection: { type: "string", description: "Collection key to search within" },
        limit: { type: "number", description: "Maximum number of results (default: 25)" },
      },
    },
  },
  {
    name: "get_item",
    description: "Get complete details for a specific Zotero item including all metadata, abstract, creators, tags, notes, and attachments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKey: { type: "string", description: "The unique key of the Zotero item" },
      },
      required: ["itemKey"],
    },
  },
  {
    name: "get_item_fulltext",
    description: "Extract and return the full text content from an item's PDF attachments. Use this to get the complete paper/document content for analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKey: { type: "string", description: "The unique key of the Zotero item" },
      },
      required: ["itemKey"],
    },
  },
  {
    name: "get_item_notes",
    description: "Get all notes attached to a Zotero item. Notes may contain user annotations, summaries, or extracted information.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKey: { type: "string", description: "The unique key of the Zotero item" },
      },
      required: ["itemKey"],
    },
  },
  {
    name: "get_item_annotations",
    description: "Get PDF annotations (highlights, comments, notes) from an item's attachments. Useful for understanding what parts of a paper the user found important.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKey: { type: "string", description: "The unique key of the Zotero item" },
      },
      required: ["itemKey"],
    },
  },
  {
    name: "list_collections",
    description: "List all collections in the Zotero library. Collections are folders used to organize items.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_collection_items",
    description: "Get all items in a specific Zotero collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collectionKey: { type: "string", description: "The unique key of the collection" },
        recursive: { type: "boolean", description: "Include items from subcollections" },
        limit: { type: "number", description: "Maximum number of results" },
      },
      required: ["collectionKey"],
    },
  },
  {
    name: "list_tags",
    description: "List all tags in the Zotero library with item counts. Tags are labels used to categorize items.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filter: { type: "string", description: "Filter tags by name" },
      },
    },
  },
  {
    name: "search_fulltext",
    description: "Search across the full text content of all PDFs in the library. Use this to find papers that mention specific terms, methods, or concepts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Text to search for in PDF content" },
        limit: { type: "number", description: "Maximum number of results" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_bibliography",
    description: "Generate formatted bibliography/citations for specified items in a given citation style.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKeys: { type: "array", items: { type: "string" }, description: "Array of item keys to generate bibliography for" },
        style: { type: "string", description: "Citation style (e.g., 'apa', 'chicago-author-date', 'mla')" },
      },
      required: ["itemKeys"],
    },
  },
  {
    name: "get_related_items",
    description: "Get items that are marked as related to a given item in Zotero.",
    inputSchema: {
      type: "object" as const,
      properties: {
        itemKey: { type: "string", description: "The unique key of the Zotero item" },
      },
      required: ["itemKey"],
    },
  },
  {
    name: "get_recent_items",
    description: "Get recently added or modified items in the library.",
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Number of days to look back" },
        limit: { type: "number", description: "Maximum number of results" },
      },
    },
  },
];

// Resource definitions for ListResources
const RESOURCE_DEFINITIONS = [
  {
    uri: "zotero://library/stats",
    name: "Library Statistics",
    description: "Overview of library contents including item counts, collections, and tags",
    mimeType: "text/markdown",
  },
  {
    uri: "zotero://collections",
    name: "Collections",
    description: "Complete list of all collections in the library",
    mimeType: "text/markdown",
  },
  {
    uri: "zotero://tags",
    name: "Tags",
    description: "All tags in the library with item counts",
    mimeType: "text/markdown",
  },
  {
    uri: "zotero://recent",
    name: "Recent Items",
    description: "Items added or modified in the last 7 days",
    mimeType: "text/markdown",
  },
  {
    uri: "zotero://schema/item-types",
    name: "Item Types Schema",
    description: "List of all item types supported by Zotero",
    mimeType: "text/markdown",
  },
];

class ZoteroMCPServer {
  private server: Server;
  private config: ZoteroConfig;
  private backend: ZoteroBackend | null = null;
  private toolHandlers: Map<string, (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>> = new Map();
  private resourceHandlers: Map<string, () => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>> = new Map();

  constructor() {
    this.config = loadConfig();
    
    this.server = new Server(
      {
        name: "zotero-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
    this.registerToolsAndResources();
  }

  private getBackend(): ZoteroBackend {
    if (!this.backend) {
      const errors = validateConfig(this.config);
      if (errors.length > 0) {
        throw new Error(`Configuration errors:\n${errors.join("\n")}`);
      }

      if (this.config.mode === ZoteroMode.LOCAL) {
        this.backend = new LocalBackend(this.config);
      } else {
        this.backend = new WebAPIBackend(this.config);
      }
    }
    return this.backend;
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS,
    }));

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = this.toolHandlers.get(name);

      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      try {
        return await handler(args || {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    });

    // List resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: RESOURCE_DEFINITIONS,
    }));

    // Read resource handler
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const handler = this.resourceHandlers.get(uri);

      if (!handler) {
        throw new Error(`Unknown resource: ${uri}`);
      }

      try {
        return await handler();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Error: ${message}`,
            },
          ],
        };
      }
    });
  }

  private registerToolsAndResources(): void {
    // Create a wrapper to register tools
    const toolServer = {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
      ) => {
        this.toolHandlers.set(name, handler);
      },
    };

    // Create a wrapper to register resources
    const resourceServer = {
      resource: (
        uri: string,
        _name: string,
        handler: () => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>
      ) => {
        this.resourceHandlers.set(uri, handler);
      },
    };

    // Register all tools and resources
    registerTools(toolServer, () => this.getBackend());
    registerResources(resourceServer, () => this.getBackend());
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Log startup info to stderr (not stdout which is used for MCP communication)
    console.error(`Zotero MCP Server started`);
    console.error(`Mode: ${this.config.mode}`);
    if (this.config.mode === ZoteroMode.LOCAL) {
      console.error(`Data directory: ${this.config.dataDir}`);
    } else {
      console.error(`User ID: ${this.config.userId || "not set"}`);
      console.error(`Group ID: ${this.config.groupId || "not set"}`);
    }
  }
}

// Main entry point
const server = new ZoteroMCPServer();
server.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
