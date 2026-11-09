import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { isNativeApp } from '../utils/platform';

const ROOT_PATHS = new Set(['/', '/login', '/welcome']);

/**
 * Android қосымшасына арналған көпір:
 *  - жүйелік «Артқа» батырмасы — тарих бойынша артқа, түбірлік бетте қосымшадан шығу
 *  - статус-бар түсі тақырыпқа сай
 *  - splash экранын жасыру
 * Браузерде ешнәрсе істемейді.
 */
const NativeBridge: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!isNativeApp) return;
    SplashScreen.hide().catch(() => {});
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && !ROOT_PATHS.has(pathRef.current)) navigate(-1);
      else CapApp.exitApp();
    });
    return () => { handle.then((h) => h.remove()).catch(() => {}); };
  }, [navigate]);

  useEffect(() => {
    if (!isNativeApp) return;
    const apply = () => {
      const dark = document.documentElement.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        document.body.classList.contains('dark');
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
      StatusBar.setBackgroundColor({ color: dark ? '#0d1117' : '#ffffff' }).catch(() => {});
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return null;
};

export default NativeBridge;
