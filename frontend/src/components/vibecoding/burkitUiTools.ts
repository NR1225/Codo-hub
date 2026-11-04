import type { Dispatch } from 'react';
import type { BlockAction, UiOp } from './burkitBlocks';
import { cleanPath } from './burkitBlocks';
import {
  emitVibe, getPreview, getRunState, sleep, waitForPreview, type RunState,
} from '../../utils/vibeControl';
import { subscribeTerminalOutput } from '../../utils/vibeActivity';
import { requestReveal } from '../../utils/vibeBridge';

/* Codo-ның Vibecoding бетін басқаратын құралдары (```ui …``` блоктары):
   іске қосу/тоқтату, көріністі қайта жүктеу, консольді оқу, бетте JS орындау, DOM құрылымы,
   панельдерді ашу/жабу, файлды ашу, экран өлшемі, басқа HTML бетке өту, беттің жалпы күйі.
   Әр әрекеттің нәтижесі Codo-ға «[Құрал нәтижесі]» болып қайтады. */

type UiAction = Extract<BlockAction, { kind: 'ui' }>;

/** Ask режимінде де орындалатын (ештеңені өзгертпейтін) әрекеттер */
export const UI_READONLY_OPS = new Set<UiOp>(['console', 'dom', 'state']);
/** Қолданушы «Авто» қоспаса — растау керек (беттің ішінде код орындайды) */
export const UI_CONFIRM_OPS = new Set<UiOp>(['eval']);

export interface UiHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: Dispatch<any>;
  getLayout: () => { left: boolean; right: boolean; bottom: boolean };
  getProject: () => { id: string; files: { path: string }[] } | null;
  getActiveFile: () => string | null;
  previewOpen: () => boolean;
}

const RUN_WAIT_MS = 150_000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const SETTLE_MS = 1500;

const PANEL_NAMES: Record<string, 'left' | 'right' | 'bottom' | 'preview'> = {
  explorer: 'left', files: 'left', left: 'left', sidebar: 'left', git: 'left',
  terminal: 'bottom', bottom: 'bottom',
  ai: 'right', codo: 'right', chat: 'right', right: 'right',
  preview: 'preview', view: 'preview', browser: 'preview',
};

const PANEL_LABEL = { left: 'Эксплорер', right: 'Codo панелі', bottom: 'Терминал', preview: 'Көрініс' } as const;

export function describeUiAction(action: UiAction): string {
  const a = action.attrs;
  switch (action.op) {
    case 'run': return 'Жобаны іске қосу';
    case 'stop': return 'Іске қосылған жобаны тоқтату';
    case 'reload': return 'Көріністі қайта жүктеу';
    case 'console': return 'Көрініс консолін оқу';
    case 'eval': return 'Көрініс бетінде JavaScript орындау';
    case 'dom': return 'Беттің құрылымын (DOM) қарау';
    case 'panel': {
      const name = PANEL_NAMES[(a.name ?? '').toLowerCase()];
      const state = (a.state ?? 'toggle').toLowerCase();
      const verb = state === 'open' ? 'ашу' : state === 'close' ? 'жабу' : state === 'max' ? 'толық жаю' : 'ауыстыру';
      return `${name ? PANEL_LABEL[name] : 'Панель'}: ${verb}`;
    }
    case 'open': return `Файлды ашу: ${a.path ?? '?'}${a.line ? `:${a.line}` : ''}`;
    case 'device': return `Экран өлшемі: ${a.name ?? '?'}`;
    case 'page': return `Көріністе бетке өту: ${a.path ?? '?'}`;
    case 'state': return 'Беттің күйін қарау';
  }
}

function runSummary(s: RunState): string {
  const parts = [`күйі: ${s.phase}`];
  if (s.kind) parts.push(`түрі: ${s.kind === 'web' ? 'статикалық бет (браузерде)' : s.kind === 'server' ? 'dev-сервер' : 'консольдік скрипт'}`);
  if (s.framework) parts.push(`фреймворк: ${s.framework}`);
  if (s.command) parts.push(`команда: ${s.command}`);
  if (s.url) parts.push(`адрес: ${s.url}`);
  if (s.error) parts.push(`қате: ${s.error}`);
  return parts.join('; ');
}

function block(title: string, lines: string[]): string {
  return lines.length ? `${title}:\n~~~text\n${lines.join('\n')}\n~~~` : `${title}: бос.`;
}

async function previewReport(waitMs = SETTLE_MS): Promise<string> {
  const p = await waitForPreview(3000);
  if (!p) return 'Көрініс панелі ашылмады.';
  await sleep(waitMs);
  const issues = p.networkIssues();
  return [
    p.describe(),
    block('Консоль (соңғы жолдар)', p.consoleLines(60)),
    ...(issues.length ? [block('Сәтсіз желі сұраулары', issues)] : []),
  ].join('\n');
}

const DOM_SNIPPET = `(() => {
  const out = [];
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);
  const walk = (el, d) => {
    for (const c of el.children) {
      if (out.length >= 160) return;
      if (skip.has(c.tagName)) continue;
      let s = '  '.repeat(d) + '<' + c.tagName.toLowerCase();
      if (c.id) s += '#' + c.id;
      if (typeof c.className === 'string' && c.className.trim()) s += '.' + c.className.trim().split(/\\s+/).slice(0, 3).join('.');
      for (const a of ['href', 'src', 'type', 'name', 'placeholder', 'value', 'role', 'aria-label']) {
        const v = c.getAttribute && c.getAttribute(a);
        if (v) s += ' ' + a + '="' + String(v).slice(0, 60) + '"';
      }
      s += '>';
      const text = Array.from(c.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (text) s += ' ' + text.slice(0, 80);
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) s += ' [көрінбейді]';
      out.push(s);
      if (d < 7) walk(c, d + 1);
    }
  };
  if (document.body) walk(document.body, 0);
  return 'title: ' + document.title + '\\nurl: ' + location.href + '\\nviewport: ' + innerWidth + '×' + innerHeight
    + '\\nscroll: ' + Math.round(scrollY) + '/' + Math.max(0, document.documentElement.scrollHeight - innerHeight)
    + '\\n' + out.join('\\n') + (out.length >= 160 ? '\\n… (қысқартылды)' : '');
})()`;

/** Бір ui блогын орындау; қайтарғаны — Codo-ға баратын мәтін */
export async function runUiAction(action: UiAction, code: string, host: UiHost, signal: AbortSignal): Promise<string> {
  const label = describeUiAction(action);
  const a = action.attrs;
  try {
    switch (action.op) {
      case 'run': {
        const project = host.getProject();
        if (!project) return `${label}: жоба ашылмаған.`;
        let out = '';
        const unsubscribe = subscribeTerminalOutput(text => { out = (out + text).slice(-8000); });
        try {
          const t0 = Date.now();
          emitVibe('run');
          // Жоспар → терминал → сервер адресі (немесе қате) — аяқталғанша күтеміз
          await sleep(400);
          while (Date.now() - t0 < RUN_WAIT_MS && !signal.aborted) {
            const s = getRunState();
            if (s.phase !== 'planning' && s.phase !== 'starting') break;
            await sleep(300);
          }
          let s = getRunState();
          if (s.kind === 'console' && s.phase === 'running') {
            // Скрипт: аяқталғанша (немесе 20 с) терминал шығысын жинаймыз
            const t1 = Date.now();
            while (Date.now() - t1 < 20_000 && !signal.aborted && getRunState().phase === 'running') await sleep(300);
            s = getRunState();
            const clean = out.replace(ANSI_RE, '').trim();
            return `${label}: ${runSummary(s)}\n${block('Терминал шығысы', clean ? clean.split('\n').slice(-80) : [])}`
              + (s.phase === 'running' ? '\n(Скрипт әлі жұмыс істеп тұр.)' : '');
          }
          if (s.phase === 'error') {
            const clean = out.replace(ANSI_RE, '').trim();
            return `${label}: сәтсіз — ${runSummary(s)}\n${block('Терминал шығысы', clean ? clean.split('\n').slice(-60) : [])}`;
          }
          return `${label}: ${runSummary(s)}\n${await previewReport(s.kind === 'server' ? 2500 : SETTLE_MS)}`;
        } finally {
          unsubscribe();
        }
      }
      case 'stop': {
        emitVibe('stop', { keepPreview: a.keep === 'true' });
        await sleep(300);
        return `${label}: орындалды (${runSummary(getRunState())}).`;
      }
      case 'reload': {
        const p = getPreview();
        if (!p) return `${label}: көрініс ашық емес — алдымен \`\`\`ui run\`\`\` орында.`;
        p.reload();
        return `${label}: орындалды.\n${await previewReport()}`;
      }
      case 'console': {
        const p = getPreview();
        if (!p) return `${label}: көрініс ашық емес.`;
        const limit = Math.min(200, Math.max(5, Number(a.limit) || 80));
        const issues = p.networkIssues();
        if (a.clear === 'true') p.clearConsole();
        return [p.describe(), block('Консоль', p.consoleLines(limit)), ...(issues.length ? [block('Сәтсіз желі сұраулары', issues)] : [])].join('\n');
      }
      case 'eval': {
        const js = code.trim();
        if (!js) return `${label}: блокта код жоқ.`;
        const p = await waitForPreview(2000);
        if (!p) return `${label}: көрініс ашық емес — алдымен \`\`\`ui run\`\`\` орында.`;
        const mark = p.consoleMark();
        const r = await p.evaluate(js, 8000);
        await sleep(300);
        const after = p.consoleSince(mark).filter(l => !l.startsWith('> ') && !l.startsWith('< '));
        return `${label}: ${r.ok ? 'нәтиже' : 'қате'}:\n~~~text\n${r.text.slice(0, 6000)}\n~~~`
          + (after.length ? `\n${block('Консольге шыққаны', after.slice(-30))}` : '');
      }
      case 'dom': {
        const p = await waitForPreview(2000);
        if (!p) return `${label}: көрініс ашық емес.`;
        const r = await p.evaluate(DOM_SNIPPET, 8000, true);
        return r.ok ? `${label}:\n~~~text\n${r.text.slice(0, 12000)}\n~~~` : `${label}: орындалмады — ${r.text}`;
      }
      case 'panel': {
        const name = PANEL_NAMES[(a.name ?? '').toLowerCase()];
        if (!name) return `${label}: белгісіз панель «${a.name ?? ''}». Болатыны: explorer, terminal, ai, preview.`;
        const state = (a.state ?? 'toggle').toLowerCase();
        const layout = host.getLayout();
        const current = name === 'preview' ? host.previewOpen() : layout[name];
        const want = state === 'open' || state === 'max' ? true : state === 'close' ? false : !current;
        if (name === 'preview') {
          if (state === 'max') emitVibe('maximizePreview', true);
          else emitVibe(want ? 'openPreview' : 'closePreview');
        } else {
          const type = name === 'left' ? 'SET_LEFT_PANEL_VISIBLE' : name === 'right' ? 'SET_RIGHT_PANEL_VISIBLE' : 'SET_BOTTOM_PANEL_VISIBLE';
          host.dispatch({ type, payload: want });
        }
        return `${label}: ${PANEL_LABEL[name]} ${want ? 'ашық' : 'жабық'}.`;
      }
      case 'open': {
        const project = host.getProject();
        const path = cleanPath(a.path);
        if (!project || !path) return `${label}: жоба немесе жол жоқ.`;
        const file = project.files.find(f => f.path === path) ?? project.files.find(f => f.path.toLowerCase() === path.toLowerCase());
        if (!file) return `${label}: мұндай файл жоқ.`;
        const line = Math.max(1, Number(a.line) || 1);
        requestReveal({ path: file.path, line, column: Math.max(1, Number(a.column) || 1) });
        host.dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId: project.id, path: file.path } });
        return `${label}: редакторда ашылды.`;
      }
      case 'device': {
        const p = await waitForPreview(1500);
        if (!p) return `${label}: көрініс ашық емес.`;
        return p.setDevice((a.name ?? '').toLowerCase())
          ? `${label}: орнатылды.`
          : `${label}: белгісіз өлшем. Болатыны: ${p.devices().join(', ')}.`;
      }
      case 'page': {
        const p = await waitForPreview(1500);
        if (!p) return `${label}: көрініс ашық емес.`;
        if (!a.path || !p.navigate(a.path)) return `${label}: бет табылмады (тек жобадағы .html беттері, dev-серверде емес).`;
        return `${label}: ашылды.\n${await previewReport()}`;
      }
      case 'state': {
        const layout = host.getLayout();
        const p = getPreview();
        return [
          `Беттің күйі: эксплорер ${layout.left ? 'ашық' : 'жабық'}, терминал ${layout.bottom ? 'ашық' : 'жабық'}, `
            + `Codo панелі ${layout.right ? 'ашық' : 'жабық'}, көрініс ${host.previewOpen() ? 'ашық' : 'жабық'}.`,
          `Редактордағы файл: ${host.getActiveFile() ?? 'жоқ'}.`,
          `Іске қосу: ${runSummary(getRunState())}.`,
          p ? p.describe() : 'Көрініс ашылмаған.',
        ].join('\n');
      }
    }
  } catch (e) {
    return `${label}: орындалмады — ${e instanceof Error ? e.message : 'қате'}`;
  }
  return `${label}: белгісіз әрекет.`;
}
