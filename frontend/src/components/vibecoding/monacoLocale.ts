import { loader } from '@monaco-editor/react';
import i18n from '../../i18n/config';
import kk from './monacoNls.kk.json';

/* Monaco мәтіндерінің тілі (контекст мәзірі, іздеу терезесі, командалар палитрасы).
   Monaco хабарламаларды globalThis._VSCODE_NLS_MESSAGES[i]-дан алады, табылмаса — ағылшынша.
   - ru: Monaco-ның ресми аудармасы CDN-нен жүктеледі
   - kk: ресми аударма жоқ — өз сөздігіміз (scripts/monaco-nls), қалған жолдар ағылшынша
   Тіл Monaco бірінші рет жүктелгенде таңдалады; кейін ауыстырылса — бетті жаңарту керек. */

let configured = false;

export function configureMonacoLocale() {
  if (configured) return;
  configured = true;
  const lang = (i18n.language || 'kk').split('-')[0];
  if (lang === 'ru') {
    loader.config({ 'vs/nls': { availableLanguages: { '*': 'ru' } } });
  } else if (lang === 'kk') {
    const messages: string[] = [];
    for (const [index, text] of Object.entries(kk.messages as Record<string, string>)) {
      messages[Number(index)] = text;
    }
    (globalThis as { _VSCODE_NLS_MESSAGES?: string[] })._VSCODE_NLS_MESSAGES = messages;
  }
}
