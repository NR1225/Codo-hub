import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/*
  Жобаны ашу жолы ағымдағы беттің ішінде құрылады:
    /profile              → /profile/view/<id>
    /profile/aibek        → /profile/aibek/view/<id>
    /codes, /codes/list   → /codes/view/<id>, /codes/list/view/<id>
    /settings/projects    → /settings/projects/view/<id>
    /chat/...             → /chat/view/<id>
    /moderation           → /moderation/view/<id>
    басқа беттер (/ т.б.) → /view/<id>
  Бұл тізім App.tsx-тегі маршруттармен бірге (VIEW_PARENT_ROUTES) сәйкес болуы керек.
*/

/** App.tsx осы үлгілердің әрқайсысына `<үлгі>/view/:id` маршрутын тіркейді */
export const VIEW_PARENT_ROUTES = [
  '/codes',
  '/codes/list',
  '/profile',
  '/profile/:username',
  '/settings/:tab',
  '/chat',
  '/moderation',
] as const;

const VIEW_SUFFIX = /\/view\/[^/]+\/?$/;

/** Ағымдағы жолдан жоба ашылатын «ата-ана» бөлігін анықтайды ('' — түбір) */
export function viewBase(pathname: string): string {
  const path = pathname.replace(VIEW_SUFFIX, '').replace(/\/+$/, '');
  const seg = path.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'codes':
      return seg[1] === 'list' ? '/codes/list' : '/codes';
    case 'profile':
      return seg[1] ? `/profile/${seg[1]}` : '/profile';
    case 'settings':
      return seg[1] ? `/settings/${seg[1]}` : '';
    case 'chat':
      return '/chat';
    case 'moderation':
      return '/moderation';
    default:
      return '';
  }
}

export function buildViewPath(id: string, pathname = '/'): string {
  return `${viewBase(pathname)}/view/${encodeURIComponent(id)}`;
}

/** Ағымдағы бетке қатысты жоба жолын қайтаратын хук */
export function useViewPath(): (id: string) => string {
  const { pathname } = useLocation();
  return useCallback((id: string) => buildViewPath(id, pathname), [pathname]);
}

/** Жоба бетінен «артқа» шыққанда баратын ата-ана жол (тікелей сілтемемен ашылғанда) */
export function viewParentPath(pathname: string): string {
  return viewBase(pathname) || '/codes';
}
