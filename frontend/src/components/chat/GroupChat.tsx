import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm, useToast } from '../../contexts/ToastContext';
import { apiService, ChatGroupDetails, GroupMember, GroupUser, Message, MessageAttachment, User } from '../../utils/api';
import { websocketService } from '../../utils/websocket';
import MessageInput from '../MessageInput';
import {
  ArrowLeftIcon,
  BellOffIcon,
  ChatIcon,
  PinIcon,
  CheckSmallIcon,
  CloseIcon,
  CrownIcon,
  EditIcon,
  LogOutIcon,
  MoreIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from '../home/icons';
import { monogram } from '../home/monogram';
import UserPicker, { Avatar } from './UserPicker';
import DetailsPanel from './DetailsPanel';
import { groupEventText } from './groupText';
import ShareProjectModal, { ProjectShare } from './ShareProjectModal';
import {
  useMessageActions,
  ForwardedLabel,
  ReplyQuote,
  ReactionBar,
  MessageMoreButton,
  PinnedBar,
  MenuItem,
} from './MessageActions';
import { SharedMedia } from './ChatExtras';
import Popover from './Popover';
import { usePresence, isNewDay, DayDivider, useStickToBottom, JumpToBottom, draftKeyFor } from './ChatComfort';

/* Топтық сөйлесу — чат бетінің оң жақ панелі (стильдері ChatPage.css) */

interface GroupChatProps {
  groupId: string;
  currentUser: User;
  suggestions: GroupUser[];
  renderMessageContent: (message: Message) => React.ReactNode;
  formatTime: (date: string) => string;
  onBack: () => void;
  /** Топтан шықтым / топ жойылды */
  onRemoved: () => void;
  /** Тізімдегі соңғы хабарлама мен оқылмағандар санын жаңарту */
  onActivity: () => void;
  /** Бекіту / дыбысын өшіру / мұрағаттау — тақырып мәзірінде */
  prefMenuItems: MenuItem[];
  muted: boolean;
  onOpenImage: (url: string, filename: string) => void;
}

const isManager = (role?: string) => role === 'owner' || role === 'admin';

export const GroupAvatar: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span className={`cht-gavatar ${className}`} aria-hidden="true">
    {monogram(name)}
  </span>
);

const GroupChat: React.FC<GroupChatProps> = ({
  groupId,
  currentUser,
  suggestions,
  renderMessageContent,
  formatTime,
  onBack,
  onRemoved,
  onActivity,
  prefMenuItems,
  muted,
  onOpenImage,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [group, setGroup] = useState<ChatGroupDetails | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [showMenu, setShowMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [infoAddMode, setInfoAddMode] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setShowMenu(false), []);
  // Ата-ана компоненттің функциялары әр рендерде жаңарады — эффектілер қайта іске қосылмауы үшін ref
  const onRemovedRef = useRef(onRemoved);
  const onActivityRef = useRef(onActivity);
  onRemovedRef.current = onRemoved;
  onActivityRef.current = onActivity;
  const refreshList = useCallback(() => onActivityRef.current(), []);

  // Хабарлама әрекеттері: жауап, өңдеу, жою, бағыттау, бекіту (тек әкімшілер), реакциялар
  const msgActions = useMessageActions({
    currentUserId: currentUser.id,
    chatKey: groupId,
    groupId,
    canDeleteForAll: (m) => m.fromUserId === currentUser.id || isManager(group?.myRole),
    canPin: isManager(group?.myRole),
    containerRef: listRef,
    onLocalUpdate: (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x))),
    onLocalRemove: (id) => {
      setMessages((prev) => prev.filter((x) => x.id !== id));
      refreshList();
    },
  });
  const forgetMessageRef = useRef(msgActions.forgetMessage);
  forgetMessageRef.current = msgActions.forgetMessage;

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  const loadGroup = useCallback(async () => {
    try {
      setGroup(await apiService.getGroup(groupId));
    } catch {
      // Мүше емеспін (шығарылғанмын) немесе топ жойылған
      onRemovedRef.current();
    }
  }, [groupId]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiService.getGroupMessages(groupId);
      setMessages(list);
      scrollToBottom();
      apiService.markGroupRead(groupId).then(refreshList, () => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.loadMessagesError'));
    } finally {
      setLoading(false);
    }
  }, [groupId, scrollToBottom, refreshList, t]);

  useEffect(() => {
    setGroup(null);
    setMessages([]);
    setTyping({});
    setShowInfo(false);
    loadGroup();
    loadMessages();
  }, [groupId, loadGroup, loadMessages]);

  // Нақты уақыттағы оқиғалар
  useEffect(() => {
    const onMessage = (data: { groupId?: string; message?: Message }) => {
      if (data.groupId !== groupId || !data.message) return;
      const msg = data.message;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setTyping((prev) => {
        if (!(msg.fromUserId in prev)) return prev;
        const next = { ...prev };
        delete next[msg.fromUserId];
        return next;
      });
      if (msg.fromUserId !== currentUser.id) apiService.markGroupRead(groupId).then(refreshList, () => undefined);
    };
    const onTyping = (data: { groupId?: string; userId?: string; isTyping?: boolean }) => {
      if (data.groupId !== groupId || !data.userId) return;
      const uid = data.userId;
      setTyping((prev) => {
        const next = { ...prev };
        if (data.isTyping) next[uid] = Date.now();
        else delete next[uid];
        return next;
      });
    };
    const onUpdated = (data: { groupId?: string }) => {
      if (data.groupId === groupId) loadGroup();
    };
    const onMessageUpdated = (data: { groupId?: string; message?: Message }) => {
      const updated = data.message;
      if (data.groupId !== groupId || !updated) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    };
    const onMessageDeleted = (data: { groupId?: string; messageId?: string }) => {
      const id = data.messageId;
      if (data.groupId !== groupId || !id) return;
      setMessages((prev) => prev.filter((m) => m.id !== id));
      forgetMessageRef.current(id);
      refreshList();
    };
    websocketService.on('group_message', onMessage);
    websocketService.on('group_typing', onTyping);
    websocketService.on('group_updated', onUpdated);
    websocketService.on('group_message_updated', onMessageUpdated);
    websocketService.on('group_message_deleted', onMessageDeleted);
    return () => {
      websocketService.off('group_message_updated', onMessageUpdated);
      websocketService.off('group_message_deleted', onMessageDeleted);
      websocketService.off('group_message', onMessage);
      websocketService.off('group_typing', onTyping);
      websocketService.off('group_updated', onUpdated);
    };
  }, [groupId, currentUser.id, scrollToBottom, refreshList, loadGroup]);

  // «Жазуда» белгісі 6 секундтан кейін өзі өшеді (желі үзілсе қалып қоймауы үшін)
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, at]) => now - at < 6000));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [typing]);

  const membersById = useMemo(() => {
    const map: Record<string, GroupMember> = {};
    group?.members.forEach((m) => (map[m.id] = m));
    return map;
  }, [group]);

  const typingNames = Object.keys(typing)
    .map((id) => membersById[id]?.username)
    .filter(Boolean) as string[];

  // Онлайн мүшелер саны (өзім әрқашан онлайнмын)
  const memberIds = useMemo(() => (group?.members ?? []).map((m) => m.id).filter((id) => id !== currentUser.id), [group, currentUser.id]);
  const presence = usePresence(memberIds);
  const onlineCount = group ? memberIds.filter((id) => presence[id]?.online).length + 1 : 0;
  const stick = useStickToBottom(listRef, messages, currentUser.id, groupId);

  const statusText =
    typingNames.length === 1
      ? t('chat.group.typingOne', { name: typingNames[0] })
      : typingNames.length > 1
        ? t('chat.group.typingMany', { count: typingNames.length })
        : onlineCount > 1
          ? `${t('chat.group.membersCount', { count: group?.members.length ?? 0 })}, ${t('chat.presence.onlineCount', { count: onlineCount })}`
          : t('chat.group.membersCount', { count: group?.members.length ?? 0 });

  const append = (msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    scrollToBottom(true);
    refreshList();
  };

  const handleSend = async (content: string, type = 'text', attachments?: MessageAttachment[], metadata?: Record<string, unknown>) => {
    // Өңдеу режимі: жаңа хабарлама емес, бұрынғысы өзгереді
    if (type === 'text' && msgActions.submitEdit(content)) return;
    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    try {
      append(await apiService.sendGroupMessage(groupId, content, type, attachments, metadata, replyToId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.sendMessageError'));
    }
  };

  const handleUpload = async (file: File, type: string, content?: string, metadata?: Record<string, unknown>) => {
    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    try {
      append(await apiService.uploadGroupFile(groupId, file, type as 'image' | 'audio' | 'video' | 'file', content, metadata, replyToId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.uploadFileError'));
    }
  };

  const handleCreatePoll = async (poll: { question: string; options: string[]; multiple: boolean }) => {
    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    append(await apiService.sendGroupMessage(groupId, poll.question, 'poll', undefined, poll, replyToId));
  };

  const handleShareProject = async (share: ProjectShare, comment: string) => {
    append(await apiService.sendGroupMessage(groupId, comment, 'project', undefined, { ...share }));
  };

  const handleLeave = async () => {
    setShowMenu(false);
    if (!(await confirm({ title: t('chat.group.leaveConfirm'), confirmText: t('chat.group.leave'), danger: true }))) return;
    try {
      await apiService.removeGroupMember(groupId, currentUser.id);
      onRemovedRef.current();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.group.actionError'));
    }
  };

  const openInfo = (addMode = false) => {
    setShowMenu(false);
    setInfoAddMode(addMode);
    setShowInfo(true);
  };

  const name = group?.name ?? '';

  return (
    <>
      <div className="cht-conv">
      <header className="cht-bar">
        <button
          type="button"
          className="cht-icon-btn cht-bar__back"
          onClick={onBack}
          title={t('common.back')}
          aria-label={t('common.back')}
        >
          <ArrowLeftIcon />
        </button>
        <button
          type="button"
          className={`cht-bar__who ${showInfo ? 'is-open' : ''}`}
          onClick={() => (showInfo ? setShowInfo(false) : openInfo())}
          disabled={!group}
          aria-expanded={showInfo}
        >
          <GroupAvatar name={name || '?'} />
          <span className="cht-bar__names">
            <span className="cht-bar__name">
              {name || '…'}
              {muted && (
                <span className="cht-item__flags" title={t('chat.list.muted')}>
                  <BellOffIcon size={12} />
                </span>
              )}
            </span>
            <span className={`cht-bar__status ${typingNames.length ? 'is-typing' : ''}`}>{group ? statusText : ''}</span>
          </span>
        </button>

        {/* Мүшелердің аватарлары — басқанда топ туралы ашылады */}
        {group && (
          <button type="button" className="cht-stack" onClick={() => openInfo()} aria-label={t('chat.group.members')}>
            {group.members.slice(0, 4).map((m) => (
              <Avatar key={m.id} user={m} className="cht-avatar--sm" />
            ))}
            {group.members.length > 4 && <span className="cht-stack__more">+{group.members.length - 4}</span>}
          </button>
        )}

        <div className="cht-menu">
          <button
            ref={menuBtnRef}
            type="button"
            className={`cht-icon-btn ${showMenu ? 'is-open' : ''}`}
            onClick={() => setShowMenu((v) => !v)}
            aria-label={t('chat.menuTitle')}
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            <MoreIcon />
          </button>
          <Popover open={showMenu} anchor={menuBtnRef} onClose={closeMenu} placement="bottom-end" ariaLabel={t('chat.menuTitle')}>
              <button type="button" role="menuitem" className="cht-menu__item" onClick={() => openInfo()}>
                <UsersIcon size={16} />
                <span>{t('chat.group.groupInfo')}</span>
              </button>
              {isManager(group?.myRole) && (
                <button type="button" role="menuitem" className="cht-menu__item" onClick={() => openInfo(true)}>
                  <UserPlusIcon size={16} />
                  <span>{t('chat.group.addMembers')}</span>
                </button>
              )}
              <div className="cht-menu__sep" role="separator" />
              {prefMenuItems.map((item) =>
                item.separator ? null : (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className="cht-menu__item"
                    onClick={item.onClick}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ),
              )}
              <div className="cht-menu__sep" role="separator" />
              <button type="button" role="menuitem" className="cht-menu__item is-danger" onClick={handleLeave}>
                <LogOutIcon size={16} />
                <span>{t('chat.group.leave')}</span>
              </button>
          </Popover>
        </div>
      </header>

      <PinnedBar
        messages={messages}
        onJump={msgActions.jumpTo}
        onUnpin={
          isManager(group?.myRole)
            ? (m) => {
                apiService
                  .pinMessage(m.id, false, groupId)
                  .then((u) => setMessages((prev) => prev.map((x) => (x.id === u.id ? u : x))))
                  .catch(() => toast.error(t('chat.actions.failed')));
              }
            : undefined
        }
      />

      <div className="cht-messages" ref={listRef}>
        {loading && messages.length === 0 ? (
          <div className="cht-state">
            <span className="cht-state__icon is-pulsing">
              <ChatIcon size={22} />
            </span>
            <p className="cht-state__text">{t('chat.messagesLoading')}</p>
          </div>
        ) : error ? (
          <div className="cht-state">
            <span className="cht-state__icon">
              <ChatIcon size={22} />
            </span>
            <p className="cht-state__text">{t('chat.errorWithMessage', { message: error })}</p>
            <button type="button" className="cht-btn cht-btn--primary" onClick={loadMessages}>
              <RefreshIcon />
              {t('common.retry')}
            </button>
          </div>
        ) : (
          messages.map((message, index) => {
            const divider = isNewDay(message, messages[index - 1]) ? <DayDivider date={message.createdAt} /> : null;
            if (message.type === 'system') {
              return (
                <React.Fragment key={message.id}>
                  {divider}
                  <div className="cht-sysmsg">
                    <span>{groupEventText(message, t, currentUser.id)}</span>
                  </div>
                </React.Fragment>
              );
            }
            const isOwn = message.fromUserId === currentUser.id;
            const prev = messages[index - 1];
            const next = messages[index + 1];
            const isFirstInGroup = !prev || prev.fromUserId !== message.fromUserId || prev.type === 'system' || !!divider;
            const isLastInGroup =
              !next || next.fromUserId !== message.fromUserId || next.type === 'system' || isNewDay(next, message);
            const sender = message.sender || membersById[message.fromUserId];
            return (
              <React.Fragment key={message.id}>
              {divider}
              <div className={`cht-gmsg ${isOwn ? 'own' : 'other'} ${isLastInGroup ? 'is-last' : ''}`}>
                {/* Басқаның хабарламасы: топтың соңғы хабарламасының жанында аватар */}
                {!isOwn && (isLastInGroup ? <Avatar user={sender} className="cht-avatar--sm" /> : <span className="cht-gmsg__spacer" />)}
                <div
                  className={`chat-message ${isOwn ? 'own' : 'other'} ${message.type || 'text'} ${isLastInGroup ? 'is-last' : ''}`}
                  {...msgActions.bind(message)}
                >
                  {!isOwn && isFirstInGroup && <span className="cht-sender">{sender?.username ?? '?'}</span>}
                  {message.forwardedFrom && <ForwardedLabel from={message.forwardedFrom} />}
                  {message.replyTo && (
                    <ReplyQuote reply={message.replyTo} currentUserId={currentUser.id} onJump={msgActions.jumpTo} />
                  )}
                  {renderMessageContent(message)}
                  <div className="chat-message-bottom">
                  <ReactionBar
                    reactions={message.reactions}
                    currentUserId={currentUser.id}
                    onToggle={(emoji) => msgActions.react(message, emoji)}
                  />
                  <div className="chat-message-footer">
                    {message.pinned && (
                      <span className="chat-message-pin" title={t('chat.actions.pinned')}>
                        <PinIcon size={11} />
                      </span>
                    )}
                    {message.editedAt && <span className="chat-message-edited">{t('chat.actions.edited')}</span>}
                    <span className="chat-message-time">{formatTime(message.createdAt)}</span>
                  </div>
                  </div>
                  <MessageMoreButton onOpen={(x, y) => msgActions.openMenu(x, y, message)} />
                </div>
              </div>
              </React.Fragment>
            );
          })
        )}
        <div className="cht-jump-anchor">
          <JumpToBottom visible={stick.showButton} count={stick.newCount} onClick={() => stick.scrollToBottom(true)} />
        </div>
      </div>

      <MessageInput
        key={groupId}
        draftKey={draftKeyFor('group', groupId)}
        onSendMessage={handleSend}
        onUploadFile={handleUpload}
        onTyping={(isTyping) => websocketService.sendGroupTyping(groupId, isTyping)}
        onShareProject={() => setShowShare(true)}
        onCreatePoll={handleCreatePoll}
        {...msgActions.inputProps}
      />
      {msgActions.overlays}
      </div>

      {showShare && (
        <ShareProjectModal
          username={currentUser.username}
          onClose={() => setShowShare(false)}
          onShare={handleShareProject}
        />
      )}

      {showInfo && group && (
        <GroupInfoModal
          key={group.id}
          group={group}
          currentUserId={currentUser.id}
          suggestions={suggestions}
          startInAddMode={infoAddMode}
          onClose={() => setShowInfo(false)}
          onChanged={setGroup}
          onLeave={handleLeave}
          onDeleted={onRemoved}
          messages={messages}
          onOpenImage={onOpenImage}
          onJump={msgActions.jumpTo}
        />
      )}
    </>
  );
};

/* ---------- Топ туралы терезе ---------- */

interface GroupInfoModalProps {
  group: ChatGroupDetails;
  currentUserId: string;
  suggestions: GroupUser[];
  startInAddMode: boolean;
  onClose: () => void;
  onChanged: (group: ChatGroupDetails) => void;
  onLeave: () => void;
  onDeleted: () => void;
  messages: Message[];
  onOpenImage: (url: string, filename: string) => void;
  onJump: (messageId: string) => void;
}

const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  group,
  currentUserId,
  suggestions,
  startInAddMode,
  onClose,
  onChanged,
  onLeave,
  onDeleted,
  messages,
  onOpenImage,
  onJump,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [adding, setAdding] = useState(startInAddMode);
  const [toAdd, setToAdd] = useState<GroupUser[]>([]);
  const [busy, setBusy] = useState(false);
  const canManage = isManager(group.myRole);
  const isOwner = group.myRole === 'owner';

  // Панель ашық тұрғанда мәзірден «Мүше қосу» таңдалса — қосу режиміне өту
  useEffect(() => {
    if (startInAddMode) setAdding(true);
  }, [startInAddMode]);

  const run = async (action: () => Promise<ChatGroupDetails | void>) => {
    setBusy(true);
    try {
      const result = await action();
      if (result) onChanged(result);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.group.actionError'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveInfo = async () => {
    if (!name.trim()) return;
    const ok = await run(() => apiService.updateGroup(group.id, { name: name.trim(), description: description.trim() }));
    if (ok) setEditing(false);
  };

  const addMembers = async () => {
    if (toAdd.length === 0) return;
    const ok = await run(() => apiService.addGroupMembers(group.id, toAdd.map((u) => u.id)));
    if (ok) {
      setToAdd([]);
      setAdding(false);
    }
  };

  const removeMember = async (m: GroupMember) => {
    if (!(await confirm({ title: t('chat.group.removeConfirm', { name: m.username }), confirmText: t('chat.group.removeMember'), danger: true }))) return;
    run(async () => {
      await apiService.removeGroupMember(group.id, m.id);
      return apiService.getGroup(group.id);
    });
  };

  const toggleAdmin = (m: GroupMember) =>
    run(() => apiService.setGroupMemberRole(group.id, m.id, m.role === 'admin' ? 'member' : 'admin'));

  const deleteGroup = async () => {
    if (!(await confirm({ title: t('chat.group.delete'), message: t('chat.group.deleteConfirm'), confirmText: t('common.delete'), danger: true }))) return;
    const ok = await run(() => apiService.deleteGroup(group.id));
    if (ok) onDeleted();
  };

  const roleChip = (role: GroupMember['role']) =>
    role === 'member' ? null : (
      <span className={`cht-role cht-role--${role}`}>
        {role === 'owner' ? <CrownIcon size={12} /> : <ShieldIcon size={12} />}
        {t(`chat.group.${role}`)}
      </span>
    );

  return (
    <DetailsPanel
      title={t('chat.group.groupInfo')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cht-btn cht-btn--danger-ghost" onClick={onLeave}>
            <LogOutIcon size={16} />
            {t('chat.group.leave')}
          </button>
          {isOwner && (
            <button type="button" className="cht-btn cht-btn--danger-ghost" onClick={deleteGroup} disabled={busy}>
              <TrashIcon size={16} />
              {t('chat.group.delete')}
            </button>
          )}
        </>
      }
    >
          <div className="cht-profile">
            <GroupAvatar name={editing ? name || '?' : group.name} className="cht-gavatar--xl" />
            {editing ? (
              <div className="cht-newgroup__fields cht-newgroup__fields--center">
                <input
                  className="cht-field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label={t('chat.group.groupName')}
                  maxLength={100}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && saveInfo()}
                />
                <input
                  className="cht-field cht-field--sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('chat.group.descriptionPlaceholder')}
                  aria-label={t('chat.group.description')}
                  maxLength={500}
                />
                <div className="cht-row-actions">
                  <button type="button" className="cht-btn cht-btn--ghost cht-btn--sm" onClick={() => setEditing(false)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="cht-btn cht-btn--primary cht-btn--sm"
                    onClick={saveInfo}
                    disabled={busy || !name.trim()}
                  >
                    <CheckSmallIcon size={14} />
                    {t('common.save')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="cht-profile__name">
                  <h3>{group.name}</h3>
                  {canManage && (
                    <button
                      type="button"
                      className="cht-icon-btn"
                      onClick={() => setEditing(true)}
                      title={t('chat.group.rename')}
                      aria-label={t('chat.group.rename')}
                    >
                      <EditIcon size={15} />
                    </button>
                  )}
                </div>
                {group.description && <p className="cht-profile__desc">{group.description}</p>}
                <span className="cht-profile__meta">{t('chat.group.membersCount', { count: group.members.length })}</span>
              </>
            )}
          </div>

          <div className="cht-section cht-section--row">
            <span>{t('chat.group.members')}</span>
            {canManage && !adding && (
              <button type="button" className="cht-btn cht-btn--ghost cht-btn--sm" onClick={() => setAdding(true)}>
                <UserPlusIcon size={14} />
                {t('chat.group.addMembers')}
              </button>
            )}
          </div>

          {adding && (
            <div className="cht-addbox">
              <UserPicker
                selected={toAdd}
                onChange={setToAdd}
                excludeIds={group.members.map((m) => m.id)}
                suggestions={suggestions}
                autoFocus
              />
              <div className="cht-row-actions">
                <button
                  type="button"
                  className="cht-btn cht-btn--ghost cht-btn--sm"
                  onClick={() => {
                    setAdding(false);
                    setToAdd([]);
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="cht-btn cht-btn--primary cht-btn--sm"
                  onClick={addMembers}
                  disabled={busy || toAdd.length === 0}
                >
                  <UserPlusIcon size={14} />
                  {t('chat.group.add')}
                  {toAdd.length > 0 && ` (${toAdd.length})`}
                </button>
              </div>
            </div>
          )}

          <div className="cht-members">
            {group.members.map((m) => {
              const isMe = m.id === currentUserId;
              const canRemove = !isMe && (isOwner ? m.role !== 'owner' : group.myRole === 'admin' && m.role === 'member');
              return (
                <div key={m.id} className="cht-item is-static">
                  <Avatar user={m} />
                  <div className="cht-item__body">
                    <span className="cht-item__name">
                      {m.username}
                      {isMe && <span className="cht-you"> · {t('chat.group.you')}</span>}
                    </span>
                  </div>
                  {roleChip(m.role)}
                  {isOwner && !isMe && (
                    <button
                      type="button"
                      className={`cht-icon-btn ${m.role === 'admin' ? 'is-open' : ''}`}
                      onClick={() => toggleAdmin(m)}
                      disabled={busy}
                      title={m.role === 'admin' ? t('chat.group.removeAdmin') : t('chat.group.makeAdmin')}
                      aria-label={m.role === 'admin' ? t('chat.group.removeAdmin') : t('chat.group.makeAdmin')}
                    >
                      <ShieldIcon size={15} />
                    </button>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      className="cht-icon-btn cht-icon-btn--danger"
                      onClick={() => removeMember(m)}
                      disabled={busy}
                      title={t('chat.group.removeMember')}
                      aria-label={t('chat.group.removeMember')}
                    >
                      <CloseIcon size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <SharedMedia messages={messages} onOpenImage={onOpenImage} onJump={onJump} />
    </DetailsPanel>
  );
};

export default GroupChat;
