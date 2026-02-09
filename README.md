# Zotero MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides comprehensive access to your [Zotero](https://www.zotero.org/) research library. Give LLMs full context about your papers, including metadata, abstracts, notes, annotations, and full-text PDF content.

## Features

- 🔍 **Full Library Search**: Search items by title, author, tags, or full-text content
- 📚 **Complete Metadata**: Access all item fields, creators, tags, and collections
- 📄 **Full-Text Access**: Extract and search PDF content
- ✏️ **Annotations & Notes**: Access PDF highlights, comments, and user notes
- 📖 **Citations**: Generate formatted bibliographies in various styles (APA, MLA, Chicago, etc.)
- 🔄 **Dual Backend**: Switch between Web API (remote) and local SQLite database

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0
- A [Zotero](https://www.zotero.org/) account with an API key

### Installation

```bash
# Clone the repository
git clone https://github.com/drxaibi/zotero-mcp.git
cd zotero-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Get Your Zotero API Key

1. Go to [Zotero API Keys](https://www.zotero.org/settings/keys/new)
2. Create a new key with these permissions:
   - ✅ Allow library access
   - ✅ Allow notes access
   - ❌ Allow write access (not needed)
3. Note your **User ID** shown at the top of the keys page
4. Copy the generated API key

### Configuration

#### For Claude Desktop

Add to your Claude Desktop config file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Minimal config (most users):**
```json
{
  "mcpServers": {
    "zotero": {
      "command": "node",
      "args": ["/path/to/zotero-mcp/dist/index.js"],
      "env": {
        "ZOTERO_API_KEY": "your-api-key-here",
        "ZOTERO_USER_ID": "your-user-id-here"
      }
    }
  }
}
```

**Full config with all options:**
```json
{
  "mcpServers": {
    "zotero": {
      "command": "node",
      "args": ["/path/to/zotero-mcp/dist/index.js"],
      "env": {
        "ZOTERO_API_KEY": "your-api-key-here",
        "ZOTERO_USER_ID": "your-user-id-here",
        "ZOTERO_MODE": "web",
        "ZOTERO_GROUP_ID": "",
        "ZOTERO_DEFAULT_LIMIT": "25",
        "ZOTERO_CACHE_TTL": "300",
        "ZOTERO_MAX_FULLTEXT_LENGTH": "100000"
      }
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `ZOTERO_API_KEY` | *required* | Your Zotero API key |
| `ZOTERO_USER_ID` | *required* | Your Zotero user ID |
| `ZOTERO_MODE` | `web` | `web` (API) or `local` (SQLite) |
| `ZOTERO_GROUP_ID` | *empty* | Group library ID (if accessing group instead of personal) |
| `ZOTERO_DEFAULT_LIMIT` | `25` | Results per query (1-100) |
| `ZOTERO_CACHE_TTL` | `300` | Cache duration in seconds |
| `ZOTERO_MAX_FULLTEXT_LENGTH` | `100000` | Max characters for full-text extraction |

#### For VS Code with Claude Extension

Add to your VS Code MCP configuration (`.vscode/mcp.json` or settings):

```json
{
  "mcpServers": {
    "zotero": {
      "command": "node",
      "args": ["C:/path/to/zotero-mcp/dist/index.js"],
      "env": {
        "ZOTERO_API_KEY": "your-api-key",
        "ZOTERO_USER_ID": "your-user-id"
      }
    }
  }
}
```

#### Local Mode (Optional)

To read directly from your local Zotero SQLite database (faster, works offline):

```json
{
  "env": {
    "ZOTERO_MODE": "local",
    "ZOTERO_DATA_DIR": "C:/Users/YourName/Zotero"
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `ZOTERO_MODE` | `web` | Set to `local` for SQLite mode |
| `ZOTERO_DATA_DIR` | *auto-detected* | Path to Zotero data folder |

> **Note**: Zotero must be closed when using local mode due to SQLite file locking.

## Available Tools

| Tool | Description |
|------|-------------|
| `search_library` | Search items by query, tags, type, or collection |
| `get_item` | Get complete item details with all metadata |
| `get_item_fulltext` | Extract full text from PDFs |
| `get_item_notes` | Get all notes attached to an item |
| `get_item_annotations` | Get PDF highlights and comments |
| `list_collections` | List all collections |
| `get_collection_items` | Get items in a collection |
| `list_tags` | List all tags with counts |
| `search_fulltext` | Search across all PDF content |
| `get_bibliography` | Generate formatted citations |
| `get_related_items` | Find related items |
| `get_recent_items` | Get recently added/modified items |

## Available Resources

| Resource | Description |
|----------|-------------|
| `zotero://library/stats` | Library statistics overview |
| `zotero://collections` | Full collection hierarchy |
| `zotero://tags` | All tags with item counts |
| `zotero://recent` | Recently modified items |
| `zotero://schema/item-types` | Supported item types |

## Example Prompts

Once connected, you can ask Claude things like:

- *"Search my Zotero library for papers about machine learning"*
- *"Get the full text of the paper with key ABC123"*
- *"What annotations did I make on this paper?"*
- *"Show me all papers in my 'Literature Review' collection"*
- *"Find papers tagged with 'methodology'"*
- *"Generate APA citations for these three papers"*
- *"What papers did I add this week?"*
- *"Summarize the key findings from my climate change papers"*

## All Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZOTERO_API_KEY` | Yes (web mode) | - | Your Zotero API key |
| `ZOTERO_USER_ID` | Yes (web mode) | - | Your Zotero user ID |
| `ZOTERO_MODE` | No | `web` | `web` (API) or `local` (SQLite) |
| `ZOTERO_GROUP_ID` | No | - | Group library ID (use group instead of personal library) |
| `ZOTERO_DATA_DIR` | No | Auto-detected | Path to Zotero data folder (local mode) |
| `ZOTERO_DEFAULT_LIMIT` | No | `25` | Results per query (1-100) |
| `ZOTERO_CACHE_ENABLED` | No | `true` | Enable/disable response caching |
| `ZOTERO_CACHE_TTL` | No | `300` | Cache duration in seconds |
| `ZOTERO_EXTRACT_PDF` | No | `true` | Enable PDF text extraction |
| `ZOTERO_MAX_FULLTEXT_LENGTH` | No | `100000` | Max characters for full-text |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (index.ts)                   │
├─────────────────────────────────────────────────────────────┤
│  Tools              │  Resources                            │
│  - search_library   │  - zotero://library/stats             │
│  - get_item         │  - zotero://collections               │
│  - get_fulltext     │  - zotero://tags                      │
│  - ...              │  - ...                                │
├─────────────────────┴───────────────────────────────────────┤
│                    Backend Interface                        │
├─────────────────────────────────────────────────────────────┤
│   Web API Backend          │      Local SQLite Backend      │
│   (api.zotero.org)         │      (zotero.sqlite)           │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Watch mode
npm run watch
```

## Troubleshooting

### "ZOTERO_API_KEY is required"
Make sure you've set the environment variables in your MCP configuration.

### "Could not detect Zotero data directory"
In local mode, set `ZOTERO_DATA_DIR` to your Zotero data folder path explicitly.

### "Database is locked" (Local mode)
Close Zotero before using local mode. Zotero locks the SQLite database while running.

### No full-text results
Make sure Zotero has indexed your PDFs. In Zotero: Edit → Preferences → Search → Rebuild Index.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Zotero](https://www.zotero.org/) - The amazing open-source reference manager
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol that makes this possible
- [Anthropic](https://www.anthropic.com/) - For Claude and the MCP SDK

## Related Projects

- [Zotero](https://github.com/zotero/zotero) - The Zotero client
- [pyzotero](https://github.com/urschrei/pyzotero) - Python client for Zotero API
- [MCP Servers](https://github.com/modelcontextprotocol/servers) - Official MCP server examples
