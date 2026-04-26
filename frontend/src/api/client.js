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
 * Scan code and build dependency graph (cost: $0).
 * Calls POST /api/v1/ask/scan
 *
 * @param {string} code       - Source code string
 * @param {string} sessionId  - Session identifier
 * @param {string} language   - Language hint
 * @returns {Promise<ScanResponse>}
 */
export async function scanCode(code, sessionId = 'default', language = 'auto') {
  const response = await fetch(`${BASE_URL}/ask/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'scan',
      session_id: sessionId,
      code,
      language,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Scan failed');
  }

  return response.json();
}

/**
 * Ask a question about the code — graph-first, AI-last.
 * Calls POST /api/v1/ask/
 *
 * @param {string} question   - The question to ask
 * @param {string} sessionId  - Session identifier
 * @param {string} code       - Optional code for context
 * @param {string} language   - Language hint
 * @returns {Promise<AskResponse>}
 */
export async function askQuestion(question, sessionId = 'default', code = '', language = 'auto') {
  const response = await fetch(`${BASE_URL}/ask/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      session_id: sessionId,
      code,
      language,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Ask failed');
  }

  return response.json();
}

/**
 * Get the dependency graph for a session.
 * Calls GET /api/v1/ask/graph/{sessionId}
 *
 * @param {string} sessionId
 * @returns {Promise<GraphResponse>}
 */
export async function getGraph(sessionId = 'default') {
  const response = await fetch(`${BASE_URL}/ask/graph/${sessionId}`);

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Graph fetch failed');
  }

  return response.json();
}

/**
 * Get the global accumulated dependency graph.
 * Calls GET /api/v1/analyze/global_graph
 */
export async function getGlobalGraph() {
  const response = await fetch(`${BASE_URL}/analyze/global_graph`);

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new APIError(response.status, err.detail || 'Global graph fetch failed');
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
 * @property {number}         dependency_graph_edges
 * @property {string[]}       high_impact_symbols
 */

/**
 * @typedef {Object} AskResponse
 * @property {string}  question
 * @property {string}  category       - "impact" | "structural" | "semantic"
 * @property {string}  answered_by    - "graph" ($0) | "ai" (cost)
 * @property {string}  answer
 * @property {Object}  details
 * @property {boolean} graph_context_used
 * @property {number}  ai_cost_estimated
 * @property {number}  processing_time_ms
 */

