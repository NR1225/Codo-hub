import { apiService } from '../../utils/api';

/* Әкімші панелінің API-і (backend/routes/admin_data.py) */

export interface Person { id: string; username: string; avatar?: string | null }
export interface Paged<T> { total: number; items: T[] }

export interface AdminStats {
  users: number; banned: number; projects: number; files: number; messages: number;
  groups: number; stories: number; opinions: number; vibecoding: number; notes: number;
}

export interface AdminUser {
  id: string; username: string; email: string; avatar: string | null; bio: string | null;
  role: 'moderator' | null; roleFromEnv: boolean; isAdmin: boolean;
  banned: boolean; bannedAt: string | null; banReason: string | null; locked: boolean;
  totpEnabled: boolean; githubLogin: string | null; lastSeenAt: string | null; createdAt: string | null;
  counts?: { projects: number; messages: number; conversations: number; groups: number; stories: number; notes: number; vibecoding: number };
}

export interface AdminCodeRow {
  id: string; title: string; author: string; language?: string; isFolder?: boolean; isPrivate?: boolean;
  folderId?: string | null; folderPath?: string | null; createdAt?: string; updatedAt?: string; protection?: string;
  likes: number; comments: number; views: number; files: number | null;
}

export interface AdminComment { id: string; author: string; content: string; createdAt?: string; replies?: AdminComment[] }
export type AdminCode = Omit<AdminCodeRow, 'likes' | 'comments' | 'views' | 'files'> & {
  description?: string; tags?: string[]; content?: string; locked?: boolean;
  likes?: string[]; comments?: AdminComment[]; views?: number;
}

export interface AdminStory {
  id: string; author: Person | null; mediaType: string; caption: string; projectId: string | null;
  mention: (Person & { kind: string; text: string }) | null; status: string; views: number; clicks: number;
  createdAt: string | null; expiresAt: string | null;
}

export interface AdminOpinion {
  id: string; kind: 'praise' | 'complaint'; text: string; evidence: string | null; verdict: string | null;
  status: string; author: Person | null; target: Person | null; createdAt: string | null;
}

export interface AdminGroupRow {
  id: string; name: string; description: string | null; owner: Person | null; members: number; messages: number; createdAt: string | null;
}

export interface ChatMsg {
  id: string; fromUserId: string; toUserId?: string | null; content: string; type?: string; createdAt?: string;
  sender?: Person | null; editedAt?: string; attachments?: unknown[];
}

export interface AdminGroup {
  id: string; name: string; description: string | null; ownerId: string; createdAt: string | null;
  members: (Person & { role: string; joinedAt: string | null })[];
  messages: ChatMsg[];
}

export interface AdminVibeRow {
  id: string; name: string; owner: Person | null; files: number; shared: boolean; createdAt: string | null; updatedAt: string | null;
}
export interface AdminVibe {
  id: string; name: string; ownerId: string; shared: boolean; createdAt: string | null; updatedAt: string | null;
  files: { path: string; language?: string; content: string }[];
}

export interface Conversation { peer: Person; count: number; lastAt: string }
export interface NoteMeta { id: string; title: string; folder: string; kind: string; updatedAt?: string }
export interface NoteFull extends NoteMeta { content: string }

const a = apiService.admin.bind(apiService);
const id = encodeURIComponent;

export const adminApi = {
  stats: () => a<AdminStats>('/stats'),

  users: (query: { q?: string; filter?: string; offset?: number; limit?: number }) => a<Paged<AdminUser>>('/users', { query }),
  user: (userId: string) => a<AdminUser>(`/users/${id(userId)}`),
  updateUser: (userId: string, body: Partial<{ username: string; email: string; bio: string; removeAvatar: boolean; role: 'user' | 'moderator' }>) =>
    a<AdminUser>(`/users/${id(userId)}`, { method: 'PATCH', body }),
  ban: (userId: string, reason: string) => a<AdminUser>(`/users/${id(userId)}/ban`, { method: 'POST', body: { reason } }),
  unban: (userId: string) => a<AdminUser>(`/users/${id(userId)}/unban`, { method: 'POST' }),
  deleteUser: (userId: string) => a(`/users/${id(userId)}`, { method: 'DELETE' }),
  unlock: (userId: string) => apiService.adminUnlockUser(userId),
  logoutEverywhere: (userId: string) => apiService.adminLogoutEverywhere(userId),

  codes: (query: { q?: string; author?: string; folderId?: string; offset?: number; limit?: number }) => a<Paged<AdminCodeRow>>('/codes', { query }),
  code: (codeId: string) => a<AdminCode>(`/codes/${id(codeId)}`),
  updateCode: (codeId: string, body: Partial<{ title: string; description: string; tags: string[]; isPrivate: boolean; content: string }>) =>
    a<AdminCode>(`/codes/${id(codeId)}`, { method: 'PATCH', body }),
  deleteCode: (codeId: string) => a(`/codes/${id(codeId)}`, { method: 'DELETE' }),
  deleteComment: (codeId: string, commentId: string) => a(`/codes/${id(codeId)}/comments/${id(commentId)}`, { method: 'DELETE' }),

  stories: (query: { offset?: number; limit?: number }) => a<Paged<AdminStory>>('/stories', { query }),
  deleteStory: (storyId: string) => a(`/stories/${id(storyId)}`, { method: 'DELETE' }),
  opinions: (query: { kind?: string; offset?: number; limit?: number }) => a<Paged<AdminOpinion>>('/opinions', { query }),
  deleteOpinion: (opinionId: string) => a(`/opinions/${id(opinionId)}`, { method: 'DELETE' }),

  groups: (query: { q?: string; offset?: number; limit?: number }) => a<Paged<AdminGroupRow>>('/groups', { query }),
  group: (groupId: string) => a<AdminGroup>(`/groups/${id(groupId)}`),
  updateGroup: (groupId: string, body: Partial<{ name: string; description: string }>) => a(`/groups/${id(groupId)}`, { method: 'PATCH', body }),
  deleteGroup: (groupId: string) => a(`/groups/${id(groupId)}`, { method: 'DELETE' }),
  removeMember: (groupId: string, userId: string) => a(`/groups/${id(groupId)}/members/${id(userId)}`, { method: 'DELETE' }),
  deleteGroupMessage: (groupId: string, messageId: string) => a(`/groups/${id(groupId)}/messages/${id(messageId)}`, { method: 'DELETE' }),

  vibecoding: (query: { q?: string; ownerId?: string; offset?: number; limit?: number }) => a<Paged<AdminVibeRow>>('/vibecoding', { query }),
  vibe: (projectId: string) => a<AdminVibe>(`/vibecoding/${id(projectId)}`),
  updateVibe: (projectId: string, body: Partial<{ name: string; revokeShare: boolean }>) => a(`/vibecoding/${id(projectId)}`, { method: 'PATCH', body }),
  deleteVibe: (projectId: string) => a(`/vibecoding/${id(projectId)}`, { method: 'DELETE' }),

  conversations: (userId: string) => a<{ items: Conversation[] }>(`/users/${id(userId)}/conversations`),
  conversation: (userA: string, userB: string) =>
    a<{ people: Record<string, Person>; messages: ChatMsg[] }>('/messages', { query: { a: userA, b: userB } }),
  editMessage: (messageId: string, content: string) => a<ChatMsg>(`/messages/${id(messageId)}`, { method: 'PATCH', body: { content } }),
  deleteMessage: (messageId: string) => a(`/messages/${id(messageId)}`, { method: 'DELETE' }),

  notes: (userId: string) => a<{ items: NoteMeta[] }>(`/users/${id(userId)}/notes`),
  note: (noteId: string) => a<NoteFull>(`/notes/${id(noteId)}`),
  updateNote: (noteId: string, body: Partial<{ title: string; content: string }>) => a<NoteFull>(`/notes/${id(noteId)}`, { method: 'PATCH', body }),
  deleteNote: (noteId: string) => a(`/notes/${id(noteId)}`, { method: 'DELETE' }),
};

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
