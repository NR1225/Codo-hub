import React, { useState } from 'react';

/* Хабарлама мәтінін Telegram сияқты форматтау (HTML емес — тек React элементтері, XSS қаупі жоқ):
     **қалың**   __курсив__   ~~сызылған~~   `код`   ```код блогы```   ||спойлер||   https://сілтеме
   Пернелер (MessageInput): Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+Shift+M, Ctrl+Shift+P */

export const FORMAT_MARKERS = {
  bold: '**',
  italic: '__',
  strike: '~~',
  code: '`',
  spoiler: '||',
} as const;

export type FormatKind = keyof typeof FORMAT_MARKERS;

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(~~[^~\n]+?~~)|(\|\|[^|\n]+?\|\|)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

const Spoiler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`cht-spoiler ${shown ? 'is-shown' : ''}`}
      role="button"
      tabIndex={shown ? -1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShown(true)}
    >
      {children}
    </span>
  );
};

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (m[1]) out.push(<code key={key} className="cht-fmt-code">{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (m[3]) out.push(<em key={key}>{renderInline(token.slice(2, -2), key)}</em>);
    else if (m[4]) out.push(<s key={key}>{renderInline(token.slice(2, -2), key)}</s>);
    else if (m[5]) out.push(<Spoiler key={key}>{renderInline(token.slice(2, -2), key)}</Spoiler>);
    else
      out.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer" className="cht-fmt-link" onClick={(e) => e.stopPropagation()}>
          {token}
        </a>,
      );
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

/** Форматталған мәтін: алдымен ```блоктар```, сосын жол ішіндегі белгілер */
export const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, idx) =>
        idx % 2 === 1 ? (
          <pre key={idx} className="cht-fmt-pre">
            <code>{part.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          <React.Fragment key={idx}>{renderInline(part, String(idx))}</React.Fragment>
        ),
      )}
    </>
  );
};

/** Тізім алдындағы қысқа мәтін үшін белгілерді алып тастау */
export const stripFormatting = (text: string): string =>
  text
    .replace(/```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/\|\|([^|\n]+?)\|\|/g, '▒▒▒')
    .replace(/`([^`\n]+)`/g, '$1');

/**
 * Белгіленген мәтінді белгімен орау (қайта басылса — алып тастау).
 * Жаңа мәтін мен курсордың жаңа орнын қайтарады.
 */
export const toggleFormat = (
  value: string,
  start: number,
  end: number,
  kind: FormatKind,
): { value: string; start: number; end: number } => {
  const mark = FORMAT_MARKERS[kind];
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  // Белгінің ішінде тұрса — алып тастаймыз
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return {
      value: before.slice(0, -mark.length) + selected + after.slice(mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  }
  return {
    value: before + mark + selected + mark + after,
    start: start + mark.length,
    end: end + mark.length,
  };
};

/** Пернелер тіркесі → формат түрі (Telegram Desktop сияқты) */
export const formatFromShortcut = (e: React.KeyboardEvent): FormatKind | null => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === 'b') return 'bold';
  if (!e.shiftKey && key === 'i') return 'italic';
  if (e.shiftKey && key === 'x') return 'strike';
  if (e.shiftKey && key === 'm') return 'code';
  if (e.shiftKey && key === 'p') return 'spoiler';
  return null;
};
