"use client";

import { ArrowClockwise, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB (Vercel serverless body limit headroom)
const ADMIN_SESSION_STORAGE_KEY = "admin-session";
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface AdminSessionState {
  password: string;
  authenticatedAt: number;
}

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
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlMessage, setUrlMessage] = useState<string | null>(null);

  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [refreshingFilename, setRefreshingFilename] = useState<string | null>(
    null,
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (pwd: string) => {
    const res = await fetch("/api/admin/documents", {
      headers: { "x-admin-password": pwd },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { documents: DocumentMeta[] };
    setDocuments(data.documents ?? []);
  }, []);

  const clearStoredSession = useCallback(() => {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) {
      setRestoringSession(false);
      return;
    }

    let parsed: AdminSessionState | null = null;
    try {
      parsed = JSON.parse(raw) as AdminSessionState;
    } catch {
      clearStoredSession();
      setRestoringSession(false);
      return;
    }

    if (
      !parsed?.password ||
      typeof parsed.password !== "string" ||
      typeof parsed.authenticatedAt !== "number"
    ) {
      clearStoredSession();
      setRestoringSession(false);
      return;
    }

    if (Date.now() - parsed.authenticatedAt > ADMIN_SESSION_TTL_MS) {
      clearStoredSession();
      setRestoringSession(false);
      return;
    }

    setPassword(parsed.password);
    fetchDocuments(parsed.password)
      .then(() => setAuthed(true))
      .catch(() => {
        clearStoredSession();
        setAuthed(false);
      })
      .finally(() => setRestoringSession(false));
  }, [clearStoredSession, fetchDocuments]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      await fetchDocuments(password);
      setAuthed(true);
      const session: AdminSessionState = {
        password,
        authenticatedAt: Date.now(),
      };
      localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes("401")
          ? "Incorrect password. Please try again."
          : "Could not connect to the server. Please try again.";
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }

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
        headers: { "x-admin-password": password },
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
      await fetchDocuments(password);
    } catch {
      setUploadError(
        "Upload failed. Please check your connection and try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleAddUrl(e: React.FormEvent) {
    e.preventDefault();
    setUrlError(null);
    setUrlMessage(null);

    const trimmed = urlInput.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setUrlError("Please enter a valid URL starting with https:// or http://");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setUrlError("Please enter a valid URL (e.g. https://example.com/page).");
      return;
    }

    setAddingUrl(true);
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        pageTitle?: string;
        totalChunks?: number;
        error?: string;
      };
      if (!res.ok) {
        setUrlError(data.error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      setUrlMessage(
        `"${data.pageTitle ?? trimmed}" added successfully (${data.totalChunks ?? "?"} chunks).`,
      );
      setUrlInput("");
      await fetchDocuments(password);
    } catch {
      setUrlError(
        "Failed to add URL. Please check your connection and try again.",
      );
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
          headers: { "x-admin-password": password },
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setDeleteError(data.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      await fetchDocuments(password);
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
          headers: { "x-admin-password": password },
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setRefreshError(data.error ?? `Refresh failed (HTTP ${res.status}).`);
        return;
      }
      await fetchDocuments(password);
    } catch {
      setRefreshError(
        "Refresh failed. Please check your connection and try again.",
      );
    } finally {
      setRefreshingFilename(null);
    }
  }

  function handleLogout() {
    clearStoredSession();
    setPassword("");
    setAuthed(false);
    setDocuments([]);
    setAuthError(null);
    setUploadMessage(null);
    setUploadError(null);
    setDeleteError(null);
    setRefreshError(null);
    setSelectedFile(null);
    setFileError(null);
    setUrlInput("");
    setUrlError(null);
    setUrlMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-gray-900">
              OYSA Document Admin
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Enter your admin password to continue.
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setAuthError(null);
                }}
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600"
                placeholder="Enter password"
              />
            </div>

            {authError && <p className="text-sm text-red-600">{authError}</p>}

            <button
              type="submit"
              disabled={restoringSession || authLoading || !password}
              className="w-full rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {restoringSession
                ? "Restoring session…"
                : authLoading
                  ? "Verifying…"
                  : "Unlock"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          OYSA Document Admin
        </h1>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          Lock
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
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

        {/* Add web page section */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Add Web Page
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Paste a public URL to extract and index its text content.
          </p>
          <form onSubmit={handleAddUrl} className="space-y-3">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError(null);
                setUrlMessage(null);
              }}
              placeholder="https://example.com/page"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600"
            />

            {urlError && <p className="text-sm text-red-600">{urlError}</p>}
            {urlMessage && (
              <p className="text-sm text-green-700">{urlMessage}</p>
            )}

            <button
              type="submit"
              disabled={!urlInput || addingUrl}
              className="rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addingUrl ? "Adding…" : "Add URL"}
            </button>
          </form>
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
                    <th className="px-6 py-3 font-medium">Source</th>
                    <th className="px-6 py-3 font-medium">Added</th>
                    <th className="px-6 py-3 font-medium">Size</th>
                    <th className="px-6 py-3 font-medium">Chunks</th>
                    <th className="px-6 py-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documents.map((doc) => (
                    <tr
                      key={doc.filename}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 max-w-xs">
                        <div className="font-medium text-gray-900 truncate">
                          {doc.sourceType === "url"
                            ? (doc.pageTitle ?? doc.originalFilename)
                            : doc.originalFilename}
                        </div>
                        {doc.sourceType === "url" && doc.url && (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-700 hover:underline truncate block"
                          >
                            {doc.url}
                          </a>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {doc.uploadDate ? formatDate(doc.uploadDate) : "—"}
                      </td>
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {doc.sourceType === "url"
                          ? "—"
                          : (doc.fileSizeDisplay ?? "—")}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {doc.totalChunks ?? "—"}
                      </td>
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
      </div>
    </main>
  );
}
