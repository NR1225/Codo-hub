import React from 'react';

/* Чаттағы хабарлама түрлерінің белгішелері — тек сызықтық (stroke 1.8, currentColor).
   Аттары home/icons.tsx-пен бірдей: чат файлдарында импорт жолын ауыстыру жеткілікті. */

type MediaIcon = React.FC<{ size?: number }>;

const Base: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/* Дауыстық хабарлама: микрофон + екі жағында дыбыс толқыны */
export const MicIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <rect x="9.5" y="3" width="5" height="10.5" rx="2.5" />
    <path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9.5 20.5h5" />
    <path d="M3.5 9.5v3M20.5 9.5v3" />
  </Base>
);

/* Орналасқан жер: түйреуіш + жердегі көлеңке */
export const MapPinIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M12 17.5s-5.5-4.6-5.5-9a5.5 5.5 0 0 1 11 0c0 4.4-5.5 9-5.5 9Z" />
    <circle cx="12" cy="8.5" r="2" />
    <path d="M7.5 17.2c-2 .4-3.5 1.1-3.5 1.8 0 1.1 3.6 2 8 2s8-.9 8-2c0-.7-1.5-1.4-3.5-1.8" />
  </Base>
);

/* Фото: жақтау, күн, екі шың */
export const ImageIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="15.5" cy="9" r="1.5" />
    <path d="m3.5 16.5 4.6-4.6a1.5 1.5 0 0 1 2.1 0l3.3 3.3M12.5 14l1.4-1.4a1.5 1.5 0 0 1 2.1 0l4.5 4.5" />
  </Base>
);

/* Видео: таспа жақтауы + ішінде ойнату үшбұрышы */
export const VideoIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10.5 9.5v5l4-2.5Z" />
  </Base>
);

/* Файл: бүктелген бұрышы бар парақ + мәтін жолдары */
export const FileIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M13.5 3.5H8a2.5 2.5 0 0 0-2.5 2.5v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8.5Z" />
    <path d="M13.5 3.5v3.5a1.5 1.5 0 0 0 1.5 1.5h3.5M9 13h6M9 16.5h4" />
  </Base>
);

/* Папка (жоба, репозиторий): құлақшасы мен алдыңғы қақпағы бар */
export const FolderIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M3.5 17.5v-11A2 2 0 0 1 5.5 4.5h3.4a2 2 0 0 1 1.5.7l1.3 1.6h6.8a2 2 0 0 1 2 2v8.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    <path d="M3.5 10h17" />
  </Base>
);

/* Сауалнама: нұсқалар — нүкте + әр ұзындықтағы жолақ */
export const PollIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth="2.6" />
    <path d="M8.5 6.5h11M8.5 12h7M8.5 17.5h9" />
  </Base>
);

/* Тіркеме (файл қосу) */
export const PaperclipIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="m19.5 11-7.4 7.4a4.6 4.6 0 0 1-6.5-6.5l7.7-7.7a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l7-7" />
  </Base>
);

/* Дауыстық хабарды ойнату / тоқтату — толтырусыз */
export const PlayIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M8 6.2v11.6a1 1 0 0 0 1.5.9l9.2-5.8a1 1 0 0 0 0-1.8L9.5 5.3A1 1 0 0 0 8 6.2Z" />
  </Base>
);

export const PauseIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <rect x="6.5" y="5.5" width="3.5" height="13" rx="1.2" />
    <rect x="14" y="5.5" width="3.5" height="13" rx="1.2" />
  </Base>
);

/* Стикер: бұрышы бүктелген жапсырма */
export const StickerIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5h3.5a5 5 0 0 1 5 5Z" />
    <path d="M20.5 12h-3.5a5 5 0 0 0-5 5v3.5" />
  </Base>
);

const KIND_ICONS: Record<string, MediaIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MicIcon,
  file: FileIcon,
  location: MapPinIcon,
  project: FolderIcon,
  poll: PollIcon,
  sticker: StickerIcon,
};

/** Хабарлама түріне сай белгіше (мәтін мен жүйелік хабарда — ештеңе) */
export const MediaKindIcon: React.FC<{ type?: string; size?: number }> = ({ type, size = 14 }) => {
  const KindIcon = type ? KIND_ICONS[type] : undefined;
  if (!KindIcon) return null;
  return (
    <span className="cht-kind-icon">
      <KindIcon size={size} />
    </span>
  );
};

/* Жіберілмеді: дөңгелек ішінде леп белгісі */
export const AlertIcon: MediaIcon = ({ size }) => (
  <Base size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.8v4.9M12 16.2h.01" />
  </Base>
);
