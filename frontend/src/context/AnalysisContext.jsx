/**
 * AnalysisContext — shared state for the workspace panels.
 *
 * Provides:
 *   - analysisResult : AnalyzeResponse | null  — the latest scan result
 *   - isLoading      : boolean                  — scan in progress
 *   - error          : string | null            — last error message
 *   - runAnalysis    : (file, language?) => void — triggers file upload + analysis
 *   - clearAnalysis  : () => void               — resets state
 */
import { createContext, useCallback, useContext, useState } from 'react';
import { analyzeFile, APIError } from '../api/client';

const AnalysisContext = createContext(null);

export function AnalysisProvider({ children }) {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAnalysis = useCallback(async (file, language = 'auto') => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await analyzeFile(file, language);
      setAnalysisResult(result);
    } catch (err) {
      if (err instanceof APIError) {
        setError(`API Error ${err.status}: ${err.message}`);
      } else {
        setError('Could not reach the backend. Make sure it is running on port 8000.');
      }
      setAnalysisResult(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysisResult(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return (
    <AnalysisContext.Provider value={{ analysisResult, isLoading, error, runAnalysis, clearAnalysis }}>
      {children}
    </AnalysisContext.Provider>
  );
}

/**
 * Hook — use inside any workspace panel to access analysis state.
 * @returns {{ analysisResult, isLoading, error, runAnalysis, clearAnalysis }}
 */
export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used inside <AnalysisProvider>');
  return ctx;
}
