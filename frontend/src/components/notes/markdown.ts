import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import type { NoteMeta } from '../../utils/api';
import { resolveLink, slugify } from './noteLinks';

/*
 * Obsidian-ға ұқсас Markdown: GFM + [[wikilink]], ![[ендіру]], #тег, ==белгілеу==,
 * > [!note] callout, басуға болатын тапсырма белгілері.
 * Нәтиже әрқашан DOMPurify арқылы тазаланады.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WIKILINK = /^(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/;
const TAG = /^#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/u;
const TAG_START = /(^|[\s(])#[\p{L}\p{N}_]/u;

interface WikiToken extends Tokens.Generic {
  embed: boolean;
  target: string;
  heading?: string;
  alias?: string;
}

const CALLOUT_ICONS: Record<string, string> = {
  note: '✎', info: 'ℹ', tip: '💡', todo: '☑', success: '✓', question: '?', warning: '⚠',
  danger: '⚡', bug: '🐞', example: '▤', quote: '❝', abstract: '≡',
};

function createRenderer(notes: NoteMeta[]): Marked {
  const headingSlugs = new Map<string, number>();
  const marked = new Marked({ gfm: true, breaks: true });

  marked.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start: (src: string) => {
          const i = src.indexOf('[[');
          return i > 0 && src[i - 1] === '!' ? i - 1 : i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = WIKILINK.exec(src);
          if (!m) return undefined;
          return {
            type: 'wikilink',
            raw: m[0],
            embed: m[1] === '!',
            target: m[2].trim(),
            heading: m[3]?.slice(1).trim() || undefined,
            alias: m[4]?.slice(1).trim() || undefined,
          } as WikiToken;
        },
        renderer(token) {
          const t = token as WikiToken;
          const note = resolveLink(t.target, notes);
          const label = t.alias || (t.heading ? `${t.target} › ${t.heading}` : t.target);
          const attrs = [
            `class="nt-wikilink${note ? '' : ' nt-wikilink--missing'}${t.embed ? ' nt-wikilink--embed' : ''}"`,
            `data-target="${escapeHtml(t.target)}"`,
            note ? `data-note-id="${escapeHtml(note.id)}"` : '',
            t.heading ? `data-heading="${escapeHtml(slugify(t.heading))}"` : '',
            `href="#"`,
          ].filter(Boolean);
          return `<a ${attrs.join(' ')}>${t.embed ? '⧉ ' : ''}${escapeHtml(label)}</a>`;
        },
      },
      {
        name: 'tag',
        level: 'inline',
        start: (src: string) => {
          const m = TAG_START.exec(src);
          return m ? m.index + m[1].length : undefined;
        },
        tokenizer(src: string, tokens) {
          const prev = tokens[tokens.length - 1];
          // «C#» сияқты сөз ішіндегі # — тег емес
          if (prev && prev.type === 'text' && /[\p{L}\p{N}]$/u.test(prev.raw)) return undefined;
          const m = TAG.exec(src);
          if (!m) return undefined;
          return { type: 'tag', raw: m[0], tag: m[1] };
        },
        renderer(token) {
          const tag = escapeHtml(String(token.tag).toLowerCase());
          return `<a class="nt-tag" href="#" data-tag="${tag}">#${escapeHtml(String(token.tag))}</a>`;
        },
      },
      {
        name: 'highlight',
        level: 'inline',
        start: (src: string) => {
          const i = src.indexOf('==');
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
          if (!m) return undefined;
          return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
        },
      },
    ],
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = tokens.map((t) => ('text' in t ? String(t.text) : t.raw)).join('');
        const base = slugify(plain);
        const count = headingSlugs.get(base) ?? 0;
        headingSlugs.set(base, count + 1);
        const id = count ? `${base}-${count}` : base;
        return `<h${depth} id="nt-h-${escapeHtml(id)}">${text}</h${depth}>\n`;
      },
      checkbox({ checked }) {
        return `<input type="checkbox" class="nt-task"${checked ? ' checked' : ''}> `;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : `https://${href}`;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a class="nt-external" href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  });
  return marked;
}

/** > [!type] Тақырып  →  callout блогы */
function applyCallouts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>\s*|\n)?/g,
    (_, type: string, _fold: string, title: string) => {
      const kind = type.toLowerCase();
      const icon = CALLOUT_ICONS[kind] ?? CALLOUT_ICONS.note;
      const heading = title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
      return `<blockquote class="nt-callout nt-callout--${escapeHtml(kind)}"><div class="nt-callout__title"><span>${icon}</span> ${heading}</div><p>`;
    }
  );
}

export function renderMarkdown(content: string, notes: NoteMeta[]): string {
  const html = createRenderer(notes).parse(content, { async: false }) as string;
  return DOMPurify.sanitize(applyCallouts(html), {
    ADD_ATTR: ['target', 'data-target', 'data-note-id', 'data-heading', 'data-tag'],
  });
}
