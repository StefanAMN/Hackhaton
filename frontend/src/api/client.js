/**
 * API client — thin wrapper around fetch for the Legacy Code Analyzer backend.
 *
 * Base URL: proxied to http://localhost:8000 in dev via vite.config.js
 * All endpoints are under /api/v1/analyze
 */

const BASE_URL = '/api/v1';

/**
 * Analyze a code file uploaded as a File object.
 * Calls POST /api/v1/analyze/upload (multipart/form-data)
 *
 * @param {File} file       - The source file to analyze
 * @param {string} language - Language hint: 'auto' | 'python' | 'javascript' | 'java' | 'go'
 * @returns {Promise<AnalyzeResponse>}
 */
export async function analyzeFile(file, language = 'auto') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('language', language);

  const response = await fetch(`${BASE_URL}/analyze/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Request failed');
  }

  return response.json();
}

/**
 * Analyze code provided as a raw string.
 * Calls POST /api/v1/analyze/ (JSON body)
 *
 * @param {string} code     - Source code string
 * @param {string} language - Language hint
 * @returns {Promise<AnalyzeResponse>}
 */
export async function analyzeCode(code, language = 'auto') {
  const response = await fetch(`${BASE_URL}/analyze/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Request failed');
  }

  return response.json();
}

/**
 * Health check — verify backend is reachable.
 * @returns {Promise<{status: string, version: string, llm_provider: string}>}
 */
export async function healthCheck() {
  const response = await fetch('/health');
  if (!response.ok) throw new APIError(response.status, 'Backend unreachable');
  return response.json();
}

// ── Error type ─────────────────────────────────────────────────────────────────

export class APIError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

/**
 * @typedef {Object} ChunkAnalysis
 * @property {string}   chunk_id
 * @property {string}   chunk_name
 * @property {string}   source_code
 * @property {boolean}  cached
 * @property {string}   docstring
 * @property {string[]} bugs_and_vulnerabilities
 * @property {string}   junior_summary
 */

/**
 * @typedef {Object} AnalyzeResponse
 * @property {string}         language_detected
 * @property {number}         total_chunks
 * @property {ChunkAnalysis[]} chunks
 * @property {number}         processing_time_ms
 */
