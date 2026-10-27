import type { WorkspaceSnapshot } from './vibeActivity';
import { API_BASE_URL } from './constants';
import i18n from '../i18n/config';

function tApi(key: string, options?: Record<string, string>): string {
  return String(i18n.t(key, options));
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  replies?: Comment[]; // Replies to this comment
  likes?: string[]; // Array of user IDs who liked
  parentId?: string; // ID of parent comment if this is a reply
}

export interface CodeFile {
  id: string;
  title: string;
  content: string;
  language: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  description?: string;
  likes?: string[]; // Array of user IDs who liked
  comments?: Comment[];
  folderId?: string; // ID of parent folder if this is a file in a folder
  folderPath?: string; // Path within folder (e.g., "src/components/Header.tsx")
  isFolder?: boolean; // True if this is a folder container
  folderStructure?: Record<string, { type: 'file' | 'folder'; name: string; size?: number; language?: string }>; // Folder structure
  views?: number; // Total number of views
  viewedBy?: string[]; // Array of user IDs who viewed this code
  hasContent?: boolean; // Тізімде content жіберілмейді — бар-жоғы осымен белгіленеді
  folderStats?: { files: number; folders: number; names: { name: string; type: string }[] }; // folderStructure орнына (тізімде)
}

// Vibecoding жобасы — серверде тек иесіне сақталады
export interface VibecodingProjectFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
}

export interface VibecodingProjectDTO {
  id: string;
  name: string;
  files: VibecodingProjectFile[];
  folders?: string[];
  /** Notes-тағы байланысқан папка (сервер өзі береді) */
  notesFolder?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Жазбалар (Obsidian сияқты жеке vault)
export type NoteKind = 'note' | 'canvas';

export interface NoteMeta {
  id: string;
  title: string;
  folder: string;
  kind: NoteKind;
  links: string[];
  tags: string[];
  starred: boolean;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDTO extends NoteMeta {
  content: string;
}

export interface NoteVaultDTO {
  notes: NoteMeta[];
  folders: string[];
}

export interface NoteSearchResult {
  id: string;
  title: string;
  folder: string;
  snippet: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  phone?: string;
  avatar?: string;
  bio?: string;
}

export interface MessageAttachment {
  filename: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface Message {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  type?: 'text' | 'image' | 'audio' | 'video' | 'file' | 'sticker' | 'emoji' | 'location' | 'system' | 'project' | 'poll';
  /** Топ хабарламасы болса — топтың id-і және жіберушінің қысқаша деректері */
  groupId?: string;
  sender?: GroupUser | null;
  attachments?: MessageAttachment[];
  metadata?: {
    latitude?: number;
    longitude?: number;
    address?: string;
    stickerId?: string;
    emoji?: string;
    [key: string]: any;
  };
  createdAt: string;
  read: boolean;
  status?: 'sent' | 'delivered' | 'read';
  readAt?: string;
  /** Дауыстық хабарламаны алушы тыңдаған уақыт */
  listenedAt?: string;
  /** Тек клиентте: әлі серверге жетпеген (жіберіліп жатыр / жіберілмеді) хабарлама */
  localState?: 'sending' | 'failed';
  /** Тек клиентте: файлдың жүктелу барысы 0..1 */
  uploadProgress?: number;
  /** Тек клиентте: жіберілмеу себебі */
  localError?: string;
  /* Telegram сияқты әрекеттер (backend: services/message_extras.py) */
  replyTo?: MessageReplyRef;
  forwardedFrom?: { userId: string; username: string };
  editedAt?: string;
  /** emoji → оны қойған қолданушылардың id-лері */
  reactions?: Record<string, string[]>;
  pinned?: boolean;
  /** Сауалнама дауыстары: optionId → дауыс бергендердің id-лері */
  votes?: Record<string, string[]>;
}

/** type='poll' хабарламасының metadata-сы */
export interface PollMeta {
  question: string;
  options: Array<{ id: string; text: string }>;
  multiple: boolean;
}

export interface UploadOptions {
  /** Жүктелу барысы 0..1 */
  onProgress?: (ratio: number) => void;
  /** Жүктеуді тоқтату */
  signal?: AbortSignal;
}

/** Қолданушы жүктеуді өзі тоқтатты */
export class UploadAbortedError extends Error {
  constructor() {
    super('Upload aborted');
    this.name = 'UploadAbortedError';
  }
}

/** Дауыстық хабарлама (type='audio', metadata.voice=true) */
export interface VoiceMeta {
  voice: true;
  duration: number;
  /** 0..1 аралығындағы деңгейлер (толқын пішіні) */
  waveform: number[];
}

/** Чаттар тізіміндегі белгілер — тек өзіме көрінеді */
export interface ChatPref {
  kind: 'dm' | 'group';
  id: string;
  pinnedAt: string | null;
  muted: boolean;
  archived: boolean;
}

export interface MessageReplyRef {
  id: string;
  fromUserId: string;
  senderName: string;
  type: string;
  preview: string;
}

export type ForwardTarget = { kind: 'dm' | 'group'; id: string };

export interface PresenceInfo {
  online: boolean;
  lastSeen: string | null;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  otherUser?: User;
  fromUser?: User;
  toUser?: User;
  isIncoming?: boolean;
}

export interface Chat {
  partnerId: string;
  partner: User;
  lastMessage: Message;
  unreadCount: number;
  lastMessageTime: string;
}

/* ---------- Чаттағы жоба карталары ---------- */

/** type='project' хабарламасының metadata-сы (деректерді сервер толтырады) */
export interface ProjectCardMeta {
  kind: 'repo' | 'vibe';
  projectId: string;
  title: string;
  language?: string;
  description?: string;
  author?: string;
  isFolder?: boolean;
  fileCount?: number;
  ownerId?: string;
  /** «Бірге бастайық» шақыруы */
  invite?: boolean;
}

/* ---------- Топтық чат ---------- */

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupUser {
  id: string;
  username: string;
  avatar?: string | null;
}

export interface GroupMember extends GroupUser {
  role: GroupRole;
  joinedAt?: string;
}

export interface ChatGroup {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
  ownerId: string;
  createdAt: string;
  myRole: GroupRole;
}

export interface ChatGroupSummary extends ChatGroup {
  memberCount: number;
  lastMessage: Message | null;
  lastMessageTime: string;
  unreadCount: number;
}

export interface ChatGroupDetails extends ChatGroup {
  members: GroupMember[];
}

export interface SiteConfig {
  appName: string;
  contact: {
    email: string;
    phone: string;
    address: string;
    addressEn?: string;
  };
  externalLinks: Array<{
    name: string;
    url: string;
    iconUrl?: string;
  }>;
  fileConfig?: {
    maxFileSizeBytes: number;
    maxFileSizeMB: number;
    maxFolderSizeBytes?: number;
    supportedExtensions: string[];
    dangerousExtensions?: string[];
    allowedExtensions?: string[];
    allowedMimeTypes?: string[];
  };
  firebaseConfig?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  features?: Array<{
    icon: string;
    titleKey: string;
    descriptionKey: string;
  }>;
  validationConfig?: {
    maxFileSizeBytes: number;
    maxFileSizeMB: number;
    maxFolderSizeBytes?: number;
    supportedExtensions: string[];
    dangerousExtensions: string[];
    allowedExtensions: string[];
    allowedMimeTypes: string[];
  };
  languageCategories?: { [key: string]: string[] };
  codeCategoryKeywords?: { [category: string]: string[] };
  passwordRules?: {
    minLength: number;
    requireUppercase?: boolean;
    requireNumber?: boolean;
    emailRegex?: string;
  };
  googleClientId?: string;
  aboutContent?: { [locale: string]: { title: string; subtitle: string; sections: Array<{ title: string; description: string }> } };
  termsContent?: { [locale: string]: { title: string; lastUpdated: string; sections: Array<{ title: string; description: string }> } };
  privacyContent?: { [locale: string]: { title: string; lastUpdated: string; sections: Array<{ title: string; description: string }> } };
  apiDisplayUrl?: string;
}

/** Бүркіт қай кілтпен жұмыс істейді: өз кілті, сервердің ортақ кілті, немесе кілт жоқ */
export interface BurkitStatus {
  provider: 'gemini';
  model: string;
  source: 'own' | 'shared' | 'none';
  keyHint: string | null;
}

export interface BurkitChatPayload {
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Ашық файлдың жобадағы жолы және мазмұны */
  fileName?: string;
  fileContent?: string;
  /** Ашық жоба: Бүркіт файлдарды көріп, path= блоктарымен оларға жаза алады */
  projectName?: string;
  projectFiles?: { path: string; content?: string }[];
  /** Серверге сақталған жоба — оның Notes папкасындағы жазбалар да Бүркітке барады */
  projectId?: string;
  /** agent — Бүркіт файлдар мен жазбаларға жазады; ask — тек жауап береді */
  mode?: 'agent' | 'ask';
  /** Vibecoding бетінің ағымдағы күйі: оқиғалар, терминал, консоль, редактор, қателер */
  workspace?: WorkspaceSnapshot & { openFiles: string[] };
  /** Сайт интерфейсінің тілі — Бүркіт осы тілде жауап береді */
  uiLanguage?: 'kk' | 'ru' | 'en';
}

/** Жобаға автоматты түрде байланысқан Notes папкасы */
export interface ProjectNotesDTO {
  folder: string;
  notes: { id: string; title: string; folder: string }[];
}

export interface ProjectNoteWriteResult {
  id: string;
  title: string;
  created: boolean;
  /** Бұрынғы мазмұн («Қайтару» үшін); жаңа жазбада null */
  previous: string | null;
}

/** Бүркіт сұрауының қатесі; status 403 — кілт енгізілмеген */
export class BurkitError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'BurkitError';
  }
}

class ApiService {
  private baseUrl: string;
  private _getToken: (() => string | null) | null = null;
  private _refreshToken: (() => Promise<string | null>) | null = null;
  private configCache: SiteConfig | null = null;
  private configCacheExpiry: number = 0;
  private static readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private codesCache: { codes: CodeFile[]; total: number; offset: number; hasMore: boolean } | null = null;
  private codesCacheExpiry: number = 0;
  private static readonly CODES_CACHE_TTL = 30 * 1000; // 30 seconds

  /**
   * Read the CSRF token from the csrf_token cookie (set by the server
   * alongside the HttpOnly refresh_token cookie). Used for the
   * double-submit cookie pattern on the /auth/refresh endpoint.
   */
  private getCsrfToken(): string | null {
    const match = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrf_token='));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
  }

  setTokenGetter(getter: () => string | null) {
    this._getToken = getter;
  }

  /**
   * Register a callback that obtains a fresh access token (via the refresh
   * cookie). Used to transparently retry a request once when the access
   * token has expired, e.g. after the computer slept or the tab was frozen.
   */
  setTokenRefresher(refresher: () => Promise<string | null>) {
    this._refreshToken = refresher;
  }

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Invalidate the codes cache so next request fetches fresh data
   */
  invalidateCodesCache(): void {
    this.codesCache = null;
    this.codesCacheExpiry = 0;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      if (import.meta.env.DEV) {
        console.log(`API Request: ${options?.method || 'GET'} ${url}`);
      }

      // Add timeout to prevent hanging (30 seconds for better reliability)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const headers: Record<string, string> = {
        ...(this._getToken ? { 'Authorization': `Bearer ${this._getToken()}` } : {}),
        ...options?.headers as Record<string, string>,
      };
      // Only set Content-Type for requests with a body (not for GET/DELETE without body)
      const hasBody = options?.body !== undefined && options?.body !== null;
      if (hasBody && !(options?.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      let response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
        credentials: 'include', // Include cookies (HttpOnly refresh_token)
      });

      // Access token expired → refresh once and retry with the new token
      if (response.status === 401 && this._refreshToken && !endpoint.startsWith('/auth/')) {
        const newToken = await this._refreshToken();
        if (newToken) {
          response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { ...headers, 'Authorization': `Bearer ${newToken}` },
            credentials: 'include',
          });
        }
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        
        // Only log non-401 errors or if it's not a login endpoint
        // 401 errors during login are expected (will try Firebase)
        const isLoginEndpoint = endpoint.includes('/auth/login');
        const isExpected401 = response.status === 401 && isLoginEndpoint;
        
        // Don't log 404 errors for getUserProfile - this is expected when searching by ID
        const isUserProfileEndpoint = endpoint.match(/^\/users\/[^\/]+$/);
        const isExpected404 = response.status === 404 && isUserProfileEndpoint;
        
        if (!isExpected401 && !isExpected404) {
          console.error(`API Error: ${response.status} ${response.statusText}`);
        }
        
        let errorMessage = errorData.detail || errorData.error || `API Error: ${response.statusText}`;

        if (errorMessage.includes('Username already in use by another user')) {
          errorMessage = tApi('apiErrors.usernameInUse');
        } else if (
          errorMessage.includes('User with username') &&
          errorMessage.includes('already exists')
        ) {
          errorMessage = tApi('apiErrors.usernameInUse');
        } else if (errorMessage.includes('Email already in use by another user')) {
          errorMessage = tApi('apiErrors.emailInUse');
        } else if (
          errorMessage.includes('User with email') &&
          errorMessage.includes('already exists')
        ) {
          errorMessage = tApi('apiErrors.emailInUse');
        } else if (errorMessage.includes('Invalid avatar format')) {
          errorMessage = tApi('apiErrors.invalidAvatarFormat');
        } else if (errorMessage.includes('Internal server error while updating profile')) {
          errorMessage = tApi('apiErrors.profileUpdateFailed');
        } else if (errorMessage.includes('Invalid credentials') || errorMessage.includes('User not found')) {
          errorMessage = tApi('apiErrors.invalidCredentials');
        } else if (errorMessage.includes('Something went wrong')) {
          errorMessage = tApi('apiErrors.genericServerError');
        } else if (response.status === 401) {
          errorMessage = tApi('apiErrors.unauthorized');
        } else if (response.status === 404) {
          errorMessage = tApi('apiErrors.userNotFoundShort');
        } else if (response.status === 500) {
          errorMessage = tApi('apiErrors.serverError');
        } else if (response.status === 503) {
          errorMessage = tApi('apiErrors.serviceUnavailable');
        }

        const apiError = new Error(errorMessage);
        // Attach HTTP status code so callers can distinguish hard failures
        // (401/404) from transient ones (network/timeout) without relying on
        // the translated message text.
        (apiError as any).status = response.status;
        throw apiError;
      }

      // Handle empty responses (e.g., 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T;
      }
      return response.json();
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's an abort error (timeout)
        if (error.name === 'AbortError' || error.message.includes('aborted')) {
          const serverUrl = this.baseUrl.replace(/\/api\/?$/, '');
          throw new Error(tApi('apiErrors.requestTimeout', { serverUrl }));
        }
        // Network error or other fetch errors
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ERR_CONNECTION_REFUSED') || error.message.includes('ERR_NETWORK')) {
          const serverUrl = this.baseUrl.replace(/\/api\/?$/, '');
          throw new Error(tApi('apiErrors.networkError', { serverUrl }));
        }
        throw error;
      }
      throw new Error(tApi('apiErrors.unknownError'));
    }
  }

  // Code files
  async getCodeFiles(
    folderId?: string,
    limit?: number,
    offset?: number,
    includeContent?: boolean
  ): Promise<{ codes: CodeFile[]; total: number; limit?: number; offset: number; hasMore: boolean }> {
    // Use cache for default listing (no folderId, default limit/offset, no content)
    const isDefaultQuery = !folderId && limit === 50 && offset === 0 && !includeContent;
    const now = Date.now();

    if (isDefaultQuery && this.codesCache && now < this.codesCacheExpiry) {
      return this.codesCache;
    }

    const params = new URLSearchParams();
    if (folderId) params.append('folderId', folderId);
    if (limit !== undefined) params.append('limit', limit.toString());
    if (offset !== undefined) params.append('offset', offset.toString());
    if (includeContent) params.append('includeContent', 'true');

    const endpoint = `/codes${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.request<any>(endpoint);

    // Кері үйлесімділік: егер жауап массив болса (ескі формат), оны жаңа форматқа түрлендіру
    let result: { codes: CodeFile[]; total: number; limit?: number; offset: number; hasMore: boolean };
    if (Array.isArray(response)) {
      result = {
        codes: response,
        total: response.length,
        limit: limit,
        offset: offset || 0,
        hasMore: false
      };
    } else {
      result = response;
    }

    // Cache default listing
    if (isDefaultQuery) {
      this.codesCache = result;
      this.codesCacheExpiry = now + ApiService.CODES_CACHE_TTL;
    }

    return result;
  }

  // lite=true — папка болса, ауыр content/folderStructure жіберілмейді
  async getCodeFile(id: string, lite = false): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${id}${lite ? '?lite=true' : ''}`);
  }

  async createCodeFile(file: Omit<CodeFile, 'id' | 'createdAt' | 'updatedAt'>): Promise<CodeFile> {
    return this.request<CodeFile>('/codes', {
      method: 'POST',
      body: JSON.stringify(file),
    });
  }

  async updateCodeFile(id: string, file: Partial<CodeFile>): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(file),
    });
  }

  async deleteCodeFile(id: string): Promise<void> {
    return this.request<void>(`/codes/${id}`, {
      method: 'DELETE',
    });
  }

  // Vibecoding жобалары (тек ағымдағы қолданушының)
  async getVibecodingProjects(): Promise<VibecodingProjectDTO[]> {
    return this.request<VibecodingProjectDTO[]>('/vibecoding/projects');
  }

  /** Чатта бөлісілген Vibecoding жобасының көшірмесін өзіме алу */
  async forkSharedProject(messageId: string, groupId?: string, name?: string): Promise<VibecodingProjectDTO> {
    return this.request<VibecodingProjectDTO>('/vibecoding/projects/fork', {
      method: 'POST',
      body: JSON.stringify({ messageId, groupId, name }),
    });
  }

  async saveVibecodingProject(
    id: string,
    project: { name: string; files: VibecodingProjectFile[]; folders?: string[]; createdAt?: string }
  ): Promise<VibecodingProjectDTO> {
    return this.request<VibecodingProjectDTO>(`/vibecoding/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    });
  }

  async deleteVibecodingProject(id: string): Promise<void> {
    return this.request<void>(`/vibecoding/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Жазбалар
  async getNoteVault(): Promise<NoteVaultDTO> {
    return this.request<NoteVaultDTO>('/notes');
  }

  async getNote(id: string): Promise<NoteDTO> {
    return this.request<NoteDTO>(`/notes/${encodeURIComponent(id)}`);
  }

  async createNote(data: { title: string; folder?: string; kind?: NoteKind; content?: string }): Promise<NoteDTO> {
    return this.request<NoteDTO>('/notes', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateNote(
    id: string,
    data: { title?: string; folder?: string; content?: string; starred?: boolean; updateLinks?: boolean }
  ): Promise<NoteDTO & { updatedNotes: NoteMeta[] }> {
    return this.request(`/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async deleteNote(id: string): Promise<void> {
    await this.request(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async searchNotes(q: string): Promise<NoteSearchResult[]> {
    return this.request<NoteSearchResult[]>(`/notes/search?q=${encodeURIComponent(q)}`);
  }

  async createNoteFolder(path: string): Promise<{ folders: string[] }> {
    return this.request('/notes/folders', { method: 'POST', body: JSON.stringify({ path }) });
  }

  async renameNoteFolder(path: string, newPath: string): Promise<NoteVaultDTO> {
    return this.request<NoteVaultDTO>('/notes/folders', { method: 'PATCH', body: JSON.stringify({ path, newPath }) });
  }

  async deleteNoteFolder(path: string): Promise<NoteVaultDTO> {
    return this.request<NoteVaultDTO>(`/notes/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }

  async deleteMultipleCodes(ids: string[]): Promise<{ message: string; deletedCount: number }> {
    return this.request<{ message: string; deletedCount: number }>('/codes/delete-multiple', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  // User
  async getCurrentUser(email?: string, userId?: string): Promise<User> {
    // Try to get email and userId from localStorage if not provided
    if (!email || !userId) {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const userData = JSON.parse(storedUser);
          email = email || userData.email;
          userId = userId || userData.id;
        }
      } catch (err) {
        console.error('Failed to get user data from localStorage:', err);
      }
    }
    
    // Build query parameters
    const params = new URLSearchParams();
    if (email) params.append('email', email);
    if (userId) params.append('user_id', userId);
    
    const url = params.toString() ? `/user?${params.toString()}` : '/user';
    
    try {
      return await this.request<User>(url);
    } catch (error: any) {
      const msg = String(error?.message || '');
      const notFoundHint =
        msg.includes('404') ||
        /not found|табылмады|не найден/i.test(msg) ||
        msg === tApi('apiErrors.userNotFoundShort') ||
        msg === tApi('apiErrors.invalidCredentials');
      if (notFoundHint) {
        console.warn('User not found in backend, clearing localStorage');
        localStorage.removeItem('user');
        throw new Error(tApi('editProfile.userNotFound'));
      }
      throw error;
    }
  }

  async getUserProfile(userId: string): Promise<User> {
    return this.request<User>(`/users/${userId}`);
  }

  async getUserByUsername(username: string): Promise<User> {
    return this.request<User>(`/users/by-username/${username}`);
  }

  async updateUserProfile(updates: Partial<User>): Promise<User> {
    return this.request<User>('/user', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // Authentication
  async register(username: string, email: string, password: string, captchaToken?: string | null): Promise<{ user: User; access_token: string; token_type: string; message: string }> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, captcha_token: captchaToken || undefined }),
    });
  }

  async login(emailOrUsername: string, password: string, captchaToken?: string | null): Promise<any> {
    const isEmail = emailOrUsername.includes('@');
    const captcha_token = captchaToken || undefined;
    const body = isEmail
      ? { email: emailOrUsername, password, captcha_token }
      : { username: emailOrUsername, password, captcha_token };

    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async refreshToken(): Promise<{ access_token: string; token_type: string }> {
    // Refresh token is sent automatically via HttpOnly cookie (credentials: 'include')
    // CSRF token is sent as a custom header (double-submit cookie pattern)
    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      // Without a readable csrf_token cookie the server always answers 403,
      // so the session can never be refreshed — signal it as unrecoverable.
      const err = new Error('CSRF token missing');
      (err as any).status = 403;
      (err as any).csrfMissing = true;
      throw err;
    }
    return this.request('/auth/refresh', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    });
  }

  async logout(token?: string): Promise<{ message: string }> {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return this.request('/auth/logout', {
      method: 'POST',
      headers,
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, new_password: string): Promise<{ message: string }> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password }),
    });
  }

  // 2FA
  async setup2FA(): Promise<{ secret: string; uri: string }> {
    return this.request('/auth/2fa/setup', { method: 'POST' });
  }

  async verify2FASetup(code: string): Promise<{ message: string; recovery_codes: string[] }> {
    return this.request('/auth/2fa/verify-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disable2FA(password: string): Promise<{ message: string }> {
    return this.request('/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  async verify2FALogin(temp_token: string, code: string): Promise<any> {
    return this.request('/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ temp_token, code }),
    });
  }

  async deleteAccount(): Promise<{ message: string }> {
    return this.request('/user', { method: 'DELETE' });
  }

  // Likes
  async likeCode(codeId: string, userId: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/like`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  async unlikeCode(codeId: string, userId: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/unlike`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // Comments
  async addComment(codeId: string, author: string, content: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author, content }),
    });
  }

  async updateComment(codeId: string, commentId: string, content: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteComment(codeId: string, commentId: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  async addReply(codeId: string, parentId: string, author: string, content: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author, content, parentId }),
    });
  }

  async likeComment(codeId: string, commentId: string, userId: string): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/comments/${commentId}/like`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }


  // Views
  async incrementView(codeId: string, userId: string | null): Promise<CodeFile> {
    return this.request<CodeFile>(`/codes/${codeId}/view`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // Friends
  async getFriends(userId: string): Promise<User[]> {
    return this.request<User[]>(`/friends/${userId}`);
  }

  async addFriend(userId: string, friendId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/friends/${userId}/add`, {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    });
  }

  async removeFriend(userId: string, friendId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/friends/${userId}/remove/${friendId}`, {
      method: 'DELETE',
    });
  }

  // Messages
  async getMessages(userId: string): Promise<Message[]> {
    return this.request<Message[]>(`/messages/${userId}`);
  }

  async getConversation(userId: string, friendId: string): Promise<Message[]> {
    return this.request<Message[]>(`/messages/${userId}/${friendId}`);
  }

  async clearConversation(userId: string, friendId: string): Promise<{ message: string; deletedCount: number }> {
    return this.request<{ message: string; deletedCount: number }>(`/messages/${userId}/${friendId}`, {
      method: 'DELETE',
    });
  }

  async sendMessage(
    fromUserId: string, 
    toUserId: string, 
    content: string,
    type: string = 'text',
    attachments?: MessageAttachment[],
    metadata?: Record<string, any>,
    replyToId?: string
  ): Promise<Message> {
    return this.request<Message>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        fromUserId,
        toUserId,
        content,
        type,
        attachments,
        metadata,
        replyToId,
      }),
    });
  }

  async uploadFile(
    file: File,
    fromUserId: string,
    toUserId: string,
    messageType: 'image' | 'audio' | 'video' | 'file',
    content?: string,
    metadata?: Record<string, any>,
    replyToId?: string,
    options?: UploadOptions
  ): Promise<Message> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fromUserId', fromUserId);
    formData.append('toUserId', toUserId);
    formData.append('messageType', messageType);
    if (content) formData.append('content', content);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    if (replyToId) formData.append('replyToId', replyToId);

    // fetch жүктелу барысын бермейді — XHR арқылы жібереміз (onProgress үшін)
    return new Promise<Message>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/messages/upload`);
      xhr.withCredentials = true;
      xhr.timeout = 60000;
      const token = this._getToken && this._getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) options?.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data: any = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as Message);
          return;
        }
        let errorMessage = data?.detail || tApi('apiErrors.uploadFailed');
        if (xhr.status === 403) {
          if (errorMessage.includes('You can only message friends') || errorMessage.includes('Тек достарға')) {
            errorMessage = tApi('apiErrors.messageFriendsOnly');
          } else {
            errorMessage = tApi('apiErrors.messageForbidden');
          }
        }
        reject(new Error(errorMessage));
      };
      xhr.onerror = () => reject(new Error(tApi('apiErrors.uploadConnectionFailed')));
      xhr.ontimeout = () => reject(new Error(tApi('apiErrors.uploadTimeout')));
      xhr.onabort = () => reject(new UploadAbortedError());

      if (options?.signal) {
        if (options.signal.aborted) {
          reject(new UploadAbortedError());
          return;
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(formData);
    });
  }

  /** Дауыстық хабарламаны тыңдадым — жіберушіге «тыңдалды» белгісі */
  async markListened(messageId: string, groupId?: string): Promise<Message> {
    return this.request<Message>(`${this.messagePath(messageId, groupId)}/listened`, { method: 'POST' });
  }

  async markMessageAsRead(messageId: string): Promise<Message> {
    return this.request<Message>(`/messages/${messageId}/read`, {
      method: 'PUT',
    });
  }

  async markConversationRead(userId: string, friendId: string): Promise<{ message: string; count: number }> {
    return this.request<{ message: string; count: number }>(`/messages/${userId}/${friendId}/mark-read`, {
      method: 'PUT',
    });
  }

  async getUnreadCountForChat(userId: string, friendId: string): Promise<{ unreadCount: number; chatId: string }> {
    return this.request<{ unreadCount: number; chatId: string }>(`/messages/${userId}/${friendId}/unread-count`);
  }

  async getTotalUnreadCount(userId: string): Promise<{ totalUnreadCount: number }> {
    return this.request<{ totalUnreadCount: number }>(`/messages/${userId}/unread-count`);
  }

  async getChats(userId: string): Promise<Chat[]> {
    return this.request<Chat[]>(`/chats/${userId}`);
  }

  async getIncomingFriendRequestCount(userId: string): Promise<{ incomingRequestCount: number }> {
    return this.request<{ incomingRequestCount: number }>(`/friend-requests/${userId}/incoming-count`);
  }

  // Friend Requests
  async getFriendRequests(userId: string): Promise<FriendRequest[]> {
    return this.request<FriendRequest[]>(`/friend-requests/${userId}`);
  }

  async getIncomingFriendRequests(userId: string): Promise<FriendRequest[]> {
    return this.request<FriendRequest[]>(`/friend-requests/incoming/${userId}`);
  }

  async getOutgoingFriendRequests(userId: string): Promise<FriendRequest[]> {
    return this.request<FriendRequest[]>(`/friend-requests/outgoing/${userId}`);
  }

  async sendFriendRequest(fromUserId: string, toUserId: string): Promise<FriendRequest> {
    return this.request<FriendRequest>('/friend-requests', {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId }),
    });
  }

  async acceptFriendRequest(requestId: string): Promise<{ message: string; request: FriendRequest }> {
    return this.request<{ message: string; request: FriendRequest }>(`/friend-requests/${requestId}/accept`, {
      method: 'PUT',
    });
  }

  async rejectFriendRequest(requestId: string): Promise<{ message: string; request: FriendRequest }> {
    return this.request<{ message: string; request: FriendRequest }>(`/friend-requests/${requestId}/reject`, {
      method: 'PUT',
    });
  }

  async cancelFriendRequest(requestId: string, userId: string): Promise<{ message: string; request: FriendRequest }> {
    return this.request<{ message: string; request: FriendRequest }>(`/friend-requests/${requestId}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ userId }),
    });
  }

  /**
   * Get site configuration (app name, contact, external links, file limits) from backend.
   */
  async getConfig(): Promise<SiteConfig> {
    // Return cached config if still fresh
    const now = Date.now();
    if (this.configCache && now < this.configCacheExpiry) {
      return this.configCache;
    }
    try {
      const data = await this.request<SiteConfig>('/config');
      this.configCache = data;
      this.configCacheExpiry = now + ApiService.CONFIG_CACHE_TTL;
      return data;
    } catch (error) {
      console.warn('Failed to load site config, using defaults:', error);
      return {
        appName: 'Codo Hub',
        contact: { email: '', phone: '', address: '', addressEn: 'Kazakhstan' },
        externalLinks: [],
        fileConfig: {
          maxFileSizeBytes: 30 * 1024 * 1024,
          maxFileSizeMB: 30,
          supportedExtensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.json', '.md', '.xml', '.yaml', '.yml']
        },
        apiDisplayUrl: this.baseUrl.replace(/\/api$/, '') + '/api'
      };
    }
  }

  // Contact form submission
  async submitContactForm(data: { name: string; email: string; subject: string; message: string }): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/contact', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ---------- Топтық чат ----------

  async getGroups(): Promise<ChatGroupSummary[]> {
    return this.request<ChatGroupSummary[]>('/groups');
  }

  async createGroup(name: string, memberIds: string[], description?: string): Promise<ChatGroupDetails> {
    return this.request<ChatGroupDetails>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds, description }),
    });
  }

  async getGroup(groupId: string): Promise<ChatGroupDetails> {
    return this.request<ChatGroupDetails>(`/groups/${encodeURIComponent(groupId)}`);
  }

  async updateGroup(groupId: string, data: { name?: string; description?: string }): Promise<ChatGroupDetails> {
    return this.request<ChatGroupDetails>(`/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.request(`/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  }

  async addGroupMembers(groupId: string, userIds: string[]): Promise<ChatGroupDetails> {
    return this.request<ChatGroupDetails>(`/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  /** Мүшені шығару; memberId өзімнің id-м болса — топтан шығу */
  async removeGroupMember(groupId: string, memberId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' }
    );
  }

  async setGroupMemberRole(groupId: string, memberId: string, role: 'admin' | 'member'): Promise<ChatGroupDetails> {
    return this.request<ChatGroupDetails>(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    );
  }

  async getGroupMessages(groupId: string): Promise<Message[]> {
    return this.request<Message[]>(`/groups/${encodeURIComponent(groupId)}/messages`);
  }

  async sendGroupMessage(
    groupId: string,
    content: string,
    type: string = 'text',
    attachments?: MessageAttachment[],
    metadata?: Record<string, unknown>,
    replyToId?: string
  ): Promise<Message> {
    return this.request<Message>(`/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, type, attachments, metadata, replyToId }),
    });
  }

  async uploadGroupFile(
    groupId: string,
    file: File,
    messageType: 'image' | 'audio' | 'video' | 'file',
    content?: string,
    metadata?: Record<string, unknown>,
    replyToId?: string
  ): Promise<Message> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('messageType', messageType);
    if (content) formData.append('content', content);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    if (replyToId) formData.append('replyToId', replyToId);
    return this.request<Message>(`/groups/${encodeURIComponent(groupId)}/messages/upload`, {
      method: 'POST',
      body: formData,
    });
  }

  async markGroupRead(groupId: string): Promise<void> {
    await this.request(`/groups/${encodeURIComponent(groupId)}/read`, { method: 'PUT' });
  }

  // ---------- Хабарлама әрекеттері (жеке чат: groupId жоқ, топ: groupId бар) ----------

  private messagePath(messageId: string, groupId?: string): string {
    const id = encodeURIComponent(messageId);
    return groupId ? `/groups/${encodeURIComponent(groupId)}/messages/${id}` : `/messages/${id}`;
  }

  async editMessage(messageId: string, content: string, groupId?: string): Promise<Message> {
    return this.request<Message>(this.messagePath(messageId, groupId), {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(messageId: string, scope: 'me' | 'all', groupId?: string): Promise<void> {
    await this.request(`${this.messagePath(messageId, groupId)}?scope=${scope}`, { method: 'DELETE' });
  }

  async reactToMessage(messageId: string, emoji: string, groupId?: string): Promise<Message> {
    return this.request<Message>(`${this.messagePath(messageId, groupId)}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  async pinMessage(messageId: string, pinned: boolean, groupId?: string): Promise<Message> {
    return this.request<Message>(`${this.messagePath(messageId, groupId)}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    });
  }

  async votePoll(messageId: string, optionIds: string[], groupId?: string): Promise<Message> {
    return this.request<Message>(`${this.messagePath(messageId, groupId)}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIds }),
    });
  }

  async getChatPrefs(): Promise<ChatPref[]> {
    return this.request<ChatPref[]>('/chat-prefs');
  }

  async updateChatPref(
    kind: 'dm' | 'group',
    id: string,
    changes: Partial<{ pinned: boolean; muted: boolean; archived: boolean }>
  ): Promise<ChatPref> {
    return this.request<ChatPref>(`/chat-prefs/${kind}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(changes),
    });
  }

  /** Онлайн күйі: тек достар, хат жазысқандар және топтастар үшін қайтарылады */
  async getPresence(userIds: string[]): Promise<Record<string, PresenceInfo>> {
    if (userIds.length === 0) return {};
    return this.request(`/presence?ids=${encodeURIComponent(userIds.join(','))}`);
  }

  async forwardMessage(
    messageId: string,
    targets: ForwardTarget[],
    sourceGroupId?: string
  ): Promise<{ results: Array<ForwardTarget & { ok: boolean; error?: string }> }> {
    return this.request('/messages/forward', {
      method: 'POST',
      body: JSON.stringify({
        sourceKind: sourceGroupId ? 'group' : 'dm',
        sourceGroupId,
        messageId,
        targets,
      }),
    });
  }

  // User Search - Using Backend API (Firebase fallback removed for reliability)
  async searchUsers(searchQuery: string): Promise<User[]> {
    const searchTerm = searchQuery.trim();
    if (!searchTerm || searchTerm.length < 1) {
      return [];
    }
    
    try {
      // Use backend API directly for reliable search
      return await this.request<User[]>(`/users/search?query=${encodeURIComponent(searchTerm)}`);
    } catch (error) {
      console.error('User search error:', error);
      // Return empty array on error
      return [];
    }
  }

  // ── Бүркіт (Gemini) ──
  async getBurkitStatus(): Promise<BurkitStatus> {
    return this.request<BurkitStatus>('/burkit/status');
  }

  async saveBurkitKey(apiKey: string): Promise<BurkitStatus> {
    return this.request<BurkitStatus>('/burkit/key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    });
  }

  async deleteBurkitKey(): Promise<BurkitStatus> {
    return this.request<BurkitStatus>('/burkit/key', { method: 'DELETE' });
  }

  async getProjectNotes(projectId: string): Promise<ProjectNotesDTO> {
    return this.request<ProjectNotesDTO>(`/burkit/project-notes/${encodeURIComponent(projectId)}`);
  }

  async writeProjectNote(projectId: string, title: string, content: string): Promise<ProjectNoteWriteResult> {
    return this.request<ProjectNoteWriteResult>(`/burkit/project-notes/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    });
  }

  /**
   * Бүркіттен жауап алу — мәтін бөлік-бөлік келеді (onChunk). request() жауапты
   * толық күтетіндіктен, мұнда fetch тікелей қолданылады (401-де бір рет жаңартып қайталайды).
   */
  async streamBurkitChat(
    payload: BurkitChatPayload,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const send = (token: string | null) =>
      fetch(`${this.baseUrl}/burkit/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        credentials: 'include',
        signal,
      });

    let response = await send(this._getToken ? this._getToken() : null);
    if (response.status === 401 && this._refreshToken) {
      const newToken = await this._refreshToken();
      if (newToken) response = await send(newToken);
    }
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new BurkitError(data.detail || tApi('apiErrors.burkitFailed'), response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  }
}

export const apiService = new ApiService();