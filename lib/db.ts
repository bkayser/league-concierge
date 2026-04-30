import { neon } from "@neondatabase/serverless";

// ---- Feature flag -------------------------------------------------------

export function isLoggingEnabled(): boolean {
  // #region agent log
  const _url = process.env.NEON_DATABASE_URL;
  console.log("[debug-3eaca3] isLoggingEnabled", {
    defined: _url !== undefined,
    type: typeof _url,
    length: _url?.length ?? 0,
    prefix: _url?.slice(0, 12) ?? "",
    result: Boolean(_url),
  });
  fetch("http://127.0.0.1:7332/ingest/be510bfa-a905-4eae-99f2-53e3706acaea", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3eaca3" },
    body: JSON.stringify({ sessionId: "3eaca3", location: "lib/db.ts:isLoggingEnabled", message: "feature flag check", data: { defined: _url !== undefined, type: typeof _url, length: _url?.length ?? 0, prefix: _url?.slice(0, 12) ?? "", result: Boolean(_url) }, timestamp: Date.now(), hypothesisId: "A-B-C-D" }),
  }).catch(() => {});
  // #endregion
  return Boolean(process.env.NEON_DATABASE_URL);
}

// ---- Client -------------------------------------------------------------

type NeonClient = ReturnType<typeof neon>;
let _db: NeonClient | null = null;

export function getDb(): NeonClient {
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error(
      "getDb() called but NEON_DATABASE_URL is not set. Gate calls with isLoggingEnabled().",
    );
  }
  if (!_db) {
    _db = neon(process.env.NEON_DATABASE_URL);
  }
  return _db;
}

// ---- Types --------------------------------------------------------------

export interface SourceRow {
  id: string;
  filename: string;
  original_filename: string;
  upload_date: string;
  file_size_bytes: number;
  file_size_display: string;
  mime_type: string;
  total_chunks: number;
  is_active: boolean;
  use_count?: number;
}

export interface InteractionRow {
  id: string;
  session_id: string;
  prompt: string;
  response: string;
  rating: number | null;
  rating_comment: string | null;
  model_version: string;
  chunks_retrieved: number;
  latency_ms: number;
  created_at: string;
  updated_at: string | null;
  sources_display?: string;
}

// ---- Sources ------------------------------------------------------------

export async function upsertSource(params: {
  filename: string;
  originalFilename: string;
  uploadDate: string;
  fileSizeBytes: number;
  fileSizeDisplay: string;
  mimeType: string;
  totalChunks: number;
}): Promise<void> {
  const sql = getDb();
  const {
    filename,
    originalFilename,
    uploadDate,
    fileSizeBytes,
    fileSizeDisplay,
    mimeType,
    totalChunks,
  } = params;
  await sql`
    INSERT INTO sources
      (filename, original_filename, upload_date, file_size_bytes, file_size_display, mime_type, total_chunks)
    VALUES
      (${filename}, ${originalFilename}, ${uploadDate}, ${fileSizeBytes}, ${fileSizeDisplay}, ${mimeType}, ${totalChunks})
    ON CONFLICT (filename) DO UPDATE SET
      original_filename = EXCLUDED.original_filename,
      upload_date       = EXCLUDED.upload_date,
      file_size_bytes   = EXCLUDED.file_size_bytes,
      file_size_display = EXCLUDED.file_size_display,
      mime_type         = EXCLUDED.mime_type,
      total_chunks      = EXCLUDED.total_chunks,
      is_active         = true
  `;
}

export async function softDeleteSource(filename: string): Promise<void> {
  const sql = getDb();
  await sql`UPDATE sources SET is_active = false WHERE filename = ${filename}`;
}

export async function getSources(): Promise<SourceRow[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT
      s.*,
      COUNT(iss.id)::integer AS use_count
    FROM sources s
    LEFT JOIN interaction_sources iss ON iss.source_id = s.id
    WHERE s.is_active = true
    GROUP BY s.id
    ORDER BY s.original_filename
  `;
  return rows as SourceRow[];
}

export async function getSourceByFilename(
  filename: string,
): Promise<SourceRow | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT * FROM sources WHERE filename = ${filename} LIMIT 1
  `) as SourceRow[];
  return rows[0] ?? null;
}

// ---- Interactions -------------------------------------------------------

export async function logInteraction(params: {
  id: string;
  sessionId: string;
  prompt: string;
  response: string;
  sources: string[]; // originalFilename strings — resolved to UUIDs here
  modelVersion: string;
  chunksRetrieved: number;
  latencyMs: number;
}): Promise<void> {
  const sql = getDb();
  const {
    id,
    sessionId,
    prompt,
    response,
    sources,
    modelVersion,
    chunksRetrieved,
    latencyMs,
  } = params;

  await sql`
    INSERT INTO interactions
      (id, session_id, prompt, response, model_version, chunks_retrieved, latency_ms)
    VALUES
      (${id}::uuid, ${sessionId}::uuid, ${prompt}, ${response}, ${modelVersion}, ${chunksRetrieved}, ${latencyMs})
  `;

  for (const originalFilename of sources) {
    const resolved = (await sql`
      SELECT id FROM sources WHERE original_filename = ${originalFilename} LIMIT 1
    `) as { id: string }[];
    if (resolved.length === 0) {
      console.error(
        `logInteraction: could not resolve source "${originalFilename}" — skipping interaction_sources row`,
      );
      continue;
    }
    await sql`
      INSERT INTO interaction_sources (interaction_id, source_id)
      VALUES (${id}::uuid, ${resolved[0].id}::uuid)
    `;
  }
}

export async function rateInteraction(params: {
  interactionId: string;
  rating: 1 | -1;
  comment: string | null;
}): Promise<boolean> {
  const sql = getDb();
  const { interactionId, rating, comment } = params;
  const rows = (await sql`
    UPDATE interactions
    SET rating = ${rating}, rating_comment = ${comment}, updated_at = now()
    WHERE id = ${interactionId}::uuid
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

// ---- Log queries --------------------------------------------------------

// Each filter variant is written out in full because neon tagged template
// literals cannot be dynamically composed from string fragments.

export async function getLog(params: {
  filter: "all" | "rated" | "unrated";
}): Promise<InteractionRow[]> {
  const sql = getDb();
  const { filter } = params;
  let rows;

  if (filter === "rated") {
    rows = await sql`
      SELECT i.*,
        COALESCE(string_agg(
          CASE WHEN s.is_active THEN s.original_filename
               ELSE s.original_filename || ' (deleted)' END,
          ', ' ORDER BY s.original_filename), '') AS sources_display
      FROM interactions i
      LEFT JOIN interaction_sources iss ON iss.interaction_id = i.id
      LEFT JOIN sources s ON s.id = iss.source_id
      WHERE i.rating IS NOT NULL
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `;
  } else if (filter === "unrated") {
    rows = await sql`
      SELECT i.*,
        COALESCE(string_agg(
          CASE WHEN s.is_active THEN s.original_filename
               ELSE s.original_filename || ' (deleted)' END,
          ', ' ORDER BY s.original_filename), '') AS sources_display
      FROM interactions i
      LEFT JOIN interaction_sources iss ON iss.interaction_id = i.id
      LEFT JOIN sources s ON s.id = iss.source_id
      WHERE i.rating IS NULL
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `;
  } else {
    rows = await sql`
      SELECT i.*,
        COALESCE(string_agg(
          CASE WHEN s.is_active THEN s.original_filename
               ELSE s.original_filename || ' (deleted)' END,
          ', ' ORDER BY s.original_filename), '') AS sources_display
      FROM interactions i
      LEFT JOIN interaction_sources iss ON iss.interaction_id = i.id
      LEFT JOIN sources s ON s.id = iss.source_id
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `;
  }

  return rows as InteractionRow[];
}

export async function getLogCsv(): Promise<string> {
  const sql = getDb();
  const rows = (await sql`
    SELECT i.*,
      COALESCE(string_agg(
        CASE WHEN s.is_active THEN s.original_filename
             ELSE s.original_filename || ' (deleted)' END,
        ', ' ORDER BY s.original_filename), '') AS sources_display
    FROM interactions i
    LEFT JOIN interaction_sources iss ON iss.interaction_id = i.id
    LEFT JOIN sources s ON s.id = iss.source_id
    WHERE i.created_at >= now() - interval '30 days'
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `) as InteractionRow[];

  function csvField(value: unknown): string {
    if (value === null || value === undefined) return '""';
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  const header = [
    "id",
    "session_id",
    "prompt",
    "response",
    "rating",
    "rating_comment",
    "model_version",
    "chunks_retrieved",
    "latency_ms",
    "created_at",
    "updated_at",
    "sources_display",
  ].join(",");

  const lines = rows.map((row) =>
    [
      csvField(row.id),
      csvField(row.session_id),
      csvField(row.prompt),
      csvField(row.response),
      csvField(row.rating),
      csvField(row.rating_comment),
      csvField(row.model_version),
      csvField(row.chunks_retrieved),
      csvField(row.latency_ms),
      csvField(row.created_at),
      csvField(row.updated_at),
      csvField(row.sources_display),
    ].join(","),
  );

  return [header, ...lines].join("\n");
}
