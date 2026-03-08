import * as fs from "fs";

// Fallback PDF extraction when Zotero's indexed text is unavailable
export async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const module = await import("pdf-parse");
    const PDFParse = module.PDFParse;
    
    if (typeof PDFParse !== "function") {
      console.error("pdf-parse PDFParse not found");
      return null;
    }
    
    const buffer = fs.readFileSync(filePath);
    const parser = new (PDFParse as any)({});

    if (typeof parser.loadBuffer === "function") {
      await parser.loadBuffer(buffer);
    } else if (typeof parser.load === "function") {
      await parser.load(buffer);
    } else {
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
    console.error(`PDF extraction failed for ${filePath}:`, error);
    return null;
  }
}

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
