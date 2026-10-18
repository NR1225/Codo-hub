import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEdit, faTrash, faHeart, faCheck, faCopy, faComment, faDownload, faPaperPlane, faEllipsisVertical, faImage, faChevronDown, faChevronUp, faTimes } from '@fortawesome/free-solid-svg-icons';
import { faHeart as faRegHeartRegular } from '@fortawesome/free-regular-svg-icons';
import { CodeFile, Comment } from '../utils/api';
import { apiService } from '../utils/api';
import { subscribeToCode, unsubscribe } from '../utils/realtimeService';
import CodeEditor from '../components/CodeEditor';
import FileExplorer from '../components/FileExplorer';
import UploadModal from '../components/modals/UploadModal';
import Button from '../components/ui/Button';
import { isImageFile } from '../utils/fileHandler';
import { formatDate as formatDateUtil, formatDateTime } from '../utils/dateFormatter';
import './ViewCode.css';

interface CommentItemProps {
  comment: Comment;
  currentUser: { id: string; username: string } | null;
  editingCommentId: string | null;
  editingCommentText: string;
  setEditingCommentText: (text: string) => void;
  replyingToCommentId: string | null;
  replyText: string;
  setReplyText: (text: string) => void;
  replyImage: string | null;
  setReplyImage: (image: string | null) => void;
  isSubmittingReply: boolean;
  onEdit: (comment: Comment) => void;
  onSave: (commentId: string) => void;
  onCancelEdit: () => void;
  onDelete: (commentId: string) => void;
  onReply: (commentId: string) => void;
  onCancelReply: () => void;
  onSubmitReply: (e: React.FormEvent, parentId: string) => void;
  onLike: (commentId: string) => void;
  allComments?: Comment[];
  currentLanguage: string;
  authorAvatar?: string;
  onReplyImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  currentUser,
  editingCommentId,
  editingCommentText,
  setEditingCommentText,
  replyingToCommentId,
  replyText,
  setReplyText,
  replyImage,
  setReplyImage,
  isSubmittingReply,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  onReply,
  onCancelReply,
  onSubmitReply,
  onLike,
  allComments = [],
  currentLanguage,
  authorAvatar,
  onReplyImageSelect,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const isLiked = currentUser ? comment.likes?.includes(currentUser.id) : false;
  const likeCount = comment.likes?.length || 0;
  const isReply = comment.parentId ? true : false;
  
  // Find parent comment
  const parentComment = comment.parentId 
    ? allComments.find(c => c.id === comment.parentId)
    : null;

  const handleAvatarClick = () => {
    navigate(`/profile/${comment.author}`);
  };

  // Close menu when clicking outside
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showActionsMenu && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowActionsMenu(false);
      }
    };

    if (showActionsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionsMenu]);

  return (
    <div 
      className={`relative w-full mb-4 md:mb-6 ${isReply ? 'ml-8 md:ml-12 pl-4 md:pl-6 border-l-2 border-l-blue-200 dark:border-l-blue-800' : ''}`}
      data-comment-id={comment.id}
    >
      {isReply && parentComment && (
        <div className="mb-2 md:mb-3 pl-3 md:pl-4 py-1.5 md:py-2 bg-[var(--primary-color)]/10 border-l-3 border-l-[var(--primary-color)] rounded-r-lg">
          <div className="flex items-center gap-1.5 md:gap-2 mb-0.5 md:mb-1">
            <span className="text-[var(--primary-color)] font-semibold text-xs md:text-sm">{parentComment.author}</span>
          </div>
          <p className="text-[var(--text-secondary)] text-[10px] md:text-xs italic truncate">
            {parentComment.content.length > 60 
              ? parentComment.content.substring(0, 60) + '...' 
              : parentComment.content}
          </p>
        </div>
      )}
      
      <div className="flex gap-3 md:gap-4 w-full items-start">
        {/* Avatar */}
        <div
          className="w-9 h-9 md:w-12 md:h-12 rounded-full bg-[var(--primary-color)] flex items-center justify-center text-white font-semibold text-base md:text-lg flex-shrink-0 cursor-pointer shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 self-start overflow-hidden"
          onClick={handleAvatarClick}
          title={t('viewCode.viewProfile', { author: comment.author })}
        >
          {authorAvatar ? (
            <img 
              src={authorAvatar} 
              alt={comment.author}
              className="w-full h-full object-cover"
            />
          ) : (
            comment.author.charAt(0).toUpperCase()
          )}
        </div>
        
        {/* Comment Body */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 md:gap-3 mb-1.5 md:mb-2">
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <span className="font-semibold text-[var(--text-primary)] text-sm md:text-base">
                {comment.author}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {formatDateTime(comment.createdAt, currentLanguage)}
              </span>
            </div>
          </div>
          
          {/* Content */}
          {editingCommentId === comment.id ? (
            <div className="relative">
              <textarea
                className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl text-[var(--text-primary)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition-all duration-200"
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.target.value)}
                rows={3}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  className="px-3 py-1.5 bg-[var(--primary-color)] hover:opacity-90 text-white text-sm font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200 active:scale-95"
                  onClick={() => onSave(comment.id)}
                >
                  {t('common.save')}
                </button>
                <button
                  className="px-3 py-1.5 bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--primary-color)]/30 text-sm font-medium rounded-lg transition-all duration-200 active:scale-95"
                  onClick={onCancelEdit}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-secondary)] rounded-xl md:rounded-2xl p-3 md:p-4 shadow-sm border border-[var(--primary-color)]/20 hover:border-[var(--primary-color)]/40 hover:shadow-md relative">
              {currentUser && currentUser.username === comment.author && (
                <div className="absolute top-2 right-2" ref={menuRef}>
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-all duration-200 active:scale-95"
                    onClick={() => setShowActionsMenu(!showActionsMenu)}
                    title={t('viewCode.actionsTitle')}
                  >
                    <FontAwesomeIcon icon={faEllipsisVertical} className="w-4 h-4" />
                  </button>
                  {showActionsMenu && (
                    <div className="absolute top-full right-0 mt-2 w-40 bg-[var(--bg-secondary)] rounded-xl shadow-xl border border-[var(--primary-color)]/30 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                      <button
                        className="w-full px-4 py-2.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--primary-color)]/10 hover:text-[var(--primary-color)] transition-colors flex items-center gap-2"
                        onClick={() => {
                          onEdit(comment);
                          setShowActionsMenu(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faEdit} className="w-3.5 h-3.5" />
                        <span>{t('common.edit')}</span>
                      </button>
                      <button
                        className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                        onClick={() => {
                          onDelete(comment.id);
                          setShowActionsMenu(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                        <span>{t('common.delete')}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="text-[var(--text-primary)] text-xs md:text-sm leading-relaxed whitespace-pre-wrap break-words mb-2 md:mb-3">
                {comment.content.split(/(<img[^>]*>)/).map((part, index) => {
                  if (part.startsWith('<img')) {
                    // Extract src from img tag
                    const srcMatch = part.match(/src="([^"]*)"/);
                    if (srcMatch) {
                      const src = srcMatch[1];
                      // Only allow http/https/data protocol URLs to prevent XSS
                      if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
                        return <span key={index}>[image blocked]</span>;
                      }
                      return (
                        <img
                          key={index}
                          src={src}
                          alt="Comment image"
                          className="max-w-full rounded-lg mt-2"
                          style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '8px' }}
                        />
                      );
                    }
                  }
                  return <span key={index}>{part}</span>;
                })}
              </div>
              <div className="flex items-center justify-end gap-1.5 md:gap-2 pt-1.5 md:pt-2 border-t border-[var(--primary-color)]/20">
                <button
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium active:scale-95 w-auto ${
                    isLiked 
                      ? 'bg-[var(--primary-color)]/20 text-[var(--primary-color)] border border-[var(--primary-color)]/40' 
                      : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--primary-color)]/20 hover:border-[var(--primary-color)]/40 hover:text-[var(--primary-color)]'
                  }`}
                  onClick={() => onLike(comment.id)}
                  disabled={!currentUser}
                  title={t('common.like')}
                >
                  <span className="text-xs">👍</span>
                  {likeCount > 0 && <span className="text-xs">{likeCount}</span>}
                </button>
                {currentUser && (
                  <button
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--primary-color)]/20 hover:border-[var(--primary-color)]/40 hover:text-[var(--primary-color)] active:scale-95 w-auto"
                    onClick={() => onReply(comment.id)}
                  >
                    <FontAwesomeIcon icon={faComment} className="w-2.5 h-2.5" />
                    <span className="text-xs">{t('viewCode.reply')}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {replyingToCommentId === comment.id && currentUser && (
        <div className="mt-3 md:mt-4 ml-10 md:ml-16">
          <div className="mb-2 md:mb-3 flex items-center justify-between gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-2.5 bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/30 rounded-lg md:rounded-xl">
            <span className="text-xs md:text-sm text-[var(--text-primary)]">
              {t('viewCode.replyingTo')}: <strong className="text-[var(--primary-color)]">{comment.author}</strong>
            </span>
            <button
              type="button"
              className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded-full bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors"
              onClick={onCancelReply}
            >
              <FontAwesomeIcon icon={faTimes} className="w-2.5 h-2.5 md:w-3 md:h-3" />
            </button>
          </div>
          <form
            onSubmit={(e) => onSubmitReply(e, comment.id)}
            className="p-3 md:p-4 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl md:rounded-2xl shadow-lg backdrop-blur-sm focus-within:border-[var(--primary-color)] focus-within:shadow-xl transition-all duration-200"
          >
            <div className="flex items-end gap-2 md:gap-3">
              <label className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-[var(--primary-color)] flex items-center justify-center text-white font-semibold flex-shrink-0 cursor-pointer shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 active:scale-95">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onReplyImageSelect}
                />
                <FontAwesomeIcon icon={faImage} className="w-4 h-4" />
              </label>
              <div className="relative flex-1">
                {replyImage && (
                  <div className="mb-2 relative">
                    <img
                      src={replyImage}
                      alt="Preview"
                      className="max-w-full max-h-32 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setReplyImage(null)}
                      className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                )}
                <textarea
                  className="w-full px-3 md:px-4 py-2 md:py-3 bg-[var(--bg-primary)] border border-[var(--primary-color)]/30 rounded-lg md:rounded-xl text-[var(--text-primary)] text-xs md:text-sm resize-y min-h-[60px] md:min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition-all duration-200 placeholder:text-[var(--text-secondary)]"
                  placeholder={t('viewCode.replyPlaceholder')}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSubmitReply(e, comment.id);
                    }
                  }}
                  rows={3}
                />
              </div>
              <button
                type="submit"
                className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-lg md:rounded-xl bg-[var(--primary-color)] text-white border-none cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                disabled={(!replyText.trim() && !replyImage) || isSubmittingReply}
                title={isSubmittingReply ? t('common.loading') : t('viewCode.addReply')}
              >
                <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const ViewCode: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentLanguage = i18n.language;
  const [code, setCode] = useState<CodeFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [commentImage, setCommentImage] = useState<string | null>(null);
  const [replyImage, setReplyImage] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<CodeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  const [userAvatars, setUserAvatars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id) {
      let cancelled = false;
      const loadCodeWithCancel = async (codeId: string) => {
        if (cancelled) return;
        try {
          setLoading(true);
          const data = await apiService.getCodeFile(codeId);
          if (cancelled) return;
          setCode(data);
          setError(null);

          // Load current user if not already loaded
          if (!currentUser) {
            await loadCurrentUser();
          }
          if (cancelled) return;

          // Load avatars for comment authors
          if (data.comments && data.comments.length > 0) {
            loadCommentAuthorAvatars(data.comments);
          }

          // Increment view count
          try {
            const userId = currentUser?.id || (() => {
              try {
                const storedUser = localStorage.getItem('user');
                if (storedUser) {
                  const userData = JSON.parse(storedUser);
                  return userData.id || null;
                }
              } catch (e) {
                // Ignore
              }
              return null;
            })();
            const updatedCode = await apiService.incrementView(codeId, userId);
            if (cancelled) return;
            if (updatedCode) {
              setCode(updatedCode);
              if (updatedCode.comments && updatedCode.comments.length > 0) {
                loadCommentAuthorAvatars(updatedCode.comments);
              }
            }
          } catch (viewError) {
            console.error('Failed to increment view:', viewError);
          }

          // Load files only if it's a folder
          if (data.isFolder) {
            await loadFolderFiles(codeId);
          } else {
            setFolderFiles([]);
            setSelectedFile(null);
          }
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : t('viewCode.errorLoadingCode'));
        } finally {
          if (!cancelled) setLoading(false);
        }
      };

      loadCodeWithCancel(id);

      // Real-time listener қосу
      const unsubscribeListener = subscribeToCode(
        id,
        (updatedCode) => {
          if (cancelled) return;
          setCode(updatedCode);
          // Load avatars for comment authors if comments exist
          if (updatedCode.comments && updatedCode.comments.length > 0) {
            loadCommentAuthorAvatars(updatedCode.comments);
          }
          // Егер папка болса, файлдарды жүктеу
          if (updatedCode.isFolder) {
            loadFolderFiles(id);
          } else {
            // Егер папка емес болса, файлдарды тазалау
            setFolderFiles([]);
            setSelectedFile(null);
          }
        },
        (error) => {
          console.error('Real-time listener error:', error);
          // Егер real-time жұмыс істемесе, қалыпты жолмен жүктеу
          if (!code && !cancelled) {
            loadCodeWithCancel(id);
          }
        }
      );

      return () => {
        cancelled = true;
        unsubscribeListener();
        unsubscribe(`code-${id}`);
      };
    }
  }, [id]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showActionsMenu && !target.closest('.code-actions-menu')) {
        setShowActionsMenu(false);
      }
    };

    if (showActionsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionsMenu]);

  // Auto-scroll to bottom when comments change
  useEffect(() => {
    if (commentsContainerRef.current && code?.comments && code.comments.length > 0) {
      // Small delay to ensure DOM is updated
      const scrollTimeout = setTimeout(() => {
        if (commentsContainerRef.current) {
          commentsContainerRef.current.scrollTo({
            top: commentsContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
      
      return () => clearTimeout(scrollTimeout);
    }
  }, [code?.comments]);


  const loadCurrentUser = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        setCurrentUser({ id: userData.id, username: userData.username });
      }
    } catch (err) {
      console.error('Failed to load current user:', err);
    }
  };

  const loadCommentAuthorAvatars = async (comments: Comment[]) => {
    if (!comments || comments.length === 0) return;
    
    // Get unique authors
    const uniqueAuthors = Array.from(new Set(comments.map(c => c.author)));
    
    // Filter out authors we already have avatars for
    const authorsToLoad = uniqueAuthors.filter(author => !userAvatars[author]);
    
    if (authorsToLoad.length === 0) return;
    
    // Load avatars for each author
    const avatarPromises = authorsToLoad.map(async (author) => {
      try {
        const user = await apiService.getUserByUsername(author);
        return { author, avatar: user.avatar || undefined };
      } catch (err) {
        console.error(`Failed to load avatar for ${author}:`, err);
        return { author, avatar: undefined };
      }
    });
    
    const avatarResults = await Promise.all(avatarPromises);
    const newAvatars: Record<string, string> = {};
    
    avatarResults.forEach(({ author, avatar }) => {
      if (avatar) {
        newAvatars[author] = avatar;
      }
    });
    
    if (Object.keys(newAvatars).length > 0) {
      setUserAvatars(prev => ({ ...prev, ...newAvatars }));
    }
  };

  const loadCode = async (codeId: string) => {
    try {
      setLoading(true);
      const data = await apiService.getCodeFile(codeId);
      setCode(data);
      setError(null);
      
      // Load current user if not already loaded
      if (!currentUser) {
        await loadCurrentUser();
      }
      
      // Load avatars for comment authors
      if (data.comments && data.comments.length > 0) {
        loadCommentAuthorAvatars(data.comments);
      }
      
      // Increment view count (after code is loaded)
      try {
        // Get current user from state or localStorage
        const userId = currentUser?.id || (() => {
          try {
            const storedUser = localStorage.getItem('user');
            if (storedUser) {
              const userData = JSON.parse(storedUser);
              return userData.id || null;
            }
          } catch (e) {
            // Ignore
          }
          return null;
        })();
        const updatedCode = await apiService.incrementView(codeId, userId);
        if (updatedCode) {
          setCode(updatedCode);
          // Load avatars for new comments if any
          if (updatedCode.comments && updatedCode.comments.length > 0) {
            loadCommentAuthorAvatars(updatedCode.comments);
          }
        }
      } catch (viewError) {
        // Silently fail if view increment fails
        console.error('Failed to increment view:', viewError);
      }
      
      // Load files only if it's a folder
      if (data.isFolder) {
        await loadFolderFiles(codeId);
      } else {
        // If it's not a folder, clear folder files
        setFolderFiles([]);
        setSelectedFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('viewCode.errorLoadingCode'));
    } finally {
      setLoading(false);
    }
  };

  const loadFolderFiles = async (folderId: string) => {
    try {
      setLoadingFiles(true);
      const response = await apiService.getCodeFiles(folderId, 1000, 0, true);
      const files = response.codes;
      setFolderFiles(files);
      if (files.length > 0) {
        setSelectedFile(files[0]);
      }
    } catch (err) {
      console.error('Failed to load folder files:', err);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleExportFolder = async () => {
    if (!folderFiles || folderFiles.length === 0) {
      alert(t('viewCode.noFilesToExport'));
      return;
    }

    try {
      // jszip-ті тек қана экспорт кезінде динамикалық жүктеу (~100KB)
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      
      // Add all files to ZIP maintaining folder structure
      for (const file of folderFiles) {
        const filePath = file.folderPath || file.title;
        
        // Handle image files - convert base64 to blob
        if (isImageFile(file.title)) {
          let imageData = file.content;
          // If it's a data URL, extract base64 part
          if (imageData.startsWith('data:')) {
            const base64Match = imageData.match(/base64,(.+)/);
            if (base64Match) {
              imageData = base64Match[1];
            }
          }
          zip.file(filePath, imageData, { base64: true });
        } else {
          // Text files
          zip.file(filePath, file.content);
        }
      }

      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Create download link
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${code?.title || 'folder'}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export folder:', err);
      alert(t('viewCode.errorExportFolder'));
    }
  };

  const handleFileSelect = (file: CodeFile) => {
    setSelectedFile(file);
  };

  const handleUploadSuccess = async () => {
    if (code && id) {
      await loadFolderFiles(id);
      await loadCode(id);
    }
  };

  const handleDeleteCode = async () => {
    if (!code || !currentUser) return;

    // Тек автор ғана жоя алады (батырма тек авторға ғана көрсетіледі, бірақ қосымша қауіпсіздік үшін тексереміз)
    if (code.author !== currentUser.username) {
      alert(t('viewCode.errorOnlyAuthorCanDelete'));
      return;
    }

    const confirmMessage = t('viewCode.deleteConfirmTitle', { title: code.title });

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setIsDeleting(true);
      await apiService.deleteCodeFile(code.id);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete code:', err);
      alert(t('viewCode.errorDeleteCode'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditCode = () => {
    if (!code) return;
    setEditTitle(code.title);
    setEditDescription(code.description || '');
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!code || !editTitle.trim()) return;

    try {
      setIsSaving(true);
      const updatedCode = await apiService.updateCodeFile(code.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      });
      setCode(updatedCode);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update code:', err);
      alert(t('viewCode.errorEditFolder'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEditFolder = () => {
    setIsEditing(false);
    setEditTitle('');
    setEditDescription('');
  };

  const handleLike = async () => {
    if (!code || !currentUser) return;
    
    // Optimistic update - бірден state-ті өзгерту
    const isLiked = code.likes?.includes(currentUser.id);
    const currentLikes = code.likes || [];
    const updatedLikes = isLiked
      ? currentLikes.filter(id => id !== currentUser.id)
      : [...currentLikes, currentUser.id];
    
    // Бірден state-ті жаңарту
    setCode({
      ...code,
      likes: updatedLikes
    });
    
    try {
      // API сұрауын жіберу
      const updatedCode = isLiked
        ? await apiService.unlikeCode(code.id, currentUser.id)
        : await apiService.likeCode(code.id, currentUser.id);
      setCode(updatedCode);
    } catch (err) {
      console.error('Failed to toggle like:', err);
      // Егер API сұрауы сәтсіз болса, state-ті қайтару
      setCode({
        ...code,
        likes: currentLikes
      });
    }
  };

  const handleAddComment = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (!code || !currentUser || (!commentText.trim() && !commentImage)) return;

    // Build comment content with image if present
    let commentContent = commentText.trim();
    if (commentImage) {
      const imageTag = `<img src="${commentImage}" alt="Comment image" style="max-width: 100%; border-radius: 8px; margin-top: 8px;" />`;
      commentContent = commentContent ? `${commentContent}\n${imageTag}` : imageTag;
    }

    const commentTextToAdd = commentContent;
    setIsSubmittingComment(true);
    
    // Optimistic UI update - пікірді бірден көрсету
    const optimisticComment: Comment = {
      id: `temp-${Date.now()}`,
      author: currentUser.username,
      content: commentTextToAdd,
      createdAt: new Date().toISOString(),
      likes: [],
    };
    
    setCode(prevCode => {
      if (!prevCode) return prevCode;
      return {
        ...prevCode,
        comments: [...(prevCode.comments || []), optimisticComment]
      };
    });
    setCommentText('');
    setCommentImage(null);
    
    try {
      const updatedCode = await apiService.addComment(
        code.id,
        currentUser.username,
        commentTextToAdd
      );
      setCode(updatedCode);
      // Load avatars for comment authors
      if (updatedCode.comments && updatedCode.comments.length > 0) {
        loadCommentAuthorAvatars(updatedCode.comments);
      }
    } catch (err) {
      console.error('Failed to add comment:', err);
      // Optimistic update-ті к geri алу
      setCode(prevCode => {
        if (!prevCode) return prevCode;
        return {
          ...prevCode,
          comments: (prevCode.comments || []).filter(c => c.id !== optimisticComment.id)
        };
      });
      setCommentText(commentText.trim());
      setCommentImage(commentImage);
      alert(t('viewCode.errorAddComment'));
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.content);
  };

  const handleSaveComment = async (commentId: string) => {
    if (!code || !editingCommentText.trim()) return;

    try {
      const updatedCode = await apiService.updateComment(
        code.id,
        commentId,
        editingCommentText.trim()
      );
      setCode(updatedCode);
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (err) {
      console.error('Failed to update comment:', err);
      alert(t('viewCode.errorEditComment'));
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!code) return;
    
    if (!confirm(t('viewCode.deleteConfirm'))) {
      return;
    }

    try {
      const updatedCode = await apiService.deleteComment(code.id, commentId);
      setCode(updatedCode);
    } catch (err) {
      console.error('Failed to delete comment:', err);
      alert(t('viewCode.errorDeleteComment'));
    }
  };

  const handleReply = (commentId: string) => {
    setReplyingToCommentId(commentId);
    setReplyText('');
  };

  const handleCancelReply = () => {
    setReplyingToCommentId(null);
    setReplyText('');
    setReplyImage(null);
  };

  const handleCommentImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert(t('viewCode.errorImageFilesOnly'));
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert(t('viewCode.errorImageSizeLimit'));
      return;
    }

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setCommentImage(result);
      };
      reader.onerror = () => {
        alert(t('viewCode.errorReadImage'));
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error reading image:', err);
      alert(t('viewCode.errorProcessImage'));
    }
  };

  const handleReplyImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert(t('viewCode.errorImageFilesOnly'));
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert(t('viewCode.errorImageSizeLimit'));
      return;
    }

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setReplyImage(result);
      };
      reader.onerror = () => {
        alert(t('viewCode.errorReadImage'));
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error reading image:', err);
      alert(t('viewCode.errorProcessImage'));
    }
  };

  const handleSubmitReply = async (e: React.FormEvent, parentId: string) => {
    e.preventDefault();
    if (!code || !currentUser || (!replyText.trim() && !replyImage)) return;

    // Build reply content with image if present
    let replyContent = replyText.trim();
    if (replyImage) {
      const imageTag = `<img src="${replyImage}" alt="Reply image" style="max-width: 100%; border-radius: 8px; margin-top: 8px;" />`;
      replyContent = replyContent ? `${replyContent}\n${imageTag}` : imageTag;
    }

    setIsSubmittingReply(true);
    try {
      const updatedCode = await apiService.addReply(
        code.id,
        parentId,
        currentUser.username,
        replyContent
      );
      setCode(updatedCode);
      // Load avatars for comment authors
      if (updatedCode.comments && updatedCode.comments.length > 0) {
        loadCommentAuthorAvatars(updatedCode.comments);
      }
      setReplyText('');
      setReplyImage(null);
      setReplyingToCommentId(null);
      
      // Жаңа жауапқа scroll жасау
      setTimeout(() => {
        const repliesContainer = document.querySelector(`[data-parent-id="${parentId}"]`);
        if (repliesContainer) {
          const replies = repliesContainer.querySelectorAll('[data-comment-id]');
          if (replies.length > 0) {
            const lastReply = replies[replies.length - 1] as HTMLElement;
            lastReply.classList.add('animate-pulse');
            lastReply.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Анимациядан кейін классты алып тастау
            setTimeout(() => {
              lastReply.classList.remove('animate-pulse');
            }, 1000);
          }
        }
      }, 100);
    } catch (err) {
      console.error('Failed to add reply:', err);
      alert(t('viewCode.errorAddReply'));
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!code || !currentUser) return;

    // Find the comment
    const comment = code.comments?.find(c => c.id === commentId);
    if (!comment) return;

    // Store original likes for rollback
    const originalLikes = comment.likes || [];

    // Optimistic UI update - update UI immediately
    const isLiked = originalLikes.includes(currentUser.id);
    const newLikes = isLiked
      ? originalLikes.filter(id => id !== currentUser.id)
      : [...originalLikes, currentUser.id];

    // Update comment optimistically - update UI immediately
    const updatedComments = (code.comments || []).map(c =>
      c.id === commentId
        ? { ...c, likes: newLikes }
        : c
    );
    setCode({ ...code, comments: updatedComments });

    try {
      // Then update server
      const updatedCode = await apiService.likeComment(code.id, commentId, currentUser.id);
      // Update with server response
      setCode(updatedCode);
    } catch (err) {
      console.error('Failed to like comment:', err);
      // Rollback on error - revert to original state
      const originalComments = (code.comments || []).map(c =>
        c.id === commentId
          ? { ...c, likes: originalLikes }
          : c
      );
      setCode({ ...code, comments: originalComments });
    }
  };


  // Organize comments: top-level comments first, then all their replies below (flat structure, recursive)
  const organizeComments = (comments: Comment[]): Comment[] => {
    const topLevel: Comment[] = [];
    const repliesMap: Record<string, Comment[]> = {};

    // Separate top-level comments and replies
    comments.forEach(comment => {
      if (comment.parentId) {
        if (!repliesMap[comment.parentId]) {
          repliesMap[comment.parentId] = [];
        }
        repliesMap[comment.parentId].push(comment);
      } else {
        topLevel.push(comment);
      }
    });

    // Recursive function to add comment and all its replies (flat structure)
    const addCommentAndReplies = (comment: Comment): Comment[] => {
      const result: Comment[] = [comment];
      // Add all replies directly below the parent comment
      if (repliesMap[comment.id]) {
        repliesMap[comment.id].forEach(reply => {
          // Recursively add reply and its own replies
          result.push(...addCommentAndReplies(reply));
        });
      }
      return result;
    };

    // Create flat list: top-level comment, then all its replies (recursively), then next top-level comment, etc.
    const result: Comment[] = [];
    topLevel.forEach(comment => {
      result.push(...addCommentAndReplies(comment));
    });

    return result;
  };

  const isLiked = code && currentUser ? code.likes?.includes(currentUser.id) : false;
  const likeCount = code?.likes?.length || 0;

  if (loading) {
    return (
      <div className="view-code-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !code) {
    return (
      <div className="view-code-container">
        <div className="error-state">
          <p className="error-icon">❌</p>
          <p className="error-title">{t('viewCode.error')}</p>
          <p className="error-message">{error || t('viewCode.pageNotFound')}</p>
          <Button onClick={() => navigate('/')} variant="primary">
            {t('home.title')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-code-container">
      <button onClick={() => navigate(-1)} className="back-button">
        ← {t('common.back')}
      </button>

      <div className="code-header">
        <div className="code-header-main">
          <div className="code-header-top">
            <div className="code-header-title-section">
              <h1 className="code-title">{code.title}</h1>
              {code.description && (
                <div className="code-description-wrapper">
                  <div className="code-description-content">
                    <p className={`code-description ${isDescriptionExpanded ? 'expanded' : 'collapsed'}`}>
                      {code.description}
                    </p>
                    {code.description.length > 100 && (
                      <button
                        className="code-description-toggle"
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        title={isDescriptionExpanded ? t('common.hide') : t('viewCode.showMore')}
                      >
                        <FontAwesomeIcon icon={isDescriptionExpanded ? faChevronUp : faChevronDown} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {currentUser && code.author === currentUser.username && (
              <div className="code-actions-menu">
                <button
                  className="btn-actions-menu-toggle"
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  title={t('viewCode.actionsTitle')}
                >
                  <FontAwesomeIcon icon={faEllipsisVertical} />
                </button>
                {showActionsMenu && (
                  <div className="actions-menu-dropdown">
                    {currentUser && code.author === currentUser.username && (
                      <button
                        className="actions-menu-item"
                        onClick={() => {
                          handleEditCode();
                          setShowActionsMenu(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faEdit} /> {t('common.edit')}
                      </button>
                    )}
                    {currentUser && code.author === currentUser.username && (
                      <button
                        className="actions-menu-item actions-menu-item-danger"
                        onClick={() => {
                          handleDeleteCode();
                          setShowActionsMenu(false);
                        }}
                        disabled={isDeleting}
                      >
                        {isDeleting ? t('common.loading') : <><FontAwesomeIcon icon={faTrash} /> {t('common.delete')}</>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="code-meta-inline">
          <span className="meta-item-inline">
            <span className="meta-label">{t('viewCode.language')}:</span>
            <span className="meta-value">{code.language}</span>
          </span>
          <span className="meta-item-inline">
            <span className="meta-label">{t('viewCode.author')}:</span>
            <span className="meta-value">{code.author === currentUser?.username ? t('viewCode.youLabel') : code.author}</span>
          </span>
          <span className="meta-item-inline">
            <span className="meta-label">{t('viewCode.created')}:</span>
            <span className="meta-value">{formatDateUtil(code.createdAt, currentLanguage, 'long')}</span>
          </span>
          <span className="meta-item-inline">
            <span className="meta-label">{t('viewCode.updated')}:</span>
            <span className="meta-value">{formatDateUtil(code.updatedAt, currentLanguage, 'long')}</span>
          </span>
        </div>

        {code.tags && code.tags.length > 0 && (
          <div className="code-tags">
            {code.tags.filter(tag => tag.toLowerCase() !== 'folder').map((tag, index) => (
              <span key={index} className="tag">{tag}</span>
            ))}
          </div>
        )}

        <div className="code-header-actions">
          <button
            className={`like-button-header ${isLiked ? 'liked' : ''}`}
            onClick={handleLike}
            disabled={!currentUser}
            title={currentUser ? (isLiked ? t('viewCode.unlike') : t('viewCode.likeButton')) : t('viewCode.loginToLike')}
          >
            <FontAwesomeIcon icon={isLiked ? faHeart : faRegHeartRegular} /> {likeCount}
          </button>
          {code.isFolder && folderFiles.length > 0 && (
            <button
              className="btn-export-folder"
              onClick={handleExportFolder}
              title={t('viewCode.exportFolderTitle')}
            >
              <FontAwesomeIcon icon={faDownload} /> {t('viewCode.exportFolder')}
            </button>
          )}
        </div>
      </div>

      {/* Single file (non-folder) code view */}
      {!code.isFolder && (
        <>
          <div className="code-content">
            <div className="file-code-container">
              {isImageFile(code.title) ? (
                <div className="image-preview-wrapper">
                  <div className="image-preview-container">
                    <img
                      src={(() => {
                        const content = code.content;
                        if (content.startsWith('data:') || content.startsWith('http://') || content.startsWith('https://')) {
                          return content;
                        }
                        const ext = code.title.split('.').pop()?.toLowerCase() || 'png';
                        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                       ext === 'png' ? 'image/png' :
                                       ext === 'gif' ? 'image/gif' :
                                       ext === 'webp' ? 'image/webp' :
                                       ext === 'svg' ? 'image/svg+xml' :
                                       ext === 'bmp' ? 'image/bmp' : 'image/png';
                        return `data:${mimeType};base64,${content}`;
                      })()}
                      alt={code.title}
                      className="image-preview"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'image-error';
                        errorDiv.textContent = t('viewCode.errorDisplayImage');
                        target.parentElement?.appendChild(errorDiv);
                      }}
                    />
                  </div>
                  <button
                    className="btn-copy-code-sticky"
                    onClick={async () => {
                      try {
                        const img = document.querySelector('.image-preview') as HTMLImageElement;
                        if (img && img.src) {
                          const response = await fetch(img.src);
                          const blob = await response.blob();
                          await navigator.clipboard.write([
                            new ClipboardItem({ [blob.type]: blob })
                          ]);
                          setIsCopied(true);
                          setTimeout(() => setIsCopied(false), 5000);
                        }
                      } catch (err) {
                        console.error('Failed to copy image:', err);
                      }
                    }}
                  >
                    {isCopied ? <><FontAwesomeIcon icon={faCheck} /> {t('viewCode.imageCopied')}</> : <><FontAwesomeIcon icon={faCopy} /> {t('viewCode.copyImage')}</>}
                  </button>
                </div>
              ) : (
                <div className="code-wrapper">
                  <CodeEditor
                    code={code.content}
                    language={code.language}
                    readOnly={true}
                    lineNumbers={true}
                  />
                  <button
                    className="btn-copy-code-sticky"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(code.content);
                        setIsCopied(true);
                        setTimeout(() => setIsCopied(false), 5000);
                      } catch (err) {
                        console.error('Failed to copy:', err);
                      }
                    }}
                  >
                    {isCopied ? <><FontAwesomeIcon icon={faCheck} /> {t('viewCode.codeCopied')}</> : <><FontAwesomeIcon icon={faCopy} /> {t('viewCode.copyCode')}</>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Single file comments */}
          <div
            className="bg-[var(--bg-secondary)] border-[1.5px] border-[var(--border-color)] rounded-2xl md:p-8 p-3 md:mt-8 mt-4 w-full max-w-[1100px] mx-auto md:h-[calc(100vh-120px)] h-auto md:max-h-[calc(100vh-120px)] max-h-none overflow-y-auto overflow-x-hidden flex flex-col shadow-[0_4px_12px_rgba(0,0,0,0.1),0_2px_4px_rgba(0,0,0,0.06)] box-border flex-shrink-0 relative folder-comments-container"
            ref={commentsContainerRef}
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#d4d4d4 var(--bg-secondary)' }}
          >
            <div className="flex flex-col min-h-0 overflow-hidden w-full max-w-full box-border flex-1 h-auto">
              <div className="flex items-center gap-2 md:gap-4 mb-4 md:mb-8 pb-2 md:pb-4 border-b border-[var(--primary-color)]/20 flex-shrink-0">
                <h2 className="text-lg md:text-2xl text-[var(--text-primary)] m-0 font-bold flex items-center gap-2 md:gap-3">
                  <FontAwesomeIcon icon={faComment} className="text-[var(--primary-color)]" />
                  {t('viewCode.comments')} ({code.comments?.length || 0})
                </h2>
                <div className="flex-1 h-px bg-gradient-to-r from-[var(--primary-color)]/20 to-transparent"></div>
              </div>

              <div className="flex flex-col gap-3 md:gap-4 mb-0 min-h-0 overflow-y-auto overflow-x-hidden pb-2 md:pb-4 pr-0 md:pr-2 w-full max-w-full box-border flex-1">
                {code.comments && code.comments.length > 0 ? (
                  organizeComments(code.comments).map((comment: Comment) => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      currentUser={currentUser}
                      editingCommentId={editingCommentId}
                      editingCommentText={editingCommentText}
                      setEditingCommentText={setEditingCommentText}
                      replyingToCommentId={replyingToCommentId}
                      replyText={replyText}
                      setReplyText={setReplyText}
                      replyImage={replyImage}
                      setReplyImage={setReplyImage}
                      isSubmittingReply={isSubmittingReply}
                      onEdit={handleEditComment}
                      onSave={handleSaveComment}
                      onCancelEdit={handleCancelEdit}
                      onDelete={handleDeleteComment}
                      onReply={handleReply}
                      onCancelReply={handleCancelReply}
                      onSubmitReply={handleSubmitReply}
                      onLike={handleLikeComment}
                      allComments={code.comments || []}
                      currentLanguage={currentLanguage}
                      authorAvatar={userAvatars[comment.author]}
                      onReplyImageSelect={handleReplyImageSelect}
                    />
                  ))
                ) : (
                  <div className="text-center py-8 md:py-12">
                    <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm">{t('viewCode.noComments')}</p>
                  </div>
                )}
              </div>

              {currentUser && !replyingToCommentId ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddComment(e);
                  }}
                  className="sticky bottom-0 mt-4 md:mt-6 mb-0 p-2 md:p-4 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl md:rounded-2xl shadow-lg backdrop-blur-sm flex-shrink-0 z-10 focus-within:border-[var(--primary-color)] focus-within:shadow-xl transition-all duration-200"
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <label className="h-[28px] w-[28px] md:h-[32px] md:w-[32px] min-h-[28px] min-w-[28px] md:min-h-[32px] md:min-w-[32px] box-border rounded-lg md:rounded-xl bg-[var(--primary-color)] flex items-center justify-center text-white font-semibold flex-shrink-0 cursor-pointer shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 active:scale-95">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleCommentImageSelect}
                      />
                      <FontAwesomeIcon icon={faImage} className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </label>
                    <div className="relative flex-1">
                      {commentImage && (
                        <div className="mb-2 relative">
                          <img
                            src={commentImage}
                            alt="Preview"
                            className="max-w-full max-h-24 md:max-h-32 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setCommentImage(null)}
                            className="absolute top-1 right-1 w-5 h-5 md:w-6 md:h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      <textarea
                        className="w-full px-3 md:px-4 py-1 md:py-1.5 bg-[var(--bg-primary)] border border-[var(--primary-color)]/30 rounded-lg md:rounded-xl text-[var(--text-primary)] text-xs md:text-sm resize-none h-[28px] md:h-[32px] min-h-[28px] md:min-h-[32px] max-h-[28px] md:max-h-[32px] box-border focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition-all duration-200 placeholder:text-[var(--text-secondary)] overflow-y-hidden"
                        placeholder={t('viewCode.commentPlaceholder')}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddComment(e);
                          }
                        }}
                        rows={1}
                      />
                    </div>
                    <button
                      type="submit"
                      className="h-[28px] w-[28px] md:h-[32px] md:w-[32px] min-h-[28px] min-w-[28px] md:min-h-[32px] md:min-w-[32px] box-border flex items-center justify-center rounded-lg md:rounded-xl bg-[var(--primary-color)] text-white border-none cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={(!commentText.trim() && !commentImage) || isSubmittingComment}
                      title={isSubmittingComment ? t('common.loading') : t('viewCode.addComment')}
                    >
                      <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </button>
                  </div>
                </form>
              ) : !currentUser ? (
                <div className="sticky bottom-0 mt-4 md:mt-6 mb-0 p-3 md:p-4 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl md:rounded-2xl flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs md:text-sm text-[var(--text-secondary)]">
                      {t('viewCode.loginToComment')}
                    </p>
                    <button
                      onClick={() => navigate('/login')}
                      className="px-3 md:px-4 py-1.5 md:py-2 bg-[var(--primary-color)] hover:opacity-90 text-white text-xs md:text-sm font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200 active:scale-95"
                    >
                      {t('common.login')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      {code.isFolder && (
      <div className="folder-view-wrapper">
        <div className="folder-view">
          <div className="folder-explorer">
              <div className="folder-explorer-header">
                <h3 className="folder-explorer-title">{t('viewCode.files')} ({folderFiles.length})</h3>
              </div>
            <FileExplorer
              files={folderFiles}
              onFileSelect={handleFileSelect}
              selectedFileId={selectedFile?.id}
              showFolderStructure={true}
            />
          </div>
          <div className="folder-content">
            {loadingFiles ? (
              <div className="loading-spinner">
                <div className="spinner"></div>
                  <p>{t('viewCode.loadingFiles')}</p>
              </div>
            ) : selectedFile ? (
              <>
                <div className="file-code-container">
                <div className="file-header">
                  <div className="file-header-left">
                    <h3 className="file-title">{selectedFile.title}</h3>
                    <span className="file-path">{selectedFile.folderPath}</span>
                  </div>
                </div>
                  {isImageFile(selectedFile.title) ? (
                    <div className="image-preview-wrapper">
                      <div className="image-preview-container">
                        <img 
                          src={(() => {
                            const content = selectedFile.content;
                            // If already a data URL or HTTP URL, use as is
                            if (content.startsWith('data:') || content.startsWith('http://') || content.startsWith('https://')) {
                              return content;
                            }
                            // If it's base64 without prefix, add the data URL prefix
                            const ext = selectedFile.title.split('.').pop()?.toLowerCase() || 'png';
                            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                           ext === 'png' ? 'image/png' :
                                           ext === 'gif' ? 'image/gif' :
                                           ext === 'webp' ? 'image/webp' :
                                           ext === 'svg' ? 'image/svg+xml' :
                                           ext === 'bmp' ? 'image/bmp' : 'image/png';
                            return `data:${mimeType};base64,${content}`;
                          })()}
                          alt={selectedFile.title}
                          className="image-preview"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'image-error';
                            errorDiv.textContent = t('viewCode.errorDisplayImage');
                            target.parentElement?.appendChild(errorDiv);
                          }}
                        />
                      </div>
                      <button
                        className="btn-copy-code-sticky"
                        onClick={async () => {
                          try {
                            const img = document.querySelector('.image-preview') as HTMLImageElement;
                            if (img && img.src) {
                              const response = await fetch(img.src);
                              const blob = await response.blob();
                              await navigator.clipboard.write([
                                new ClipboardItem({ [blob.type]: blob })
                              ]);
                              setIsCopied(true);
                              setTimeout(() => setIsCopied(false), 5000);
                            }
                          } catch (err) {
                            console.error('Failed to copy image:', err);
                            // Fallback: copy image URL
                            try {
                              const img = document.querySelector('.image-preview') as HTMLImageElement;
                              if (img && img.src) {
                                await navigator.clipboard.writeText(img.src);
                                setIsCopied(true);
                                setTimeout(() => setIsCopied(false), 5000);
                              }
                            } catch (err2) {
                              console.error('Failed to copy image URL:', err2);
                            }
                          }
                        }}
                      >
                        {isCopied ? <><FontAwesomeIcon icon={faCheck} /> {t('viewCode.imageCopied')}</> : <><FontAwesomeIcon icon={faCopy} /> {t('viewCode.copyImage')}</>}
                      </button>
                    </div>
                  ) : (
                    <div className="code-wrapper">
                      <CodeEditor
                        code={selectedFile.content}
                        language={selectedFile.language}
                        readOnly={true}
                        lineNumbers={true}
                      />
                      <button
                        className="btn-copy-code-sticky"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(selectedFile.content);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 5000);
                          } catch (err) {
                            console.error('Failed to copy:', err);
                          }
                        }}
                      >
                        {isCopied ? <><FontAwesomeIcon icon={faCheck} /> {t('viewCode.codeCopied')}</> : <><FontAwesomeIcon icon={faCopy} /> {t('viewCode.copyCode')}</>}
                      </button>
                    </div>
                  )}
                </div>
              </>
              ) : (
                <div className="no-file-selected">
                  <p>{t('viewCode.noFileSelected')}</p>
                </div>
              )}
          </div>
                </div>

          {/* Папка үшін ортақ пікірлер контейнері */}
          <div 
            className="bg-[var(--bg-secondary)] border-[1.5px] border-[var(--border-color)] rounded-2xl md:p-8 p-3 md:mt-8 mt-4 w-full max-w-[1100px] mx-auto md:h-[calc(100vh-120px)] h-auto md:max-h-[calc(100vh-120px)] max-h-none overflow-y-auto overflow-x-hidden flex flex-col shadow-[0_4px_12px_rgba(0,0,0,0.1),0_2px_4px_rgba(0,0,0,0.06)] box-border col-span-full flex-shrink-0 relative folder-comments-container"
            ref={commentsContainerRef}
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#d4d4d4 var(--bg-secondary)' }}
          >
            {/* Пікірлер бөлімі */}
            <div className="flex flex-col min-h-0 overflow-hidden w-full max-w-full box-border flex-1 h-auto">
              {/* Header */}
              <div className="flex items-center gap-2 md:gap-4 mb-4 md:mb-8 pb-2 md:pb-4 border-b border-[var(--primary-color)]/20 flex-shrink-0">
                <h2 className="text-lg md:text-2xl text-[var(--text-primary)] m-0 font-bold flex items-center gap-2 md:gap-3">
                  <FontAwesomeIcon icon={faComment} className="text-[var(--primary-color)]" /> 
                  {t('viewCode.comments')} ({code.comments?.length || 0})
                </h2>
                <div className="flex-1 h-px bg-gradient-to-r from-[var(--primary-color)]/20 to-transparent"></div>
              </div>

              {/* Пікірлер тізімі */}
              <div className="flex flex-col gap-3 md:gap-4 mb-0 min-h-0 overflow-y-auto overflow-x-hidden pb-2 md:pb-4 pr-0 md:pr-2 w-full max-w-full box-border flex-1 scrollbar-thin scrollbar-thumb-blue-300 dark:scrollbar-thumb-blue-700 scrollbar-track-transparent">
                {code.comments && code.comments.length > 0 ? (
                  organizeComments(code.comments).map((comment: Comment) => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      currentUser={currentUser}
                      editingCommentId={editingCommentId}
                      editingCommentText={editingCommentText}
                      setEditingCommentText={setEditingCommentText}
                      replyingToCommentId={replyingToCommentId}
                      replyText={replyText}
                      setReplyText={setReplyText}
                      replyImage={replyImage}
                      setReplyImage={setReplyImage}
                      isSubmittingReply={isSubmittingReply}
                      onEdit={handleEditComment}
                      onSave={handleSaveComment}
                      onCancelEdit={handleCancelEdit}
                      onDelete={handleDeleteComment}
                      onReply={handleReply}
                      onCancelReply={handleCancelReply}
                      onSubmitReply={handleSubmitReply}
                      onLike={handleLikeComment}
                      allComments={code.comments || []}
                      currentLanguage={currentLanguage}
                      authorAvatar={userAvatars[comment.author]}
                      onReplyImageSelect={handleReplyImageSelect}
                    />
                  ))
                ) : (
                  <div className="text-center py-8 md:py-12">
                    <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm">{t('viewCode.noComments')}</p>
                  </div>
                )}
              </div>

              {/* Пікір формасы - тек жауап бермегенде */}
              {currentUser && !replyingToCommentId ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddComment(e);
                  }}
                  className="sticky bottom-0 mt-4 md:mt-6 mb-0 p-2 md:p-4 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl md:rounded-2xl shadow-lg backdrop-blur-sm flex-shrink-0 z-10 focus-within:border-[var(--primary-color)] focus-within:shadow-xl transition-all duration-200"
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <label className="h-[28px] w-[28px] md:h-[32px] md:w-[32px] min-h-[28px] min-w-[28px] md:min-h-[32px] md:min-w-[32px] box-border rounded-lg md:rounded-xl bg-[var(--primary-color)] flex items-center justify-center text-white font-semibold flex-shrink-0 cursor-pointer shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 active:scale-95">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleCommentImageSelect}
                      />
                      <FontAwesomeIcon icon={faImage} className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </label>
                    <div className="relative flex-1">
                      {commentImage && (
                        <div className="mb-2 relative">
                          <img
                            src={commentImage}
                            alt="Preview"
                            className="max-w-full max-h-24 md:max-h-32 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setCommentImage(null)}
                            className="absolute top-1 right-1 w-5 h-5 md:w-6 md:h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      <textarea
                        className="w-full px-3 md:px-4 py-1 md:py-1.5 bg-[var(--bg-primary)] border border-[var(--primary-color)]/30 rounded-lg md:rounded-xl text-[var(--text-primary)] text-xs md:text-sm resize-none h-[28px] md:h-[32px] min-h-[28px] md:min-h-[32px] max-h-[28px] md:max-h-[32px] box-border focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition-all duration-200 placeholder:text-[var(--text-secondary)] overflow-y-hidden"
                        placeholder={t('viewCode.commentPlaceholder')}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddComment(e);
                          }
                        }}
                        rows={1}
                      />
                    </div>
                    <button
                      type="submit"
                      className="h-[28px] w-[28px] md:h-[32px] md:w-[32px] min-h-[28px] min-w-[28px] md:min-h-[32px] md:min-w-[32px] box-border flex items-center justify-center rounded-lg md:rounded-xl bg-[var(--primary-color)] text-white border-none cursor-pointer transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={(!commentText.trim() && !commentImage) || isSubmittingComment}
                      title={isSubmittingComment ? t('common.loading') : t('viewCode.addComment')}
                    >
                      <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </button>
                  </div>
                </form>
              ) : !currentUser ? (
                <div className="sticky bottom-0 mt-4 md:mt-6 mb-0 p-3 md:p-4 bg-[var(--bg-secondary)] border border-[var(--primary-color)]/30 rounded-xl md:rounded-2xl flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-secondary)]">
                      {t('viewCode.loginToComment')}
                    </p>
                    <button
                      onClick={() => navigate('/login')}
                      className="px-4 py-2 bg-[var(--primary-color)] hover:opacity-90 text-white text-sm font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200 active:scale-95"
                    >
                      {t('common.login')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditing && (
        <div className="modal-overlay" onClick={handleCancelEditFolder}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('viewCode.editFolder')}</h3>
              <button className="modal-close" onClick={handleCancelEditFolder}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-title">{t('viewCode.titleLabel')}</label>
                <input
                  id="edit-title"
                  type="text"
                  className="form-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={t('viewCode.folderNamePlaceholder')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-description">{t('viewCode.descriptionLabel')}</label>
                <textarea
                  id="edit-description"
                  className="form-textarea"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t('viewCode.folderDescriptionPlaceholder')}
                  rows={4}
                />
              </div>
            </div>
            <div className="modal-footer">
              <Button
                variant="secondary"
                onClick={handleCancelEditFolder}
                disabled={isSaving}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveEdit}
                disabled={isSaving || !editTitle.trim()}
              >
                {isSaving ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
};

export default ViewCode;