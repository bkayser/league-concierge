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
