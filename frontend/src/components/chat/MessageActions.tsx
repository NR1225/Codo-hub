import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useConfirm, useToast } from '../../contexts/ToastContext';
import { apiService, Chat, ChatGroupSummary, ForwardTarget, Message, MessageReplyRef } from '../../utils/api';
import {
  CheckSmallIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  ForwardIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  TrashIcon,
} from '../home/icons';
import { monogram } from '../home/monogram';
import { stripFormatting } from './formatText';
import { SavedAvatar } from './ChatExtras';
import { MediaKindIcon } from './MediaIcons';
import Popover, { useLingering } from './Popover';
import './MessageActions.css';

/* Telegram сияқты хабарлама әрекеттері — жеке чат пен топқа ортақ:
   контекстік мәзір (оң батырма / ұзақ басу / ⋯), жауап беру, өңдеу, көшіру,
   бағыттау, бекіту, жою және реакциялар. Стильдері: ChatPage.css (cht-ma-*) */

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🙏'];
const NON_EDITABLE = ['system', 'project', 'location', 'sticker', 'poll'];
const LONG_PRESS_MS = 450;

/** Жауап үзіндісі мен баннерде көрсетілетін қысқа мәтін */
export const messagePreview = (
  m: Pick<Message, 'type' | 'content'> | MessageReplyRef,
  t: TFunction,
): string => {
  const text = stripFormatting(('preview' in m ? m.preview : m.content) || '');
  const type = m.type || 'text';
  if (type === 'text' || type === 'emoji') return text;
  const label = t(`chat.actions.media.${type}`, { defaultValue: t('chat.actions.media.file') });
  return text ? `${label} · ${text}` : label;
};

interface MessageActionsConfig {
  currentUserId: string;
  /** Чаттың бірегей кілті (досының id-і не топ id-і) — ауысқанда күй тазаланады */
  chatKey: string;
  /** Топ болса — оның id-і; жеке чатта undefined */
  groupId?: string;
  canDeleteForAll: (m: Message) => boolean;
  canPin: boolean;
  /** Баннерде көрсетілетін жіберуші аты (әйтпесе m.sender) */
  senderName?: (m: Message) => string;
  containerRef: React.RefObject<HTMLDivElement>;
  /** Сервер қайтарған жаңартылған хабарламаны күйге жазу */
  onLocalUpdate: (m: Message) => void;
  onLocalRemove: (id: string) => void;
}

interface MenuState {
  message: Message;
  x: number;
  y: number;
}

export const useMessageActions = (cfg: MessageActionsConfig) => {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | undefined>();
  const [focusKey, setFocusKey] = useState(0);
  const pressTimer = useRef<number | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  // Чат ауысқанда барлық күй тазаланады
  useEffect(() => {
    setMenu(null);
    setReplyTo(null);
    setEditing(null);
    setForwarding(null);
  }, [cfg.chatKey]);

  const openMenu = useCallback((x: number, y: number, message: Message) => {
    if (message.type === 'system') return;
    setMenu({ message, x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  /** Хабарлама элементіне ілінетін оқиғалар */
  const bind = (message: Message) => ({
    'data-mid': message.id,
    onContextMenu: (e: React.MouseEvent) => {
      // Сілтеме/суретте браузер мәзірі керек болса — Shift басып тұрып
      if (e.shiftKey) return;
      e.preventDefault();
      openMenu(e.clientX, e.clientY, message);
    },
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      cancelPress();
      pressTimer.current = window.setTimeout(() => {
        navigator.vibrate?.(15);
        openMenu(touch.clientX, touch.clientY, message);
      }, LONG_PRESS_MS);
    },
    onTouchMove: cancelPress,
    onTouchEnd: cancelPress,
  });

  /** Хабарламаға секіріп, оны жарқыратып көрсету */
  const jumpTo = useCallback(
    (id: string) => {
      const el = cfgRef.current.containerRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
      if (!el) {
        toast.info(t('chat.actions.notFound'));
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('is-flash');
      void el.offsetWidth; // анимацияны қайта бастау
      el.classList.add('is-flash');
      window.setTimeout(() => el.classList.remove('is-flash'), 1600);
    },
    [t, toast],
  );

  const fail = useCallback(
    (err: unknown) => {
      console.error('Message action failed:', err);
      toast.error(err instanceof Error && err.message ? err.message : t('chat.actions.failed'));
    },
    [t, toast],
  );

  const react = useCallback(
    async (message: Message, emoji: string) => {
      setMenu(null);
      try {
        cfgRef.current.onLocalUpdate(await apiService.reactToMessage(message.id, emoji, cfgRef.current.groupId));
      } catch (err) {
        fail(err);
      }
    },
    [fail],
  );

  const startReply = (message: Message) => {
    setMenu(null);
    if (editing) setPrefill({ text: '', key: Date.now() });
    setEditing(null);
    setReplyTo(message);
    setFocusKey(Date.now());
  };

  const startEdit = (message: Message) => {
    setMenu(null);
    setReplyTo(null);
    setEditing(message);
    setPrefill({ text: message.content || '', key: Date.now() });
  };

  const cancelComposer = () => {
    setReplyTo(null);
    if (editing) setPrefill({ text: '', key: Date.now() });
    setEditing(null);
  };

  /** Өңдеу режимінде жіберілген мәтінді сақтау. true — өңделді (жаңа хабарлама жіберілмейді) */
  const submitEdit = (content: string): boolean => {
    if (!editing) return false;
    const target = editing;
    setEditing(null);
    // Өріске өңдеуден бұрынғы черновик қайтады (MessageInput)
    setPrefill({ text: '', key: Date.now() });
    if (content.trim() && content.trim() !== (target.content || '').trim()) {
      apiService
        .editMessage(target.id, content, cfgRef.current.groupId)
        .then((m) => cfgRef.current.onLocalUpdate(m))
        .catch(fail);
    }
    return true;
  };

  const copy = async (message: Message) => {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(message.content || '');
      toast.success(t('chat.actions.copied'));
    } catch {
      toast.error(t('chat.copyError'));
    }
  };

  const togglePin = async (message: Message) => {
    setMenu(null);
    try {
      cfgRef.current.onLocalUpdate(await apiService.pinMessage(message.id, !message.pinned, cfgRef.current.groupId));
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (message: Message, scope: 'me' | 'all') => {
    setMenu(null);
    const ok = await confirm({
      title: t(scope === 'all' ? 'chat.actions.deleteForAllTitle' : 'chat.actions.deleteForMeTitle'),
      message: t(scope === 'all' ? 'chat.actions.deleteForAllText' : 'chat.actions.deleteForMeText'),
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiService.deleteMessage(message.id, scope, cfgRef.current.groupId);
      cfgRef.current.onLocalRemove(message.id);
      if (replyTo?.id === message.id) setReplyTo(null);
      if (editing?.id === message.id) cancelComposer();
    } catch (err) {
      fail(err);
    }
  };

  // Жауап берілген/өңделіп жатқан хабарлама басқа жақтан жойылса — жолақты жабамыз
  const forgetMessage = useCallback((id: string) => {
    setReplyTo((prev) => (prev?.id === id ? null : prev));
    setEditing((prev) => (prev?.id === id ? null : prev));
    setMenu((prev) => (prev?.message.id === id ? null : prev));
  }, []);

  const isOwn = (m: Message) => m.fromUserId === cfg.currentUserId;

  // Жабылғанда да соңғы хабарламаның мәзірі анимация біткенше көрінеді
  const [shown, menuOpen] = useLingering(menu);
  const menuNode = shown && (
    <ContextMenu
      state={shown}
      open={menuOpen}
      onClose={closeMenu}
      onReact={(emoji) => react(shown.message, emoji)}
      myReaction={Object.entries(shown.message.reactions || {}).find(([, ids]) => ids.includes(cfg.currentUserId))?.[0]}
      items={[
        { key: 'reply', icon: <ReplyIcon size={16} />, label: t('chat.actions.reply'), onClick: () => startReply(shown.message) },
        ...(isOwn(shown.message) && !NON_EDITABLE.includes(shown.message.type || 'text')
          ? [{ key: 'edit', icon: <EditIcon size={16} />, label: t('chat.actions.edit'), onClick: () => startEdit(shown.message) }]
          : []),
        ...(shown.message.content
          ? [{ key: 'copy', icon: <CopyIcon size={16} />, label: t('chat.actions.copy'), onClick: () => copy(shown.message) }]
          : []),
        {
          key: 'forward',
          icon: <ForwardIcon size={16} />,
          label: t('chat.actions.forward'),
          onClick: () => {
            setMenu(null);
            setForwarding(shown.message);
          },
        },
        ...(cfg.canPin
          ? [{
              key: 'pin',
              icon: <PinIcon size={16} />,
              label: t(shown.message.pinned ? 'chat.actions.unpin' : 'chat.actions.pin'),
              onClick: () => togglePin(shown.message),
            }]
          : []),
        { key: 'sep', separator: true },
        { key: 'del-me', icon: <TrashIcon size={16} />, label: t('chat.actions.deleteForMe'), danger: true, onClick: () => remove(shown.message, 'me') },
        ...(cfg.canDeleteForAll(shown.message)
          ? [{ key: 'del-all', icon: <TrashIcon size={16} />, label: t('chat.actions.deleteForAll'), danger: true, onClick: () => remove(shown.message, 'all') }]
          : []),
      ]}
    />
  );

  const composerTarget = editing || replyTo;
  const banner = composerTarget ? (
    <div className={`cht-ma-banner ${editing ? 'is-edit' : 'is-reply'}`}>
      <span className="cht-ma-banner__icon">{editing ? <EditIcon size={16} /> : <ReplyIcon size={16} />}</span>
      <button type="button" className="cht-ma-banner__body" onClick={() => jumpTo(composerTarget.id)}>
        <span className="cht-ma-banner__title">
          {editing
            ? t('chat.actions.editing')
            : t('chat.actions.replyingTo', {
                name: isOwn(composerTarget)
                  ? t('common.you')
                  : cfg.senderName?.(composerTarget) || composerTarget.sender?.username || '',
              })}
        </span>
        <span className="cht-ma-banner__text">
          <MediaKindIcon type={composerTarget.type} size={13} />
          {messagePreview(composerTarget, t)}
        </span>
      </button>
      <button type="button" className="cht-ma-banner__close" onClick={cancelComposer} aria-label={t('common.cancel')}>
        <CloseIcon size={14} />
      </button>
    </div>
  ) : undefined;

  const forwardNode = forwarding && (
    <ForwardModal
      currentUserId={cfg.currentUserId}
      onClose={() => setForwarding(null)}
      onSend={async (targets) => {
        const res = await apiService.forwardMessage(forwarding.id, targets, cfg.groupId);
        const sent = res.results.filter((r) => r.ok).length;
        if (sent === targets.length) toast.success(t('chat.actions.forwarded', { count: sent }));
        else toast.info(t('chat.actions.forwardedPartial', { sent, total: targets.length }));
        setForwarding(null);
      }}
    />
  );

  return {
    bind,
    openMenu,
    jumpTo,
    react,
    forgetMessage,
    replyTo,
    editing,
    clearReply: () => setReplyTo(null),
    submitEdit,
    /** MessageInput-қа берілетін пропстар */
    inputProps: { banner, prefill, focusKey, onEscape: composerTarget ? cancelComposer : undefined },
    /** Мәзір мен бағыттау терезесі — компоненттің соңында рендерленеді */
    overlays: (
      <>
        {menuNode}
        {forwardNode}
      </>
    ),
  };
};

/* ---------- Контекстік мәзір ---------- */

export type MenuItem =
  | { key: string; separator: true }
  | { key: string; icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; separator?: false };

/** Курсордан (не ⋯ батырмасынан) шығатын мәзір; onReact берілсе — жоғарғы жағында жылдам реакциялар.
    Чаттар тізімінде және сурет қарау терезесінде де қолданылады */
export const ContextMenu: React.FC<{
  state: { x: number; y: number };
  /** false — жабылу анимациясы ойнайды (useLingering-пен бірге) */
  open?: boolean;
  items: MenuItem[];
  myReaction?: string;
  onReact?: (emoji: string) => void;
  onClose: () => void;
}> = ({ state, open = true, items, myReaction, onReact, onClose }) => (
  <Popover open={open} anchor={{ x: state.x, y: state.y }} onClose={onClose} placement="bottom-start">
    {onReact && (
      <div className="cht-ma-menu__reactions" role="group">
        {QUICK_REACTIONS.map((emoji, i) => (
          <button
            key={emoji}
            type="button"
            className={`cht-ma-menu__emoji ${myReaction === emoji ? 'is-active' : ''}`}
            style={{ '--i': i } as React.CSSProperties}
            onClick={() => onReact(emoji)}
            aria-label={emoji}
            aria-pressed={myReaction === emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    )}
    {items.map((item) =>
      item.separator ? (
        <div key={item.key} className="cht-ma-menu__sep" role="separator" />
      ) : (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`cht-ma-menu__item ${item.danger ? 'is-danger' : ''}`}
          onClick={item.onClick}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ),
    )}
  </Popover>
);

/* ---------- Көпіршік ішіндегі бөліктер ---------- */

/** «Бағытталды: аты» */
export const ForwardedLabel: React.FC<{ from: NonNullable<Message['forwardedFrom']> }> = ({ from }) => {
  const { t } = useTranslation();
  return (
    <span className="cht-ma-fwd">
      <ForwardIcon size={13} />
      {t('chat.actions.forwardedFrom', { name: from.username || '?' })}
    </span>
  );
};

/** Жауап берілген хабарламаның үзіндісі — басқанда сол хабарламаға секіреді */
export const ReplyQuote: React.FC<{ reply: MessageReplyRef; currentUserId: string; onJump: (id: string) => void }> = ({
  reply,
  currentUserId,
  onJump,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="cht-ma-quote"
      onClick={(e) => {
        e.stopPropagation();
        onJump(reply.id);
      }}
    >
      <span className="cht-ma-quote__name">
        {reply.fromUserId === currentUserId ? t('common.you') : reply.senderName || '?'}
      </span>
      <span className="cht-ma-quote__text">
        <MediaKindIcon type={reply.type} size={13} />
        {messagePreview(reply, t)}
      </span>
    </button>
  );
};

/** Реакциялар қатары: көп қойылғаны бірінші, өзімдікі белгіленеді */
export const ReactionBar: React.FC<{
  reactions?: Record<string, string[]>;
  currentUserId: string;
  onToggle: (emoji: string) => void;
}> = ({ reactions, currentUserId, onToggle }) => {
  const entries = Object.entries(reactions || {})
    .filter(([, ids]) => ids.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  if (entries.length === 0) return null;
  return (
    <div className="cht-ma-reactions">
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            className={`cht-ma-reaction ${mine ? 'is-mine' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(emoji);
            }}
            aria-pressed={mine}
          >
            <span className="cht-ma-reaction__emoji">{emoji}</span>
            <span className="cht-ma-reaction__count">{ids.length}</span>
          </button>
        );
      })}
    </div>
  );
};

/** Хабарлама көпіршігінің ⋯ батырмасы (тышқанмен жұмыс істегенде көрінеді) */
export const MessageMoreButton: React.FC<{ onOpen: (x: number, y: number) => void }> = ({ onOpen }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="cht-ma-more"
      aria-label={t('chat.actions.more')}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(r.left, r.bottom + 4);
      }}
    >
      <span aria-hidden="true">⋯</span>
    </button>
  );
};

/* ---------- Бекітілген хабарламалар жолағы ---------- */

export const PinnedBar: React.FC<{
  messages: Message[];
  onJump: (id: string) => void;
  onUnpin?: (m: Message) => void;
}> = ({ messages, onJump, onUnpin }) => {
  const { t } = useTranslation();
  const pinned = useMemo(() => messages.filter((m) => m.pinned), [messages]);
  // Telegram сияқты: басқан сайын алдыңғы бекітілгенге ауысады
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [pinned.length]);
  if (pinned.length === 0) return null;
  const current = pinned[pinned.length - 1 - (index % pinned.length)];
  return (
    <div className="cht-ma-pinned">
      {pinned.length > 1 && (
        <span className="cht-ma-pinned__track" aria-hidden="true">
          {pinned.map((m, i) => (
            <span key={m.id} className={pinned.length - 1 - i === index % pinned.length ? 'is-active' : ''} />
          ))}
        </span>
      )}
      <button
        type="button"
        className="cht-ma-pinned__body"
        onClick={() => {
          onJump(current.id);
          setIndex((i) => i + 1);
        }}
      >
        <span className="cht-ma-pinned__title">
          <PinIcon size={13} />
          {pinned.length > 1
            ? t('chat.actions.pinnedNumbered', { n: pinned.length - (index % pinned.length), total: pinned.length })
            : t('chat.actions.pinnedMessage')}
        </span>
        <span className="cht-ma-pinned__text">
          <MediaKindIcon type={current.type} size={13} />
          {messagePreview(current, t)}
        </span>
      </button>
      {onUnpin && (
        <button
          type="button"
          className="cht-icon-btn"
          onClick={() => onUnpin(current)}
          title={t('chat.actions.unpin')}
          aria-label={t('chat.actions.unpin')}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
};

/* ---------- Бағыттау терезесі ---------- */

interface ForwardOption {
  kind: 'dm' | 'group';
  id: string;
  name: string;
  avatar?: string | null;
  hint: string;
}

const ForwardModal: React.FC<{
  currentUserId: string;
  onClose: () => void;
  onSend: (targets: ForwardTarget[]) => Promise<void>;
}> = ({ currentUserId, onClose, onSend }) => {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ForwardOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiService.getChats(currentUserId).catch(() => [] as Chat[]),
      apiService.getGroups().catch(() => [] as ChatGroupSummary[]),
    ]).then(([chats, groups]) => {
      if (!alive) return;
      setOptions([
        // «Сақталған хабарламалар» — әрқашан бірінші
        { kind: 'dm' as const, id: currentUserId, name: t('chat.saved.title'), hint: t('chat.saved.subtitle') },
        ...groups.map((g) => ({
          kind: 'group' as const,
          id: g.id,
          name: g.name,
          hint: t('chat.group.membersCount', { count: g.memberCount }),
        })),
        ...chats.filter((c) => c.partnerId !== currentUserId).map((c) => ({
          kind: 'dm' as const,
          id: c.partnerId,
          name: c.partner.username,
          avatar: c.partner.avatar,
          hint: `@${c.partner.username}`,
        })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [currentUserId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !sending && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const keyOf = (o: { kind: string; id: string }) => `${o.kind}:${o.id}`;
  const filtered = (options || []).filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (o: ForwardOption) =>
    setSelected((prev) => (prev.includes(keyOf(o)) ? prev.filter((k) => k !== keyOf(o)) : [...prev, keyOf(o)]));

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSend(
        selected.map((k) => {
          const [kind, ...rest] = k.split(':');
          return { kind: kind as 'dm' | 'group', id: rest.join(':') };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.actions.failed'));
      setSending(false);
    }
  };

  return createPortal(
    <div className="cht-ma-portal cht-overlay" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div className="cht-modal cht-ma-fwdmodal" role="dialog" aria-modal="true" aria-labelledby="cht-fwd-title">
        <div className="cht-modal__head">
          <h2 id="cht-fwd-title">{t('chat.actions.forwardTitle')}</h2>
          <button type="button" className="cht-icon-btn x-close" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon size={16} />
          </button>
        </div>
        <label className="cht-search cht-ma-fwdmodal__search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.actions.forwardSearch')}
            aria-label={t('chat.actions.forwardSearch')}
            autoFocus
          />
        </label>
        <div className="cht-ma-fwdmodal__list" role="listbox" aria-multiselectable="true">
          {options === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="cht-skel">
                <span />
                <span />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <p className="cht-empty">{t('chat.actions.forwardEmpty')}</p>
          ) : (
            filtered.map((o) => {
              const isOn = selected.includes(keyOf(o));
              return (
                <button
                  key={keyOf(o)}
                  type="button"
                  role="option"
                  aria-selected={isOn}
                  className={`cht-ma-fwdmodal__item ${isOn ? 'is-on' : ''}`}
                  onClick={() => toggle(o)}
                >
                  {o.kind === 'dm' && o.id === currentUserId ? (
                    <SavedAvatar />
                  ) : o.kind === 'group' ? (
                    <span className="cht-gavatar" aria-hidden="true">{monogram(o.name)}</span>
                  ) : (
                    <span className="cht-avatar">
                      {o.avatar ? <img src={o.avatar} alt="" /> : <span>{monogram(o.name)}</span>}
                    </span>
                  )}
                  <span className="cht-item__body">
                    <span className="cht-item__name">{o.name}</span>
                    <span className="cht-item__last">{o.hint}</span>
                  </span>
                  <span className="cht-ma-check" aria-hidden="true">
                    {isOn && <CheckSmallIcon size={14} />}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {error && (
          <p className="cht-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="cht-modal__foot">
          <button type="button" className="cht-btn cht-btn--ghost" onClick={onClose} disabled={sending}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cht-btn cht-btn--primary"
            onClick={send}
            disabled={sending || selected.length === 0}
          >
            {sending ? <span className="cht-btn-spinner" aria-hidden="true" /> : <ForwardIcon size={16} />}
            {selected.length > 0 ? t('chat.actions.forwardSendCount', { count: selected.length }) : t('chat.actions.forwardSend')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
