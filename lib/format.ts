const BYTE_UNITS = ["KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;

  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formatted = size < 10 ? size.toFixed(1) : Math.round(size).toString();
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

export function normalizeFilename(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

export function normalizeUrl(url: string): string {
  const withoutProtocol = url.replace(/^https?:\/\//, "");
  const slug = withoutProtocol
    .toLowerCase()
    .replace(/\//g, "--")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "--")
    .replace(/^--|--$/, "");
  return `url--${slug}`;
}
