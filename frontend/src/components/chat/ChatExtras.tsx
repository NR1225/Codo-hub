import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { apiService, ChatPref, Message, PollMeta, VoiceMeta } from '../../utils/api';
import { API_BASE_URL } from '../../utils/constants';
import { websocketService } from '../../utils/websocket';
import {
  BookmarkIcon,
  CheckSmallIcon,
  CloseIcon,
  LinkIcon,
} from '../home/icons';
import { FileIcon, MicIcon, PauseIcon, PlayIcon, PollIcon, VideoIcon } from './MediaIcons';
import './ChatExtras.css';

/* Telegram сияқты қосымшалар (3-кезең): дауыстық хабарламалар, сауалнамалар,
   ортақ медиа галереясы, чаттарды бекіту / дыбысын өшіру / мұрағаттау, «Сақталған хабарламалар» */

/** Тіркеменің толық адресі (/api/uploads/... → бэкенд хосты) */
export const fileUrl = (url: string) => {
  // blob: — әлі жүктеліп жатқан файлдың жергілікті көшірмесі
  if (url.startsWith('http') || url.startsWith('blob:')) return url;
  if (url.startsWith('/api')) return `${API_BASE_URL.replace('/api', '')}${url}`;
  return `${API_BASE_URL.replace('/api', '')}/api${url}`;
};

export const formatDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/* ═════════ Дауыстық хабарлама: жазу ═════════ */

const VOICE_MAX_SECONDS = 300;
const VOICE_MIN_SECONDS = 0.6;
const WAVEFORM_BARS = 48;
const LIVE_BARS = 32;

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return (
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ''
  );
};

/** Деңгейлер тізімін n бағанға сығып, 0..1 аралығына қалыптау */
const downsample = (levels: number[], n: number) => {
  if (levels.length === 0) return Array(n).fill(0.1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * levels.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
    const slice = levels.slice(from, to);
    out.push(Math.max(...slice));
  }
  const max = Math.max(...out, 0.05);
  return out.map((v) => Math.round(Math.max(0.08, v / max) * 100) / 100);
};

/**
 * Микрофоннан дауыс жазу: уақыт, тірі толқын және соңында файл + VoiceMeta.
 * finish() — жіберу, cancel() — жою. 5 минуттан кейін өзі жіберіледі.
 */
export const useVoiceRecorder = (onDone: (file: File, meta: VoiceMeta) => void, onError: (message: string) => void) => {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelsRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
    setLevels([]);
  }, []);

  const finish = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    finish();
    cleanup();
  }, [finish, cleanup]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError(t('chat.voice.unsupported'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(t('messageInput.microphonePermissionRequired'));
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    streamRef.current = stream;
    recorderRef.current = recorder;
    cancelledRef.current = false;
    levelsRef.current = [];
    startedAtRef.current = Date.now();

    // Дауыс деңгейін өлшеу — толқын пішіні үшін
    let analyser: AnalyserNode | null = null;
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    const buffer = new Uint8Array(analyser?.fftSize ?? 0);

    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      const duration = (Date.now() - startedAtRef.current) / 1000;
      const waveform = downsample(levelsRef.current, WAVEFORM_BARS);
      const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
      const cancelled = cancelledRef.current;
      cleanup();
      if (cancelled || duration < VOICE_MIN_SECONDS) return;
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([new Blob(chunks, { type })], `voice_${Date.now()}.${ext}`, { type });
      onDoneRef.current(file, { voice: true, duration: Math.round(duration * 10) / 10, waveform });
    };

    recorder.start(250);
    setRecording(true);
    setSeconds(0);
    timerRef.current = window.setInterval(() => {
      if (analyser) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        levelsRef.current.push(Math.min(1, Math.sqrt(sum / buffer.length) * 4));
        setLevels(levelsRef.current.slice(-LIVE_BARS));
      }
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= VOICE_MAX_SECONDS) finish();
    }, 100);
  }, [cleanup, finish, onError, t]);

  // Чат жабылса — жазуды тастаймыз
  useEffect(() => () => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioCtxRef.current?.close().catch(() => undefined);
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  return { recording, seconds, levels, start, finish, cancel };
};

/** Жазу кезінде жазу өрісінің орнына шығатын жолақ */
export const VoiceRecorderBar: React.FC<{
  seconds: number;
  levels: number[];
  onCancel: () => void;
  onSend: () => void;
}> = ({ seconds, levels, onCancel, onSend }) => {
  const { t } = useTranslation();
  const bars = [...Array(Math.max(0, LIVE_BARS - levels.length)).fill(0), ...levels];
  return (
    <div className="cht-rec" role="status" aria-live="polite">
      <button type="button" className="cht-rec__cancel" onClick={onCancel} aria-label={t('chat.voice.cancel')} title={`${t('chat.voice.cancel')} · Esc`}>
        <CloseIcon size={16} />
      </button>
      <span className="cht-rec__dot" aria-hidden="true" />
      <span className="cht-rec__time">{formatDuration(seconds)}</span>
      <span className="cht-rec__wave" aria-hidden="true">
        {bars.map((v, i) => (
          <span key={i} style={{ transform: `scaleY(${Math.max(0.12, v)})` }} />
        ))}
      </span>
      <span className="cht-rec__hint">{t('chat.voice.hint')}</span>
      <button type="button" className="cht-rec__send" onClick={onSend} aria-label={t('chat.voice.send')} title={`${t('chat.voice.send')} · Enter`}>
        <CheckSmallIcon size={18} />
      </button>
    </div>
  );
};

/* ═════════ Дауыстық хабарлама: ойнату ═════════ */

// Бір уақытта тек бір дауыс ойнайды
let activeAudio: HTMLAudioElement | null = null;
const SPEEDS = [1, 1.5, 2];

/** Ескі жазбаларда толқын жоқ — адресінен тұрақты «кездейсоқ» пішін */
const fallbackWave = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Array.from({ length: 36 }, () => {
    h = (h * 1103515245 + 12345) | 0;
    return 0.25 + ((h >>> 16) % 75) / 100;
  });
};

export const VoiceMessage: React.FC<{
  url: string;
  meta?: Partial<VoiceMeta>;
  filename?: string;
  /** Алушы әлі тыңдамаған — ұзақтығының жанында нүкте */
  unheard?: boolean;
  /** Алғаш ойнатылғанда (тек алушыға беріледі) */
  onPlayed?: () => void;
}> = ({ url, meta, filename, unheard, onPlayed }) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const src = fileUrl(url);
  const wave = useMemo(() => (meta?.waveform?.length ? meta.waveform : fallbackWave(src)), [meta?.waveform, src]);
  const duration = meta?.duration || loadedDuration;
  const progress = duration ? Math.min(1, current / duration) : 0;
  // Дауыс емес аудио (музыка т.б.) — атауы да көрінеді
  const title = !meta?.voice && filename && !filename.startsWith('recording_') ? filename : null;

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio && activeAudio === audio) activeAudio = null;
      audio?.pause();
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      audio.playbackRate = speed;
      audio.play().catch(() => setPlaying(false));
      onPlayed?.();
    } else {
      audio.pause();
    }
  };

  const seek = (e: React.MouseEvent<HTMLSpanElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrent(audio.currentTime);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className={`cht-voice ${playing ? 'is-playing' : ''} ${unheard ? 'is-unheard' : ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLoadedDuration(e.currentTarget.duration)}
      />
      <button
        type="button"
        className="cht-voice__play"
        onClick={toggle}
        aria-label={playing ? t('chat.voice.pause') : t('chat.voice.play')}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <span className="cht-voice__body">
        {title && <span className="cht-voice__title">{title}</span>}
        <span
          className="cht-voice__wave"
          onClick={seek}
          role="slider"
          aria-label={t('chat.voice.position')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
        >
          {wave.map((v, i) => (
            <span
              key={i}
              className={(i + 0.5) / wave.length <= progress ? 'is-played' : ''}
              style={{ height: `${Math.round(Math.max(0.12, v) * 100)}%` }}
            />
          ))}
        </span>
        <span className="cht-voice__meta">
          <span>{formatDuration(playing || current > 0 ? current : duration)}</span>
          {unheard && <span className="cht-voice__unheard" title={t('chat.voice.unheard')} aria-label={t('chat.voice.unheard')} />}
          <button type="button" className="cht-voice__speed" onClick={cycleSpeed} title={t('chat.voice.speed')}>
            {speed}×
          </button>
        </span>
      </span>
    </div>
  );
};

/* ═════════ Сауалнама ═════════ */

export const PollCard: React.FC<{ message: Message; currentUserId: string }> = ({ message, currentUserId }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const poll = message.metadata as PollMeta | undefined;
  const [votes, setVotes] = useState<Record<string, string[]>>(message.votes || {});
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Сервер/WebSocket жаңартқанда
  useEffect(() => setVotes(message.votes || {}), [message.votes]);

  if (!poll?.options?.length) return <span className="chat-message-text-content">{message.content}</span>;

  const mine = poll.options.filter((o) => votes[o.id]?.includes(currentUserId)).map((o) => o.id);
  const voted = mine.length > 0;
  const voters = new Set(Object.values(votes).flat()).size;
  const totalVotes = Object.values(votes).reduce((sum, ids) => sum + ids.length, 0);

  const submit = async (optionIds: string[]) => {
    const previous = votes;
    // Оптимистік: бірден көрсетеміз, қате болса қайтарамыз
    const next: Record<string, string[]> = {};
    Object.entries(votes).forEach(([k, ids]) => {
      const rest = ids.filter((id) => id !== currentUserId);
      if (rest.length) next[k] = rest;
    });
    optionIds.forEach((id) => (next[id] = [...(next[id] || []), currentUserId]));
    setVotes(next);
    setPending([]);
    setBusy(true);
    try {
      const updated = await apiService.votePoll(message.id, optionIds, message.groupId);
      setVotes(updated.votes || {});
    } catch {
      setVotes(previous);
      toast.error(t('chat.actions.failed'));
    } finally {
      setBusy(false);
    }
  };

  const choose = (id: string) => {
    if (busy) return;
    if (!poll.multiple) {
      submit([id]);
      return;
    }
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="cht-poll">
      <div className="cht-poll__question">{poll.question}</div>
      <div className="cht-poll__kind">
        <PollIcon size={12} />
        {poll.multiple ? t('chat.poll.multiple') : t('chat.poll.single')}
      </div>
      <div className="cht-poll__options" role={voted ? undefined : 'group'}>
        {poll.options.map((option) => {
          const count = votes[option.id]?.length || 0;
          const percent = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
          const isMine = mine.includes(option.id);
          if (voted) {
            return (
              <div key={option.id} className={`cht-poll__result ${isMine ? 'is-mine' : ''}`}>
                <span className="cht-poll__bar" style={{ width: `${percent}%` }} aria-hidden="true" />
                <span className="cht-poll__percent">{percent}%</span>
                <span className="cht-poll__text">{option.text}</span>
                {isMine && <CheckSmallIcon size={14} />}
              </div>
            );
          }
          const isPending = pending.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`cht-poll__option ${isPending ? 'is-on' : ''}`}
              onClick={() => choose(option.id)}
              disabled={busy}
              aria-pressed={poll.multiple ? isPending : undefined}
            >
              <span className={`cht-poll__mark ${poll.multiple ? 'is-square' : ''}`} aria-hidden="true">
                {isPending && <CheckSmallIcon size={12} />}
              </span>
              <span className="cht-poll__text">{option.text}</span>
            </button>
          );
        })}
      </div>
      <div className="cht-poll__foot">
        <span>{voters ? t('chat.poll.votes', { count: voters }) : t('chat.poll.noVotes')}</span>
        {voted ? (
          <button type="button" className="cht-poll__link" onClick={() => submit([])} disabled={busy}>
            {t('chat.poll.retract')}
          </button>
        ) : (
          poll.multiple && (
            <button type="button" className="cht-poll__link" onClick={() => submit(pending)} disabled={busy || pending.length === 0}>
              {t('chat.poll.vote')}
            </button>
          )
        )}
      </div>
    </div>
  );
};

const POLL_MAX_OPTIONS = 10;

export const CreatePollModal: React.FC<{
  onClose: () => void;
  onCreate: (poll: { question: string; options: string[]; multiple: boolean }) => Promise<void>;
}> = ({ onClose, onCreate }) => {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const unique = new Set(filled.map((o) => o.toLowerCase())).size === filled.length;
  const valid = question.trim() !== '' && filled.length >= 2 && unique;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const setOption = (index: number, value: string) => {
    setOptions((prev) => {
      const next = prev.map((o, i) => (i === index ? value : o));
      // Соңғы жолға жаза бастаса — жаңа бос жол қосылады
      if (index === next.length - 1 && value.trim() && next.length < POLL_MAX_OPTIONS) next.push('');
      return next;
    });
  };

  const removeOption = (index: number) =>
    setOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length < 2 ? [...next, ''] : next;
    });

  const focusOption = (index: number) =>
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('input')[index]?.focus());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ question: question.trim(), options: filled, multiple });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.actions.failed'));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="cht-ma-portal cht-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="cht-modal cht-pollmodal" role="dialog" aria-modal="true" aria-labelledby="cht-poll-title" onSubmit={submit}>
        <div className="cht-modal__head">
          <h2 id="cht-poll-title">{t('chat.poll.create')}</h2>
          <button type="button" className="cht-icon-btn x-close" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="cht-modal__body">
          <label className="cht-pollmodal__label" htmlFor="cht-poll-q">
            {t('chat.poll.question')}
          </label>
          <input
            id="cht-poll-q"
            className="cht-field"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('chat.poll.questionPlaceholder')}
            maxLength={300}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusOption(0);
              }
            }}
          />
          <div className="cht-pollmodal__label">
            {t('chat.poll.options')}
            <span>{t('chat.poll.optionsLeft', { count: POLL_MAX_OPTIONS - filled.length })}</span>
          </div>
          <div className="cht-pollmodal__options" ref={listRef}>
            {options.map((option, i) => (
              <div key={i} className="cht-pollmodal__option">
                <input
                  className="cht-field cht-field--sm"
                  value={option}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={t('chat.poll.optionPlaceholder', { n: i + 1 })}
                  aria-label={t('chat.poll.optionPlaceholder', { n: i + 1 })}
                  maxLength={100}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (i < options.length - 1) focusOption(i + 1);
                    } else if (e.key === 'Backspace' && !option && options.length > 2) {
                      e.preventDefault();
                      removeOption(i);
                      focusOption(Math.max(0, i - 1));
                    }
                  }}
                />
                {options.length > 2 && option && (
                  <button type="button" className="cht-icon-btn" onClick={() => removeOption(i)} aria-label={t('common.delete')}>
                    <CloseIcon size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <label className="cht-pollmodal__switch">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
            <span className="cht-pollmodal__track" aria-hidden="true" />
            <span>{t('chat.poll.allowMultiple')}</span>
          </label>
          {!unique && <p className="cht-form-error">{t('chat.poll.duplicate')}</p>}
          {error && (
            <p className="cht-form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="cht-modal__foot">
          <button type="button" className="cht-btn cht-btn--ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="cht-btn cht-btn--primary" disabled={!valid || saving}>
            {saving ? <span className="cht-btn-spinner" aria-hidden="true" /> : <PollIcon size={16} />}
            {t('chat.poll.send')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

/* ═════════ Ортақ медиа (профиль / топ туралы панелінде) ═════════ */

type MediaTab = 'media' | 'files' | 'voice' | 'links';
const URL_RE = /https?:\/\/[^\s<>()"']+/g;

export const SharedMedia: React.FC<{
  messages: Message[];
  onOpenImage: (url: string, filename: string) => void;
  onJump: (messageId: string) => void;
}> = ({ messages, onOpenImage, onJump }) => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<MediaTab>('media');

  const groups = useMemo(() => {
    const media: Array<{ message: Message; url: string; filename: string; kind: 'image' | 'video' }> = [];
    const files: Array<{ message: Message; url: string; filename: string; size: number }> = [];
    const voice: Array<{ message: Message; url: string; duration?: number }> = [];
    const links: Array<{ message: Message; url: string }> = [];
    // Жаңалары жоғарыда
    [...messages].reverse().forEach((m) => {
      const atts = m.attachments || [];
      if (m.type === 'image' || m.type === 'video') {
        atts.forEach((a) => media.push({ message: m, url: a.url, filename: a.filename, kind: m.type as 'image' | 'video' }));
      } else if (m.type === 'file') {
        atts.forEach((a) => files.push({ message: m, url: a.url, filename: a.filename, size: a.size }));
      } else if (m.type === 'audio') {
        atts.forEach((a) => voice.push({ message: m, url: a.url, duration: (m.metadata as Partial<VoiceMeta>)?.duration }));
      }
      if (m.content && m.type !== 'project' && m.type !== 'poll') {
        Array.from(new Set(m.content.match(URL_RE) || [])).forEach((url) => links.push({ message: m, url: url.replace(/[.,;:!?]+$/, '') }));
      }
    });
    return { media, files, voice, links };
  }, [messages]);

  const dateOf = (m: Message) =>
    new Date(m.createdAt).toLocaleDateString(i18n.language.startsWith('kk') ? 'kk-KZ' : i18n.language.startsWith('ru') ? 'ru-RU' : 'en-US', {
      day: 'numeric',
      month: 'short',
    });

  const tabs: Array<{ key: MediaTab; label: string; count: number }> = [
    { key: 'media', label: t('chat.shared.media'), count: groups.media.length },
    { key: 'files', label: t('chat.shared.files'), count: groups.files.length },
    { key: 'voice', label: t('chat.shared.voice'), count: groups.voice.length },
    { key: 'links', label: t('chat.shared.links'), count: groups.links.length },
  ];

  const empty = <p className="cht-empty">{t(`chat.shared.empty.${tab}`)}</p>;

  return (
    <section className="cht-shared" aria-label={t('chat.media')}>
      <div className="cht-shared__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`cht-shared__tab ${tab === item.key ? 'is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {item.count > 0 && <span>{item.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'media' &&
        (groups.media.length === 0 ? (
          empty
        ) : (
          <div className="cht-media">
            {groups.media.map((item, i) =>
              item.kind === 'image' ? (
                <button
                  key={`${item.message.id}-${i}`}
                  type="button"
                  className="cht-media__item"
                  onClick={() => onOpenImage(fileUrl(item.url), item.filename)}
                  title={item.filename}
                >
                  <img src={fileUrl(item.url)} alt={item.filename} loading="lazy" />
                </button>
              ) : (
                <button
                  key={`${item.message.id}-${i}`}
                  type="button"
                  className="cht-media__item cht-media__item--video"
                  onClick={() => onJump(item.message.id)}
                  title={item.filename}
                >
                  <video src={fileUrl(item.url)} preload="metadata" muted />
                  <span className="cht-media__badge">
                    <VideoIcon size={14} />
                  </span>
                </button>
              ),
            )}
          </div>
        ))}

      {tab === 'files' &&
        (groups.files.length === 0 ? (
          empty
        ) : (
          <div className="cht-shared__list">
            {groups.files.map((item, i) => (
              <a
                key={`${item.message.id}-${i}`}
                className="cht-shared__row"
                href={fileUrl(item.url)}
                download={item.filename}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="cht-shared__icon">
                  <FileIcon size={16} />
                </span>
                <span className="cht-shared__info">
                  <span className="cht-shared__name">{item.filename}</span>
                  <span className="cht-shared__sub">
                    {formatSize(item.size)} · {dateOf(item.message)}
                  </span>
                </span>
              </a>
            ))}
          </div>
        ))}

      {tab === 'voice' &&
        (groups.voice.length === 0 ? (
          empty
        ) : (
          <div className="cht-shared__list">
            {groups.voice.map((item, i) => (
              <button key={`${item.message.id}-${i}`} type="button" className="cht-shared__row" onClick={() => onJump(item.message.id)}>
                <span className="cht-shared__icon">
                  <MicIcon size={16} />
                </span>
                <span className="cht-shared__info">
                  <span className="cht-shared__name">
                    {item.message.sender?.username ? `${item.message.sender.username} · ` : ''}
                    {item.duration ? formatDuration(item.duration) : t('chat.shared.voiceItem')}
                  </span>
                  <span className="cht-shared__sub">{dateOf(item.message)}</span>
                </span>
              </button>
            ))}
          </div>
        ))}

      {tab === 'links' &&
        (groups.links.length === 0 ? (
          empty
        ) : (
          <div className="cht-shared__list">
            {groups.links.map((item, i) => (
              <a
                key={`${item.message.id}-${i}`}
                className="cht-shared__row"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="cht-shared__icon">
                  <LinkIcon size={16} />
                </span>
                <span className="cht-shared__info">
                  <span className="cht-shared__name">{item.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  <span className="cht-shared__sub">{dateOf(item.message)}</span>
                </span>
              </a>
            ))}
          </div>
        ))}
    </section>
  );
};

/* ═════════ Чаттарды бекіту / дыбысын өшіру / мұрағаттау ═════════ */

export type ChatKind = 'dm' | 'group';
export const prefKey = (kind: ChatKind, id: string) => `${kind}:${id}`;

export const useChatPrefs = (enabled: boolean) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, ChatPref>>({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiService
      .getChatPrefs()
      .then((list) => alive && setPrefs(Object.fromEntries(list.map((p) => [prefKey(p.kind, p.id), p]))))
      .catch(() => undefined);
    // Басқа бетте/құрылғыда өзгерсе
    const onPref = (data: { pref?: ChatPref }) => {
      const pref = data.pref;
      if (pref) setPrefs((prev) => ({ ...prev, [prefKey(pref.kind, pref.id)]: pref }));
    };
    websocketService.on('chat_pref', onPref);
    return () => {
      alive = false;
      websocketService.off('chat_pref', onPref);
    };
  }, [enabled]);

  const prefOf = useCallback(
    (kind: ChatKind, id: string): ChatPref => prefs[prefKey(kind, id)] || { kind, id, pinnedAt: null, muted: false, archived: false },
    [prefs],
  );

  const update = useCallback(
    async (kind: ChatKind, id: string, changes: Partial<{ pinned: boolean; muted: boolean; archived: boolean }>) => {
      const key = prefKey(kind, id);
      const before = prefs[key];
      const base = before || { kind, id, pinnedAt: null, muted: false, archived: false };
      const optimistic: ChatPref = {
        ...base,
        ...(changes.muted !== undefined ? { muted: changes.muted } : {}),
        ...(changes.archived !== undefined ? { archived: changes.archived } : {}),
        ...(changes.pinned !== undefined ? { pinnedAt: changes.pinned ? base.pinnedAt || new Date().toISOString() : null } : {}),
      };
      if (changes.archived) optimistic.pinnedAt = null;
      setPrefs((prev) => ({ ...prev, [key]: optimistic }));
      try {
        const saved = await apiService.updateChatPref(kind, id, changes);
        setPrefs((prev) => ({ ...prev, [key]: saved }));
        if (changes.archived !== undefined) toast.success(t(changes.archived ? 'chat.list.archivedToast' : 'chat.list.unarchivedToast'));
      } catch (err) {
        setPrefs((prev) => {
          const next = { ...prev };
          if (before) next[key] = before;
          else delete next[key];
          return next;
        });
        const message = err instanceof Error ? err.message : '';
        toast.error(message.includes('pinned_limit') ? t('chat.list.pinnedLimit', { count: 5 }) : t('chat.actions.failed'));
      }
    },
    [prefs, t, toast],
  );

  return { prefOf, update };
};

/** «Сақталған хабарламалар» аватары */
export const SavedAvatar: React.FC<{ className?: string; size?: number }> = ({ className = '', size = 18 }) => (
  <span className={`cht-saved-avatar ${className}`} aria-hidden="true">
    <BookmarkIcon size={size} />
  </span>
);
