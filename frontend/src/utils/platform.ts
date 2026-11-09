import { Capacitor } from '@capacitor/core';

/** Android/iOS нативті қосымшасының ішінде іске қосылғанда true */
export const isNativeApp = Capacitor.isNativePlatform();

/**
 * Сайттың жария адресі — бөлісу сілтемелері үшін.
 * Мобильді қосымшада window.location.origin = https://localhost, сондықтан
 * VITE_SITE_URL берілсе, сол қолданылады.
 */
export const siteOrigin: string =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin;
