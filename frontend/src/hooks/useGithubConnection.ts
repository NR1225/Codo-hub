import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService, GithubStatus } from '../utils/api';

// /github/callback беті қосылым біткенін осы арна арқылы хабарлайды (бірдей origin, кез келген қойынды)
export const GITHUB_CHANNEL = 'codo-github';
const POPUP_NAME = 'codo-github';
const POPUP_FEATURES = 'popup,width=720,height=760';

interface UseGithubConnection {
  status: GithubStatus | null;
  connecting: boolean;
  /** Қосу басталмай қалса (мысалы, серверде OAuth бапталмаған) */
  error: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  refresh: () => Promise<GithubStatus | null>;
}

/** GitHub профилін қосу/ажырату. Қосу жеке терезеде өтеді; терезе бөгелсе — осы қойындыда */
export function useGithubConnection(enabled = true): UseGithubConnection {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiService.getGithubStatus();
      setStatus(next);
      return next;
    } catch (err) {
      console.warn('GitHub status failed:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const connect = useCallback(() => {
    // Терезені клик ішінде бірден ашамыз — сілтеме келгенше күтсек, браузер оны бөгеп тастайды
    cleanupRef.current?.();
    const popup = window.open('', POPUP_NAME, POPUP_FEATURES);
    const returnTo = window.location.pathname + window.location.search;
    setConnecting(true);
    setError(null);

    apiService
      .getGithubConnectUrl(!!popup, returnTo)
      .then(({ url }) => {
        if (!popup) {
          window.location.assign(url);
          return;
        }
        popup.location.href = url;

        const finish = () => {
          cleanupRef.current?.();
          refresh().finally(() => setConnecting(false));
        };
        const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(GITHUB_CHANNEL) : null;
        if (channel) channel.onmessage = finish;
        // github.com COOP-ке байланысты popup.closed сенімсіз, сондықтан қойындыға оралғанда күйді тексереміз.
        // Әлі қосылмаған болса (терезе жай жабылды) — батырма қайта белсенді болады, арна тыңдала береді
        const onFocus = () =>
          window.setTimeout(() => refresh().then((s) => (s?.connected ? finish() : setConnecting(false))), 400);
        window.addEventListener('focus', onFocus);
        cleanupRef.current = () => {
          channel?.close();
          window.removeEventListener('focus', onFocus);
          cleanupRef.current = null;
        };
      })
      .catch((err) => {
        console.error('GitHub connect failed:', err);
        popup?.close();
        setError(err instanceof Error ? err.message : String(err));
        setConnecting(false);
      });
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setStatus(await apiService.disconnectGithub());
  }, []);

  return { status, connecting, error, connect, disconnect, refresh };
}
