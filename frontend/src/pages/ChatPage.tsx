import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments } from '@fortawesome/free-regular-svg-icons';
import { useToast, useConfirm } from '../contexts/ToastContext';
import {
  ArrowLeftIcon,
  ChatIcon,
  CheckDoubleIcon,
  CheckSmallIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  InboxIcon,
  LinkIcon,
  MoreIcon,
  RefreshIcon,
  SearchIcon,
  TextIcon,
  TrashIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
} from '../components/home/icons';
import { monogram } from '../components/home/monogram';
import { User, Message, FriendRequest, MessageRequest, Chat, MessageAttachment, ChatGroupSummary, GroupUser, ChatPref, VoiceMeta, UploadOptions, UploadAbortedError } from '../utils/api';
import { apiService } from '../utils/api';
import { websocketService, WebSocketMessage } from '../utils/websocket';
import { formatDateTime } from '../utils/dateFormatter';
import { ensureNumericId, isNumericId } from '../utils/idConverter';
import { API_BASE_URL } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import MessageInput from '../components/MessageInput';
import GroupChat, { GroupAvatar } from '../components/chat/GroupChat';
import CreateGroupModal from '../components/chat/CreateGroupModal';
import { groupEventText, groupSenderPrefix, messageBodyPreview } from '../components/chat/groupText';
import ProjectCard from '../components/chat/ProjectCard';
import StoryReplyQuote from '../components/chat/StoryReplyQuote';
import { stickerSrc } from '../components/home/stories/storyUtils';
import ShareProjectModal, { ProjectShare } from '../components/chat/ShareProjectModal';
import {
  useMessageActions,
  ForwardedLabel,
  ReplyQuote,
  ReactionBar,
  MessageMoreButton,
  PinnedBar,
  ContextMenu,
  MenuItem,
} from '../components/chat/MessageActions';
import { PinIcon, ArchiveIcon, BellIcon, BellOffIcon, MailOpenIcon } from '../components/home/icons';
import { AlertIcon, FileIcon, MapPinIcon, MediaKindIcon } from '../components/chat/MediaIcons';
import { FailedBar, UploadOverlay } from '../components/chat/DeliveryState';
import { useDragScroll } from '../components/chat/useDragScroll';
import { ChatsTabIcon, AddFriendTabIcon, RequestsTabIcon, SavedIcon, NewGroupIcon, SideToggleIcon } from '../components/chat/SideIcons';
import {
  ChatKind,
  PollCard,
  SavedAvatar,
  SharedMedia,
  useChatPrefs,
  VoiceMessage,
} from '../components/chat/ChatExtras';
import DetailsPanel from '../components/chat/DetailsPanel';
import Popover, { useLingering } from '../components/chat/Popover';
import {
  usePresence,
  presenceText,
  isNewDay,
  DayDivider,
  useStickToBottom,
  JumpToBottom,
  draftKeyFor,
  loadDraft,
  useDraftVersion,
} from '../components/chat/ChatComfort';
import { FormattedText, stripFormatting } from '../components/chat/formatText';
import './ChatPage.css';

/* Әр чаттың өз адресі: /chat/user/:id, /chat/group/:id, /chat/saved */
type ChatRoute =
  | { kind: 'none' }
  | { kind: 'saved' }
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string };

const parseChatPath = (pathname: string): ChatRoute => {
  const rest = pathname.replace(/^\/chat\/?/, '').replace(/\/+$/, '');
  if (rest === 'saved') return { kind: 'saved' };
  const group = rest.match(/^group\/([^/]+)$/);
  if (group) return { kind: 'group', id: decodeURIComponent(group[1]) };
  const user = rest.match(/^user\/([^/]+)$/);
  if (user) return { kind: 'user', id: decodeURIComponent(user[1]) };
  return { kind: 'none' };
};

const userChatPath = (userId: string) => `/chat/user/${encodeURIComponent(userId)}`;
const groupChatPath = (groupId: string) => `/chat/group/${encodeURIComponent(groupId)}`;

// ---------- Тізім сүзгілері және жиналған тізім ----------

const LIST_FILTER_KEY = 'kh-chat-filter';
const LIST_COLLAPSED_KEY = 'kh-chat-list-collapsed';

type ListFilterKey = 'all' | 'direct' | 'groups' | 'unread' | 'archived';

type ListEntry =
  | { kind: 'dm'; time: string; unread: number; pref: ChatPref; chat: Chat }
  | { kind: 'group'; time: string; unread: number; pref: ChatPref; group: ChatGroupSummary };

/** Жаңа сүзгі — осы тізімге бір жол қосу жеткілікті. Мұрағаттағы чаттар тек «Мұрағат» сүзгісінде */
const LIST_FILTERS: { key: ListFilterKey; labelKey: string; match: (e: ListEntry) => boolean }[] = [
  { key: 'all', labelKey: 'chat.filters.all', match: (e) => !e.pref.archived },
  { key: 'direct', labelKey: 'chat.filters.direct', match: (e) => e.kind === 'dm' && !e.pref.archived },
  { key: 'groups', labelKey: 'chat.filters.groups', match: (e) => e.kind === 'group' && !e.pref.archived },
  { key: 'unread', labelKey: 'chat.filters.unread', match: (e) => e.unread > 0 && !e.pref.archived },
  { key: 'archived', labelKey: 'chat.filters.archived', match: (e) => e.pref.archived },
];

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage қолжетімсіз — елемеу
  }
}

/** Тізімдегі өз соңғы хабарламаның күйі: оқылмаған ✓, оқылды ✓✓ */
const ListStatusTick: React.FC<{ status?: Message['status'] }> = ({ status }) => (
  <span className={`cht-item__tick ${status === 'read' ? 'is-read' : ''}`}>
    {status === 'read' ? <CheckDoubleIcon size={15} /> : <CheckSmallIcon size={15} />}
  </span>
);

/** Тізімдегі чат атауының жанындағы белгілер: дыбысы өшірілген, бекітілген */
const ListFlags: React.FC<{ pref: ChatPref }> = ({ pref }) => {
  const { t } = useTranslation();
  if (!pref.muted && !pref.pinnedAt) return null;
  return (
    <span className="cht-item__flags">
      {pref.muted && (
        <span title={t('chat.list.muted')} aria-label={t('chat.list.muted')}>
          <BellOffIcon size={12} />
        </span>
      )}
      {pref.pinnedAt && (
        <span title={t('chat.list.pinned')} aria-label={t('chat.list.pinned')}>
          <PinIcon size={12} />
        </span>
      )}
    </span>
  );
};

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Сүзгілер жолағын компьютерде тінтуірмен сүйреп айналдыру
  const filtersRef = useDragScroll<HTMLDivElement>();
  const { i18n, t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  // Топтық чаттар: тізім, ашық топ және «Жаңа топ» терезесі
  const [groups, setGroups] = useState<ChatGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  // Жеке чатта жоба бөлісу терезесі
  const [showShareProject, setShowShareProject] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'friends' | 'add' | 'requests'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FriendRequest[]>([]);
  // Бейтаныстан келген, әлі қабылданбаған хабарламалар (профилім «жабық» болса)
  const [messageRequests, setMessageRequests] = useState<MessageRequest[]>([]);
  const [searching, setSearching] = useState(false);
  const [friendsSearchQuery, setFriendsSearchQuery] = useState('');
  const [listFilter, setListFilter] = useState<ListFilterKey>(() => readStored(LIST_FILTER_KEY, 'all') as ListFilterKey);
  const [listCollapsed, setListCollapsed] = useState(() => readStored(LIST_COLLAPSED_KEY, '0') === '1');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  // Достық сұрау батырмаларының күйі: 'send:<userId>', 'accept:<id>', 'reject:<id>', 'cancel:<id>'
  const [requestStatus, setRequestStatus] = useState<Record<string, 'loading' | 'error'>>({});
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showChatProfileModal, setShowChatProfileModal] = useState(false);
  const [chatDisplayNames, setChatDisplayNames] = useState<Record<string, string>>({});
  const [editingFriendId, setEditingFriendId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<string>('');
  const [showProfileNameMenu, setShowProfileNameMenu] = useState(false);
  const profileNameBtnRef = useRef<HTMLButtonElement>(null);
  const [selectedImage, setSelectedImage] = useState<{ url: string; filename: string } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Чаттар тізіміндегі мәзір: бекіту, дыбысын өшіру, мұрағаттау, оқылды деп белгілеу
  const [listMenu, setListMenu] = useState<{ x: number; y: number; kind: ChatKind; id: string; unread: number } | null>(null);
  const chatPrefs = useChatPrefs(!!currentUser?.id);
  // Жабылу анимациясы ойнауы үшін мәзірлердің соңғы күйі сақталады
  const [shownListMenu, listMenuOpen] = useLingering(listMenu);
  const [shownImageMenu, imageMenuOpen] = useLingering(imageContextMenu);
  // «Сақталған хабарламалар» — өзіммен чат
  const isSavedChat = !!selectedFriend && selectedFriend.id === currentUser?.id;

  // Чатта көрсетілетін атын localStorage-тан жүктеу
  useEffect(() => {
    if (selectedFriend?.id && currentUser?.id) {
      const displayNameKey = `chat_display_name_${currentUser.id}_${selectedFriend.id}`;
      const savedName = localStorage.getItem(displayNameKey);
      if (savedName) {
        setChatDisplayNames(prev => ({ ...prev, [selectedFriend.id]: savedName }));
      } else {
        // Егер сақталған аты жоқ болса, түпнұсқа атын қолдану
        setChatDisplayNames(prev => {
          const updated = { ...prev };
          if (!updated[selectedFriend.id]) {
            updated[selectedFriend.id] = selectedFriend.username;
          }
          return updated;
        });
      }
    }
  }, [selectedFriend?.id, selectedFriend?.username, currentUser?.id]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadChatsRef = useRef<(() => Promise<void>) | null>(null);
  // Ашық тұрған чат — тізімде оған «оқылмаған» санауышы көрсетілмейді
  const openChatRef = useRef<{ friendId?: string; groupId?: string | null }>({});
  openChatRef.current = { friendId: selectedFriend?.id, groupId: selectedGroupId };
  const chatMenuBtnRef = useRef<HTMLButtonElement>(null);
  const closeChatMenu = useCallback(() => setShowChatMenu(false), []);
  const closeProfileNameMenu = useCallback(() => setShowProfileNameMenu(false), []);
  const closeImageMenu = useCallback(() => setImageContextMenu(null), []);

  // Хабарлама әрекеттері: жауап, өңдеу, жою, бағыттау, бекіту, реакциялар
  const msgActions = useMessageActions({
    currentUserId: currentUser?.id || '',
    chatKey: selectedFriend?.id || '',
    canDeleteForAll: (m) => m.fromUserId === currentUser?.id,
    canPin: true,
    senderName: () => (selectedFriend ? chatDisplayNames[selectedFriend.id] || selectedFriend.username : ''),
    containerRef: messagesContainerRef,
    onLocalUpdate: (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x))),
    onLocalRemove: (id) => {
      setMessages((prev) => prev.filter((x) => x.id !== id));
      loadChatsRef.current?.();
    },
  });
  const forgetMessageRef = useRef(msgActions.forgetMessage);
  forgetMessageRef.current = msgActions.forgetMessage;

  // Онлайн күйі (тізімдегі достар + ашық чат), «төменге түсу» және черновиктер
  const presence = usePresence([...chats.map((c) => c.partnerId), selectedFriend?.id || '']);
  const stick = useStickToBottom(messagesContainerRef, messages, currentUser?.id || '', selectedFriend?.id || '');
  useDraftVersion();

  const scrollToBottom = useCallback((instant: boolean = false) => {
    if (instant) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      messagesContainerRef.current?.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'auto'
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const loadCurrentUser = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        let userData;
        try {
          userData = JSON.parse(storedUser);
        } catch {
          localStorage.removeItem('user');
          navigate('/login');
          return;
        }
        // Verify user exists in backend using stored email and id
        try {
          const verifiedUser = await apiService.getCurrentUser(userData.email, userData.id);
          setCurrentUser(verifiedUser);
        } catch (err: any) {
          // Only redirect to login on a genuine "user not found" (HTTP 404).
          // Transient errors (401, network, timeout, server down) must NOT
          // log the user out — fall back to the cached user so the chat keeps
          // working and the session isn't destroyed by a temporary blip.
          const status = err?.status;
          const msg = String(err?.message || '');
          const isUserGone =
            status === 404 ||
            /not found|табылмады|ne найден/i.test(msg);
          if (isUserGone) {
            console.warn('User no longer exists in backend, redirecting to login');
            localStorage.removeItem('user');
            navigate('/login');
            return;
          }
          // Transient failure — keep the stored user and continue.
          console.warn('getCurrentUser transient failure, using cached user:', err);
          setCurrentUser(userData);
        }
      } else {
        // No stored user - redirect to login
        navigate('/login');
      }
    } catch (err) {
      console.error('Failed to load current user:', err);
      navigate('/login');
    }
  };

  const connectWebSocket = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      await websocketService.connect(currentUser.id);
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [currentUser?.id]);

  const loadChats = useCallback(async () => {
    if (!currentUser?.id) return;
    // Ашық чатқа келген хабарламаны қолданушы көріп отыр: «оқылды» сұрауы серверге жеткенше
    // тізім санауышы жыпылықтамасын. Басқа қойындыда отырса — санауыш шыға берсін
    const isOpen = (kind: 'friendId' | 'groupId', id: string) =>
      document.visibilityState === 'visible' && openChatRef.current[kind] === id;
    apiService.getGroups().then(
      (list) => setGroups(list.map((g) => (g.unreadCount && isOpen('groupId', g.id) ? { ...g, unreadCount: 0 } : g))),
      (err) => console.error('Failed to load groups:', err),
    );
    try {
      const chatsList = await apiService.getChats(currentUser.id);
      setChats(chatsList.map((c) => (c.unreadCount && isOpen('friendId', c.partnerId) ? { ...c, unreadCount: 0 } : c)));
    } catch (err) {
      console.error('Failed to load chats:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  // Store loadChats in ref for use in other callbacks
  useEffect(() => {
    loadChatsRef.current = loadChats;
  }, [loadChats]);

  const loadFriendRequests = useCallback(async () => {
    if (!currentUser?.id) {
      setFriendRequests([]);
      setOutgoingFriendRequests([]);
      return;
    }
    try {
      const [incoming, outgoing] = await Promise.all([
        apiService.getIncomingFriendRequests(currentUser.id),
        apiService.getOutgoingFriendRequests(currentUser.id)
      ]);
      setFriendRequests(incoming || []);
      setOutgoingFriendRequests(outgoing || []);
      apiService.getMessageRequests().then(setMessageRequests, () => {});
    } catch (err) {
      console.error('Failed to load friend requests:', err);
      // If error, clear requests
      setFriendRequests([]);
      setOutgoingFriendRequests([]);
    }
  }, [currentUser?.id]);

  const loadIncomingRequestCount = useCallback(async () => {
    if (!currentUser?.id) {
      return;
    }
    try {
      await apiService.getIncomingFriendRequestCount(currentUser.id);
    } catch (err) {
      console.error('Failed to load incoming request count:', err);
    }
  }, [currentUser?.id]);

  const loadMessages = useCallback(async () => {
    if (!currentUser?.id || !selectedFriend?.id) {
      setMessages([]);
      setMessagesError(null);
      setLoadingMessages(false);
      return;
    }
    
    setLoadingMessages(true);
    setMessagesError(null);
    
    try {
      const conversationMessages = await apiService.getConversation(
        currentUser.id,
        selectedFriend.id
      );
      
      if (!Array.isArray(conversationMessages)) {
        console.error('loadMessages: API returned non-array response:', conversationMessages);
        setMessages([]);
        setMessagesError(t('chat.apiInvalidResponse'));
        setLoadingMessages(false);
        return;
      }
      
      setMessages(conversationMessages);
      setMessagesError(null);
      // Scroll to bottom instantly when loading messages
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      console.error('Failed to load messages:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        response: err.response
      });
      const errorMessage = err.message || t('chat.loadMessagesError');
      setMessagesError(errorMessage);
      // Set empty messages array on error to show "no messages" state
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [currentUser?.id, selectedFriend?.id]);

  const markConversationRead = useCallback(async () => {
    if (!currentUser?.id || !selectedFriend?.id) return;
    try {
      await apiService.markConversationRead(currentUser.id, selectedFriend.id);
      // Refresh chats to update unread count using ref to avoid dependency issues
      if (loadChatsRef.current) {
        loadChatsRef.current();
      }
    } catch (err) {
      console.error('Failed to mark conversation as read:', err);
    }
  }, [currentUser?.id, selectedFriend?.id]);

  // Load current user once the access token has been restored (page reload)
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadCurrentUser();
  }, [authLoading, isAuthenticated]);

  // Connect WebSocket when user is loaded
  useEffect(() => {
    if (!currentUser?.id) return;
    
    connectWebSocket();
    loadChats();
    loadFriendRequests();
    loadIncomingRequestCount();
    
    return () => {
      websocketService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Setup WebSocket listeners
  useEffect(() => {
    if (!currentUser?.id) return;

    const handleNewMessage = (data: WebSocketMessage) => {
      if (data.message) {
        const message = data.message as Message;
        // Add message if it's for current conversation
        if (selectedFriend && 
            ((message.fromUserId === selectedFriend.id && message.toUserId === currentUser.id) ||
             (message.fromUserId === currentUser.id && message.toUserId === selectedFriend.id))) {
          setMessages(prev => {
            // Check if message already exists
            if (prev.some(m => m.id === message.id)) {
              return prev;
            }
            // Өз хабарламам («Сақталған»): жергілікті көшірмесін API жауабы ауыстырады
            if (
              message.fromUserId === currentUser.id &&
              prev.some(m => m.localState === 'sending' && m.type === message.type && (m.content || '') === (message.content || ''))
            ) {
              return prev;
            }
            return [...prev, message];
          });
          // Чат ашық әрі бет көрініп тұрса — досымның жаңа хабарламасы бірден оқылды
          if (
            message.fromUserId === selectedFriend.id &&
            message.fromUserId !== currentUser.id &&
            document.visibilityState === 'visible'
          ) {
            markConversationRead();
          }
        }

        // Update chats list
        loadChats();
      }
    };

    // Тізімдегі соңғы хабарламаның ✓✓ белгісі де бірден жаңарсын
    const markLastRead = (match: (chat: Chat) => boolean) =>
      setChats((prev) =>
        prev.map((chat) =>
          chat.lastMessage && chat.lastMessage.status !== 'read' && match(chat)
            ? { ...chat, lastMessage: { ...chat.lastMessage, status: 'read' } }
            : chat,
        ),
      );

    const handleMessageRead = (data: WebSocketMessage) => {
      if (data.messageId) markLastRead((chat) => chat.lastMessage?.id === data.messageId);
      if (data.messageId && selectedFriend) {
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, read: true, status: 'read', readAt: data.readAt }
            : msg
        ));
      }
    };

    const handleMessagesRead = (data: WebSocketMessage) => {
      if (data.userId) markLastRead((chat) => chat.partnerId === data.userId && chat.lastMessage?.fromUserId === currentUser.id);
      if (selectedFriend && data.userId === selectedFriend.id) {
        setMessages(prev => prev.map(msg => 
          msg.fromUserId === currentUser.id && msg.toUserId === selectedFriend.id
            ? { ...msg, read: true, status: 'read' }
            : msg
        ));
      }
    };

    const handleTyping = (data: WebSocketMessage) => {
      if (data.userId && data.userId === selectedFriend?.id) {
        if (data.isTyping) {
          setTypingUsers(prev => new Set(prev).add(data.userId!));
        } else {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.userId!);
            return newSet;
          });
        }
      }
    };

    const handleGroupActivity = () => {
      loadChatsRef.current?.();
    };
    const handleGroupRemoved = (data: WebSocketMessage) => {
      setGroups((prev) => prev.filter((g) => g.id !== data.groupId));
      setSelectedGroupId((current) => (current === data.groupId ? null : current));
    };

    websocketService.on('group_message', handleGroupActivity);
    websocketService.on('group_updated', handleGroupActivity);
    websocketService.on('group_removed', handleGroupRemoved);
    websocketService.on('new_message', handleNewMessage);
    websocketService.on('message_read', handleMessageRead);
    websocketService.on('messages_read', handleMessagesRead);
    websocketService.on('typing', handleTyping);

    const handleMessageUpdated = (data: WebSocketMessage) => {
      const updated = data.message as Message | undefined;
      if (!updated) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
    };
    const handleMessageDeleted = (data: WebSocketMessage) => {
      if (!data.messageId) return;
      setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
      forgetMessageRef.current(data.messageId);
      loadChatsRef.current?.();
    };
    websocketService.on('message_updated', handleMessageUpdated);
    websocketService.on('message_deleted', handleMessageDeleted);

    return () => {
      websocketService.off('message_updated', handleMessageUpdated);
      websocketService.off('message_deleted', handleMessageDeleted);
      websocketService.off('group_message', handleGroupActivity);
      websocketService.off('group_updated', handleGroupActivity);
      websocketService.off('group_removed', handleGroupRemoved);
      websocketService.off('new_message', handleNewMessage);
      websocketService.off('message_read', handleMessageRead);
      websocketService.off('messages_read', handleMessagesRead);
      websocketService.off('typing', handleTyping);
    };
  }, [currentUser?.id, selectedFriend?.id]);

  // Load chats periodically
  useEffect(() => {
    if (!currentUser?.id) return;
    
    if (activeTab === 'friends') {
      // Use Page Visibility API to pause polling when tab is hidden
      let interval: NodeJS.Timeout | null = null;
      
      const startPolling = () => {
        if (document.visibilityState === 'visible') {
          interval = setInterval(loadChats, 5000);
        }
      };
      
      const stopPolling = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      };
      
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          // Reload immediately when tab becomes visible
          loadChats();
          startPolling();
        } else {
          stopPolling();
        }
      };
      
      // Load immediately and start polling if tab is visible
      if (document.visibilityState === 'visible') {
        loadChats();
        startPolling();
      }
      
      // Listen for visibility changes
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        stopPolling();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [currentUser?.id, activeTab, loadChats]);

  // Хабарлама сұраулары: бейтаныс жазды → тізімді жаңарту; менің сұрауымды қабылдады → белгіні алу
  useEffect(() => {
    const onRequest = () => { loadFriendRequests(); };
    const onAccepted = (data: WebSocketMessage) => {
      setMessages((prev) => prev.map((m) => (m.request && m.toUserId === data.userId ? { ...m, request: undefined } : m)));
      loadChatsRef.current?.();
    };
    websocketService.on('message_request', onRequest);
    websocketService.on('message_request_accepted', onAccepted);
    return () => {
      websocketService.off('message_request', onRequest);
      websocketService.off('message_request_accepted', onAccepted);
    };
  }, [loadFriendRequests]);

  // Load friend requests periodically - always load to show count on button
  useEffect(() => {
    if (!currentUser?.id) return;
    
    // Always load friend requests initially to show count on button
    loadFriendRequests();
    
    if (activeTab === 'requests') {
      loadIncomingRequestCount();
      loadChats(); // Also reload chats to check if any requests were accepted
      
      // Use Page Visibility API to pause polling when tab is hidden
      let interval: NodeJS.Timeout | null = null;
      
      const startPolling = () => {
        if (document.visibilityState === 'visible') {
          interval = setInterval(() => {
            loadFriendRequests();
            loadIncomingRequestCount();
            loadChats(); // Check if any requests were accepted
          }, 5000);
        }
      };
      
      const stopPolling = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      };
      
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          // Reload immediately when tab becomes visible
          loadFriendRequests();
          loadIncomingRequestCount();
          loadChats();
          startPolling();
        } else {
          stopPolling();
        }
      };
      
      // Start polling if tab is visible
      if (document.visibilityState === 'visible') {
        startPolling();
      }
      
      // Listen for visibility changes
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        stopPolling();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      // When not on requests tab, still poll friend requests less frequently to keep count updated
      let interval: NodeJS.Timeout | null = null;
      
      const startPolling = () => {
        if (document.visibilityState === 'visible') {
          interval = setInterval(() => {
            loadFriendRequests();
          }, 10000); // Poll every 10 seconds when tab is not active
        }
      };
      
      const stopPolling = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      };
      
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          loadFriendRequests();
          startPolling();
        } else {
          stopPolling();
        }
      };
      
      if (document.visibilityState === 'visible') {
        startPolling();
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        stopPolling();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [currentUser?.id, activeTab, loadFriendRequests, loadIncomingRequestCount, loadChats]);

  // Load messages when friend is selected
  useEffect(() => {
    if (currentUser?.id && selectedFriend?.id) {
      setMessagesError(null); // Clear any previous errors
      loadMessages();
      markConversationRead();
      // Scroll to bottom immediately when entering conversation
      setTimeout(() => scrollToBottom(true), 100);
    } else {
      // Clear messages when no friend is selected
      setMessages([]);
      setMessagesError(null);
      setLoadingMessages(false);
    }
  }, [currentUser?.id, selectedFriend?.id, loadMessages, markConversationRead]);

  // Басқа қойындыдан оралғанда ашық чаттағы жаңа хабарламалар оқылды болсын
  useEffect(() => {
    if (!currentUser?.id || (!selectedFriend?.id && !selectedGroupId)) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (selectedFriend?.id) markConversationRead();
      else if (selectedGroupId) apiService.markGroupRead(selectedGroupId).then(() => loadChatsRef.current?.(), () => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [currentUser?.id, selectedFriend?.id, selectedGroupId, markConversationRead]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Use instant scroll for initial load, smooth for new messages
      const isInitialLoad = messages.length === 1 || !messagesContainerRef.current?.scrollTop;
      scrollToBottom(isInitialLoad);
    }
  }, [messages, scrollToBottom]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  /* ---------- Серверге әлі жетпеген хабарламалар ----------
     Хабарлама бірден тізімге «жіберіліп жатыр» күйінде қосылады; сервер жауап бергенде
     нағызымен ауыстырылады, қате болса — «жіберілмеді» (қайталау / жою). */
  const pendingRef = useRef(new Map<string, { retry: () => void; abort: () => void; previewUrl?: string }>());

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      pending.forEach((p) => {
        p.abort();
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      pending.clear();
    };
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const forgetLocal = (localId: string) => {
    const p = pendingRef.current.get(localId);
    if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
    pendingRef.current.delete(localId);
  };

  const sendLocal = (
    draft: Pick<Message, 'type' | 'content' | 'attachments' | 'metadata' | 'uploadProgress'>,
    send: (opts: UploadOptions) => Promise<Message>,
    previewUrl?: string,
  ) => {
    if (!currentUser || !selectedFriend) return;
    const localId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const isUpload = draft.uploadProgress !== undefined;
    setMessages((prev) => [
      ...prev,
      {
        ...draft,
        id: localId,
        fromUserId: currentUser.id,
        toUserId: selectedFriend.id,
        createdAt: new Date().toISOString(),
        read: false,
        localState: 'sending',
      },
    ]);
    scrollToBottom();

    let controller: AbortController | null = null;
    const attempt = () => {
      controller = new AbortController();
      patchMessage(localId, { localState: 'sending', localError: undefined, ...(isUpload ? { uploadProgress: 0 } : {}) });
      send({ signal: controller.signal, onProgress: (ratio) => patchMessage(localId, { uploadProgress: ratio }) })
        .then((sent) => {
          // Сервердегі нұсқа (url, id, күйі) жергілікті көшірменің орнына келеді
          setMessages((prev) =>
            prev.some((m) => m.id === sent.id) ? prev.filter((m) => m.id !== localId) : prev.map((m) => (m.id === localId ? sent : m)),
          );
          forgetLocal(localId);
          if (websocketService.isConnected()) websocketService.markDelivered(sent.id);
          loadChats();
        })
        .catch((err: unknown) => {
          if (err instanceof UploadAbortedError) return;
          console.error('Failed to send message:', err);
          const message = err instanceof Error && err.message ? err.message : t('chat.sendMessageError');
          patchMessage(localId, { localState: 'failed', localError: message });
        });
    };
    pendingRef.current.set(localId, { retry: attempt, abort: () => controller?.abort(), previewUrl });
    attempt();
  };

  const retryLocal = (localId: string) => pendingRef.current.get(localId)?.retry();

  /** Жүктеуді тоқтату не жіберілмеген хабарламаны жою */
  const discardLocal = (localId: string) => {
    pendingRef.current.get(localId)?.abort();
    forgetLocal(localId);
    setMessages((prev) => prev.filter((m) => m.id !== localId));
  };

  /** Дауыстық хабарламаны алушы алғаш тыңдағанда — жіберушіге «тыңдалды» */
  const markVoiceListened = (message: Message) => {
    // Топ хабарламасы GroupChat күйінде — оны group_message_updated жаңартады
    if (!message.groupId) patchMessage(message.id, { listenedAt: new Date().toISOString() });
    apiService.markListened(message.id, message.groupId).catch((err) => console.error('Failed to mark voice as listened:', err));
  };

  const handleSendMessage = async (
    content: string,
    type: string = 'text',
    attachments?: MessageAttachment[],
    metadata?: any
  ) => {
    if (!currentUser || !selectedFriend) return;

    // Clear typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    websocketService.sendTyping(selectedFriend.id, false);

    // Өңдеу режимі: жаңа хабарлама емес, бұрынғысы өзгереді
    if (type === 'text' && msgActions.submitEdit(content)) return;

    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    const fromId = currentUser.id;
    const toId = selectedFriend.id;
    sendLocal(
      { type: type as Message['type'], content, attachments: attachments || [], metadata: metadata || {} },
      () => apiService.sendMessage(fromId, toId, content, type, attachments, metadata, replyToId),
    );
  };

  const handleShareProject = async (share: ProjectShare, comment: string) => {
    if (!currentUser || !selectedFriend) return;
    const sentMessage = await apiService.sendMessage(
      currentUser.id,
      selectedFriend.id,
      comment,
      'project',
      undefined,
      { ...share }
    );
    setMessages(prev => (prev.some(m => m.id === sentMessage.id) ? prev : [...prev, sentMessage]));
    scrollToBottom();
    loadChats();
  };

  const handleCreatePoll = async (poll: { question: string; options: string[]; multiple: boolean }) => {
    if (!currentUser || !selectedFriend) return;
    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    const sentMessage = await apiService.sendMessage(
      currentUser.id,
      selectedFriend.id,
      poll.question,
      'poll',
      undefined,
      poll,
      replyToId
    );
    setMessages(prev => (prev.some(m => m.id === sentMessage.id) ? prev : [...prev, sentMessage]));
    scrollToBottom();
    loadChats();
  };

  const handleUploadFile = async (
    file: File,
    type: string,
    content?: string,
    metadata?: any
  ) => {
    if (!currentUser || !selectedFriend) return;

    const replyToId = msgActions.replyTo?.id;
    msgActions.clearReply();
    const fromId = currentUser.id;
    const toId = selectedFriend.id;
    // Жүктеліп жатқанда-ақ көрсету үшін файлдың жергілікті көшірмесі
    const previewUrl = URL.createObjectURL(file);
    sendLocal(
      {
        type: type as Message['type'],
        content: content || '',
        attachments: [{ filename: file.name, url: previewUrl, size: file.size, mimeType: file.type }],
        metadata: metadata || {},
        uploadProgress: 0,
      },
      (opts) =>
        apiService.uploadFile(file, fromId, toId, type as 'image' | 'audio' | 'video' | 'file', content, metadata, replyToId, opts),
      previewUrl,
    );
  };


  const handleSearchUsers = async (query: string) => {
    if (!currentUser) {
      setSearchResults([]);
      return;
    }
    
    const trimmedQuery = query.trim();
    
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    
    if (trimmedQuery.length < 1) {
      return;
    }
    
    try {
      setSearching(true);
      
      // Егер сұрау тек сандардан тұрса (ID), тікелей пайдаланушыны табуға тырысу
      let results: User[] = [];
      
      if (isNumericId(trimmedQuery)) {
        // ID арқылы тікелей іздеу
        try {
          // ID-ны 12 цифрға дейін форматтау (егер қысқа болса)
          let numericId = trimmedQuery;
          if (numericId.length < 12) {
            numericId = numericId.padStart(12, '0');
          }
          
          const user = await apiService.getUserProfile(numericId);
          
          // Егер пайдаланушы табылса және бұл ағымдағы пайдаланушы емес
          if (user && user.id !== currentUser.id) {
            // Дос емес екенін тексеру
            const friendIds = new Set(chats.map(chat => chat.partnerId));
            if (!friendIds.has(user.id)) {
              results = [user];
            }
          }
        } catch (err: any) {
          // Егер ID арқылы табылмаса (404), тихо өңдеу - бұл қалыпты жағдай
          // 404 қатесін консольге шығармау, тек нәтижелерді тазалау
          const is404 = err.message?.includes('404') || 
                       err.message?.includes('табылмады') || 
                       err.message?.includes('not found') ||
                       err.message?.includes('User not found');
          
          if (!is404) {
            // Басқа қателер үшін консольге шығару
            console.error('Failed to search user by ID:', err);
          } else {
            console.log('User not found by ID, trying general search');
          }
          
          // ID арқылы табылмаса, жалпы іздеуге өту
          // Бұл жерде return қалдырмаймыз, өйткені жалпы іздеуге өту керек
        }
      }
      
      // Егер ID арқылы табылмаса немесе сұрау ID емес болса, жалпы іздеу
      if (results.length === 0) {
        results = await apiService.searchUsers(trimmedQuery);
      }
      
      // Filter out current user and existing friends
      const friendIds = new Set(chats.map(chat => chat.partnerId));
      let filtered = results.filter(
        user => user.id !== currentUser.id && !friendIds.has(user.id)
      );

      // Use search results directly — the API should already return valid users
      // (Removed N+1 per-user verification that was causing excessive API calls)

      setSearchResults(filtered);
    } catch (err: any) {
      console.error('Failed to search users:', err);
      // Show error message to user
      const errorMsg = err.message || t('chat.searchError');
      if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('NetworkError')) {
        console.error('Search error:', errorMsg);
      }
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Нәтиже toast болып емес, батырманың өзінде көрінеді: жүктелу → (сәтті болса тізім жаңарады) / қате
  const runRequestAction = async (key: string, action: () => Promise<void>) => {
    setRequestStatus((prev) => ({ ...prev, [key]: 'loading' }));
    const clear = () =>
      setRequestStatus((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    try {
      await action();
      clear();
    } catch (err) {
      console.error(`Friend request action failed (${key}):`, err);
      setRequestStatus((prev) => ({ ...prev, [key]: 'error' }));
      setTimeout(clear, 3000);
    }
  };

  const handleSendFriendRequest = (toUserId: string) => {
    if (!currentUser) return;
    return runRequestAction(`send:${toUserId}`, async () => {
      try {
        await apiService.sendFriendRequest(currentUser.id, toUserId);
      } catch (err: any) {
        const errorMsg: string = err?.message || '';
        // Сұрау бұрыннан бар не дос болып қойған — қате емес, тізімді жаңарту жеткілікті
        if (!/already exists|уже существует|Already friends/.test(errorMsg)) throw err;
      }
      await Promise.all([loadFriendRequests(), loadIncomingRequestCount(), loadChats()]);
    });
  };

  const handleAcceptRequest = (requestId: string) =>
    runRequestAction(`accept:${requestId}`, async () => {
      await apiService.acceptFriendRequest(requestId);
      await Promise.all([loadFriendRequests(), loadIncomingRequestCount(), loadChats()]);
    });

  const handleRejectRequest = (requestId: string) =>
    runRequestAction(`reject:${requestId}`, async () => {
      await apiService.rejectFriendRequest(requestId);
      await Promise.all([loadFriendRequests(), loadIncomingRequestCount()]);
    });

  const handleCancelRequest = (requestId: string) => {
    if (!currentUser) return;
    return runRequestAction(`cancel:${requestId}`, async () => {
      await apiService.cancelFriendRequest(requestId, currentUser.id);
      await Promise.all([loadFriendRequests(), loadIncomingRequestCount()]);
    });
  };

  // Хабарлама сұрауы: қабылдау — чат ашылады; бас тарту — хабарламалары өшеді
  const handleAcceptMessageRequest = (req: MessageRequest) =>
    runRequestAction(`maccept:${req.user.id}`, async () => {
      await apiService.acceptMessageRequest(req.user.id);
      setMessageRequests((prev) => prev.filter((r) => r.user.id !== req.user.id));
      await loadChats();
      setActiveTab('friends');
      openDirectChat({ id: req.user.id, username: req.user.username, avatar: req.user.avatar ?? undefined } as User);
    });

  const handleDeclineMessageRequest = (req: MessageRequest) =>
    runRequestAction(`mdecline:${req.user.id}`, async () => {
      await apiService.declineMessageRequest(req.user.id);
      setMessageRequests((prev) => prev.filter((r) => r.user.id !== req.user.id));
    });

  // Сұрау батырмасының белгішесі мен класы оның күйіне қарай
  const requestBtn = (key: string, icon: React.ReactNode) => {
    const status = requestStatus[key];
    return {
      className: status ? `is-${status}` : '',
      disabled: status === 'loading',
      content: status === 'loading'
        ? <span className="cht-btn-spinner" aria-hidden="true" />
        : status === 'error'
          ? <span className="cht-btn-error" aria-hidden="true">!</span>
          : icon,
      errorTitle: status === 'error' ? t('chat.requestFailed') : undefined,
    };
  };

  const handleClearMessages = async () => {
    if (!currentUser || !selectedFriend) return;
    if (await confirm({ title: t('chat.clearMessagesConfirm'), confirmText: t('chat.clearMessagesInChat'), danger: true })) {
      try {
        await apiService.clearConversation(currentUser.id, selectedFriend.id);
        setMessages([]);
        setShowChatMenu(false);
        await loadChats();
      } catch (err: any) {
        console.error('Failed to clear messages:', err);
        toast.error(err.message || t('chat.clearMessagesError'));
      }
    }
  };

  const handleDeleteChat = async () => {
    if (!currentUser || !selectedFriend) return;
    if (await confirm({ title: t('chat.deleteChatConfirm'), confirmText: t('chat.deleteChat'), danger: true })) {
      try {
        // Дос алып тастау - бұл дос тізімінен де жойады
        await apiService.removeFriend(currentUser.id, selectedFriend.id);
        
        // Чат тізімін жаңарту - дос тізімінен жойылғандықтан, чат тізімінен де жойылады
        await loadChats();
        
        // Ағымдағы чатті жабу
        setSelectedFriend(null);
        setMessages([]);
        setShowChatMenu(false);
        
        toast.success(t('chat.chatDeleted'));
      } catch (err) {
        console.error('Failed to delete chat:', err);
        toast.error(t('chat.deleteChatError'));
      }
    }
  };

  const handleSearchMessages = () => {
    setShowMessageSearch(true);
    setShowChatMenu(false);
  };

  const toggleMessageSearch = () => {
    if (!showMessageSearch) {
      handleSearchMessages();
      return;
    }
    setShowMessageSearch(false);
    setMessageSearchQuery('');
  };

  const filteredMessages = messageSearchQuery
    ? messages.filter(msg => 
        msg.content.toLowerCase().includes(messageSearchQuery.toLowerCase())
      )
    : messages;

  const handleSaveDisplayName = () => {
    if (!currentUser || !selectedFriend) return;
    const displayNameKey = `chat_display_name_${currentUser.id}_${selectedFriend.id}`;
    const nameToSave = editDisplayName.trim() || selectedFriend.username;
    localStorage.setItem(displayNameKey, nameToSave);
    setChatDisplayNames(prev => ({ ...prev, [selectedFriend.id]: nameToSave }));
    setEditingFriendId(null);
    setEditDisplayName('');
  };

  const getFullUrl = (url: string) => {
    if (url.startsWith('http')) return url;
    if (url.startsWith('/api')) return `${API_BASE_URL.replace('/api', '')}${url}`;
    return `${API_BASE_URL.replace('/api', '')}/api${url}`;
  };

  const handleDownloadImage = async (url: string, filename: string) => {
    // Helper function to clean filename while preserving extension
    const cleanFilename = (name: string) => {
      // Extract extension
      const extensionMatch = name.match(/\.([^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : 'png';
      const baseName = name.replace(/\.[^/.]+$/, '').replace(/[<>:"/\\|?*]/g, '_').trim() || 'image';
      return `${baseName}.${extension}`;
    };
    
    const cleanName = cleanFilename(filename);
    const fullUrl = getFullUrl(url);
    
    // Helper function to trigger download
    const triggerDownload = (blob: Blob, downloadFilename: string) => {
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadFilename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(blobUrl);
      }, 200);
    };
    
    // Helper function for direct download fallback
    const directDownload = () => {
      const link = document.createElement('a');
      link.href = fullUrl;
      link.download = cleanName;
      link.target = '_blank';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
      }, 200);
    };
    
    try {
      // Method 1: Try fetch API first (most reliable and preserves original format)
      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit'
        });
        
        if (response.ok) {
          const blob = await response.blob();
          triggerDownload(blob, cleanName);
          return;
        }
      } catch (fetchError) {
        console.log('Fetch method failed, trying canvas method...', fetchError);
      }
      
      // Method 2: Canvas approach (for CORS-restricted images)
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              throw new Error('Could not get canvas context');
            }
            
            ctx.drawImage(img, 0, 0);
            
            // Determine MIME type from filename extension
            const extension = cleanName.split('.').pop()?.toLowerCase() || 'png';
            const mimeType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' :
                            extension === 'png' ? 'image/png' :
                            extension === 'webp' ? 'image/webp' :
                            extension === 'gif' ? 'image/gif' : 'image/png';
            
            canvas.toBlob((blob) => {
              if (!blob) {
                // If canvas fails, try direct download
                directDownload();
                resolve();
                return;
              }
              
              triggerDownload(blob, cleanName);
              resolve();
            }, mimeType);
          } catch (error: any) {
            console.error('Canvas method failed:', error);
            directDownload();
            resolve();
          }
        };
        
        img.onerror = () => {
          // If CORS fails, try direct download link
          console.log('Image load failed, trying direct download...');
          directDownload();
          resolve();
        };
        
        img.src = fullUrl;
      });
    } catch (error: any) {
      console.error('Failed to download image:', error);
      // Final fallback: try direct link
      try {
        directDownload();
      } catch (fallbackError) {
        toast.error(t('chat.imageUploadError'));
      }
    }
  };

  const getMessageStatusIcon = (message: Message) => {
    if (message.status === 'read') {
      return <span className="message-status read"><CheckDoubleIcon size={14} /></span>;
    } else if (message.status === 'delivered') {
      return <span className="message-status delivered"><CheckSmallIcon size={14} /></span>;
    } else {
      return <span className="message-status sent"><CheckSmallIcon size={14} /></span>;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    // Today: exact HH:MM; older: full date with time
    if (date.toDateString() === new Date().toDateString()) {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    return formatDateTime(dateString, i18n.language);
  };

  const renderMessageContent = (message: Message) => {
    const messageType = message.type || 'text';
    
    // Helper to get full URL
    const getFullUrl = (url: string) => {
      if (url.startsWith('http') || url.startsWith('blob:')) return url;
      // If URL already starts with /api, use API_BASE_URL directly
      // Browser will automatically encode special characters in the URL
      if (url.startsWith('/api')) return `${API_BASE_URL.replace('/api', '')}${url}`;
      // Otherwise, assume it's relative to /api/uploads
      return `${API_BASE_URL.replace('/api', '')}/api${url}`;
    };

    // Helper to check if URL is an image
    const isImageUrl = (url: string) => {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
      const lowerUrl = url.toLowerCase();
      return imageExtensions.some(ext => lowerUrl.includes(ext)) || lowerUrl.includes('/images/');
    };

    switch (messageType) {
      case 'image':
        if (message.attachments && message.attachments.length > 0) {
          return (
            <div className="chat-message-content has-image">
              <div className="chat-message-media">
                {message.attachments.map((att, idx) => {
                  const imageUrl = getFullUrl(att.url);
                  return (
                    <img
                      key={idx}
                      src={imageUrl}
                      alt={att.filename}
                      className="chat-message-image"
                      onClick={() => {
                        setSelectedImage({ url: imageUrl, filename: att.filename });
                      }}
                      loading="lazy"
                    />
                  );
                })}
                {message.content && (
                  <div className="chat-message-text"><FormattedText text={message.content} /></div>
                )}
              </div>
            </div>
          );
        }
        break;

      case 'video':
        if (message.attachments && message.attachments.length > 0) {
          return (
            <div className="chat-message-content has-video">
              <div className="chat-message-media">
                {message.attachments.map((att, idx) => (
                  <div key={idx} className="chat-message-video-wrapper">
                    <video
                      src={getFullUrl(att.url)}
                      controls
                      className="chat-message-video"
                    />
                  </div>
                ))}
                {message.content && (
                  <div className="chat-message-text"><FormattedText text={message.content} /></div>
                )}
              </div>
            </div>
          );
        }
        break;

      case 'audio':
        if (message.attachments && message.attachments.length > 0) {
          return (
            <div className="chat-message-content has-audio">
              <div className="chat-message-media">
                {message.attachments.map((att, idx) => (
                  <VoiceMessage
                    key={idx}
                    url={att.url}
                    meta={message.metadata as Partial<VoiceMeta>}
                    filename={att.filename}
                    unheard={!!message.metadata?.voice && !message.listenedAt && !message.localState && !isSavedChat}
                    onPlayed={
                      !message.listenedAt &&
                      (message.groupId
                        ? message.fromUserId !== currentUser?.id
                        : message.toUserId === currentUser?.id && !isSavedChat)
                        ? () => markVoiceListened(message)
                        : undefined
                    }
                  />
                ))}
                {message.content && (
                  <div className="chat-message-text"><FormattedText text={message.content} /></div>
                )}
              </div>
            </div>
          );
        }
        break;

      case 'file':
        if (message.attachments && message.attachments.length > 0) {
          return (
            <div className="chat-message-content">
              <div className="chat-message-media">
                {message.attachments.map((att, idx) => (
                  <a
                    key={idx}
                    href={getFullUrl(att.url)}
                    download={att.filename}
                    className="chat-message-file"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="chat-message-file-icon"><FileIcon size={18} /></span>
                    <div className="chat-message-file-info">
                      <div className="chat-message-file-name">{att.filename}</div>
                      <div className="chat-message-file-size">
                        {(att.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </a>
                ))}
                {message.content && (
                  <div className="chat-message-text"><FormattedText text={message.content} /></div>
                )}
              </div>
            </div>
          );
        }
        break;

      case 'location':
        if (message.metadata?.latitude && message.metadata?.longitude) {
          const { latitude, longitude, address } = message.metadata;
          const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=15`;
          
          return (
            <div className="chat-message-content">
              <div className="chat-message-location">
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chat-location-link"
                >
                  <span className="chat-location-icon"><MapPinIcon size={18} /></span>
                  <div className="chat-location-info">
                    <div className="chat-location-address">
                      {address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
                    </div>
                    <div className="chat-location-coords">
                      {latitude.toFixed(6)}, {longitude.toFixed(6)}
                    </div>
                  </div>
                </a>
                {message.content && (
                  <div className="chat-message-text"><FormattedText text={message.content} /></div>
                )}
              </div>
            </div>
          );
        }
        break;

      case 'emoji':
        return (
          <div className="chat-message-content">
            <div className="chat-message-emoji">
              {message.metadata?.emoji || message.content}
            </div>
          </div>
        );

      case 'project':
        return <ProjectCard message={message} currentUserId={currentUser?.id} />;

      case 'poll':
        return <PollCard message={message} currentUserId={currentUser?.id || ''} />;

      case 'sticker':
        return (
          <div className="chat-message-content">
            <div className="chat-message-sticker">
              {message.metadata?.stickerId && stickerSrc(message.metadata.stickerId) ? (
                <img className="chat-sticker-img" src={stickerSrc(message.metadata.stickerId) as string} alt="" draggable={false} />
              ) : message.metadata?.stickerId ? (
                <div className="sticker-placeholder">
                  Sticker: {message.metadata.stickerId}
                </div>
              ) : (
                message.content
              )}
            </div>
          </div>
        );

      default:
        // Check if message has attachments that are images
        if (message.attachments && message.attachments.length > 0) {
          const imageAttachments = message.attachments.filter(att => isImageUrl(att.url));
          if (imageAttachments.length > 0) {
            return (
              <div className="chat-message-content has-image">
                <div className="chat-message-media">
                  {imageAttachments.map((att, idx) => {
                    const imageUrl = getFullUrl(att.url);
                    return (
                      <img
                        key={idx}
                        src={imageUrl}
                        alt={att.filename}
                        className="chat-message-image"
                        onClick={() => {
                          setSelectedImage({ url: imageUrl, filename: att.filename });
                        }}
                        loading="lazy"
                      />
                    );
                  })}
                  {message.content && (
                    <div className="chat-message-text"><FormattedText text={message.content} /></div>
                  )}
                </div>
              </div>
            );
          }
        }
        // Check if content contains image URL
        if (message.content && isImageUrl(message.content)) {
          const imageUrl = getFullUrl(message.content);
          return (
            <div className="chat-message-content has-image">
              <div className="chat-message-media">
                <img
                  src={imageUrl}
                  alt="Image"
                  className="chat-message-image"
                  onClick={() => {
                    setSelectedImage({ url: imageUrl, filename: 'image' });
                  }}
                  loading="lazy"
                />
              </div>
            </div>
          );
        }
        return <span className="chat-message-text-content"><FormattedText text={message.content || ''} /></span>;
    }

    // Fallback to text
    return <span className="chat-message-text-content"><FormattedText text={message.content || ''} /></span>;
  };

  const listQuery = friendsSearchQuery.toLowerCase().trim();
  const savedTitle = t('chat.saved.title');
  // «Сақталған хабарламалар» әлі жазылмаса да тізімде тұрады
  const chatsWithSaved: Chat[] =
    currentUser && !chats.some((c) => c.partnerId === currentUser.id)
      ? [...chats, { partnerId: currentUser.id, partner: currentUser, lastMessage: null as unknown as Message, unreadCount: 0, lastMessageTime: '' }]
      : chats;
  const filteredChats = chatsWithSaved.filter((chat) =>
    chat.partnerId === currentUser?.id
      ? savedTitle.toLowerCase().includes(listQuery)
      : chat.partner.username.toLowerCase().includes(listQuery) ||
        (chat.partner.email || '').toLowerCase().includes(listQuery)
  );
  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(listQuery));

  // Жеке чаттар мен топтар бір тізімде: алдымен бекітілгендер (соңғы бекітілгені жоғарыда),
  // сосын соңғы белсенділік бойынша; хабарламасыз достар соңында
  const byTime = (a: ListEntry, b: ListEntry) =>
    a.time === b.time ? 0 : !a.time ? 1 : !b.time ? -1 : a.time < b.time ? 1 : -1;
  const allEntries: ListEntry[] = [
    ...filteredGroups.map((group) => ({
      kind: 'group' as const,
      time: group.lastMessageTime || '',
      unread: group.unreadCount || 0,
      pref: chatPrefs.prefOf('group', group.id),
      group,
    })),
    ...filteredChats.map((chat) => ({
      kind: 'dm' as const,
      time: chat.lastMessage ? chat.lastMessageTime || '' : '',
      unread: chat.unreadCount || 0,
      pref: chatPrefs.prefOf('dm', chat.partnerId),
      chat,
    })),
  ].sort((a, b) => {
    const pa = a.pref.pinnedAt || '';
    const pb = b.pref.pinnedAt || '';
    if (pa || pb) return pa === pb ? 0 : !pa ? 1 : !pb ? -1 : pa < pb ? 1 : -1;
    return byTime(a, b);
  });
  const archivedCount = allEntries.filter((e) => e.pref.archived).length;
  // «Мұрағат» сүзгісі тек мұрағатта чат болса көрінеді
  const visibleFilters = LIST_FILTERS.filter((f) => f.key !== 'archived' || archivedCount > 0 || listFilter === 'archived');
  const activeFilter = LIST_FILTERS.find((f) => f.key === listFilter) ?? LIST_FILTERS[0];
  const listEntries = allEntries.filter(activeFilter.match);
  const filterCounts = Object.fromEntries(
    LIST_FILTERS.map((f) => [
      f.key,
      f.key === 'unread' ? allEntries.filter((e) => f.match(e) && !e.pref.muted).length : f.key === 'archived' ? archivedCount : 0,
    ])
  ) as Record<ListFilterKey, number>;

  const openListMenu = (e: React.MouseEvent, kind: ChatKind, id: string, unread: number) => {
    e.preventDefault();
    setListMenu({ x: e.clientX, y: e.clientY, kind, id, unread });
  };

  const markChatRead = (kind: ChatKind, id: string) => {
    if (!currentUser) return;
    const request = kind === 'dm' ? apiService.markConversationRead(currentUser.id, id) : apiService.markGroupRead(id);
    request.then(() => loadChatsRef.current?.()).catch(() => toast.error(t('chat.actions.failed')));
  };

  /** Чатқа қойылатын белгілер — тізім мәзірінде де, сөйлесу тақырыбындағы мәзірде де бірдей */
  const prefMenuItems = (kind: ChatKind, id: string): MenuItem[] => {
    const pref = chatPrefs.prefOf(kind, id);
    return [
      ...(!pref.archived
        ? [{
            key: 'pin',
            icon: <PinIcon size={16} />,
            label: t(pref.pinnedAt ? 'chat.list.unpin' : 'chat.list.pin'),
            onClick: () => chatPrefs.update(kind, id, { pinned: !pref.pinnedAt }),
          }]
        : []),
      {
        key: 'mute',
        icon: pref.muted ? <BellIcon size={16} /> : <BellOffIcon size={16} />,
        label: t(pref.muted ? 'chat.list.unmute' : 'chat.list.mute'),
        onClick: () => chatPrefs.update(kind, id, { muted: !pref.muted }),
      },
      {
        key: 'archive',
        icon: <ArchiveIcon size={16} />,
        label: t(pref.archived ? 'chat.list.unarchive' : 'chat.list.archive'),
        onClick: () => chatPrefs.update(kind, id, { archived: !pref.archived }),
      },
    ];
  };

  const listMenuItems: MenuItem[] = [];
  if (shownListMenu) {
    const target = shownListMenu;
    const raw: MenuItem[] = [...prefMenuItems(target.kind, target.id)];
    if (target.unread > 0) {
      raw.push({ key: 'read', icon: <MailOpenIcon size={16} />, label: t('chat.list.markRead'), onClick: () => markChatRead(target.kind, target.id) });
    }
    // Таңдалғаннан кейін мәзір жабылады
    raw.forEach((item) =>
      listMenuItems.push(item.separator ? item : { ...item, onClick: () => { setListMenu(null); item.onClick(); } })
    );
  }
  const closeListMenu = useCallback(() => setListMenu(null), []);

  const chooseFilter = (key: ListFilterKey) => {
    setListFilter(key);
    writeStored(LIST_FILTER_KEY, key);
  };

  const toggleListCollapsed = useCallback(() => {
    setListCollapsed((prev) => {
      writeStored(LIST_COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });
    setActiveTab('friends');
  }, []);

  // Топқа адам қосқанда — достар жылдам ұсыныс ретінде
  const friendSuggestions: GroupUser[] = chats.map((c) => ({
    id: c.partner.id,
    username: c.partner.username,
    avatar: c.partner.avatar,
  }));

  const selectDirectChat = (partner: User) => {
    setSelectedGroupId(null);
    setSelectedFriend(partner);
  };

  const selectGroup = (groupId: string) => {
    setSelectedFriend(null);
    setMessages([]);
    setShowChatProfileModal(false);
    setShowMessageSearch(false);
    setSelectedGroupId(groupId);
  };

  const clearSelection = () => {
    setSelectedFriend(null);
    setSelectedGroupId(null);
    setMessages([]);
    setShowChatProfileModal(false);
    setShowMessageSearch(false);
    setMessageSearchQuery('');
  };

  const goTo = (path: string) => {
    if (location.pathname !== path) navigate(path);
  };

  const openDirectChat = (partner: User) => {
    selectDirectChat(partner);
    goTo(partner.id === currentUser?.id ? '/chat/saved' : userChatPath(String(partner.id)));
  };

  const openGroup = (groupId: string) => {
    selectGroup(groupId);
    goTo(groupChatPath(groupId));
  };

  // Адрес → ашық чат (бетті жаңарту, сілтеме, «Артқа/Алға» батырмалары)
  useEffect(() => {
    if (!currentUser) return;
    const route = parseChatPath(location.pathname);
    if (route.kind === 'none') {
      if (selectedFriend || selectedGroupId) clearSelection();
      return;
    }
    if (route.kind === 'group') {
      if (selectedGroupId !== route.id) selectGroup(route.id);
      return;
    }
    if (route.kind === 'saved') {
      if (selectedFriend?.id !== currentUser.id) selectDirectChat(currentUser);
      return;
    }
    if (String(selectedFriend?.id) === route.id) return;
    const known = chats.find((c) => String(c.partner?.id) === route.id)?.partner;
    if (known) {
      selectDirectChat(known);
      return;
    }
    let cancelled = false;
    apiService.getUserProfile(route.id).then(
      (user) => { if (!cancelled) selectDirectChat(user); },
      () => { if (!cancelled) navigate('/chat', { replace: true }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, currentUser?.id]);

  // Чат басқа жолмен жабылса (жойылды, топтан шығарылды) — адрес /chat-қа оралады
  const hadSelectionRef = useRef(false);
  useEffect(() => {
    const has = !!selectedFriend || !!selectedGroupId;
    if (hadSelectionRef.current && !has && parseChatPath(location.pathname).kind !== 'none') {
      navigate('/chat', { replace: true });
    }
    hadSelectionRef.current = has;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFriend, selectedGroupId]);

  const closeGroup = useCallback(() => setSelectedGroupId(null), []);
  const handleGroupRemoved = useCallback(() => {
    setSelectedGroupId(null);
    loadChatsRef.current?.();
  }, []);
  const refreshLists = useCallback(() => {
    loadChatsRef.current?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat || e.code !== 'KeyB') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      e.preventDefault();
      toggleListCollapsed();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleListCollapsed]);

  const handleChatHeaderClick = () => {
    clearSelection();
    goTo('/chat');
  };

  const avatarOf = (user?: { avatar?: string; username?: string } | null) =>
    user?.avatar ? <img src={user.avatar} alt={user.username} /> : <span>{monogram(user?.username || '?')}</span>;

  const tabs: { key: 'friends' | 'add' | 'requests'; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      key: 'friends',
      label: t('chat.group.chatsTab'),
      icon: <ChatsTabIcon size={17} />,
      // Дыбысы өшірілген және мұрағаттағы чаттар жалпы санға кірмейді
      badge: allEntries.reduce((sum, e) => sum + (e.pref.muted || e.pref.archived ? 0 : e.unread), 0),
    },
    { key: 'add', label: t('chat.addTab'), icon: <AddFriendTabIcon size={17} /> },
    { key: 'requests', label: t('chat.requests'), icon: <RequestsTabIcon size={17} />, badge: friendRequests.length + messageRequests.length },
  ];

  // Бүкіл бетті мөлдірден шығармаймыз — қара фон тұман болып көрінбеуі үшін (Home.tsx сияқты)
  return (
    <div className="cht-page">
      <div className={`cht-layout ${selectedFriend || selectedGroupId ? 'has-chat' : ''} ${listCollapsed ? 'is-collapsed' : ''}`}>
        {/* ---------- Сол жақ: достар панелі ---------- */}
        <aside className="cht-side" aria-label={t('chat.title')}>
          <div className="cht-side__head">
            <button
              type="button"
              className="cht-side__badge"
              onClick={handleChatHeaderClick}
              title={t('chat.backToHome')}
              aria-label={t('chat.backToHome')}
            >
              <FontAwesomeIcon icon={faComments} />
            </button>
            <h1 className="cht-side__title">{t('chat.title')}</h1>
            <button
              type="button"
              className={`cht-icon-btn cht-side__saved ${isSavedChat ? 'is-open' : ''}`}
              onClick={() => currentUser && openDirectChat(currentUser)}
              title={t('chat.saved.title')}
              aria-label={t('chat.saved.title')}
            >
              <SavedIcon size={17} />
            </button>
            <button
              type="button"
              className="cht-icon-btn cht-side__collapse"
              onClick={toggleListCollapsed}
              title={`${listCollapsed ? t('chat.layout.expandList') : t('chat.layout.collapseList')} · Ctrl+B`}
              aria-label={listCollapsed ? t('chat.layout.expandList') : t('chat.layout.collapseList')}
              aria-expanded={!listCollapsed}
              aria-keyshortcuts="Control+B"
            >
              <SideToggleIcon />
            </button>
          </div>

          <div className="cht-tabs" role="tablist" aria-label={t('chat.title')}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`cht-tab ${activeTab === tab.key ? 'is-active' : ''}`}
                title={tab.label}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {!!tab.badge && <span className="cht-tab__badge">{tab.badge > 99 ? '99+' : tab.badge}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'friends' && (
            <>
              <div className="cht-toolrow">
                <label className="cht-search">
                  <SearchIcon />
                  <input
                    type="search"
                    placeholder={t('chat.group.searchChats')}
                    value={friendsSearchQuery}
                    onChange={(e) => setFriendsSearchQuery(e.target.value)}
                    aria-label={t('chat.group.searchChats')}
                  />
                </label>
                <button
                  type="button"
                  className="cht-newgroup-btn"
                  onClick={() => setShowCreateGroup(true)}
                  title={t('chat.group.newGroup')}
                  aria-label={t('chat.group.newGroup')}
                >
                  <NewGroupIcon size={17} />
                  <span>{t('chat.group.newGroup')}</span>
                </button>
              </div>

              <div className="cht-filters" role="tablist" aria-label={t('chat.filters.label')} ref={filtersRef}>
                {visibleFilters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={listFilter === f.key}
                    className={`cht-filter ${listFilter === f.key ? 'is-active' : ''}`}
                    onClick={() => chooseFilter(f.key)}
                  >
                    {t(f.labelKey)}
                    {filterCounts[f.key] > 0 && <span className="cht-filter__count">{filterCounts[f.key]}</span>}
                  </button>
                ))}
              </div>

              <div className="cht-list">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="cht-skel">
                      <span />
                      <span />
                    </div>
                  ))
                ) : listEntries.length === 0 ? (
                  <p className="cht-empty">
                    {friendsSearchQuery
                      ? t('chat.friendNotFound')
                      : listFilter !== 'all' && allEntries.length > 0
                        ? t('chat.filters.empty')
                        : t('chat.group.listEmpty')}
                  </p>
                ) : (
                  listEntries.map((entry, i) => {
                    if (entry.kind === 'group') {
                      const group = entry.group;
                      const isActive = selectedGroupId === group.id;
                      return (
                        <div
                          key={`group-${group.id}`}
                          role="button"
                          tabIndex={0}
                          className={`cht-item ${isActive ? 'is-active' : ''} ${group.unreadCount > 0 ? 'has-unread' : ''} ${entry.pref.pinnedAt ? 'is-pinned' : ''}`}
                          style={{ '--d': Math.min(i, 10) } as React.CSSProperties}
                          title={listCollapsed ? group.name : undefined}
                          onClick={() => openGroup(group.id)}
                          onContextMenu={(e) => openListMenu(e, 'group', group.id, group.unreadCount)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openGroup(group.id);
                            }
                          }}
                        >
                          <GroupAvatar name={group.name} />
                          <div className="cht-item__body">
                            <div className="cht-item__top">
                              <span className="cht-item__name">
                                <UsersIcon size={13} />
                                {group.name}
                              </span>
                              <ListFlags pref={entry.pref} />
                              {group.lastMessage && <span className="cht-item__time">{formatTime(group.lastMessage.createdAt)}</span>}
                            </div>
                            <div className="cht-item__bottom">
                              <span className="cht-item__last">
                                {(() => {
                                  const draft = selectedGroupId !== group.id ? loadDraft(draftKeyFor('group', group.id)) : '';
                                  return draft ? (
                                    <>
                                      <span className="cht-item__draft">{t('chat.draft')} </span>
                                      {stripFormatting(draft)}
                                    </>
                                  ) : !group.lastMessage ? null : group.lastMessage.type === 'system' ? (
                                    groupEventText(group.lastMessage, t, currentUser?.id)
                                  ) : (
                                    <>
                                      <span className="cht-item__who">{groupSenderPrefix(group.lastMessage, t, currentUser?.id)}</span>
                                      <MediaKindIcon type={group.lastMessage.type} />
                                      <span className="cht-item__text">{messageBodyPreview(group.lastMessage, t)}</span>
                                    </>
                                  );
                                })()}
                              </span>
                              {group.unreadCount > 0 && (
                                <span className={`cht-unread ${entry.pref.muted ? 'is-muted' : ''}`}>{group.unreadCount > 99 ? '99+' : group.unreadCount}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const chat = entry.chat;
                    const isActive = selectedFriend?.id === chat.partnerId;
                    const last = chat.lastMessage;
                    const isSaved = chat.partnerId === currentUser?.id;
                    const displayName = isSaved ? savedTitle : chatDisplayNames[chat.partnerId] || chat.partner.username;
                    return (
                      <div
                        key={`dm-${chat.partnerId}`}
                        role="button"
                        tabIndex={0}
                        className={`cht-item ${isActive ? 'is-active' : ''} ${chat.unreadCount > 0 ? 'has-unread' : ''} ${entry.pref.pinnedAt ? 'is-pinned' : ''}`}
                        style={{ '--d': Math.min(i, 10) } as React.CSSProperties}
                        title={listCollapsed ? displayName : undefined}
                        onClick={() => chat.partner?.id && openDirectChat(chat.partner)}
                        onContextMenu={(e) => openListMenu(e, 'dm', chat.partnerId, chat.unreadCount)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && chat.partner?.id) {
                            e.preventDefault();
                            openDirectChat(chat.partner);
                          }
                        }}
                      >
                        {isSaved ? (
                          <SavedAvatar />
                        ) : (
                          <button
                            type="button"
                            className={`cht-avatar ${presence[chat.partnerId]?.online ? 'is-online' : ''}`}
                            onClick={(e) => {
                              if (listCollapsed) return;
                              e.stopPropagation();
                              navigate(`/profile/${chat.partner.username}`);
                            }}
                            aria-label={chat.partner.username}
                            tabIndex={-1}
                          >
                            {avatarOf(chat.partner)}
                          </button>
                        )}
                        <div className="cht-item__body">
                          <div className="cht-item__top">
                            <span className="cht-item__name">{displayName}</span>
                            <ListFlags pref={entry.pref} />
                            {last && <span className="cht-item__time">{formatTime(last.createdAt)}</span>}
                          </div>
                          <div className="cht-item__bottom">
                            <span className="cht-item__last">
                              {typingUsers.has(chat.partnerId) ? (
                                <em>{t('chat.typing')}</em>
                              ) : !isActive && loadDraft(draftKeyFor('dm', chat.partnerId)) ? (
                                <>
                                  <span className="cht-item__draft">{t('chat.draft')} </span>
                                  {stripFormatting(loadDraft(draftKeyFor('dm', chat.partnerId)))}
                                </>
                              ) : last ? (
                                <>
                                  {last.fromUserId === currentUser?.id && !isSaved && <ListStatusTick status={last.status} />}
                                  <MediaKindIcon type={last.type} />
                                  <span className="cht-item__text">{messageBodyPreview(last, t)}</span>
                                </>
                              ) : isSaved ? (
                                t('chat.saved.subtitle')
                              ) : null}
                            </span>
                            {chat.unreadCount > 0 && (
                              <span className={`cht-unread ${entry.pref.muted ? 'is-muted' : ''}`}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {activeTab === 'add' && (
            <>
              <label className="cht-search">
                <SearchIcon />
                <input
                  type="search"
                  placeholder={t('chat.searchUsersPlaceholder')}
                  value={searchQuery}
                  aria-label={t('chat.searchUsersPlaceholder')}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchQuery(value);

                    if (searchTimeoutRef.current) {
                      clearTimeout(searchTimeoutRef.current);
                    }

                    if (!value.trim()) {
                      setSearchResults([]);
                      setSearching(false);
                      return;
                    }

                    searchTimeoutRef.current = setTimeout(() => {
                      handleSearchUsers(value);
                    }, 500);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      handleSearchUsers(searchQuery);
                    }
                  }}
                />
              </label>

              <div className="cht-list">
                {!searchQuery ? (
                  <div className="cht-hint">
                    <span className="cht-hint__icon">
                      <UserPlusIcon size={20} />
                    </span>
                    <p>{t('chat.addFriendInfo')}</p>
                  </div>
                ) : searching ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="cht-skel">
                      <span />
                      <span />
                    </div>
                  ))
                ) : searchResults.length === 0 ? (
                  <p className="cht-empty">{t('chat.userNotFound')}</p>
                ) : (
                  searchResults.map((user, i) => {
                    const isFriend = chats.some((chat) => chat.partnerId === user.id);
                    const incomingRequest = friendRequests.find((req) => req.fromUserId === user.id);
                    const outgoingRequest = outgoingFriendRequests.find((req) => req.toUserId === user.id);
                    const sendKey = `send:${user.id}`;
                    const sendStatus = requestStatus[sendKey];
                    return (
                      <div key={user.id} className="cht-item is-static" style={{ '--d': i } as React.CSSProperties}>
                        <span className="cht-avatar">{avatarOf(user)}</span>
                        <div className="cht-item__body">
                          <span className="cht-item__name">{user.username}</span>
                          <span className="cht-item__last">
                            {user.email} · ID {ensureNumericId(user.id)}
                          </span>
                        </div>
                        {isFriend ? (
                          <span className="cht-chip">
                            <CheckSmallIcon size={14} />
                            {t('chat.friend')}
                          </span>
                        ) : incomingRequest ? (
                          <div className="cht-item__actions">
                            {(() => {
                              const b = requestBtn(`accept:${incomingRequest.id}`, <CheckSmallIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn cht-icon-btn--primary ${b.className}`}
                                  onClick={() => handleAcceptRequest(incomingRequest.id)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.acceptTitle')}
                                  aria-label={t('chat.acceptTitle')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                            {(() => {
                              const b = requestBtn(`reject:${incomingRequest.id}`, <CloseIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn ${b.className}`}
                                  onClick={() => handleRejectRequest(incomingRequest.id)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.rejectTitle')}
                                  aria-label={t('chat.rejectTitle')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                          </div>
                        ) : outgoingRequest ? (
                          <span className="cht-chip cht-chip--sent">
                            <CheckSmallIcon size={14} />
                            {t('chat.requestSentChip')}
                          </span>
                        ) : sendStatus === 'error' ? (
                          <button
                            type="button"
                            className="cht-req-btn is-error"
                            onClick={() => handleSendFriendRequest(user.id)}
                            aria-live="polite"
                          >
                            <span className="cht-btn-error" aria-hidden="true">!</span>
                            {t('chat.requestFailed')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`cht-icon-btn cht-icon-btn--primary ${sendStatus ? `is-${sendStatus}` : ''}`}
                            onClick={() => handleSendFriendRequest(user.id)}
                            disabled={sendStatus === 'loading'}
                            title={t('chat.sendFriendRequestTitle')}
                            aria-label={t('chat.sendFriendRequestTitle')}
                          >
                            {sendStatus === 'loading'
                              ? <span className="cht-btn-spinner" aria-hidden="true" />
                              : <UserPlusIcon size={16} />}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {activeTab === 'requests' && (
            <div className="cht-list">
              {friendRequests.length === 0 && outgoingFriendRequests.length === 0 && messageRequests.length === 0 ? (
                <div className="cht-hint">
                  <span className="cht-hint__icon">
                    <InboxIcon size={20} />
                  </span>
                  <p>{t('chat.noRequests')}</p>
                </div>
              ) : (
                <>
                  {messageRequests.length > 0 && (
                    <>
                      <h2 className="cht-section">{t('chat.messageRequest.title')}</h2>
                      {messageRequests.map((req) => (
                        <div key={req.user.id} className="cht-item is-static">
                          <span className="cht-avatar">{avatarOf({ username: req.user.username, avatar: req.user.avatar ?? undefined })}</span>
                          <div className="cht-item__body">
                            <span className="cht-item__name">{req.user.username}</span>
                            <span className="cht-item__last">
                              {req.lastMessage.metadata?.storyReply ? `${t('chat.storyReply.short')}: ` : ''}
                              {messageBodyPreview(req.lastMessage, t)}
                            </span>
                          </div>
                          {req.count > 1 && <span className="cht-item__count">{req.count}</span>}
                          <div className="cht-item__actions">
                            {(() => {
                              const b = requestBtn(`maccept:${req.user.id}`, <CheckSmallIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn cht-icon-btn--primary ${b.className}`}
                                  onClick={() => handleAcceptMessageRequest(req)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.messageRequest.accept')}
                                  aria-label={t('chat.messageRequest.accept')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                            {(() => {
                              const b = requestBtn(`mdecline:${req.user.id}`, <CloseIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn ${b.className}`}
                                  onClick={() => handleDeclineMessageRequest(req)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.messageRequest.decline')}
                                  aria-label={t('chat.messageRequest.decline')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {friendRequests.length > 0 && (
                    <>
                      <h2 className="cht-section">{t('chat.incomingRequests')}</h2>
                      {friendRequests.map((request) => (
                        <div key={request.id} className="cht-item is-static">
                          <span className="cht-avatar">{avatarOf(request.fromUser)}</span>
                          <div className="cht-item__body">
                            <span className="cht-item__name">{request.fromUser?.username}</span>
                            <span className="cht-item__last">{formatTime(request.createdAt)}</span>
                          </div>
                          <div className="cht-item__actions">
                            {(() => {
                              const b = requestBtn(`accept:${request.id}`, <CheckSmallIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn cht-icon-btn--primary ${b.className}`}
                                  onClick={() => handleAcceptRequest(request.id)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.acceptTitle')}
                                  aria-label={t('chat.acceptTitle')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                            {(() => {
                              const b = requestBtn(`reject:${request.id}`, <CloseIcon size={16} />);
                              return (
                                <button
                                  type="button"
                                  className={`cht-icon-btn ${b.className}`}
                                  onClick={() => handleRejectRequest(request.id)}
                                  disabled={b.disabled}
                                  title={b.errorTitle ?? t('chat.rejectTitle')}
                                  aria-label={t('chat.rejectTitle')}
                                >
                                  {b.content}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {outgoingFriendRequests.length > 0 && (
                    <>
                      <h2 className="cht-section">{t('chat.outgoingRequests')}</h2>
                      {outgoingFriendRequests.map((request) => (
                        <div key={request.id} className="cht-item is-static">
                          <span className="cht-avatar">{avatarOf(request.toUser)}</span>
                          <div className="cht-item__body">
                            <span className="cht-item__name">{request.toUser?.username}</span>
                            <span className="cht-item__last">
                              <ClockIcon size={12} /> {formatTime(request.createdAt)}
                            </span>
                          </div>
                          {(() => {
                            const b = requestBtn(`cancel:${request.id}`, <CloseIcon size={16} />);
                            return (
                              <button
                                type="button"
                                className={`cht-icon-btn ${b.className}`}
                                onClick={() => handleCancelRequest(request.id)}
                                disabled={b.disabled}
                                title={b.errorTitle ?? t('chat.cancelRequest')}
                                aria-label={t('chat.cancelRequest')}
                              >
                                {b.content}
                              </button>
                            );
                          })()}
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </aside>

        {/* ---------- Оң жақ: сөйлесу ---------- */}
        <main className="cht-main">
          {selectedGroupId && currentUser ? (
            <GroupChat
              groupId={selectedGroupId}
              currentUser={currentUser}
              suggestions={friendSuggestions}
              renderMessageContent={renderMessageContent}
              formatTime={formatTime}
              onBack={closeGroup}
              onRemoved={handleGroupRemoved}
              onActivity={refreshLists}
              prefMenuItems={prefMenuItems('group', selectedGroupId)}
              muted={chatPrefs.prefOf('group', selectedGroupId).muted}
              onOpenImage={(url, filename) => setSelectedImage({ url, filename })}
            />
          ) : selectedFriend ? (
            <>
              <div className="cht-conv">
              <header className="cht-bar">
                <button
                  type="button"
                  className="cht-icon-btn cht-bar__back"
                  onClick={handleChatHeaderClick}
                  title={t('common.back')}
                  aria-label={t('common.back')}
                >
                  <ArrowLeftIcon />
                </button>
                <button
                  type="button"
                  className={`cht-bar__who ${showChatProfileModal ? 'is-open' : ''}`}
                  onClick={() => setShowChatProfileModal((v) => !v)}
                  aria-expanded={showChatProfileModal}
                >
                  {isSavedChat ? <SavedAvatar /> : <span className="cht-avatar">{avatarOf(selectedFriend)}</span>}
                  <span className="cht-bar__names">
                    <span className="cht-bar__name">
                      {isSavedChat ? savedTitle : chatDisplayNames[selectedFriend.id] || selectedFriend.username}
                      {chatPrefs.prefOf('dm', selectedFriend.id).muted && (
                        <span className="cht-item__flags" title={t('chat.list.muted')}>
                          <BellOffIcon size={12} />
                        </span>
                      )}
                    </span>
                    {isSavedChat ? (
                      <span className="cht-bar__status">{t('chat.saved.subtitle')}</span>
                    ) : (
                    <span
                      className={`cht-bar__status ${typingUsers.has(selectedFriend.id) ? 'is-typing' : presence[selectedFriend.id]?.online ? 'is-online' : ''}`}
                    >
                      {typingUsers.has(selectedFriend.id)
                        ? t('chat.typing')
                        : presenceText(presence[selectedFriend.id], t, i18n.language) || `@${selectedFriend.username}`}
                    </span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  className={`cht-icon-btn cht-bar__action ${showMessageSearch ? 'is-open' : ''}`}
                  onClick={toggleMessageSearch}
                  title={t('chat.searchMessagesInChat')}
                  aria-label={t('chat.searchMessagesInChat')}
                  aria-pressed={showMessageSearch}
                >
                  <SearchIcon />
                </button>
                <div className="cht-menu">
                  <button
                    ref={chatMenuBtnRef}
                    type="button"
                    className={`cht-icon-btn cht-bar__action ${showChatMenu ? 'is-open' : ''}`}
                    onClick={() => setShowChatMenu(!showChatMenu)}
                    title={t('chat.menuTitle')}
                    aria-label={t('chat.menuTitle')}
                    aria-haspopup="menu"
                    aria-expanded={showChatMenu}
                  >
                    <MoreIcon />
                  </button>
                  <Popover open={showChatMenu} anchor={chatMenuBtnRef} onClose={closeChatMenu} placement="bottom-end" ariaLabel={t('chat.menuTitle')}>
                      <button type="button" role="menuitem" className="cht-menu__item" onClick={handleSearchMessages}>
                        <SearchIcon />
                        <span>{t('chat.searchMessagesInChat')}</span>
                      </button>
                      {prefMenuItems('dm', selectedFriend.id).map((item) =>
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
                        )
                      )}
                      <div className="cht-menu__sep" role="separator" />
                      <button type="button" role="menuitem" className="cht-menu__item" onClick={handleClearMessages}>
                        <TrashIcon size={16} />
                        <span>{t('chat.clearMessagesInChat')}</span>
                      </button>
                      {!isSavedChat && (
                        <>
                          <div className="cht-menu__sep" role="separator" />
                          <button type="button" role="menuitem" className="cht-menu__item is-danger" onClick={handleDeleteChat}>
                            <TrashIcon size={16} />
                            <span>{t('chat.deleteChat')}</span>
                          </button>
                        </>
                      )}
                  </Popover>
                </div>
              </header>

              {showMessageSearch && (
                <div className="cht-msgsearch">
                  <label className="cht-search">
                    <SearchIcon />
                    <input
                      type="search"
                      placeholder={t('chat.searchMessagesPlaceholder')}
                      value={messageSearchQuery}
                      onChange={(e) => setMessageSearchQuery(e.target.value)}
                      aria-label={t('chat.searchMessagesPlaceholder')}
                      autoFocus
                    />
                  </label>
                  {messageSearchQuery && (
                    <span className="cht-msgsearch__count">{t('chat.messagesFound', { count: filteredMessages.length })}</span>
                  )}
                  <button
                    type="button"
                    className="cht-icon-btn"
                    onClick={() => {
                      setShowMessageSearch(false);
                      setMessageSearchQuery('');
                    }}
                    aria-label={t('common.close')}
                  >
                    <CloseIcon size={16} />
                  </button>
                </div>
              )}

              <PinnedBar
                messages={messages}
                onJump={msgActions.jumpTo}
                onUnpin={(m) => {
                  apiService
                    .pinMessage(m.id, false)
                    .then((u) => setMessages((prev) => prev.map((x) => (x.id === u.id ? u : x))))
                    .catch(() => toast.error(t('chat.actions.failed')));
                }}
              />

              <div className="cht-messages" ref={messagesContainerRef}>
                {loadingMessages ? (
                  <div className="cht-state">
                    <span className="cht-state__icon is-pulsing">
                      <ChatIcon size={22} />
                    </span>
                    <p className="cht-state__text">{t('chat.messagesLoading')}</p>
                  </div>
                ) : messagesError ? (
                  <div className="cht-state">
                    <span className="cht-state__icon">
                      <ChatIcon size={22} />
                    </span>
                    <p className="cht-state__text">{t('chat.errorWithMessage', { message: messagesError })}</p>
                    <button type="button" className="cht-btn cht-btn--primary" onClick={() => loadMessages()}>
                      <RefreshIcon />
                      {t('common.retry')}
                    </button>
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="cht-state">
                    <span className="cht-state__icon">
                      <ChatIcon size={22} />
                    </span>
                    <p className="cht-state__title">{isSavedChat ? t('chat.saved.title') : t('chat.noMessages')}</p>
                    <p className="cht-state__text">{isSavedChat ? t('chat.saved.empty') : t('chat.sendFirstMessage')}</p>
                  </div>
                ) : (
                  filteredMessages.map((message, index) => {
                    const isOwn = message.fromUserId === currentUser?.id;
                    // Бір адамның қатарынан келген хабарламалары топталады
                    const next = filteredMessages[index + 1];
                    const isLastInGroup = !next || next.fromUserId !== message.fromUserId || isNewDay(next, message);
                    // Серверге әлі жетпеген хабарламаға мәзір, реакция қолжетімсіз
                    const isLocal = !!message.localState;
                    const isUploading = message.localState === 'sending' && message.uploadProgress !== undefined;
                    return (
                      <React.Fragment key={message.id}>
                      {isNewDay(message, filteredMessages[index - 1]) && <DayDivider date={message.createdAt} />}
                      <div
                        className={`chat-message ${isOwn ? 'own' : 'other'} ${message.type || 'text'} ${isLastInGroup ? 'is-last' : ''} ${message.localState ? `is-${message.localState}` : ''} ${isUploading ? 'is-uploading' : ''}`}
                        {...(isLocal ? {} : msgActions.bind(message))}
                      >
                        {message.forwardedFrom && <ForwardedLabel from={message.forwardedFrom} />}
                        {message.replyTo && (
                          <ReplyQuote reply={message.replyTo} currentUserId={currentUser?.id || ''} onJump={msgActions.jumpTo} />
                        )}
                        {message.metadata?.storyReply && <StoryReplyQuote reply={message.metadata.storyReply} isOwn={isOwn} />}
                        {message.metadata?.storyShare && <StoryReplyQuote reply={message.metadata.storyShare} isOwn={isOwn} kind="share" />}
                        {renderMessageContent(message)}
                        {isUploading && <UploadOverlay progress={message.uploadProgress || 0} onCancel={() => discardLocal(message.id)} />}
                        {/* Реакциялар — сол жақта мәтіннің астында, уақыт — сол қатардың оң жағында */}
                        <div className="chat-message-bottom">
                        {!isLocal && (
                          <ReactionBar
                            reactions={message.reactions}
                            currentUserId={currentUser?.id || ''}
                            onToggle={(emoji) => msgActions.react(message, emoji)}
                          />
                        )}
                        <div className="chat-message-footer">
                          {message.pinned && (
                            <span className="chat-message-pin" title={t('chat.actions.pinned')}>
                              <PinIcon size={11} />
                            </span>
                          )}
                          {message.editedAt && <span className="chat-message-edited">{t('chat.actions.edited')}</span>}
                          <span className="chat-message-time">{formatTime(message.createdAt)}</span>
                          {isOwn && (
                            <span className="chat-message-status">
                              {message.localState === 'sending' ? (
                                <span className="message-status sending" title={t('chat.delivery.sending')}><ClockIcon size={13} /></span>
                              ) : message.localState === 'failed' ? (
                                <span className="message-status failed" title={t('chat.delivery.failed')}><AlertIcon size={13} /></span>
                              ) : (
                                getMessageStatusIcon(message)
                              )}
                            </span>
                          )}
                        </div>
                        </div>
                        {!isLocal && <MessageMoreButton onOpen={(x, y) => msgActions.openMenu(x, y, message)} />}
                      </div>
                      {message.localState === 'failed' && (
                        <FailedBar error={message.localError} onRetry={() => retryLocal(message.id)} onDiscard={() => discardLocal(message.id)} />
                      )}
                      </React.Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
                <div className="cht-jump-anchor">
                  <JumpToBottom visible={stick.showButton} count={stick.newCount} onClick={() => stick.scrollToBottom(true)} />
                </div>
              </div>

              {!isSavedChat && messages.some((m) => m.request && m.fromUserId === currentUser?.id) && (
                <div className="cht-request-note" role="status">
                  <ClockIcon size={14} />
                  {t('chat.messageRequest.pending', { name: selectedFriend.username })}
                </div>
              )}
              <MessageInput
                key={selectedFriend.id}
                draftKey={draftKeyFor('dm', selectedFriend.id)}
                onSendMessage={handleSendMessage}
                onUploadFile={handleUploadFile}
                disabled={!selectedFriend}
                onTyping={isSavedChat ? undefined : (isTyping) => websocketService.sendTyping(selectedFriend.id, isTyping)}
                onShareProject={() => setShowShareProject(true)}
                onCreatePoll={handleCreatePoll}
                {...msgActions.inputProps}
              />
              {msgActions.overlays}
              </div>

              {showChatProfileModal && currentUser && (
                <DetailsPanel title={isSavedChat ? savedTitle : t('chat.chatProfile')} onClose={() => setShowChatProfileModal(false)}>
              {isSavedChat ? (
                <div className="cht-profile">
                  <SavedAvatar className="cht-avatar--xl" size={34} />
                  <p className="cht-profile__desc">{t('chat.saved.empty')}</p>
                </div>
              ) : (
              <>
              <div className="cht-profile">
                <span className="cht-avatar cht-avatar--xl">{avatarOf(selectedFriend)}</span>
                {editingFriendId === selectedFriend.id ? (
                  <div className="cht-profile__edit">
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder={selectedFriend.username}
                      aria-label={t('chat.editDisplayName')}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveDisplayName();
                        } else if (e.key === 'Escape') {
                          setEditingFriendId(null);
                          setEditDisplayName('');
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="cht-icon-btn cht-icon-btn--primary"
                      onClick={handleSaveDisplayName}
                      title={t('chat.saveTitle')}
                      aria-label={t('chat.saveTitle')}
                    >
                      <CheckSmallIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="cht-icon-btn"
                      onClick={() => {
                        setEditingFriendId(null);
                        setEditDisplayName('');
                      }}
                      title={t('chat.cancelTitle')}
                      aria-label={t('chat.cancelTitle')}
                    >
                      <CloseIcon size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="cht-profile__name">
                    <h3>{chatDisplayNames[selectedFriend.id] || selectedFriend.username}</h3>
                    <div className="cht-menu">
                      <button
                        ref={profileNameBtnRef}
                        type="button"
                        className={`cht-icon-btn ${showProfileNameMenu ? 'is-open' : ''}`}
                        onClick={() => setShowProfileNameMenu(!showProfileNameMenu)}
                        title={t('chat.menuTitle')}
                        aria-label={t('chat.menuTitle')}
                        aria-haspopup="menu"
                        aria-expanded={showProfileNameMenu}
                      >
                        <MoreIcon />
                      </button>
                      <Popover
                        open={showProfileNameMenu}
                        anchor={profileNameBtnRef}
                        onClose={closeProfileNameMenu}
                        placement="bottom-end"
                        ariaLabel={t('chat.menuTitle')}
                      >
                          <button
                            type="button"
                            role="menuitem"
                            className="cht-menu__item"
                            onClick={() => {
                              setEditingFriendId(selectedFriend.id);
                              setEditDisplayName(chatDisplayNames[selectedFriend.id] || selectedFriend.username);
                            }}
                          >
                            <EditIcon size={16} />
                            <span>{t('chat.editDisplayName')}</span>
                          </button>
                      </Popover>
                    </div>
                  </div>
                )}
              </div>

              <div className="cht-info">
                <div className="cht-info__row">
                  <span className="cht-info__icon">
                    <UserIcon size={16} />
                  </span>
                  <div>
                    <div className="cht-info__label">{t('chat.username')}</div>
                    <div className="cht-info__value">{selectedFriend.username}</div>
                  </div>
                </div>
                {selectedFriend.bio && (
                  <div className="cht-info__row">
                    <span className="cht-info__icon">
                      <TextIcon size={16} />
                    </span>
                    <div>
                      <div className="cht-info__label">{t('chat.bio')}</div>
                      <div className="cht-info__value">{selectedFriend.bio}</div>
                    </div>
                  </div>
                )}
              </div>

              </>
              )}

              <SharedMedia
                messages={messages}
                onOpenImage={(url, filename) => setSelectedImage({ url, filename })}
                onJump={msgActions.jumpTo}
              />
                </DetailsPanel>
              )}
            </>
          ) : (
            <div className="cht-state cht-state--welcome">
              <span className="cht-state__icon cht-state__icon--lg">
                <ChatIcon size={28} />
              </span>
              <p className="cht-state__title">{t('chat.selectFriend')}</p>
              <p className="cht-state__text">{t('chat.selectFriendHint')}</p>
              <div className="cht-row-actions">
                <button type="button" className="cht-btn cht-btn--primary" onClick={() => setShowCreateGroup(true)}>
                  <UsersIcon size={16} />
                  {t('chat.group.newGroup')}
                </button>
                <button type="button" className="cht-btn cht-btn--ghost" onClick={() => setActiveTab('add')}>
                  <UserPlusIcon size={16} />
                  {t('chat.addFriend')}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {shownListMenu && <ContextMenu state={shownListMenu} open={listMenuOpen} items={listMenuItems} onClose={closeListMenu} />}

      {showShareProject && currentUser && selectedFriend && (
        <ShareProjectModal
          username={currentUser.username}
          onClose={() => setShowShareProject(false)}
          onShare={handleShareProject}
        />
      )}

      {showCreateGroup && currentUser && (
        <CreateGroupModal
          currentUserId={currentUser.id}
          suggestions={friendSuggestions}
          onClose={() => setShowCreateGroup(false)}
          onCreated={(group) => {
            setShowCreateGroup(false);
            setActiveTab('friends');
            loadChats();
            openGroup(group.id);
          }}
        />
      )}

      {/* ---------- Сурет қарау ---------- */}
      {selectedImage && (
        <div
          className="cht-viewer"
          onClick={() => {
            setSelectedImage(null);
            setImageContextMenu(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setImageContextMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div className="cht-viewer__bar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="cht-btn cht-btn--primary"
              onClick={() => handleDownloadImage(selectedImage.url, selectedImage.filename)}
            >
              <DownloadIcon size={16} />
              {t('common.save')}
            </button>
            <button
              type="button"
              className="cht-icon-btn cht-icon-btn--glass"
              onClick={() => {
                setSelectedImage(null);
                setImageContextMenu(null);
              }}
              aria-label={t('common.close')}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <img
            src={selectedImage.url}
            alt={selectedImage.filename}
            className="cht-viewer__img"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setImageContextMenu({ x: e.clientX, y: e.clientY });
            }}
          />
        </div>
      )}
      {selectedImage && shownImageMenu && (
        <Popover open={imageMenuOpen} anchor={shownImageMenu} onClose={closeImageMenu} placement="bottom-start" ariaLabel={t('chat.saveImage')}>
          <button
            type="button"
            role="menuitem"
            className="cht-menu__item"
            onClick={() => handleDownloadImage(selectedImage.url, selectedImage.filename)}
          >
            <DownloadIcon size={16} />
            <span>{t('chat.saveImage')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="cht-menu__item"
            onClick={() => {
              navigator.clipboard
                .writeText(selectedImage.url)
                .then(() => toast.success(t('chat.imageLinkCopied')))
                .catch(() => toast.error(t('chat.copyError')));
            }}
          >
            <LinkIcon size={16} />
            <span>{t('chat.copyLink')}</span>
          </button>
        </Popover>
      )}
    </div>
  );
};

export default ChatPage;
