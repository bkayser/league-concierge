"use client";

import {
  ArrowClockwise,
  CaretDown,
  CheckCircle,
  ThumbsDown,
  ThumbsUp,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatMarkdown, SourceChip } from "../ChatParts";
import AdminLogin, { type AdminUser } from "./AdminLogin";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB (Vercel serverless body limit headroom)
const MAX_URLS_PER_BATCH = 10;

interface BatchUrlStatus {
  url: string;
  state: "pending" | "adding" | "added" | "failed";
  pageTitle?: string;
  totalChunks?: number;
  error?: string;
}

interface AuditEntry {
  id: string;
  action: "added" | "updated" | "removed";
  filename: string;
  source_name: string;
  url: string | null;
  admin_email: string;
  admin_name: string;
  created_at: string;
}

const AUDIT_ACTION_STYLES: Record<AuditEntry["action"], string> = {
  added: "bg-green-50 text-green-700",
  updated: "bg-blue-50 text-blue-700",
  removed: "bg-red-50 text-red-700",
};

interface DocumentMeta {
  filename: string;
  originalFilename: string;
  uploadDate: string;
  fileSizeDisplay?: string;
  fileSizeBytes?: number;
  totalChunks: number;
  mimeType?: string;
  sourceType?: "file" | "url";
  url?: string;
  pageTitle?: string;
  useCount?: number;
}

interface InteractionRow {
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
  sources_display: string;
  sources: string[];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatLatency(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

type SortColumn = "source" | "added" | "chunks";
type SortDirection = "asc" | "desc";

function sourceSortLabel(doc: DocumentMeta): string {
  return doc.sourceType === "url"
    ? (doc.pageTitle ?? doc.originalFilename)
    : doc.originalFilename;
}

function addedSortTime(doc: DocumentMeta): number {
  const t = Date.parse(doc.uploadDate);
  return Number.isFinite(t) ? t : 0;
}


export default function AdminPage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  // Signed in, but first name / last name / phone not yet collected.
  const [pendingProfileUser, setPendingProfileUser] = useState<AdminUser | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlsOpen, setUrlsOpen] = useState(false);
  const [batchStatuses, setBatchStatuses] = useState<BatchUrlStatus[]>([]);

  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [refreshingFilename, setRefreshingFilename] = useState<string | null>(
    null,
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [sortColumn, setSortColumn] = useState<SortColumn>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<"documents" | "log" | "audit">(
    "documents",
  );
  const [logFilter, setLogFilter] = useState<"all" | "rated" | "unrated">("all");
  const [logRows, setLogRows] = useState<InteractionRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [previewRow, setPreviewRow] = useState<InteractionRow | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [logDeleteError, setLogDeleteError] = useState<string | null>(null);

  const [auditRows, setAuditRows] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const sortedDocuments = useMemo(() => {
    const list = [...documents];
    const dir = sortDirection;
    const mult = dir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      switch (sortColumn) {
        case "source":
          return (
            mult *
            sourceSortLabel(a).localeCompare(sourceSortLabel(b), undefined, {
              sensitivity: "base",
            })
          );
        case "added":
          return mult * (addedSortTime(a) - addedSortTime(b));
        case "chunks":
          return mult * ((a.totalChunks ?? 0) - (b.totalChunks ?? 0));
        default:
          return 0;
      }
    });
    return list;
  }, [documents, sortColumn, sortDirection]);

  function handleSortHeader(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "added" ? "desc" : "asc");
    }
  }

  // Admin API calls authenticate with the httpOnly session cookie, which
  // same-origin fetch sends automatically.
  const fetchDocuments = useCallback(async () => {
    const res = await fetch("/api/admin/documents");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { documents: DocumentMeta[] };
    setDocuments(data.documents ?? []);
  }, []);

  // Probe /api/admin/log once on login to detect whether logging is enabled.
  // Reuses the same response to load initial log rows — avoids a second request.
  const probeAndLoadLog = useCallback(async () => {
    const res = await fetch("/api/admin/log?filter=all");
    setLoggingEnabled(res.ok);
    if (res.ok) {
      const data = (await res.json()) as { interactions: InteractionRow[] };
      setLogRows(data.interactions ?? []);
    }
  }, []);

  const handleAuthenticated = useCallback(
    (authedUser: AdminUser) => {
      setPendingProfileUser(null);
      setUser(authedUser);
      void fetchDocuments().catch(() => {});
      void probeAndLoadLog();
    },
    [fetchDocuments, probeAndLoadLog],
  );

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const res = await fetch("/api/admin/me");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          user: AdminUser;
          profileComplete: boolean;
        };
        if (cancelled) return;
        if (data.profileComplete) {
          handleAuthenticated(data.user);
        } else {
          setPendingProfileUser(data.user);
        }
      } catch {
        // fall through to the sign-in form
      } finally {
        if (!cancelled) setRestoringSession(false);
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [handleAuthenticated]);

  useEffect(() => {
    if (!previewRow) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewRow(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewRow]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    setUploadMessage(null);
    setUploadError(null);
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && file.size > MAX_FILE_BYTES) {
      setFileError(
        "This file is too large to upload (max 4 MB). Please reduce the file size or split the document and try again.",
      );
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || fileError) return;
    setUploadError(null);
    setUploadMessage(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        originalFilename?: string;
        totalChunks?: number;
        error?: string;
      };
      if (!res.ok) {
        setUploadError(data.error ?? `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setUploadMessage(
        `"${data.originalFilename ?? selectedFile.name}" uploaded successfully (${data.totalChunks ?? "?"} chunks).`,
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchDocuments();
    } catch {
      setUploadError(
        "Upload failed. Please check your connection and try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  function parseUrlList(raw: string): string[] {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function validateUrl(value: string): string | null {
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      return "URL must start with http:// or https://";
    }
    try {
      new URL(value);
    } catch {
      return "Invalid URL format.";
    }
    return null;
  }

  async function ingestSingleUrl(url: string): Promise<{
    ok: boolean;
    pageTitle?: string;
    totalChunks?: number;
    filename?: string;
    url?: string;
    error?: string;
  }> {
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        filename?: string;
        url?: string;
        pageTitle?: string;
        totalChunks?: number;
        error?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          error: data.error ?? `Failed (HTTP ${res.status}).`,
        };
      }

      // Optimistically prepend the new source so the list updates immediately,
      // before Pinecone propagates the upsert to listPaginated().
      return {
        ok: true,
        pageTitle: data.pageTitle,
        totalChunks: data.totalChunks,
        filename: data.filename,
        url: data.url,
      };
    } catch {
      return {
        ok: false,
        error: "Network error. Please check your connection.",
      };
    }
  }

  async function handleAddUrls(e: React.FormEvent) {
    e.preventDefault();
    setUrlError(null);

    const urls = parseUrlList(urlInput);
    if (urls.length === 0) {
      setUrlError("Please enter at least one URL.");
      return;
    }
    if (urls.length > MAX_URLS_PER_BATCH) {
      setUrlError(
        `Please enter no more than ${MAX_URLS_PER_BATCH} URLs (one per line).`,
      );
      return;
    }
    for (const url of urls) {
      const err = validateUrl(url);
      if (err) {
        setUrlError(`"${url}": ${err}`);
        return;
      }
    }

    const initialStatuses: BatchUrlStatus[] = urls.map((url) => ({
      url,
      state: "pending",
    }));
    setBatchStatuses(initialStatuses);
    setAddingUrl(true);

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setBatchStatuses((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, state: "adding" } : s)),
        );
        const result = await ingestSingleUrl(url);
        setBatchStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  state: result.ok ? "added" : "failed",
                  pageTitle: result.pageTitle,
                  totalChunks: result.totalChunks,
                  error: result.error,
                }
              : s,
          ),
        );
        if (result.ok && result.filename) {
          const optimistic: DocumentMeta = {
            filename: result.filename,
            originalFilename: result.pageTitle ?? url,
            sourceType: "url",
            url: result.url,
            pageTitle: result.pageTitle,
            uploadDate: new Date().toISOString(),
            totalChunks: result.totalChunks ?? 0,
          };
          setDocuments((prev) => [
            optimistic,
            ...prev.filter((d) => d.filename !== result.filename),
          ]);
        }
      }
      await fetchDocuments();
      const allOk = initialStatuses.length > 0;
      if (allOk) {
        // Clear the textarea only if every URL succeeded so failed ones can be edited and retried
        setBatchStatuses((current) => {
          if (current.every((s) => s.state === "added")) {
            setUrlInput("");
          }
          return current;
        });
      }
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleDelete(doc: DocumentMeta) {
    const label =
      doc.sourceType === "url"
        ? (doc.pageTitle ?? doc.url ?? doc.originalFilename)
        : doc.originalFilename;
    const confirmed = window.confirm(
      `Delete "${label}"? This will remove it from the chatbot's knowledge.`,
    );
    if (!confirmed) return;
    setDeleteError(null);
    setDeletingFilename(doc.filename);
    try {
      const res = await fetch(
        `/api/admin/documents/${encodeURIComponent(doc.filename)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setDeleteError(data.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      await fetchDocuments();
    } catch {
      setDeleteError(
        "Delete failed. Please check your connection and try again.",
      );
    } finally {
      setDeletingFilename(null);
    }
  }

  async function handleRefresh(doc: DocumentMeta) {
    setRefreshError(null);
    setRefreshingFilename(doc.filename);
    try {
      const res = await fetch(
        `/api/admin/documents/${encodeURIComponent(doc.filename)}/refresh`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setRefreshError(data.error ?? `Refresh failed (HTTP ${res.status}).`);
        return;
      }
      await fetchDocuments();
    } catch {
      setRefreshError(
        "Refresh failed. Please check your connection and try again.",
      );
    } finally {
      setRefreshingFilename(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setPendingProfileUser(null);
    setDocuments([]);
    setAuditRows([]);
    setAuditError(null);
    setUploadMessage(null);
    setUploadError(null);
    setDeleteError(null);
    setRefreshError(null);
    setSelectedFile(null);
    setFileError(null);
    setUrlInput("");
    setUrlError(null);
    setUrlsOpen(false);
    setBatchStatuses([]);
    setLoggingEnabled(false);
    setActiveTab("documents");
    setLogRows([]);
    setLogFilter("all");
    setPreviewRow(null);
    setLogDeleteError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFilterChange(filter: "all" | "rated" | "unrated") {
    setLogFilter(filter);
    setLogLoading(true);
    try {
      const res = await fetch(`/api/admin/log?filter=${filter}`);
      if (res.ok) {
        const data = (await res.json()) as { interactions: InteractionRow[] };
        setLogRows(data.interactions ?? []);
      }
    } catch {
      // silently fail — log view shows stale data
    } finally {
      setLogLoading(false);
    }
  }

  async function handleDeleteInteraction(row: InteractionRow) {
    const preview =
      row.prompt.length > 80 ? row.prompt.slice(0, 80) + "…" : row.prompt;
    const confirmed = window.confirm(
      `Permanently delete this question and answer?\n\n"${preview}"`,
    );
    if (!confirmed) return;
    setLogDeleteError(null);
    setDeletingLogId(row.id);
    try {
      const res = await fetch(`/api/admin/log/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setLogDeleteError(data.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      setLogRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      setLogDeleteError(
        "Delete failed. Please check your connection and try again.",
      );
    } finally {
      setDeletingLogId(null);
    }
  }

  async function downloadCsv() {
    const res = await fetch("/api/admin/log?download=true");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oysa-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadAudit() {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetch("/api/admin/audit");
      if (!res.ok) {
        setAuditError(`Failed to load audit log (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAuditRows(data.entries ?? []);
    } catch {
      setAuditError("Failed to load audit log. Please check your connection.");
    } finally {
      setAuditLoading(false);
    }
  }

  async function downloadAuditCsv() {
    const res = await fetch("/api/admin/audit?download=true");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oysa-source-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (restoringSession) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <p className="text-sm text-gray-400">Restoring session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <AdminLogin
        pendingProfileUser={pendingProfileUser}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          OYSA Document Admin
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500" title={user.email}>
            {user.first_name} {user.last_name}
          </span>
          <button
            onClick={() => void handleLogout()}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab strip — Query Log only when interaction logging is active */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 flex">
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "documents"
                ? "border-green-700 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Documents
          </button>
          {loggingEnabled && (
            <button
              type="button"
              onClick={() => {
                setActiveTab("log");
                if (logRows.length === 0 && !logLoading)
                  void handleFilterChange(logFilter);
              }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "log"
                  ? "border-green-700 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              Query Log
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActiveTab("audit");
              if (!auditLoading) void loadAudit();
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "audit"
                ? "border-green-700 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Audit
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* ── Documents tab ───────────────────────────────────────────────── */}
        {activeTab === "documents" && (
        <>
        {/* Upload document section */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Upload Document
          </h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-green-700 hover:file:bg-green-100 cursor-pointer"
              />
              <p className="mt-1 text-xs text-gray-400">
                Accepted formats: PDF, DOCX &middot; Max size: 4 MB
              </p>
            </div>

            {fileError && <p className="text-sm text-red-600">{fileError}</p>}
            {uploadError && (
              <p className="text-sm text-red-600">{uploadError}</p>
            )}
            {uploadMessage && (
              <p className="text-sm text-green-700">{uploadMessage}</p>
            )}

            <button
              type="submit"
              disabled={!selectedFile || !!fileError || uploading}
              className="rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </form>
        </section>

        {/* Add web pages section (disclosure) */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setUrlsOpen((open) => !open)}
            aria-expanded={urlsOpen}
            aria-controls="add-web-pages-panel"
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
          >
            <span>
              <h2 className="text-base font-semibold text-gray-900">
                Add Web Pages
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Paste up to {MAX_URLS_PER_BATCH} public URLs (one per line) to
                index their text content.
              </p>
            </span>
            <CaretDown
              size={18}
              weight="bold"
              className={`text-gray-400 transition-transform ${
                urlsOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {urlsOpen && (
            <div
              id="add-web-pages-panel"
              className="border-t border-gray-100 p-6"
            >
              <form onSubmit={handleAddUrls} className="space-y-3">
                <textarea
                  value={urlInput}
                  onChange={(e) => {
                    const limited = e.target.value
                      .split(/\r?\n/)
                      .slice(0, MAX_URLS_PER_BATCH)
                      .join("\n");
                    setUrlInput(limited);
                    setUrlError(null);
                  }}
                  rows={MAX_URLS_PER_BATCH}
                  placeholder={
                    "https://example.com/page-1\nhttps://example.com/page-2"
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600"
                />
                <p className="text-xs text-gray-400">
                  Up to {MAX_URLS_PER_BATCH} URLs, one per line. Each is
                  fetched, parsed, and indexed in sequence.
                </p>

                {urlError && (
                  <p className="text-sm text-red-600">{urlError}</p>
                )}

                {batchStatuses.length > 0 && (
                  <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                    {batchStatuses.map((status, idx) => (
                      <li
                        key={`${idx}-${status.url}`}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <span className="shrink-0">
                          {status.state === "pending" && (
                            <span className="block w-4 h-4 rounded-full border border-gray-300" />
                          )}
                          {status.state === "adding" && (
                            <ArrowClockwise
                              size={16}
                              weight="bold"
                              className="text-blue-500 animate-spin"
                            />
                          )}
                          {status.state === "added" && (
                            <CheckCircle
                              size={16}
                              weight="fill"
                              className="text-green-600"
                            />
                          )}
                          {status.state === "failed" && (
                            <WarningCircle
                              size={16}
                              weight="fill"
                              className="text-red-600"
                            />
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-gray-700">
                            {status.pageTitle ?? status.url}
                          </span>
                          {status.pageTitle && (
                            <span className="block truncate text-xs text-gray-400">
                              {status.url}
                            </span>
                          )}
                          {status.state === "failed" && status.error && (
                            <span className="block text-xs text-red-600 mt-0.5">
                              {status.error}
                            </span>
                          )}
                          {status.state === "added" &&
                            typeof status.totalChunks === "number" && (
                              <span className="block text-xs text-gray-400">
                                {status.totalChunks} chunks
                              </span>
                            )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!urlInput.trim() || addingUrl}
                    className="rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {addingUrl
                      ? `Adding ${batchStatuses.filter((s) => s.state === "added" || s.state === "failed").length + 1} of ${batchStatuses.length}…`
                      : "Add URLs"}
                  </button>
                  {!addingUrl && batchStatuses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchStatuses([])}
                      className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
                    >
                      Clear results
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </section>

        {/* Sources section */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Sources</h2>
            <span className="text-sm text-gray-400">
              {documents.length} total
            </span>
          </div>

          {deleteError && (
            <div className="px-6 py-3 bg-red-50 border-b border-red-100">
              <p className="text-sm text-red-600">{deleteError}</p>
            </div>
          )}

          {refreshError && (
            <div className="px-6 py-3 bg-red-50 border-b border-red-100">
              <p className="text-sm text-red-600">{refreshError}</p>
            </div>
          )}

          {documents.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-400">No sources added yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th
                      className="px-6 py-3 font-medium"
                      aria-sort={
                        sortColumn === "source"
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSortHeader("source")}
                        className="inline-flex items-center gap-1 text-left font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 rounded"
                      >
                        Source
                        {sortColumn === "source" && (
                          <span className="text-gray-400 normal-case">
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                    </th>
                    <th
                      className="px-6 py-3 font-medium"
                      aria-sort={
                        sortColumn === "added"
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSortHeader("added")}
                        className="inline-flex items-center gap-1 text-left font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 rounded"
                      >
                        Added
                        {sortColumn === "added" && (
                          <span className="text-gray-400 normal-case">
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                    </th>
                    <th
                      className="px-6 py-3 font-medium"
                      aria-sort={
                        sortColumn === "chunks"
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSortHeader("chunks")}
                        className="inline-flex items-center gap-1 text-left font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 rounded"
                      >
                        Size
                        {sortColumn === "chunks" && (
                          <span className="text-gray-400 normal-case">
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                    </th>
                    {loggingEnabled && (
                      <th className="px-6 py-3 font-medium">Times cited</th>
                    )}
                    <th className="px-6 py-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedDocuments.map((doc) => (
                    <tr
                      key={doc.filename}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 max-w-xs">
                        {doc.sourceType === "url" && doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={doc.pageTitle ?? doc.originalFilename}
                            className="font-medium text-green-700 hover:underline truncate block"
                          >
                            {doc.pageTitle ?? doc.originalFilename}
                          </a>
                        ) : (
                          <div
                            className="font-medium text-gray-900 truncate"
                            title={doc.originalFilename}
                          >
                            {doc.originalFilename}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {doc.uploadDate ? formatDate(doc.uploadDate) : "—"}
                      </td>
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        <div>{doc.totalChunks ?? "—"} chunks</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {doc.sourceType === "url" || !doc.fileSizeDisplay || doc.fileSizeDisplay === "unknown"
                            ? "—"
                            : doc.fileSizeDisplay}
                        </div>
                      </td>
                      {loggingEnabled && (
                        <td className="px-6 py-4 text-gray-500">
                          {doc.useCount ?? 0}
                        </td>
                      )}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {doc.sourceType === "url" && (
                            <button
                              onClick={() => handleRefresh(doc)}
                              disabled={
                                refreshingFilename === doc.filename ||
                                deletingFilename === doc.filename
                              }
                              aria-label="Refresh"
                              title="Refresh"
                              className="group p-1.5 rounded text-blue-500 hover:text-blue-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            >
                              {refreshingFilename === doc.filename ? (
                                <ArrowClockwise
                                  size={18}
                                  weight="fill"
                                  className="animate-spin"
                                />
                              ) : (
                                <>
                                  <ArrowClockwise
                                    size={18}
                                    weight="regular"
                                    className="group-hover:hidden"
                                  />
                                  <ArrowClockwise
                                    size={18}
                                    weight="fill"
                                    className="hidden group-hover:block"
                                  />
                                </>
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(doc)}
                            disabled={
                              deletingFilename === doc.filename ||
                              refreshingFilename === doc.filename
                            }
                            aria-label="Delete"
                            title="Delete"
                            className="group p-1.5 rounded text-red-500 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          >
                            {deletingFilename === doc.filename ? (
                              <Trash size={18} weight="fill" />
                            ) : (
                              <>
                                <Trash
                                  size={18}
                                  weight="regular"
                                  className="group-hover:hidden"
                                />
                                <Trash
                                  size={18}
                                  weight="fill"
                                  className="hidden group-hover:block"
                                />
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}

        {/* ── Log tab ─────────────────────────────────────────────────────── */}
        {loggingEnabled && activeTab === "log" && (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                Interaction Log
              </h2>
              <div className="flex items-center gap-3">
                {/* Filter pills */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  {(["all", "rated", "unrated"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => void handleFilterChange(f)}
                      className={`px-3 py-1.5 font-medium transition-colors ${
                        logFilter === f
                          ? "bg-green-700 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                {/* CSV download */}
                <button
                  type="button"
                  onClick={() => void downloadCsv()}
                  className="text-sm font-medium text-green-700 hover:text-green-900 transition-colors"
                >
                  Download last 30 days (CSV)
                </button>
              </div>
            </div>

            {logDeleteError && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-100">
                <p className="text-sm text-red-600">{logDeleteError}</p>
              </div>
            )}

            {logLoading ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-gray-400">Loading…</p>
              </div>
            ) : logRows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-gray-400">No interactions found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">Time</th>
                      <th className="px-4 py-3 font-medium">Prompt</th>
                      <th className="px-4 py-3 font-medium">Response</th>
                      <th className="px-4 py-3 font-medium">Rating</th>
                      <th className="px-4 py-3 font-medium">Sources</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setPreviewRow(row)}
                        className="align-top cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          <div>{formatDate(row.created_at)}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{formatLatency(row.latency_ms)}</div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteInteraction(row);
                            }}
                            disabled={deletingLogId === row.id}
                            aria-label="Delete"
                            title="Delete permanently"
                            className="group -ml-1.5 mt-1 p-1.5 rounded text-red-500 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          >
                            <Trash size={16} weight="regular" className="group-hover:hidden" />
                            <Trash size={16} weight="fill" className="hidden group-hover:block" />
                          </button>
                        </td>
                        <td className="px-4 py-3 max-w-xs text-gray-900">
                          <button
                            type="button"
                            className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 rounded"
                          >
                            {row.prompt.length > 80
                              ? row.prompt.slice(0, 80) + "…"
                              : row.prompt}
                          </button>
                        </td>
                        <td className="px-4 py-3 max-w-xs text-gray-700">
                          {row.response.length > 120
                            ? row.response.slice(0, 120) + "…"
                            : row.response}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.rating === 1 ? (
                            <ThumbsUp className="inline text-green-600" weight="fill" size={16} aria-label="Helpful" />
                          ) : row.rating === -1 ? (
                            <ThumbsDown className="inline text-red-500" weight="fill" size={16} aria-label="Not helpful" />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-xs">
                          {row.sources_display || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── Audit tab ───────────────────────────────────────────────────── */}
        {activeTab === "audit" && (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                Source Audit Log
              </h2>
              <button
                type="button"
                onClick={() => void downloadAuditCsv()}
                className="text-sm font-medium text-green-700 hover:text-green-900 transition-colors"
              >
                Download all (CSV)
              </button>
            </div>

            {auditError && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-100">
                <p className="text-sm text-red-600">{auditError}</p>
              </div>
            )}

            {auditLoading ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-gray-400">Loading…</p>
              </div>
            ) : auditRows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-gray-400">No source changes recorded yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">Time</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Source</th>
                      <th className="px-4 py-3 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditRows.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${AUDIT_ACTION_STYLES[row.action]}`}
                          >
                            {row.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={row.url}
                              className="text-green-700 hover:underline truncate block"
                            >
                              {row.source_name}
                            </a>
                          ) : (
                            <div className="text-gray-900 truncate" title={row.filename}>
                              {row.source_name}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>{row.admin_name}</div>
                          <div className="text-xs text-gray-400">{row.admin_email}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

      </div>

      {/* Log preview: the exchange as the user saw it */}
      {previewRow && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setPreviewRow(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Conversation preview"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-gray-50 shadow-xl px-4 pt-10 pb-6"
          >
            <button
              type="button"
              onClick={() => setPreviewRow(null)}
              aria-label="Close"
              className="absolute top-3 right-3 p-1 rounded text-gray-400 hover:text-gray-700 transition-colors"
            >
              <X size={18} />
            </button>
            <div className="space-y-4">
              <div className="flex flex-col items-end">
                <div className="px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed bg-green-700 text-white rounded-br-sm whitespace-pre-wrap">
                  {previewRow.prompt}
                </div>
              </div>
              <div className="flex flex-col items-start">
                <div className="px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed bg-white text-gray-900 border border-gray-200 shadow-xs rounded-bl-sm">
                  <ChatMarkdown>{previewRow.response}</ChatMarkdown>
                </div>
                {previewRow.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[85%]">
                    {previewRow.sources.map((src) => (
                      <SourceChip key={src} label={src} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
