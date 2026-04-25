/**
 * AnalysisContext — shared state for the workspace panels.
 *
 * Provides:
 *   - analysisResult : AnalyzeResponse | null  — the latest scan result
 *   - scanResult     : ScanResponse | null     — dependency graph scan result ($0)
 *   - sessionId      : string                  — current session for graph queries
 *   - sourceCode     : string                  — the currently loaded source code
 *   - isLoading      : boolean                 — scan in progress
 *   - error          : string | null           — last error message
 *   - runAnalysis    : (file, language?) => void — triggers file upload + analysis
 *   - runGraphScan   : (code, language?) => void — builds dependency graph only ($0)
 *   - clearAnalysis  : () => void               — resets state
 */
import { createContext, useCallback, useContext, useState } from 'react';
import { analyzeFile, scanCode, APIError } from '../api/client';

const AnalysisContext = createContext(null);

export function AnalysisProvider({ children }) {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState('default');
  const [sourceCode, setSourceCode] = useState('');

  const runAnalysis = useCallback(async (file, language = 'auto') => {
    setIsLoading(true);
    setError(null);

    try {
      // Read the file content for graph scan
      const fileContent = await file.text();
      setSourceCode(fileContent);

      // Generate session ID from file
      const sid = `session_${Date.now().toString(36)}`;
      setSessionId(sid);

      // 1. Build dependency graph first ($0)
      try {
        const graphResult = await scanCode(fileContent, sid, language);
        setScanResult(graphResult);
      } catch (graphErr) {
        // Critical for this architecture — if graph fails, we can't do anything
        console.error('Graph scan failed:', graphErr);
        throw graphErr;
      }

      // 2. We no longer run full AI analysis on upload to save costs and avoid rate limits.
      // The AI will only be called on-demand via the Question Router (Filter -> Answer).
      setAnalysisResult(null);
    } catch (err) {
      if (err instanceof APIError) {
        setError(`API Error ${err.status}: ${err.message}`);
      } else {
        setError('Could not reach the backend for graph scan.');
      }
      setScanResult(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Quick scan — builds dependency graph only, no AI. Cost: $0.
   */
  const runGraphScan = useCallback(async (code, language = 'auto') => {
    setIsLoading(true);
    setError(null);
    setSourceCode(code);

    const sid = `session_${Date.now().toString(36)}`;
    setSessionId(sid);

    try {
      const graphResult = await scanCode(code, sid, language);
      setScanResult(graphResult);
    } catch (err) {
      if (err instanceof APIError) {
        setError(`Scan Error ${err.status}: ${err.message}`);
      } else {
        setError('Could not reach the backend for graph scan.');
      }
      setScanResult(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysisResult(null);
    setScanResult(null);
    setError(null);
    setIsLoading(false);
    setSourceCode('');
  }, []);

  return (
    <AnalysisContext.Provider value={{
      analysisResult,
      scanResult,
      sessionId,
      sourceCode,
      isLoading,
      error,
      runAnalysis,
      runGraphScan,
      clearAnalysis,
    }}>
      {children}
    </AnalysisContext.Provider>
  );
}

/**
 * Hook — use inside any workspace panel to access analysis state.
 */
export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used inside <AnalysisProvider>');
  return ctx;
}
