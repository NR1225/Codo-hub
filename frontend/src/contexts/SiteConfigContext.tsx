import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiService, SiteConfig } from '../utils/api';

interface SiteConfigContextType {
  config: SiteConfig | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const SiteConfigContext = createContext<SiteConfigContextType>({
  config: null,
  loading: true,
  error: null,
  refetch: async () => {},
});

export const useSiteConfig = () => useContext(SiteConfigContext);

export const SiteConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getConfig();
      setConfig(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load site configuration';
      setError(message);
      console.warn('SiteConfig: Failed to load config, using defaults:', message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchConfig();
    }
  }, [fetchConfig]);

  const refetch = useCallback(async () => {
    hasFetched.current = false;
    await fetchConfig();
  }, [fetchConfig]);

  return (
    <SiteConfigContext.Provider value={{ config, loading, error, refetch }}>
      {children}
    </SiteConfigContext.Provider>
  );
};

export default SiteConfigContext;