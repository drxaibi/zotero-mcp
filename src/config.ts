/**
 * Configuration management for Zotero MCP Server.
 * Handles environment variables and settings for both Web API and Local modes.
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export enum ZoteroMode {
  WEB = "web",
  LOCAL = "local",
}

export interface ZoteroConfig {
  // API Mode
  mode: ZoteroMode;

  // Web API settings
  apiKey?: string;
  userId?: string;
  groupId?: string;
  apiBaseUrl: string;

  // Local mode settings
  dataDir?: string;

  // General settings
  defaultLimit: number;
  maxLimit: number;
  cacheEnabled: boolean;
  cacheTtl: number; // seconds

  // Full-text settings
  extractPdfText: boolean;
  maxFulltextLength: number;
}

/**
 * Auto-detect Zotero data directory based on OS.
 */
function detectZoteroDataDir(): string | undefined {
  const platform = os.platform();
  const home = os.homedir();
  let possiblePaths: string[] = [];

  if (platform === "win32") {
    const appData = process.env.APPDATA || "";
    possiblePaths = [
      path.join(home, "Zotero"),
      path.join(appData, "Zotero", "Zotero", "Profiles"),
    ];
  } else if (platform === "darwin") {
    possiblePaths = [
      path.join(home, "Zotero"),
      path.join(home, "Library", "Application Support", "Zotero", "Profiles"),
    ];
  } else {
    // Linux
    possiblePaths = [
      path.join(home, "Zotero"),
      path.join(home, ".zotero", "zotero"),
    ];
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      // Direct data dir
      if (fs.existsSync(path.join(p, "zotero.sqlite"))) {
        return p;
      }
      // Profile-based structure - find first profile with zotero data
      if (fs.statSync(p).isDirectory()) {
        try {
          const entries = fs.readdirSync(p);
          for (const entry of entries) {
            const profilePath = path.join(p, entry);
            if (fs.statSync(profilePath).isDirectory()) {
              const zoteroDir = path.join(profilePath, "zotero");
              if (fs.existsSync(path.join(zoteroDir, "zotero.sqlite"))) {
                return zoteroDir;
              }
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  return undefined;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): ZoteroConfig {
  const modeStr = (process.env.ZOTERO_MODE || "web").toLowerCase();
  const mode = modeStr === "local" ? ZoteroMode.LOCAL : ZoteroMode.WEB;

  return {
    mode,

    // Web API settings
    apiKey: process.env.ZOTERO_API_KEY,
    userId: process.env.ZOTERO_USER_ID,
    groupId: process.env.ZOTERO_GROUP_ID,
    apiBaseUrl: process.env.ZOTERO_API_BASE_URL || "https://api.zotero.org",

    // Local mode settings
    dataDir: process.env.ZOTERO_DATA_DIR || detectZoteroDataDir(),

    // General settings
    defaultLimit: parseInt(process.env.ZOTERO_DEFAULT_LIMIT || "25", 10),
    maxLimit: 100,
    cacheEnabled: process.env.ZOTERO_CACHE_ENABLED !== "false",
    cacheTtl: parseInt(process.env.ZOTERO_CACHE_TTL || "300", 10),

    // Full-text settings
    extractPdfText: process.env.ZOTERO_EXTRACT_PDF !== "false",
    maxFulltextLength: parseInt(
      process.env.ZOTERO_MAX_FULLTEXT_LENGTH || "100000",
      10
    ),
  };
}

/**
 * Validate configuration and return list of errors.
 */
export function validateConfig(config: ZoteroConfig): string[] {
  const errors: string[] = [];

  if (config.mode === ZoteroMode.WEB) {
    if (!config.apiKey) {
      errors.push("ZOTERO_API_KEY is required for web mode");
    }
    if (!config.userId && !config.groupId) {
      errors.push("ZOTERO_USER_ID or ZOTERO_GROUP_ID is required for web mode");
    }
  } else if (config.mode === ZoteroMode.LOCAL) {
    if (!config.dataDir) {
      errors.push(
        "Could not detect Zotero data directory. Set ZOTERO_DATA_DIR"
      );
    } else if (!fs.existsSync(config.dataDir)) {
      errors.push(`Zotero data directory does not exist: ${config.dataDir}`);
    } else if (!fs.existsSync(path.join(config.dataDir, "zotero.sqlite"))) {
      errors.push(`zotero.sqlite not found in: ${config.dataDir}`);
    }
  }

  return errors;
}

/**
 * Get the API library prefix (users/X or groups/X).
 */
export function getLibraryPrefix(config: ZoteroConfig): string {
  if (config.groupId) {
    return `groups/${config.groupId}`;
  }
  return `users/${config.userId}`;
}

/**
 * Get path to zotero.sqlite file.
 */
export function getSqlitePath(config: ZoteroConfig): string | undefined {
  if (config.dataDir) {
    return path.join(config.dataDir, "zotero.sqlite");
  }
  return undefined;
}

/**
 * Get path to storage directory containing attachments.
 */
export function getStoragePath(config: ZoteroConfig): string | undefined {
  if (config.dataDir) {
    return path.join(config.dataDir, "storage");
  }
  return undefined;
}

// Global config instance
let globalConfig: ZoteroConfig | null = null;

export function getConfig(): ZoteroConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

export function setConfig(config: ZoteroConfig): void {
  globalConfig = config;
}

export function switchMode(mode: ZoteroMode): ZoteroConfig {
  const config = getConfig();
  config.mode = mode;
  return config;
}
