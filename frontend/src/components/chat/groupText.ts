import type { TFunction } from 'i18next';
import { GroupUser, Message } from '../../utils/api';
import { stripFormatting } from './formatText';

/* Топтың жүйелік хабарламаларының мәтіні (backend тек оқиғаны жібереді: metadata.event) */

type SystemMeta = {
  event?: string;
  name?: string;
  role?: string;
  userIds?: string[];
  users?: Record<string, GroupUser>;
};

export function groupEventText(message: Message, t: TFunction, currentUserId?: string): string {
  const meta = (message.metadata || {}) as SystemMeta;
  const nameOf = (id: string) =>
    id === currentUserId ? t('chat.group.you') : meta.users?.[id]?.username || message.sender?.username || '?';
  const actor = nameOf(message.fromUserId);
  const users = (meta.userIds || []).map(nameOf).join(', ');

  switch (meta.event) {
    case 'created':
      return t('chat.group.events.created', { actor, name: meta.name });
    case 'added':
      return t('chat.group.events.added', { actor, users });
    case 'removed':
      return t('chat.group.events.removed', { actor, users });
    case 'left':
      return t('chat.group.events.left', { users });
    case 'renamed':
      return t('chat.group.events.renamed', { actor, name: meta.name });
    case 'role':
      return meta.role === 'admin'
        ? t('chat.group.events.madeAdmin', { actor, users })
        : t('chat.group.events.removedAdmin', { actor, users });
    default:
      return '';
  }
}

/** Жоба картасының атауы (чаттар тізімі үшін) */
export function projectPreview(message: Message): string {
  return (message.metadata as { title?: string } | undefined)?.title ?? '';
}

const MEDIA_LABEL_TYPES = ['image', 'video', 'location', 'sticker', 'poll', 'project'];

/** Хабарламаның қысқа мәтіні (чаттар тізімі үшін). Түрінің белгішесін MediaKindIcon береді */
export function messageBodyPreview(message: Message, t: TFunction): string {
  const text = message.type === 'project' ? projectPreview(message) : stripFormatting(message.content || '');
  if (text) return text;
  if (message.type === 'audio') return t('chat.voice.message');
  if (message.type && MEDIA_LABEL_TYPES.includes(message.type)) return t(`chat.actions.media.${message.type}`);
  return message.attachments?.[0]?.filename || '';
}

/** Топтағы соңғы хабарламаның жіберушісі: «Сіз: » не «Аты: » */
export function groupSenderPrefix(message: Message, t: TFunction, currentUserId?: string): string {
  return message.fromUserId === currentUserId ? t('chat.youPrefix') : `${message.sender?.username ?? ''}: `;
}
