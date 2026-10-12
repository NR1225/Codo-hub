import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faComment, faSearch, faTimes, faUserPlus, 
  faClock, faCheck, faCheckDouble, faCheckCircle,
  faFile, faMapMarkerAlt, faEllipsisVertical, faTrash, faSearch as faSearchIcon,
  faUser, faEdit, faVideo, faMusic, faDownload, faAlignLeft, faChevronLeft
} from '@fortawesome/free-solid-svg-icons';
import { User, Message, FriendRequest, Chat, MessageAttachment } from '../utils/api';
import { apiService } from '../utils/api';
import { websocketService, WebSocketMessage } from '../utils/websocket';
import { formatDateTime } from '../utils/dateFormatter';
import { ensureNumericId, isNumericId } from '../utils/idConverter';
import { API_BASE_URL } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import MessageInput from '../components/MessageInput';
import '../components/Chat.css';

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
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
  const [searching, setSearching] = useState(false);
  const [friendsSearchQuery, setFriendsSearchQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [clickedAddButtons, setClickedAddButtons] = useState<Set<string>>(new Set());
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showChatProfileModal, setShowChatProfileModal] = useState(false);
  const [chatDisplayNames, setChatDisplayNames] = useState<Record<string, string>>({});
  const [editingFriendId, setEditingFriendId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<string>('');
  const [showProfileNameMenu, setShowProfileNameMenu] = useState(false);
  const profileNameMenuRef = useRef<HTMLDivElement>(null);
  const [selectedImage, setSelectedImage] = useState<{ url: string; filename: string } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number } | null>(null);

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
  const menuRef = useRef<HTMLDivElement>(null);

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
          // If user not found, clear localStorage and redirect to login
          console.error('Failed to verify user:', err);
          localStorage.removeItem('user');
          navigate('/login');
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
    try {
      const chatsList = await apiService.getChats(currentUser.id);
      setChats(chatsList);
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
            return [...prev, message];
          });
          scrollToBottom();
        }
        
        // Update chats list
        loadChats();
      }
    };

    const handleMessageRead = (data: WebSocketMessage) => {
      if (data.messageId && selectedFriend) {
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId 
            ? { ...msg, read: true, status: 'read', readAt: data.readAt }
            : msg
        ));
      }
    };

    const handleMessagesRead = (data: WebSocketMessage) => {
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

    websocketService.on('new_message', handleNewMessage);
    websocketService.on('message_read', handleMessageRead);
    websocketService.on('messages_read', handleMessagesRead);
    websocketService.on('typing', handleTyping);

    return () => {
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

    try {
      const sentMessage = await apiService.sendMessage(
        currentUser.id,
        selectedFriend.id,
        content,
        type,
        attachments,
        metadata
      );
      
      // Add message to list immediately
      setMessages(prev => [...prev, sentMessage]);
      scrollToBottom();
      
      // Mark as delivered if recipient is online
      if (websocketService.isConnected()) {
        websocketService.markDelivered(sentMessage.id);
      }
      
      // Reload chats to update last message
      loadChats();
    } catch (err: any) {
      console.error('Failed to send message:', err);
      alert(err.message || t('chat.sendMessageError'));
    }
  };

  const handleUploadFile = async (
    file: File,
    type: string,
    content?: string,
    metadata?: any
  ) => {
    if (!currentUser || !selectedFriend) return;

    try {
      const sentMessage = await apiService.uploadFile(
        file,
        currentUser.id,
        selectedFriend.id,
        type as 'image' | 'audio' | 'video' | 'file',
        content,
        metadata
      );
      
      // Add message to list immediately
      setMessages(prev => [...prev, sentMessage]);
      scrollToBottom();
      
      // Mark as delivered if recipient is online
      if (websocketService.isConnected()) {
        websocketService.markDelivered(sentMessage.id);
      }
      
      // Reload chats to update last message
      loadChats();
    } catch (err: any) {
      console.error('Failed to upload file:', err);
      let errorMessage = err.message || t('chat.uploadFileError');
      
      // Translate common error messages
      if (errorMessage.includes('You can only message friends') || errorMessage.includes('Тек достарға')) {
        errorMessage = t('chat.messageFriendsOnlyFull');
      } else if (errorMessage.includes('403')) {
        errorMessage = t('chat.messageForbiddenFull');
      }
      
      alert(errorMessage);
    }
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

  const handleSendFriendRequest = async (toUserId: string) => {
    if (!currentUser) return;
    // Батырма басылғанын белгілеу
    setClickedAddButtons(prev => new Set(prev).add(toUserId));
    try {
      await apiService.sendFriendRequest(currentUser.id, toUserId);
      await loadIncomingRequestCount();
      await loadChats();
      alert(t('chat.friendRequestSent'));
    } catch (err: any) {
      console.error('Failed to send friend request:', err);
      const errorMsg = err.message || t('chat.sendMessageError');
      if (errorMsg.includes('already exists') || errorMsg.includes('уже существует')) {
        alert(t('chat.friendRequestAlreadySent'));
      } else if (errorMsg.includes('Already friends')) {
        await loadChats();
        alert(t('chat.alreadyFriends'));
      } else {
        alert(errorMsg);
      }
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      await apiService.acceptFriendRequest(requestId);
      await loadFriendRequests();
      await loadIncomingRequestCount();
      await loadChats();
      alert(t('chat.requestAccepted'));
    } catch (err) {
      console.error('Failed to accept friend request:', err);
      alert(t('chat.acceptRequestError'));
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await apiService.rejectFriendRequest(requestId);
      await loadFriendRequests();
      await loadIncomingRequestCount();
      alert(t('chat.requestRejected'));
    } catch (err) {
      console.error('Failed to reject friend request:', err);
      alert(t('chat.rejectRequestError'));
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!currentUser) return;
    try {
      await apiService.cancelFriendRequest(requestId, currentUser.id);
      await loadFriendRequests();
      await loadIncomingRequestCount();
      alert(t('chat.requestCancelled'));
    } catch (err) {
      console.error('Failed to cancel friend request:', err);
      alert(t('chat.cancelRequestError'));
    }
  };

  const handleClearMessages = async () => {
    if (!currentUser || !selectedFriend) return;
    if (window.confirm(t('chat.clearMessagesConfirm'))) {
      try {
        await apiService.clearConversation(currentUser.id, selectedFriend.id);
        setMessages([]);
        setShowChatMenu(false);
        await loadChats();
      } catch (err: any) {
        console.error('Failed to clear messages:', err);
        alert(err.message || t('chat.clearMessagesError'));
      }
    }
  };

  const handleDeleteChat = async () => {
    if (!currentUser || !selectedFriend) return;
    if (window.confirm(t('chat.deleteChatConfirm'))) {
      try {
        // Дос алып тастау - бұл дос тізімінен де жойады
        await apiService.removeFriend(currentUser.id, selectedFriend.id);
        
        // Чат тізімін жаңарту - дос тізімінен жойылғандықтан, чат тізімінен де жойылады
        await loadChats();
        
        // Ағымдағы чатті жабу
        setSelectedFriend(null);
        setMessages([]);
        setShowChatMenu(false);
        
        alert(t('chat.chatDeleted'));
      } catch (err) {
        console.error('Failed to delete chat:', err);
        alert(t('chat.deleteChatError'));
      }
    }
  };

  const handleSearchMessages = () => {
    setShowMessageSearch(true);
    setShowChatMenu(false);
  };

  const filteredMessages = messageSearchQuery
    ? messages.filter(msg => 
        msg.content.toLowerCase().includes(messageSearchQuery.toLowerCase())
      )
    : messages;

  // Менюден тыс жерге басқанда менюні жабу
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowChatMenu(false);
      }
      if (profileNameMenuRef.current && !profileNameMenuRef.current.contains(event.target as Node)) {
        setShowProfileNameMenu(false);
      }
      // Контекст менюсін жабу (тек меню ішіндегі батырма басылмағанда)
      if (imageContextMenu) {
        const target = event.target as HTMLElement;
        if (!target.closest('.image-context-menu')) {
          setImageContextMenu(null);
        }
      }
    };

    if (showChatMenu || showProfileNameMenu || imageContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showChatMenu, showProfileNameMenu, imageContextMenu]);

  const handleSaveDisplayName = () => {
    if (!currentUser || !selectedFriend) return;
    const displayNameKey = `chat_display_name_${currentUser.id}_${selectedFriend.id}`;
    const nameToSave = editDisplayName.trim() || selectedFriend.username;
    localStorage.setItem(displayNameKey, nameToSave);
    setChatDisplayNames(prev => ({ ...prev, [selectedFriend.id]: nameToSave }));
    setEditingFriendId(null);
    setEditDisplayName('');
  };

  // Медиа файлдарды алу (суреттер, видео, аудио, файлдар)
  const getChatMedia = () => {
    if (!selectedFriend || !currentUser) return [];
    
    const mediaMessages = messages.filter(msg => 
      msg.type === 'image' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'file'
    );
    
    const mediaItems: Array<{ type: string; url: string; filename: string; messageId: string }> = [];
    
    mediaMessages.forEach(msg => {
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(att => {
          mediaItems.push({
            type: msg.type || 'file',
            url: att.url,
            filename: att.filename,
            messageId: msg.id
          });
        });
      }
    });
    
    return mediaItems;
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
        alert(t('chat.imageUploadError'));
      }
    }
  };

  const getMessageStatusIcon = (message: Message) => {
    if (message.status === 'read') {
      return <FontAwesomeIcon icon={faCheckCircle} className="message-status read" />;
    } else if (message.status === 'delivered') {
      return <FontAwesomeIcon icon={faCheckDouble} className="message-status delivered" />;
    } else {
      return <FontAwesomeIcon icon={faCheck} className="message-status sent" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return t('chat.timeNow');
    if (minutes < 60) return `${minutes} ${t('chat.timeMinutesAgo')}`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} ${t('chat.timeHoursAgo')}`;
    
    return formatDateTime(dateString, i18n.language);
  };

  const renderMessageContent = (message: Message) => {
    const messageType = message.type || 'text';
    
    // Helper to get full URL
    const getFullUrl = (url: string) => {
      if (url.startsWith('http')) return url;
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
                  <div className="chat-message-text">{message.content}</div>
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
                  <div className="chat-message-text">{message.content}</div>
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
                  <div key={idx} className="chat-message-audio-wrapper">
                    <audio
                      src={getFullUrl(att.url)}
                      controls
                      className="chat-message-audio"
                    />
                  </div>
                ))}
                {message.content && (
                  <div className="chat-message-text">{message.content}</div>
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
                    <FontAwesomeIcon icon={faFile} />
                    <div className="chat-message-file-info">
                      <div className="chat-message-file-name">{att.filename}</div>
                      <div className="chat-message-file-size">
                        {(att.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </a>
                ))}
                {message.content && (
                  <div className="chat-message-text">{message.content}</div>
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
                  <FontAwesomeIcon icon={faMapMarkerAlt} />
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
                  <div className="chat-message-text">{message.content}</div>
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

      case 'sticker':
        return (
          <div className="chat-message-content">
            <div className="chat-message-sticker">
              {message.metadata?.stickerId ? (
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
                    <div className="chat-message-text">{message.content}</div>
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
        return <span className="chat-message-text-content">{message.content}</span>;
    }

    // Fallback to text
    return <span className="chat-message-text-content">{message.content || ''}</span>;
  };

  const filteredChats = chats.filter(chat =>
    chat.partner.username.toLowerCase().includes(friendsSearchQuery.toLowerCase()) ||
    chat.partner.email.toLowerCase().includes(friendsSearchQuery.toLowerCase())
  );

  const handleChatHeaderClick = () => {
    setSelectedFriend(null);
    setMessages([]);
    setShowChatProfileModal(false);
    setShowMessageSearch(false);
    setMessageSearchQuery('');
  };

  return (
    <div className="chat-page-container">
      <div className="chat-header">
        <h3 
          onClick={handleChatHeaderClick}
          style={{ cursor: 'pointer' }}
          title={t('chat.backToHome')}
        >
          <FontAwesomeIcon icon={faComment} /> {t('chat.title')}
        </h3>
      </div>

      <div className="chat-content">
        <div className="chat-friends-list">
          <div className="chat-tabs">
            <button
              className={`chat-tab ${activeTab === 'friends' ? 'active' : ''}`}
              onClick={() => setActiveTab('friends')}
            >
              {t('chat.friends')} ({chats.length})
            </button>
            <button
              className={`chat-tab ${activeTab === 'add' ? 'active' : ''}`}
              onClick={() => setActiveTab('add')}
            >
              {t('chat.addTab')}
            </button>
            <button
              className={`chat-tab ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              {t('chat.requests')} {friendRequests.length > 0 && `(${friendRequests.length})`}
            </button>
          </div>

          {activeTab === 'friends' && (
            <>
              <div className="chat-friends-search">
                <div className="chat-friends-search-box">
                  <FontAwesomeIcon icon={faSearch} className="chat-search-icon" />
                  <input
                    type="text"
                    className="chat-friends-search-input"
                    placeholder={t('chat.searchFriends')}
                    value={friendsSearchQuery}
                    onChange={(e) => setFriendsSearchQuery(e.target.value)}
                  />
                  {friendsSearchQuery && (
                    <button
                      className="chat-clear-search-btn"
                      onClick={() => setFriendsSearchQuery('')}
                    >
                      <FontAwesomeIcon icon={faTimes} />
                    </button>
                  )}
                </div>
              </div>
              {loading ? (
                <div className="chat-loading">{t('common.loading')}</div>
              ) : filteredChats.length === 0 ? (
                <div className="chat-empty">
                  {friendsSearchQuery ? t('chat.friendNotFound') : t('chat.friendsListEmpty')}
                </div>
              ) : (
                <div className="chat-friends-items">
                  {filteredChats.map((chat) => (
                    <div
                      key={chat.partnerId}
                      className={`chat-friend-item ${selectedFriend?.id === chat.partnerId ? 'active' : ''} ${chat.unreadCount > 0 ? 'has-unread' : ''}`}
                      onClick={() => {
                        if (chat.partner && chat.partner.id) {
                          setSelectedFriend(chat.partner);
                        } else {
                          console.error('chat.partner is missing or invalid:', chat);
                        }
                      }}
                    >
                      <div 
                        className="chat-friend-avatar"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/profile/${chat.partner.username}`);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {chat.partner.avatar ? (
                          <img src={chat.partner.avatar} alt={chat.partner.username} />
                        ) : (
                          <span>{chat.partner.username.charAt(0).toUpperCase()}</span>
                        )}
                        {chat.unreadCount > 0 && (
                          <span className="chat-unread-badge">
                            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="chat-friend-info">
                        <div className="chat-friend-header">
                          <div className="chat-friend-name">{chat.partner.username}</div>
                        </div>
                        {chat.lastMessage && (
                          <div className="chat-friend-last-message">
                            {chat.lastMessage.fromUserId === currentUser?.id ? t('chat.youPrefix') : ''}
                            {(chat.lastMessage.content || '').length > 40
                              ? (chat.lastMessage.content || '').substring(0, 40) + '...'
                              : (chat.lastMessage.content || '')}
                          </div>
                        )}
                        {chat.lastMessage && (
                          <div className="chat-friend-time">
                            {formatTime(chat.lastMessage.createdAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'add' && (
            <div className="chat-add-friends">
              <div className="chat-search-box">
                <div className="chat-search-input-wrapper">
                  <FontAwesomeIcon icon={faSearch} className="chat-search-icon" />
                  <input
                    type="text"
                    className="chat-search-input"
                    placeholder={t('chat.searchUsersPlaceholder')}
                    value={searchQuery}
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
                  {searchQuery && (
                    <button
                      className="chat-clear-search-btn"
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        if (searchTimeoutRef.current) {
                          clearTimeout(searchTimeoutRef.current);
                        }
                      }}
                    >
                      <FontAwesomeIcon icon={faTimes} />
                    </button>
                  )}
                </div>
              </div>
              {!searchQuery && (
                <div className="chat-add-info">
                  <div className="chat-info-icon">
                    <FontAwesomeIcon icon={faSearch} />
                  </div>
                  <p>{t('chat.addFriendInfo')}</p>
                </div>
              )}
              {searching ? (
                <div className="chat-loading">{t('chat.searching')}</div>
              ) : searchResults.length === 0 && searchQuery ? (
                <div className="chat-empty">{t('chat.userNotFound')}</div>
              ) : (
                <div className="chat-search-results">
                  {searchResults.map((user) => {
                    const isFriend = chats.some(chat => chat.partnerId === user.id);
                    const hasRequest = friendRequests.some(req => req.fromUserId === user.id);
                    
                    return (
                      <div key={user.id} className="chat-search-item">
                        <div className="chat-friend-avatar">
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.username} />
                          ) : (
                            <span>{user.username.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="chat-friend-info">
                          <div className="chat-friend-name">{user.username}</div>
                          <div className="chat-friend-email">{user.email}</div>
                          <div className="chat-friend-id">ID: {ensureNumericId(user.id)}</div>
                        </div>
                        {isFriend ? (
                          <button className="chat-add-btn chat-add-btn-pending" disabled>
                            <FontAwesomeIcon icon={faCheck} className="chat-btn-icon" />
                            {t('chat.friend')}
                          </button>
                        ) : hasRequest ? (
                          <button className="chat-add-btn chat-add-btn-pending" disabled>
                            <FontAwesomeIcon icon={faClock} className="chat-btn-icon" />
                            {t('chat.pending')}
                          </button>
                        ) : (
                          <button
                            className="chat-add-btn"
                            onClick={() => handleSendFriendRequest(user.id)}
                            title={t('chat.sendFriendRequestTitle')}
                          >
                            <FontAwesomeIcon 
                              icon={clickedAddButtons.has(user.id) ? faCheckCircle : faUserPlus} 
                              className="chat-btn-icon" 
                            />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="chat-requests">
              {friendRequests.length === 0 && outgoingFriendRequests.length === 0 ? (
                <div className="chat-empty">{t('chat.noRequests')}</div>
              ) : (
                <div className="chat-requests-items">
                  {/* {t('chat.incomingRequests')} - бұл сізге келген сұраулар */}
                  {friendRequests.length > 0 && (
                    <>
                      {outgoingFriendRequests.length > 0 && (
                        <div className="chat-requests-section-title">{t('chat.incomingRequests')}</div>
                      )}
                      {friendRequests.map((request) => (
                        <div key={request.id} className="chat-request-item">
                          <div className="chat-friend-avatar">
                            {request.fromUser?.avatar ? (
                              <img src={request.fromUser.avatar} alt={request.fromUser.username} />
                            ) : (
                              <span>{request.fromUser?.username.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="chat-friend-info">
                            <div className="chat-friend-name">{request.fromUser?.username}</div>
                            <div className="chat-request-time">{formatTime(request.createdAt)}</div>
                          </div>
                          <div className="chat-request-actions">
                            <button
                              className="chat-accept-btn"
                              onClick={() => handleAcceptRequest(request.id)}
                            >
                              ✓
                            </button>
                            <button
                              className="chat-reject-btn"
                              onClick={() => handleRejectRequest(request.id)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  
                  {/* {t('chat.outgoingRequests')} - бұл сіз жіберген сұраулар */}
                  {outgoingFriendRequests.length > 0 && (
                    <>
                      {friendRequests.length > 0 && (
                        <div className="chat-requests-section-title">{t('chat.outgoingRequests')}</div>
                      )}
                      {outgoingFriendRequests.map((request) => (
                        <div key={request.id} className="chat-request-item chat-request-item-outgoing">
                          <div className="chat-friend-avatar">
                            {request.toUser?.avatar ? (
                              <img src={request.toUser.avatar} alt={request.toUser.username} />
                            ) : (
                              <span>{request.toUser?.username.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="chat-friend-info">
                            <div className="chat-friend-name">{request.toUser?.username}</div>
                            <div className="chat-request-time">{formatTime(request.createdAt)}</div>
                          </div>
                          <div className="chat-request-actions">
                            <button
                              className="chat-cancel-btn"
                              onClick={() => handleCancelRequest(request.id)}
                              title={t('chat.cancelRequest')}
                            >
                              <FontAwesomeIcon icon={faTimes} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="chat-messages-area">
          {selectedFriend ? (
            <>
              <div className="chat-messages-header">
                <button
                  type="button"
                  className="chat-mobile-back-btn"
                  onClick={handleChatHeaderClick}
                  title={t('common.back')}
                  aria-label={t('common.back')}
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
                <div 
                  className="chat-messages-friend"
                  onClick={() => setShowChatProfileModal(true)}
                  style={{ cursor: 'pointer' }}
                >
                  <div 
                    className="chat-friend-avatar small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowChatProfileModal(true);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {selectedFriend.avatar ? (
                      <img src={selectedFriend.avatar} alt={selectedFriend.username} />
                    ) : (
                      <span>{selectedFriend.username.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span>{chatDisplayNames[selectedFriend.id] || selectedFriend.username}</span>
                  {typingUsers.has(selectedFriend.id) && (
                    <span className="typing-indicator">{t('chat.typing')}</span>
                  )}
                </div>
                <div className="chat-menu-container" ref={menuRef}>
                  <button
                    className="chat-menu-btn"
                    onClick={() => setShowChatMenu(!showChatMenu)}
                    title={t('chat.menuTitle')}
                  >
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                  </button>
                  {showChatMenu && (
                    <div className="chat-menu-dropdown">
                      <button
                        className="chat-menu-item"
                        onClick={handleSearchMessages}
                      >
                        <FontAwesomeIcon icon={faSearchIcon} />
                        <span>{t('chat.searchMessagesInChat')}</span>
                      </button>
                      <button
                        className="chat-menu-item"
                        onClick={handleClearMessages}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                        <span>{t('chat.clearMessagesInChat')}</span>
                      </button>
                      <button
                        className="chat-menu-item chat-menu-item-danger"
                        onClick={handleDeleteChat}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                        <span>{t('chat.deleteChat')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {showMessageSearch && (
                <div className="chat-message-search">
                  <div className="chat-message-search-box">
                    <FontAwesomeIcon icon={faSearchIcon} className="chat-search-icon" />
                    <input
                      type="text"
                      className="chat-message-search-input"
                      placeholder={t('chat.searchMessagesPlaceholder')}
                      value={messageSearchQuery}
                      onChange={(e) => setMessageSearchQuery(e.target.value)}
                      autoFocus
                    />
                    <button
                      className="chat-clear-search-btn"
                      onClick={() => {
                        setShowMessageSearch(false);
                        setMessageSearchQuery('');
                      }}
                    >
                      <FontAwesomeIcon icon={faTimes} />
                    </button>
                  </div>
                  {messageSearchQuery && (
                    <div className="chat-search-results-info">
                      {t('chat.messagesFound', { count: filteredMessages.length })}
                    </div>
                  )}
                </div>
              )}
              <div className="chat-messages-list" ref={messagesContainerRef}>
                {loadingMessages ? (
                  <div className="chat-no-messages">
                    <div className="chat-no-messages-icon"><FontAwesomeIcon icon={faComment} /></div>
                    <p>{t('chat.messagesLoading')}</p>
                  </div>
                ) : messagesError ? (
                  <div className="chat-no-messages">
                    <div className="chat-no-messages-icon"><FontAwesomeIcon icon={faComment} /></div>
                    <p>{t('chat.errorWithMessage', { message: messagesError })}</p>
                    <button 
                      onClick={() => loadMessages()}
                      className="chat-retry-btn"
                      style={{
                        marginTop: '1rem',
                        padding: '0.5rem 1rem',
                        background: 'var(--accent-color)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer'
                      }}
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="chat-no-messages">
                    <div className="chat-no-messages-icon"><FontAwesomeIcon icon={faComment} /></div>
                    <p>{t('chat.noMessages')}</p>
                    <p className="chat-no-messages-hint">{t('chat.sendFirstMessage')}</p>
                  </div>
                ) : (
                  filteredMessages.map((message) => {
                    const isOwn = message.fromUserId === currentUser?.id;
                    return (
                      <div
                        key={message.id}
                        className={`chat-message ${isOwn ? 'own' : 'other'} ${message.type || 'text'}`}
                      >
                        {renderMessageContent(message)}
                        <div className="chat-message-footer">
                          <div className="chat-message-time">
                            {formatTime(message.createdAt)}
                          </div>
                          {isOwn && (
                            <div className="chat-message-status">
                              {getMessageStatusIcon(message)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <MessageInput
                onSendMessage={handleSendMessage}
                onUploadFile={handleUploadFile}
                disabled={!selectedFriend}
              />
            </>
          ) : (
            <div className="chat-no-selection">
              <div className="chat-no-selection-icon"><FontAwesomeIcon icon={faComment} /></div>
              <p>{t('chat.selectFriend')}</p>
            </div>
          )}
        </div>
      </div>

      {/* {t('chat.chatProfile')} модалы */}
      {showChatProfileModal && selectedFriend && currentUser && (
        <div className="chat-profile-modal-overlay" onClick={() => setShowChatProfileModal(false)}>
          <div className="chat-profile-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="chat-profile-modal-header">
              <h2>{t('chat.chatProfile')}</h2>
              <button className="chat-profile-modal-close" onClick={() => setShowChatProfileModal(false)}>
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            <div className="chat-profile-modal-body">
              <div className="chat-profile-avatar-section">
                <div className="chat-profile-avatar-large">
                  {selectedFriend.avatar ? (
                    <img src={selectedFriend.avatar} alt={selectedFriend.username} />
                  ) : (
                    <span>{selectedFriend.username.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="chat-profile-name-section">
                  {editingFriendId === selectedFriend.id ? (
                    <div className="chat-profile-edit-name">
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        className="chat-profile-name-input"
                        placeholder={selectedFriend.username}
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
                        className="chat-profile-save-btn"
                        onClick={handleSaveDisplayName}
                        title={t('chat.saveTitle')}
                      >
                        <FontAwesomeIcon icon={faCheck} />
                      </button>
                      <button
                        className="chat-profile-cancel-btn"
                        onClick={() => {
                          setEditingFriendId(null);
                          setEditDisplayName('');
                        }}
                        title={t('chat.cancelTitle')}
                      >
                        <FontAwesomeIcon icon={faTimes} />
                      </button>
                    </div>
                  ) : (
                    <div className="chat-profile-name-display">
                      <h3>{chatDisplayNames[selectedFriend.id] || selectedFriend.username}</h3>
                      <div className="chat-profile-name-menu-container" ref={profileNameMenuRef}>
                        <button
                          className="chat-profile-name-menu-btn"
                          onClick={() => setShowProfileNameMenu(!showProfileNameMenu)}
                          title={t('chat.menuTitle')}
                        >
                          <FontAwesomeIcon icon={faEllipsisVertical} />
                        </button>
                        {showProfileNameMenu && (
                          <div className="chat-profile-name-menu-dropdown">
                            <button
                              className="chat-profile-name-menu-item"
                              onClick={() => {
                                setEditingFriendId(selectedFriend.id);
                                setEditDisplayName(chatDisplayNames[selectedFriend.id] || selectedFriend.username);
                                setShowProfileNameMenu(false);
                              }}
                            >
                              <FontAwesomeIcon icon={faEdit} />
                              <span>{t('chat.editDisplayName')}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="chat-profile-info">
                <div className="chat-profile-info-item">
                  <FontAwesomeIcon icon={faUser} className="chat-profile-info-icon" />
                  <div className="chat-profile-info-content">
                    <div className="chat-profile-info-label">{t('chat.username')}</div>
                    <div className="chat-profile-info-value">{selectedFriend.username}</div>
                  </div>
                </div>
                {selectedFriend.bio && (
                  <div className="chat-profile-info-item">
                    <FontAwesomeIcon icon={faAlignLeft} className="chat-profile-info-icon" />
                    <div className="chat-profile-info-content">
                      <div className="chat-profile-info-label">{t('chat.bio')}</div>
                      <div className="chat-profile-info-value chat-profile-bio">{selectedFriend.bio}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Медиа бөлімі */}
              <div className="chat-profile-media-section">
                <h4 className="chat-profile-media-title">{t('chat.media')}</h4>
                {getChatMedia().length === 0 ? (
                  <div className="chat-profile-media-empty">
                    {t('chat.noMediaFiles')}
                  </div>
                ) : (
                  <div className="chat-profile-media-grid">
                    {getChatMedia().map((media, index) => (
                      <div key={`${media.messageId}-${index}`} className="chat-profile-media-item">
                        {media.type === 'image' ? (
                          <img
                            src={getFullUrl(media.url)}
                            alt={media.filename}
                            className="chat-profile-media-image"
                            onClick={() => window.open(getFullUrl(media.url), '_blank')}
                          />
                        ) : media.type === 'video' ? (
                          <div className="chat-profile-media-video">
                            <FontAwesomeIcon icon={faVideo} />
                            <span>{media.filename}</span>
                          </div>
                        ) : media.type === 'audio' ? (
                          <div className="chat-profile-media-audio">
                            <FontAwesomeIcon icon={faMusic} />
                            <span>{media.filename}</span>
                          </div>
                        ) : (
                          <div className="chat-profile-media-file">
                            <FontAwesomeIcon icon={faFile} />
                            <span>{media.filename}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Сурет көрсету модалы */}
      {selectedImage && (
        <div 
          className="chat-image-viewer-overlay" 
          onClick={() => {
            setSelectedImage(null);
            setImageContextMenu(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setImageContextMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div className="chat-image-viewer-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="chat-image-viewer-download"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadImage(selectedImage.url, selectedImage.filename);
              }}
              title={t('chat.saveTitle')}
            >
              <FontAwesomeIcon icon={faDownload} />
              <span>{t('common.save')}</span>
            </button>
            <img 
              src={selectedImage.url} 
              alt={selectedImage.filename}
              className="chat-image-viewer-image"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setImageContextMenu({ x: e.clientX, y: e.clientY });
              }}
            />
            {imageContextMenu && (
              <div
                className="chat-image-context-menu"
                style={{
                  position: 'fixed',
                  top: `${imageContextMenu.y}px`,
                  left: `${imageContextMenu.x}px`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="chat-image-context-menu-item"
                  onClick={() => {
                    handleDownloadImage(selectedImage.url, selectedImage.filename);
                    setImageContextMenu(null);
                  }}
                >
                  <FontAwesomeIcon icon={faDownload} />
                  <span>{t('chat.saveImage')}</span>
                </button>
                <button
                  className="chat-image-context-menu-item"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedImage.url).then(() => {
                      alert(t('chat.imageLinkCopied'));
                    }).catch(() => {
                      alert(t('chat.copyError'));
                    });
                    setImageContextMenu(null);
                  }}
                >
                  <FontAwesomeIcon icon={faFile} />
                  <span>{t('chat.copyLink')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPage;
