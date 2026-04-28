import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const SUPPORTED_MIME_TYPES = new Set([PDF_MIME, DOCX_MIME]);

export async function extractText(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<string> {
  if (mimeType === PDF_MIME) {
    const { text } = await extractPdfText(new Uint8Array(buffer), {
      mergePages: true,
    });
    return text;
  }

  if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    return result.value;
  }

  throw new Error(`Unsupported MIME type: "${mimeType}"`);
}

export async function extractFromUrl(
  url: string
): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OYSABot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article?.textContent?.trim()) {
    throw new Error("Could not extract readable content from the page.");
  }
  return { text: article.textContent, title: article.title || url };
}
