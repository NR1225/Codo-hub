import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile, Comment } from '../utils/api';
import { apiService } from '../utils/api';
import { subscribeToCode, unsubscribe } from '../utils/realtimeService';
import { useAuth } from '../contexts/AuthContext';
import CodeEditor from '../components/CodeEditor';
import { isImageFile } from '../utils/fileHandler';
import { formatDate, formatDateTime } from '../utils/dateFormatter';
import { monogram } from '../components/home/monogram';
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CommentIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  HeartIcon,
  ImageIcon,
  MoreIcon,
  PlayIcon,
  ReplyIcon,
  TrashIcon,
} from '../components/home/icons';
import './ViewCode.css';

type CurrentUser = { id: string; username: string } | null;

// Тар экранда панельдер қойындылар арқылы ауысады (CSS ≤960px)
type MobileTab = 'files' | 'code' | 'comments';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Сурет мазмұны data URL, сілтеме немесе таза base64 болуы мүмкін
function imageSrc(file: CodeFile): string {
  const content = file.content;
  if (/^(data:|https?:\/\/)/.test(content)) return content;
  const ext = file.title.split('.').pop()?.toLowerCase() || 'png';
  const mime: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  };
  return `data:${mime[ext] || 'image/png'};base64,${content}`;
}

// Пікір мәтіні + <img> тегтері. Тек http(s) және data:image сілтемелері рұқсат (XSS-тен қорғау)
function renderCommentContent(content: string) {
  return content.split(/(<img[^>]*>)/).map((part, index) => {
    if (part.startsWith('<img')) {
      const src = part.match(/src="([^"]*)"/)?.[1];
      if (src) {
        if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
          return <span key={index}>[image blocked]</span>;
        }
        return <img key={index} src={src} alt="" className="vc-comment__img" />;
      }
    }
    return <span key={index}>{part}</span>;
  });
}

// Пікір мен жауапқа сурет тіркеу — data URL ретінде оқылады
function readImage(
  e: React.ChangeEvent<HTMLInputElement>,
  t: (key: string) => string,
  onLoad: (dataUrl: string) => void
) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert(t('viewCode.errorImageFilesOnly'));
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    alert(t('viewCode.errorImageSizeLimit'));
    return;
  }
  const reader = new FileReader();
  reader.onloadend = () => onLoad(reader.result as string);
  reader.onerror = () => alert(t('viewCode.errorReadImage'));
  reader.readAsDataURL(file);
}

function withImage(text: string, image: string | null): string {
  const trimmed = text.trim();
  if (!image) return trimmed;
  const tag = `<img src="${image}" alt="Comment image" />`;
  return trimmed ? `${trimmed}\n${tag}` : tag;
}

// Жоғары деңгейлі пікір, астында оның барлық жауаптары (тегіс тізім, рекурсивті)
function organizeComments(comments: Comment[]): Comment[] {
  const topLevel: Comment[] = [];
  const replies: Record<string, Comment[]> = {};
  comments.forEach((c) => {
    if (c.parentId) (replies[c.parentId] ||= []).push(c);
    else topLevel.push(c);
  });
  const walk = (c: Comment): Comment[] => [c, ...(replies[c.id] || []).flatMap(walk)];
  return topLevel.flatMap(walk);
}

/* ---------- Файлдар ағашы ---------- */

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: CodeFile;
}

function buildTree(files: CodeFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const file of files) {
    const parts = (file.folderPath || file.title).split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && !!c.file === isLeaf);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/'), children: [], file: isLeaf ? file : undefined };
        node.children.push(child);
      }
      node = child;
    });
  }
  // Алдымен папкалар, сосын файлдар — әліпби бойынша
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

interface FileTreeProps {
  nodes: TreeNode[];
  depth?: number;
  selectedId?: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (file: CodeFile) => void;
}

const FileTree: React.FC<FileTreeProps> = ({ nodes, depth = 0, selectedId, collapsed, onToggle, onSelect }) => (
  <ul className="vc-tree" role={depth === 0 ? 'tree' : 'group'}>
    {nodes.map((node) => {
      const isOpen = !collapsed.has(node.path);
      return (
        <li key={node.path} role="treeitem" aria-expanded={node.file ? undefined : isOpen}>
          <button
            type="button"
            className={`vc-tree__row ${node.file && node.file.id === selectedId ? 'is-active' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => (node.file ? onSelect(node.file) : onToggle(node.path))}
            title={node.path}
          >
            {node.file ? (
              <span className="vc-tree__icon">{isImageFile(node.name) ? <ImageIcon size={15} /> : <FileIcon size={15} />}</span>
            ) : (
              <span className={`vc-tree__chevron ${isOpen ? 'is-open' : ''}`}><ChevronIcon /></span>
            )}
            {!node.file && <span className="vc-tree__icon"><FolderIcon size={15} /></span>}
            <span className="vc-tree__name">{node.name}</span>
          </button>
          {!node.file && isOpen && node.children.length > 0 && (
            <FileTree
              nodes={node.children}
              depth={depth + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          )}
        </li>
      );
    })}
  </ul>
);

/* ---------- Пікір ---------- */

interface CommentItemProps {
  comment: Comment;
  parent?: Comment;
  currentUser: CurrentUser;
  avatar?: string;
  language: string;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onLike: () => void;
}

const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  parent,
  currentUser,
  avatar,
  language,
  isEditing,
  editText,
  onEditTextChange,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  onReply,
  onLike,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwn = currentUser?.username === comment.author;
  const isLiked = currentUser ? comment.likes?.includes(currentUser.id) : false;
  const likeCount = comment.likes?.length || 0;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <article className={`vc-comment ${comment.parentId ? 'is-reply' : ''}`} data-comment-id={comment.id}>
      <Link to={`/profile/${comment.author}`} className="vc-avatar" title={t('viewCode.viewProfile', { author: comment.author })}>
        {avatar ? <img src={avatar} alt="" /> : monogram(comment.author)}
      </Link>

      <div className="vc-comment__body">
        <div className="vc-comment__head">
          <Link to={`/profile/${comment.author}`} className="vc-comment__author">{comment.author}</Link>
          <span className="vc-comment__time">{formatDateTime(comment.createdAt, language)}</span>
          {isOwn && !isEditing && (
            <div className="vc-menu vc-comment__menu" ref={menuRef}>
              <button
                type="button"
                className="vc-icon-btn vc-icon-btn--sm"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('viewCode.actionsTitle')}
                aria-expanded={menuOpen}
              >
                <MoreIcon size={15} />
              </button>
              {menuOpen && (
                <div className="vc-menu__list" role="menu">
                  <button type="button" role="menuitem" className="vc-menu__item" onClick={() => { setMenuOpen(false); onEdit(); }}>
                    <EditIcon size={15} /> {t('common.edit')}
                  </button>
                  <button type="button" role="menuitem" className="vc-menu__item is-danger" onClick={() => { setMenuOpen(false); onDelete(); }}>
                    <TrashIcon size={15} /> {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {parent && (
          <div className="vc-comment__quote">
            <ReplyIcon size={12} />
            <strong>{parent.author}</strong>
            <span>{parent.content.replace(/<img[^>]*>/g, '🖼').slice(0, 80)}</span>
          </div>
        )}

        {isEditing ? (
          <div className="vc-comment__edit">
            <textarea
              className="vc-input"
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="vc-comment__edit-actions">
              <button type="button" className="vc-btn vc-btn--ghost vc-btn--sm" onClick={onCancelEdit}>{t('common.cancel')}</button>
              <button type="button" className="vc-btn vc-btn--primary vc-btn--sm" onClick={onSave} disabled={!editText.trim()}>{t('common.save')}</button>
            </div>
          </div>
        ) : (
          <div className="vc-comment__text">{renderCommentContent(comment.content)}</div>
        )}

        {!isEditing && (
          <div className="vc-comment__actions">
            <button
              type="button"
              className={`vc-chip-btn ${isLiked ? 'is-active' : ''}`}
              onClick={onLike}
              disabled={!currentUser}
              aria-pressed={isLiked}
              title={t('common.like')}
            >
              <HeartIcon /> {likeCount > 0 && likeCount}
            </button>
            {currentUser && (
              <button type="button" className="vc-chip-btn" onClick={onReply}>
                <ReplyIcon size={14} /> {t('viewCode.reply')}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

/* ---------- Бет ---------- */

const ViewCode: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const language = i18n.language;
  const currentUser: CurrentUser = user ? { id: user.id, username: user.username } : null;

  const [code, setCode] = useState<CodeFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [folderFiles, setFolderFiles] = useState<CodeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  // Папка файлдары content-сіз келеді — таңдалғанда ғана жүктеледі (id → content)
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const [mobileTab, setMobileTab] = useState<MobileTab>('code');
  const [descExpanded, setDescExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [commentText, setCommentText] = useState('');
  const [commentImage, setCommentImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  const menuRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const avatarsRequested = useRef<Set<string>>(new Set());

  const loadAvatars = useCallback((comments?: Comment[]) => {
    const authors = Array.from(new Set((comments || []).map((c) => c.author)))
      .filter((a) => !avatarsRequested.current.has(a));
    if (authors.length === 0) return;
    authors.forEach((a) => avatarsRequested.current.add(a));
    Promise.all(
      authors.map((author) =>
        apiService.getUserByUsername(author)
          .then((u) => [author, u.avatar] as const)
          .catch(() => [author, undefined] as const)
      )
    ).then((results) => {
      const found = Object.fromEntries(results.filter(([, a]) => a)) as Record<string, string>;
      if (Object.keys(found).length) setAvatars((prev) => ({ ...prev, ...found }));
    });
  }, []);

  const loadFolderFiles = useCallback(async (folderId: string) => {
    try {
      setLoadingFiles(true);
      // content-сіз тізім: үлкен жобада барлық файл мазмұны ондаған МБ болады
      const { codes } = await apiService.getCodeFiles(folderId, undefined, 0, false);
      setFolderFiles(codes);
      // Таңдалған файл жаңартылған тізімде болса — сол қалады
      setSelectedFile((prev) => codes.find((f) => f.id === prev?.id) ?? codes[0] ?? null);
    } catch (err) {
      console.error('Failed to load folder files:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const applyCode = useCallback((data: CodeFile) => {
    setCode(data);
    loadAvatars(data.comments);
  }, [loadAvatars]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const data = await apiService.getCodeFile(id, true);
        if (cancelled) return;
        applyCode(data);
        setError(null);
        setFileContents({});
        if (data.isFolder) loadFolderFiles(id);
        else {
          setFolderFiles([]);
          setSelectedFile(null);
        }
        // Жауап жеңіл нұсқа — тек қаралым санағын жаңартамыз
        apiService.incrementView(id, user?.id ?? null)
          .then((updated) => {
            if (cancelled || !updated) return;
            setCode((prev) => (prev && prev.id === updated.id
              ? { ...prev, views: updated.views, viewedBy: updated.viewedBy }
              : prev));
          })
          .catch((err) => console.error('Failed to increment view:', err));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('viewCode.errorLoadingCode'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    const unsubscribeListener = subscribeToCode(
      id,
      (updated) => {
        if (cancelled) return;
        applyCode(updated);
        if (updated.isFolder) loadFolderFiles(id);
      },
      (err) => console.error('Real-time listener error:', err)
    );

    return () => {
      cancelled = true;
      unsubscribeListener();
      unsubscribe(`code-${id}`);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Жаңа пікір қосылғанда — тізім соңына айналдыру
  const commentCount = code?.comments?.length || 0;
  useEffect(() => {
    const el = commentsRef.current;
    if (el && commentCount > 0) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [commentCount]);

  const tree = useMemo(() => buildTree(folderFiles), [folderFiles]);
  const comments = useMemo(() => organizeComments(code?.comments || []), [code?.comments]);
  const commentById = useMemo(
    () => Object.fromEntries((code?.comments || []).map((c) => [c.id, c])) as Record<string, Comment>,
    [code?.comments]
  );

  const isOwner = !!code && currentUser?.username === code.author;
  const isLiked = !!code && !!currentUser && !!code.likes?.includes(currentUser.id);
  const likeCount = code?.likes?.length || 0;
  // Таңдалған файлдың мазмұнын бір рет жүктеу
  const selectedId = selectedFile?.id;
  const selectedHasInlineContent = selectedFile?.content !== undefined;
  const selectedContentLoaded = !!selectedId && selectedId in fileContents;
  useEffect(() => {
    if (!selectedId || selectedHasInlineContent || selectedContentLoaded) return;
    let cancelled = false;
    apiService.getCodeFile(selectedId)
      .then((file) => { if (!cancelled) setFileContents((prev) => ({ ...prev, [selectedId]: file.content ?? '' })); })
      .catch((err) => {
        console.error('Failed to load file content:', err);
        if (!cancelled) setFileContents((prev) => ({ ...prev, [selectedId]: '' }));
      });
    return () => { cancelled = true; };
  }, [selectedId, selectedHasInlineContent, selectedContentLoaded]);

  // Ортада көрсетілетін файл: папкада — таңдалғаны, әйтпесе кодтың өзі
  const contentLoading = !!code?.isFolder && !!selectedFile && !selectedHasInlineContent && !selectedContentLoaded;
  const activeFile = useMemo(() => {
    if (!code?.isFolder) return code;
    if (!selectedFile) return null;
    return { ...selectedFile, content: selectedFile.content ?? fileContents[selectedFile.id] ?? '' };
  }, [code, selectedFile, fileContents]);

  /* ----- Әрекеттер ----- */

  // Жоба Vibecoding-ке көшіріліп, бірден іске қосылады
  const handleRun = () => {
    if (!code) return;
    const params = new URLSearchParams({ repo: code.id, run: '1' });
    if (code.isFolder && selectedFile) params.set('file', selectedFile.folderPath || selectedFile.title);
    navigate(`/vibecoding?${params.toString()}`);
  };

  const handleCopy = async () => {
    if (!activeFile || contentLoading) return;
    try {
      if (isImageFile(activeFile.title)) {
        const blob = await (await fetch(imageSrc(activeFile))).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } else {
        await navigator.clipboard.writeText(activeFile.content);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleExportFolder = async () => {
    if (folderFiles.length === 0) {
      alert(t('viewCode.noFilesToExport'));
      return;
    }
    try {
      // jszip-ті тек экспорт кезінде динамикалық жүктеу (~100KB)
      const { default: JSZip } = await import('jszip');
      // Тізімде content жоқ — экспорт кезінде ғана толық жүктейміз
      const { codes: files } = await apiService.getCodeFiles(code!.id, undefined, 0, true);
      const zip = new JSZip();
      for (const file of files) {
        const filePath = file.folderPath || file.title;
        if (isImageFile(file.title)) {
          const base64 = file.content.match(/base64,(.+)/)?.[1] ?? file.content;
          zip.file(filePath, base64, { base64: true });
        } else {
          zip.file(filePath, file.content);
        }
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${code?.title || 'folder'}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export folder:', err);
      alert(t('viewCode.errorExportFolder'));
    }
  };

  const handleDelete = async () => {
    if (!code || !isOwner) return;
    if (!confirm(t('viewCode.deleteConfirmTitle', { title: code.title }))) return;
    try {
      setIsDeleting(true);
      await apiService.deleteCodeFile(code.id);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete code:', err);
      alert(t('viewCode.errorDeleteCode'));
      setIsDeleting(false);
    }
  };

  const openEdit = () => {
    if (!code) return;
    setEditTitle(code.title);
    setEditDescription(code.description || '');
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!code || !editTitle.trim()) return;
    try {
      setIsSaving(true);
      const updated = await apiService.updateCodeFile(code.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      });
      setCode(updated);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update code:', err);
      alert(t('viewCode.errorEditFolder'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLike = async () => {
    if (!code || !currentUser) return;
    const previous = code.likes || [];
    const likes = isLiked ? previous.filter((uid) => uid !== currentUser.id) : [...previous, currentUser.id];
    setCode({ ...code, likes });
    try {
      setCode(isLiked
        ? await apiService.unlikeCode(code.id, currentUser.id)
        : await apiService.likeCode(code.id, currentUser.id));
    } catch (err) {
      console.error('Failed to toggle like:', err);
      setCode((prev) => (prev ? { ...prev, likes: previous } : prev));
    }
  };

  // Жаңа пікір немесе жауап — бір форма арқылы
  const handleSubmitComment = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!code || !currentUser || isSubmitting || (!commentText.trim() && !commentImage)) return;
    const content = withImage(commentText, commentImage);
    const parent = replyTo;
    const savedText = commentText;
    const savedImage = commentImage;

    setIsSubmitting(true);
    setCommentText('');
    setCommentImage(null);
    setReplyTo(null);

    // Жай пікір бірден көрсетіледі (optimistic), жауап сервер жауабынан кейін
    const temp: Comment | null = parent ? null : {
      id: `temp-${Date.now()}`,
      author: currentUser.username,
      content,
      createdAt: new Date().toISOString(),
      likes: [],
    };
    if (temp) setCode((prev) => (prev ? { ...prev, comments: [...(prev.comments || []), temp] } : prev));

    try {
      const updated = parent
        ? await apiService.addReply(code.id, parent.id, currentUser.username, content)
        : await apiService.addComment(code.id, currentUser.username, content);
      applyCode(updated);
    } catch (err) {
      console.error('Failed to add comment:', err);
      if (temp) setCode((prev) => (prev ? { ...prev, comments: (prev.comments || []).filter((c) => c.id !== temp.id) } : prev));
      setCommentText(savedText);
      setCommentImage(savedImage);
      setReplyTo(parent);
      alert(t(parent ? 'viewCode.errorAddReply' : 'viewCode.errorAddComment'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveComment = async (commentId: string) => {
    if (!code || !editingCommentText.trim()) return;
    try {
      setCode(await apiService.updateComment(code.id, commentId, editingCommentText.trim()));
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (err) {
      console.error('Failed to update comment:', err);
      alert(t('viewCode.errorEditComment'));
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!code || !confirm(t('viewCode.deleteConfirm'))) return;
    try {
      setCode(await apiService.deleteComment(code.id, commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
      alert(t('viewCode.errorDeleteComment'));
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!code || !currentUser) return;
    const original = code.comments?.find((c) => c.id === commentId)?.likes || [];
    const liked = original.includes(currentUser.id);
    const likes = liked ? original.filter((uid) => uid !== currentUser.id) : [...original, currentUser.id];
    const setLikes = (value: string[]) => setCode((prev) => prev && ({
      ...prev,
      comments: (prev.comments || []).map((c) => (c.id === commentId ? { ...c, likes: value } : c)),
    }));
    setLikes(likes);
    try {
      setCode(await apiService.likeComment(code.id, commentId, currentUser.id));
    } catch (err) {
      console.error('Failed to like comment:', err);
      setLikes(original);
    }
  };

  // Файл таңдалғанда телефонда бірден код қойындысына өтеміз
  const selectFile = (file: CodeFile) => {
    setSelectedFile(file);
    setMobileTab('code');
  };

  const startReply = (comment: Comment) => {
    setReplyTo(comment);
    composerRef.current?.focus();
  };

  /* ----- Күйлер ----- */

  if (loading && !code) {
    return (
      <div className="vc-page">
        <div className="vc-state">
          <span className="vc-spinner" aria-hidden="true" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !code) {
    return (
      <div className="vc-page">
        <div className="vc-state">
          <div className="vc-state__mark">404</div>
          <h2>{t('viewCode.error')}</h2>
          <p>{error || t('viewCode.pageNotFound')}</p>
          <button type="button" className="vc-btn vc-btn--primary" onClick={() => navigate('/')}>
            {t('home.title')}
          </button>
        </div>
      </div>
    );
  }

  const tags = (code.tags || []).filter((tag) => tag.toLowerCase() !== 'folder');
  const longDescription = (code.description?.length || 0) > 160;

  return (
    <div className="vc-page">
      {/* ---------- Жоғарғы панель: атауы, мета, әрекеттер ---------- */}
      <header className="vc-panel vc-hero">
        <button type="button" className="vc-icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')} title={t('common.back')}>
          <ArrowLeftIcon />
        </button>

        <div className="vc-hero__mono" aria-hidden="true">
          {code.isFolder ? <FolderIcon size={22} /> : monogram(code.title)}
        </div>

        <div className="vc-hero__info">
          <h1 className="vc-hero__title">{code.title}</h1>
          <div className="vc-hero__meta">
            <Link to={`/profile/${code.author}`} className="vc-hero__author">
              {isOwner ? t('viewCode.youLabel') : `@${code.author}`}
            </Link>
            <span className="vc-dot" />
            <span>{formatDate(code.updatedAt || code.createdAt, language, 'long')}</span>
            {code.language && (
              <>
                <span className="vc-dot" />
                <span className="vc-tag vc-tag--lang">{code.language}</span>
              </>
            )}
            {code.isFolder && (
              <>
                <span className="vc-dot" />
                <span>{folderFiles.length} {t('viewCode.file')}</span>
              </>
            )}
            <span className="vc-dot" />
            <span className="vc-hero__stat"><EyeIcon /> {code.views || 0}</span>
          </div>
        </div>

        <div className="vc-hero__actions">
          <button
            type="button"
            className={`vc-btn vc-btn--ghost vc-like ${isLiked ? 'is-liked' : ''}`}
            onClick={handleLike}
            disabled={!currentUser}
            aria-pressed={isLiked}
            title={currentUser ? (isLiked ? t('viewCode.unlike') : t('viewCode.likeButton')) : t('viewCode.loginToLike')}
          >
            <HeartIcon /> <span>{likeCount}</span>
          </button>

          {code.isFolder && folderFiles.length > 0 && (
            <button type="button" className="vc-btn vc-btn--ghost" onClick={handleExportFolder} title={t('viewCode.exportFolderTitle')}>
              <DownloadIcon size={16} /> <span className="vc-btn__label">{t('viewCode.download')}</span>
            </button>
          )}

          <button type="button" className="vc-btn vc-btn--primary vc-run" onClick={handleRun} title={t('viewCode.runTitle')}>
            <PlayIcon size={16} /> {t('viewCode.run')}
          </button>

          {isOwner && (
            <div className="vc-menu" ref={menuRef}>
              <button
                type="button"
                className="vc-icon-btn"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('viewCode.actionsTitle')}
                aria-expanded={menuOpen}
              >
                <MoreIcon size={18} />
              </button>
              {menuOpen && (
                <div className="vc-menu__list" role="menu">
                  <button type="button" role="menuitem" className="vc-menu__item" onClick={() => { setMenuOpen(false); openEdit(); }}>
                    <EditIcon size={15} /> {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="vc-menu__item is-danger"
                    onClick={() => { setMenuOpen(false); handleDelete(); }}
                    disabled={isDeleting}
                  >
                    <TrashIcon size={15} /> {isDeleting ? t('common.loading') : t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {(code.description || tags.length > 0) && (
          <div className="vc-hero__extra">
            {code.description && (
              <p className={`vc-hero__desc ${descExpanded || !longDescription ? '' : 'is-clamped'}`}>
                {code.description}
                {longDescription && (
                  <button type="button" className="vc-link" onClick={() => setDescExpanded((v) => !v)}>
                    {descExpanded ? t('viewCode.showLess') : t('viewCode.showMore')}
                  </button>
                )}
              </p>
            )}
            {tags.length > 0 && (
              <div className="vc-hero__tags">
                {tags.map((tag) => <span key={tag} className="vc-tag">#{tag}</span>)}
              </div>
            )}
          </div>
        )}
      </header>

      {/* ---------- Тар экранға арналған қойындылар ---------- */}
      <nav className="vc-tabs" role="tablist" aria-label={code.title}>
        {(code.isFolder ? (['files', 'code', 'comments'] as const) : (['code', 'comments'] as const)).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mobileTab === tab}
            className={`vc-tabs__item ${mobileTab === tab ? 'is-active' : ''}`}
            onClick={() => setMobileTab(tab)}
          >
            {tab === 'files' && <><FolderIcon size={15} /> {t('viewCode.files')} <span className="vc-tabs__count">{folderFiles.length}</span></>}
            {tab === 'code' && <><FileIcon size={15} /> {t('viewCode.codeTab')}</>}
            {tab === 'comments' && <><CommentIcon /> {t('viewCode.comments')} <span className="vc-tabs__count">{commentCount}</span></>}
          </button>
        ))}
      </nav>

      {/* ---------- Негізгі бөлік: файлдар · код · пікірлер ---------- */}
      <div className={`vc-body ${code.isFolder ? 'has-files' : ''}`} data-tab={mobileTab}>
        {code.isFolder && (
          <aside className="vc-panel vc-files">
            <div className="vc-panel__head">
              <span className="vc-panel__title">{t('viewCode.files')}</span>
              <span className="vc-count">{folderFiles.length}</span>
            </div>
            <div className="vc-panel__scroll">
              {loadingFiles && folderFiles.length === 0 ? (
                <div className="vc-skeleton">
                  {Array.from({ length: 6 }, (_, i) => <span key={i} style={{ width: `${55 + ((i * 17) % 40)}%` }} />)}
                </div>
              ) : folderFiles.length === 0 ? (
                <p className="vc-empty">{t('viewCode.noFilesYet')}</p>
              ) : (
                <FileTree
                  nodes={tree}
                  selectedId={selectedFile?.id}
                  collapsed={collapsedDirs}
                  onSelect={selectFile}
                  onToggle={(path) => setCollapsedDirs((prev) => {
                    const next = new Set(prev);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })}
                />
              )}
            </div>
          </aside>
        )}

        <section className="vc-panel vc-code">
          <div className="vc-panel__head">
            <span className="vc-code__path" title={activeFile?.folderPath || activeFile?.title}>
              {activeFile && (isImageFile(activeFile.title) ? <ImageIcon size={15} /> : <FileIcon size={15} />)}
              <span>{activeFile ? (activeFile.folderPath || activeFile.title) : t('viewCode.noFileSelected')}</span>
            </span>
            {activeFile && (
              <button type="button" className="vc-btn vc-btn--ghost vc-btn--sm" onClick={handleCopy}>
                {isCopied ? <CheckIcon /> : <CopyIcon size={14} />}
                <span className="vc-btn__label">
                  {isImageFile(activeFile.title)
                    ? t(isCopied ? 'viewCode.imageCopied' : 'viewCode.copyImage')
                    : t(isCopied ? 'viewCode.codeCopied' : 'viewCode.copyCode')}
                </span>
              </button>
            )}
          </div>
          <div className="vc-panel__scroll vc-code__body">
            {!activeFile ? (
              <p className="vc-empty">{loadingFiles ? t('viewCode.loadingFiles') : t('viewCode.noFileSelected')}</p>
            ) : contentLoading ? (
              <p className="vc-empty">{t('common.loading')}</p>
            ) : isImageFile(activeFile.title) ? (
              <div className="vc-image">
                <img src={imageSrc(activeFile)} alt={activeFile.title} />
              </div>
            ) : (
              <CodeEditor code={activeFile.content} language={activeFile.language} readOnly lineNumbers />
            )}
          </div>
        </section>

        <aside className="vc-panel vc-comments">
          <div className="vc-panel__head">
            <span className="vc-panel__title"><CommentIcon /> {t('viewCode.comments')}</span>
            <span className="vc-count">{commentCount}</span>
          </div>

          <div className="vc-panel__scroll vc-comments__list" ref={commentsRef}>
            {comments.length === 0 ? (
              <p className="vc-empty">{t('viewCode.noComments')}</p>
            ) : (
              comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  parent={comment.parentId ? commentById[comment.parentId] : undefined}
                  currentUser={currentUser}
                  avatar={avatars[comment.author]}
                  language={language}
                  isEditing={editingCommentId === comment.id}
                  editText={editingCommentText}
                  onEditTextChange={setEditingCommentText}
                  onEdit={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.content); }}
                  onSave={() => handleSaveComment(comment.id)}
                  onCancelEdit={() => { setEditingCommentId(null); setEditingCommentText(''); }}
                  onDelete={() => handleDeleteComment(comment.id)}
                  onReply={() => startReply(comment)}
                  onLike={() => handleLikeComment(comment.id)}
                />
              ))
            )}
          </div>

          {currentUser ? (
            <form className="vc-composer" onSubmit={handleSubmitComment}>
              {replyTo && (
                <div className="vc-composer__reply">
                  <ReplyIcon size={13} />
                  <span>{t('viewCode.replyingTo')}: <strong>{replyTo.author}</strong></span>
                  <button type="button" className="vc-icon-btn vc-icon-btn--xs" onClick={() => setReplyTo(null)} aria-label={t('common.cancel')}>
                    <CloseIcon size={12} />
                  </button>
                </div>
              )}
              {commentImage && (
                <div className="vc-composer__preview">
                  <img src={commentImage} alt="" />
                  <button type="button" className="vc-icon-btn vc-icon-btn--xs" onClick={() => setCommentImage(null)} aria-label={t('common.delete')}>
                    <CloseIcon size={12} />
                  </button>
                </div>
              )}
              <div className="vc-composer__row">
                <label className="vc-icon-btn" title={t('viewCode.attachImage')}>
                  <input type="file" accept="image/*" hidden onChange={(e) => readImage(e, t, setCommentImage)} />
                  <ImageIcon size={17} />
                </label>
                <textarea
                  ref={composerRef}
                  className="vc-composer__input"
                  placeholder={replyTo ? t('viewCode.replyPlaceholder') : t('viewCode.commentPlaceholder')}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitComment();
                    }
                    if (e.key === 'Escape' && replyTo) setReplyTo(null);
                  }}
                  rows={1}
                />
                <button
                  type="submit"
                  className="vc-send"
                  disabled={(!commentText.trim() && !commentImage) || isSubmitting}
                  aria-label={replyTo ? t('viewCode.addReply') : t('viewCode.addComment')}
                >
                  <ArrowUpIcon />
                </button>
              </div>
            </form>
          ) : (
            <div className="vc-composer vc-composer--guest">
              <span>{t('viewCode.loginToComment')}</span>
              <button type="button" className="vc-btn vc-btn--primary vc-btn--sm" onClick={() => navigate('/login')}>
                {t('common.login')}
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* ---------- Өңдеу терезесі ---------- */}
      {isEditing && (
        <div className="vc-modal" onClick={() => !isSaving && setIsEditing(false)}>
          <div className="vc-modal__card" role="dialog" aria-modal="true" aria-labelledby="vc-edit-title" onClick={(e) => e.stopPropagation()}>
            <div className="vc-modal__head">
              <h3 id="vc-edit-title">{t('viewCode.editFolder')}</h3>
              <button type="button" className="vc-icon-btn" onClick={() => setIsEditing(false)} aria-label={t('common.close')}>
                <CloseIcon size={16} />
              </button>
            </div>
            <label className="vc-field">
              <span>{t('viewCode.titleLabel')}</span>
              <input
                className="vc-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={t('viewCode.folderNamePlaceholder')}
                autoFocus
              />
            </label>
            <label className="vc-field">
              <span>{t('viewCode.descriptionLabel')}</span>
              <textarea
                className="vc-input"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t('viewCode.folderDescriptionPlaceholder')}
                rows={4}
              />
            </label>
            <div className="vc-modal__foot">
              <button type="button" className="vc-btn vc-btn--ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>
                {t('common.cancel')}
              </button>
              <button type="button" className="vc-btn vc-btn--primary" onClick={handleSaveEdit} disabled={isSaving || !editTitle.trim()}>
                {isSaving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewCode;
