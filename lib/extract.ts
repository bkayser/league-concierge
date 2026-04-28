import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

const CONTENT_SELECTORS = ["main", "article", '[role="main"]'];
const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
];

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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || url;

  $(STRIP_SELECTORS.join(",")).remove();

  for (const selector of CONTENT_SELECTORS) {
    const text = normalizeWhitespace($(selector).text());
    if (text.length >= 100) {
      return { text, title };
    }
  }

  const bodyText = normalizeWhitespace($("body").text());
  if (!bodyText) {
    throw new Error("Could not extract readable content from the page.");
  }
  return { text: bodyText, title };
}
