import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowUpIcon,
  CloseIcon,
  LayersIcon,
  PlusIcon,
  SmileIcon,
} from './home/icons';
import { FileIcon, ImageIcon, MapPinIcon, MicIcon, PaperclipIcon, PollIcon, VideoIcon } from './chat/MediaIcons';
import { FormatKind, formatFromShortcut, toggleFormat } from './chat/formatText';
import { loadDraft, saveDraft } from './chat/ChatComfort';
import { CreatePollModal, useVoiceRecorder, VoiceRecorderBar } from './chat/ChatExtras';
import Popover from './chat/Popover';
import { WOLF_STICKERS, stickerSrc } from './home/stories/storyUtils';
import './MessageInput.css';

interface MessageInputProps {
  onSendMessage: (content: string, type?: string, attachments?: any[], metadata?: any) => void;
  onUploadFile: (file: File, type: string, content?: string, metadata?: any) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** Жазып жатқанын хабарлау: true — жаза бастады, false — тоқтады/жіберді */
  onTyping?: (isTyping: boolean) => void;
  /** Берілсе — құралдар қатарында «Жоба бөлісу» батырмасы шығады */
  onShareProject?: () => void;
  /** Жазу өрісінің үстіндегі жолақ (жауап беру / өңдеу) */
  banner?: React.ReactNode;
  /** key өзгерген сайын мәтін осы text-ке ауысып, өріске фокус түседі (өңдеу режимі) */
  prefill?: { text: string; key: number };
  /** key өзгерген сайын өріске фокус түседі (жауап беру басталғанда) */
  focusKey?: number;
  /** Өрісте Esc басылды — жауапты/өңдеуді болдырмау */
  onEscape?: () => void;
  /** Берілсе — жазылып біткен жоқ мәтін осы кілтпен браузерде сақталады (черновик) */
  draftKey?: string;
  /** Берілсе — құралдар қатарында «Сауалнама» батырмасы шығады */
  onCreatePoll?: (poll: { question: string; options: string[]; multiple: boolean }) => Promise<void>;
}

const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  onUploadFile,
  disabled = false,
  placeholder = undefined,
  onTyping,
  onShareProject,
  banner,
  prefill,
  focusKey,
  onEscape,
  draftKey,
  onCreatePoll,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [message, setMessage] = useState(() => (draftKey ? loadDraft(draftKey) : ''));
  // Өңдеу кезінде черновик уақытша осында тұрады, өңдеу біткенде қайтарылады
  const stashRef = useRef<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // Панель бөлімі: эмодзи (мәтінге қосылады) не Codo стикері (бірден жіберіледі)
  const [pickerTab, setPickerTab] = useState<'emoji' | 'codo'>('emoji');
  const [showPoll, setShowPoll] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<Array<{ file: File; type: string; preview?: string }>>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const [showAttach, setShowAttach] = useState(false);
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  // Чат ауысқанда/жабылғанда — «жазуда» күйін тоқтату
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingRef.current) onTypingRef.current?.(false);
    };
  }, []);

  // Өңдеу басталды — мәтінді өріске қойып, курсорды соңына қоямыз
  useEffect(() => {
    if (!prefill) return;
    if (prefill.text) {
      if (stashRef.current === null) stashRef.current = message;
      setMessage(prefill.text);
    } else {
      // Өңдеу бітті/болдырылмады — бұрынғы черновикті қайтарамыз
      setMessage(stashRef.current ?? '');
      stashRef.current = null;
    }
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      adjustTextareaHeight();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key]);

  useEffect(() => {
    if (focusKey) textareaRef.current?.focus();
  }, [focusKey]);

  // Чат ашылғанда өріс бірден белсенді (сенсорлы экранда емес — пернетақта өздігінен шықпасын)
  useEffect(() => {
    if (disabled || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Telegram сияқты: реакция басқаннан, сурет қарағаннан кейін де пернені бассаң — мәтін өріске жазылады
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = textareaRef.current;
      if (!el || el.disabled || e.defaultPrevented || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const active = document.activeElement as HTMLElement | null;
      if (active === el) return;
      // Басқа жазу өрісінде (іздеу, модал т.б.) отырса — тимейміз
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      // Батырмада тұрғанда Space оны басу үшін қалсын
      if (e.key === ' ' && active && active !== document.body) return;
      // Фокусты keydown кезінде ауыстырсақ, браузер таңбаны жаңа өріске жазады
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Черновикті сақтау (өңдеу кезінде емес)
  useEffect(() => {
    if (!draftKey || stashRef.current !== null) return;
    const timer = setTimeout(() => saveDraft(draftKey, message), 300);
    return () => clearTimeout(timer);
  }, [draftKey, message]);

  // Черновик бар болса — биіктігін мәтінге сай қою
  useEffect(() => {
    if (message) requestAnimationFrame(() => adjustTextareaHeight());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Чат жабылғанда соңғы мәтін сақталып қалсын
  const latestRef = useRef(message);
  latestRef.current = stashRef.current ?? message;
  useEffect(() => {
    return () => {
      if (draftKey) saveDraft(draftKey, latestRef.current);
    };
  }, [draftKey]);

  // Белгіленген мәтінді **қалың** / __курсив__ т.б. ету
  const applyFormat = (kind: FormatKind) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = toggleFormat(message, el.selectionStart, el.selectionEnd, kind);
    setMessage(next.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };

  // Жазу басталғанда бір рет true, 2.5 секунд тыныштықтан кейін false жібереміз
  const stopTyping = () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (typingRef.current) {
      typingRef.current = false;
      onTyping?.(false);
    }
  };

  const notifyTyping = () => {
    if (!onTyping) return;
    if (!typingRef.current) {
      typingRef.current = true;
      onTyping(true);
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, 2500);
  };

  // Common emojis
  const commonEmojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'];

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustTextareaHeight();
    if (e.target.value.trim()) notifyTyping();
    else stopTyping();
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || (!message.trim() && previewFiles.length === 0 && !location)) return;
    stopTyping();

    // Send files first if any
    if (previewFiles.length > 0) {
      const filesToSend = [...previewFiles];
      setPreviewFiles([]);
      (async () => {
        for (const preview of filesToSend) {
          try {
            await onUploadFile(preview.file, preview.type, message || undefined);
          } catch (err) {
            console.error('Failed to upload file:', err);
          }
        }
      })();
    }

    // Send location if any
    if (location) {
      onSendMessage(
        message || t('messageInput.myLocation'),
        'location',
        undefined,
        { latitude: location.lat, longitude: location.lng, address: location.address }
      );
      setLocation(null);
    }

    // Send text message if any
    if (message.trim()) {
      onSendMessage(message.trim());
    }

    setMessage('');
    adjustTextareaHeight();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // For images, send immediately without preview
    if (type === 'image') {
      const messageToSend = message || undefined;
      (async () => {
        for (const file of Array.from(files)) {
          try {
            // Send image immediately
            await onUploadFile(file, type, messageToSend);
          } catch (error) {
            console.error('Failed to upload image:', error);
            // If upload fails, add to preview for manual retry
            const reader = new FileReader();
            reader.onloadend = () => {
              setPreviewFiles(prev => [...prev, {
                file,
                type,
                preview: reader.result as string
              }]);
            };
            reader.readAsDataURL(file);
          }
        }
        // Clear message after all images are sent
        if (messageToSend) {
          setMessage('');
          adjustTextareaHeight();
        }
      })();
    } else {
      // For other file types, add to preview
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewFiles(prev => [...prev, {
            file,
            type,
            preview: type === 'video' ? undefined : reader.result as string
          }]);
        };
        if (type === 'video') {
          // For videos, just add to preview without reading
          setPreviewFiles(prev => [...prev, {
            file,
            type,
            preview: undefined
          }]);
        } else {
          reader.readAsDataURL(file);
        }
      });
    }

    // Reset input
    if (e.target) {
      e.target.value = '';
    }
  };

  const removePreview = (index: number) => {
    setPreviewFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleStickerClick = (stickerId: string) => {
    onSendMessage('', 'sticker', undefined, { stickerId });
    setShowEmojiPicker(false);
  };

  const handleEmojiClick = (emoji: string) => {
    setMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
    adjustTextareaHeight();
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      toast.error(t('messageInput.geolocationNotSupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Try to get address from reverse geocoding
        let address: string | undefined;
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          );
          const data = await response.json();
          address = data.display_name;
        } catch (e) {
          // Ignore geocoding errors
        }

        setLocation({ lat: latitude, lng: longitude, address });
      },
      (error) => {
        toast.error(t('messageInput.locationError') + ': ' + error.message);
      }
    );
  };

  // Дауыстық хабарлама: жазу бітсе — файл толқын пішінімен бірге жіберіледі
  const voice = useVoiceRecorder(
    (file, meta) => {
      onUploadFile(file, 'audio', undefined, meta).catch((err) => console.error('Failed to upload voice:', err));
    },
    (msg) => toast.error(msg),
  );

  // Жазу кезінде: Enter — жіберу, Esc — бас тарту
  useEffect(() => {
    if (!voice.recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        voice.cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        voice.finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice.recording, voice.cancel, voice.finish]);

  const canSend = !!message.trim() || previewFiles.length > 0 || !!location;

  // Барлық тіркеме түрлері бір «+» мәзірінде
  const attachItems = [
    { key: 'image', icon: <ImageIcon size={20} />, label: t('messageInput.image'), onClick: () => imageInputRef.current?.click() },
    { key: 'video', icon: <VideoIcon size={20} />, label: t('messageInput.video'), onClick: () => videoInputRef.current?.click() },
    { key: 'file', icon: <PaperclipIcon size={20} />, label: t('messageInput.file'), onClick: () => fileInputRef.current?.click() },
    ...(onShareProject ? [{ key: 'project', icon: <LayersIcon size={20} />, label: t('chat.project.toolbar'), onClick: onShareProject }] : []),
    ...(onCreatePoll ? [{ key: 'poll', icon: <PollIcon size={20} />, label: t('chat.poll.create'), onClick: () => setShowPoll(true) }] : []),
    { key: 'location', icon: <MapPinIcon size={20} />, label: t('messageInput.location'), onClick: getLocation },
  ];

  return (
    <div className="message-input-container">
      {/* Preview files */}
      {previewFiles.length > 0 && (
        <div className="message-preview-files">
          {previewFiles.map((preview, index) => (
            <div key={index} className="message-preview-item">
              {preview.type === 'image' && preview.preview && (
                <img src={preview.preview} alt="Preview" />
              )}
              {preview.type !== 'image' && (
                <div className="message-preview-file">
                  {preview.type === 'video' ? <VideoIcon size={16} /> : <FileIcon size={16} />}
                  <span>{preview.file.name}</span>
                </div>
              )}
              <button
                className="message-preview-remove"
                onClick={() => removePreview(index)}
                type="button"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Location preview */}
      {location && (
        <div className="message-location-preview">
          <MapPinIcon size={18} />
          <span>{location.address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}</span>
          <button
            className="message-preview-remove"
            onClick={() => setLocation(null)}
            type="button"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      {/* Тіркеу мәзірі — «+» батырмасынан шығады */}
      <Popover
        open={showAttach}
        anchor={attachBtnRef}
        onClose={() => setShowAttach(false)}
        placement="top-start"
        className="cht-pop--attach"
        ariaLabel={t('messageInput.attach')}
      >
        {attachItems.map((item) => (
          <button key={item.key} type="button" role="menuitem" className={`message-attach-item is-${item.key}`} onClick={item.onClick}>
            <span className="message-attach-item__icon">{item.icon}</span>
            <span className="message-attach-item__label">{item.label}</span>
          </button>
        ))}
      </Popover>

      {/* Эмодзи панелі — смайлик батырмасынан шығады */}
      <Popover
        open={showEmojiPicker}
        anchor={emojiBtnRef}
        onClose={() => setShowEmojiPicker(false)}
        placement="top-start"
        className="cht-pop--emoji"
        role="dialog"
        ariaLabel={t('messageInput.emoji')}
        focusFirst={false}
        closeOnSelect={false}
      >
        <div className="emoji-picker-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={pickerTab === 'emoji'}
            className={`emoji-picker-tab ${pickerTab === 'emoji' ? 'is-on' : ''}`} onClick={() => setPickerTab('emoji')}>
            😊 {t('messageInput.emojiTab')}
          </button>
          <button type="button" role="tab" aria-selected={pickerTab === 'codo'}
            className={`emoji-picker-tab ${pickerTab === 'codo' ? 'is-on' : ''}`} onClick={() => setPickerTab('codo')}>
            <img src={stickerSrc('wolf:smile') ?? ''} alt="" /> {t('messageInput.stickersTab')}
          </button>
        </div>
        {pickerTab === 'codo' ? (
          <div className="sticker-picker-grid">
            {WOLF_STICKERS.map((id) => (
              <button key={id} className="sticker-item" onClick={() => handleStickerClick(id)} type="button">
                <img src={stickerSrc(id) ?? ''} alt="" draggable={false} />
              </button>
            ))}
          </div>
        ) : (
          <div className="emoji-picker-grid">
            {commonEmojis.map((emoji, index) => (
              <button key={index} className="emoji-item" onClick={() => handleEmojiClick(emoji)} type="button">
                {emoji}
              </button>
            ))}
          </div>
        )}
      </Popover>

      <form className="message-input-form" onSubmit={handleSend}>
        {banner}
        <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFileSelect(e, 'image')} />
        <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={(e) => handleFileSelect(e, 'video')} />
        <input ref={fileInputRef} type="file" hidden onChange={(e) => handleFileSelect(e, 'file')} />

        {voice.recording ? (
          <VoiceRecorderBar seconds={voice.seconds} levels={voice.levels} onCancel={voice.cancel} onSend={voice.finish} />
        ) : (
          <div className="message-input-row">
            <button
              ref={attachBtnRef}
              type="button"
              className={`message-attach-btn ${showAttach ? 'is-open' : ''}`}
              onClick={() => setShowAttach((v) => !v)}
              disabled={disabled}
              title={t('messageInput.attach')}
              aria-label={t('messageInput.attach')}
              aria-haspopup="menu"
              aria-expanded={showAttach}
            >
              <PlusIcon />
            </button>

            <div className="message-input-wrapper">
              <textarea
                ref={textareaRef}
                className="message-textarea"
                value={message}
                onChange={handleInputChange}
                placeholder={placeholder || t('messageInput.placeholder')}
                rows={1}
                disabled={disabled}
                onKeyDown={(e) => {
                  const format = formatFromShortcut(e);
                  if (format) {
                    e.preventDefault();
                    applyFormat(format);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  } else if (e.key === 'Escape' && onEscape) {
                    e.preventDefault();
                    onEscape();
                  }
                }}
              />
              <button
                ref={emojiBtnRef}
                type="button"
                className={`message-emoji-btn ${showEmojiPicker ? 'is-open' : ''}`}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title={t('messageInput.emoji')}
                aria-label={t('messageInput.emoji')}
                aria-haspopup="dialog"
                aria-expanded={showEmojiPicker}
              >
                <SmileIcon size={20} />
              </button>
            </div>

            {/* Жіберетін ештеңе жоқ болса — орнында микрофон (Telegram сияқты) */}
            <span className="message-action-slot">
              {canSend || disabled ? (
                <button
                  key="send"
                  type="submit"
                  className="message-send-btn"
                  disabled={disabled || !canSend}
                  title={t('messageInput.send')}
                  aria-label={t('messageInput.send')}
                >
                  <ArrowUpIcon />
                </button>
              ) : (
                <button
                  key="mic"
                  type="button"
                  className="message-send-btn message-send-btn--mic"
                  onClick={voice.start}
                  title={t('chat.voice.record')}
                  aria-label={t('chat.voice.record')}
                >
                  <MicIcon size={19} />
                </button>
              )}
            </span>
          </div>
        )}
      </form>
      {showPoll && onCreatePoll && <CreatePollModal onClose={() => setShowPoll(false)} onCreate={onCreatePoll} />}
    </div>
  );
};

export default MessageInput;