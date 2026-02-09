/**
 * PDF text extraction utility.
 * 
 * Note: PDF extraction is optional. Zotero already indexes full-text content
 * in its database, which is the preferred source. This module provides
 * fallback extraction for cases where the database doesn't have the text.
 */

import * as fs from "fs";

/**
 * Extract text content from a PDF file.
 * Returns null if extraction fails or pdf-parse is not available.
 */
export async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Try to dynamically import and use pdf-parse
    // This uses the pdf-parse v2 API with PDFParse class
    const module = await import("pdf-parse");
    const PDFParse = module.PDFParse;
    
    if (typeof PDFParse !== "function") {
      console.error("pdf-parse PDFParse not found");
      return null;
    }
    
    const buffer = fs.readFileSync(filePath);
    const parser = new (PDFParse as any)({});
    
    // Use loadBuffer for Buffer input
    if (typeof parser.loadBuffer === "function") {
      await parser.loadBuffer(buffer);
    } else if (typeof parser.load === "function") {
      await parser.load(buffer);
    } else {
      // Try calling it directly with buffer
      await parser(buffer);
    }
    
    let text = "";
    if (typeof parser.getText === "function") {
      const result = await parser.getText();
      text = typeof result === "string" ? result : String(result);
    } else if (parser.text) {
      text = String(parser.text);
    }
    
    if (typeof parser.destroy === "function") {
      parser.destroy();
    }
    
    return text || null;
  } catch (error) {
    // PDF extraction is best-effort - don't fail if it doesn't work
    console.error(`PDF extraction failed for ${filePath}:`, error);
    return null;
  }
}

/**
 * Extract text from HTML content.
 */
export function extractHtmlText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
