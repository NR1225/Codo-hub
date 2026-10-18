import React from 'react';

/* Басты беттің бірыңғай сызықтық белгішелері (stroke 1.8, currentColor) —
   sidebar мен Сайт ЖИ бір стильде көрінуі үшін */

export const Icon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 18 }) => (
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

export const PanelIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    {/* Сол жақ бөлік: sidebar ашық кезде боялған, жабылғанда жиналады */}
    <rect className="hsb__panel-fill" x="4.5" y="5.5" width="4" height="13" rx="1.2" fill="currentColor" stroke="none" />
    <path d="M10 4v16" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.9-3.9" />
  </Icon>
);

export const SparkleIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5Z" />
    <path d="M19 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" />
  </Icon>
);

export const ArrowUpIcon = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowRightIcon = () => (
  <Icon size={16}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon size={16}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

export const GridIcon = () => (
  <Icon size={16}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </Icon>
);

export const ListIcon = () => (
  <Icon size={16}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
  </Icon>
);

export const FileIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3.5V8h4.5" />
  </Icon>
);

export const FolderIcon: React.FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  </Icon>
);

export const HeartIcon = () => (
  <Icon size={14}>
    <path d="M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6c0 5.3-7.5 9.7-7.5 9.7Z" />
  </Icon>
);

export const CommentIcon = () => (
  <Icon size={14}>
    <path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H8.5Z" />
  </Icon>
);

export const EyeIcon = () => (
  <Icon size={14}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);

export const XIcon = () => (
  <Icon size={14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const SortIcon = () => (
  <Icon size={16}>
    <path d="M4 7h10M4 12h7M4 17h4" />
    <path d="M17.5 5v14M14.5 16l3 3 3-3" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={14}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={16}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const CodeBracketsIcon = () => (
  <Icon size={16}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Icon>
);

export const ArrowLeftIcon = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" />
  </Icon>
);

export const PhoneIcon = () => (
  <Icon>
    <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
    <path d="M10.5 17.5h3" />
  </Icon>
);

export const PlugIcon = () => (
  <Icon>
    <path d="M9 3.5v4M15 3.5v4M7 7.5h10v3a5 5 0 0 1-10 0Z" />
    <path d="M12 15.5v5" />
  </Icon>
);

export const DatabaseIcon = () => (
  <Icon>
    <ellipse cx="12" cy="6" rx="7" ry="2.8" />
    <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
    <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
  </Icon>
);

export const MonitorIcon = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="12" rx="2.2" />
    <path d="M9 20h6M12 16.5V20" />
  </Icon>
);

export const GamepadIcon = () => (
  <Icon>
    <path d="M7.5 8h9a4.5 4.5 0 0 1 4.3 5.8l-.9 3a2.3 2.3 0 0 1-3.8 1L14.5 16h-5l-1.6 1.8a2.3 2.3 0 0 1-3.8-1l-.9-3A4.5 4.5 0 0 1 7.5 8Z" />
    <path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01" />
  </Icon>
);

export const InfinityIcon = () => (
  <Icon>
    <path d="M12 12c-2-2.6-3.8-4-5.6-4a4 4 0 0 0 0 8c1.8 0 3.6-1.4 5.6-4Zm0 0c2 2.6 3.8 4 5.6 4a4 4 0 0 0 0-8c-1.8 0-3.6 1.4-5.6 4Z" />
  </Icon>
);

export const LayersIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </Icon>
);

/* ---------- Чат белгішелері ---------- */

type SizedIcon = React.FC<{ size?: number }>;

export const ChatIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h10A2.5 2.5 0 0 1 19.5 7v7a2.5 2.5 0 0 1-2.5 2.5H8.5Z" />
    <path d="M8.5 9.5h7M8.5 12.5h4.5" />
  </Icon>
);

export const UserIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c.9-3.6 3.8-5.6 7.5-5.6s6.6 2 7.5 5.6" />
  </Icon>
);

export const UserPlusIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <circle cx="10" cy="8.5" r="3.8" />
    <path d="M3 20c.9-3.6 3.6-5.6 7-5.6 1.6 0 3 .4 4.2 1.2M18.5 13v6M15.5 16h6" />
  </Icon>
);

export const InboxIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M4 13.5 6.4 6a2 2 0 0 1 1.9-1.5h7.4A2 2 0 0 1 17.6 6l2.4 7.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M4 13.5h4.5l1.2 2h4.6l1.2-2H20" />
  </Icon>
);

export const ClockIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const CheckDoubleIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="m2.5 12.5 4.5 4.5 8.5-9.5M10.5 15.5l1.5 1.5 9-9.5" />
  </Icon>
);

export const CheckSmallIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const MoreIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" strokeWidth="3" />
  </Icon>
);

export const TrashIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.8 1.8 0 0 0 1.8 1.5h5.8a1.8 1.8 0 0 0 1.8-1.5l.8-12" />
  </Icon>
);

export const EditIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.5L15.8 4.7a1.6 1.6 0 0 1 2.3 0l1.2 1.2a1.6 1.6 0 0 1 0 2.3L9 18.5Z" />
  </Icon>
);

export const VideoIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </Icon>
);

export const MusicIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M9 17.5V5.5l10-2v12" />
    <circle cx="6.5" cy="17.5" r="2.5" />
    <circle cx="16.5" cy="15.5" r="2.5" />
  </Icon>
);

export const DownloadIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Icon>
);

export const TextIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M5 6.5h14M5 11h14M5 15.5h9" />
  </Icon>
);

export const MapPinIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Icon>
);

export const LinkIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const ImageIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 15.5-4.5-4.5-8.5 8.5" />
  </Icon>
);

export const PaperclipIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
  </Icon>
);

export const MicIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Icon>
);

export const SmileIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9.3 9.8h.01M14.7 9.8h.01" />
  </Icon>
);

export const CloseIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

/* ---------- Топ белгішелері ---------- */

export const UsersIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 19.5c.8-3.3 3.3-5.2 6.5-5.2s5.7 1.9 6.5 5.2" />
    <path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.6c2 .6 3.4 2.3 4 4.9" />
  </Icon>
);

export const CrownIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10Z" />
    <path d="M4.5 20.5h15" />
  </Icon>
);

export const ShieldIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M12 3.5 19 6v5.5c0 4.4-2.9 7.7-7 9-4.1-1.3-7-4.6-7-9V6Z" />
  </Icon>
);

export const LogOutIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
  </Icon>
);

/* Хабарлама әрекеттері (чат) */
export const ReplyIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M9.5 6 4 11.5 9.5 17" />
    <path d="M4.5 11.5H14a6 6 0 0 1 6 6v.5" />
  </Icon>
);

export const ForwardIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M14.5 6 20 11.5 14.5 17" />
    <path d="M19.5 11.5H10a6 6 0 0 0-6 6v.5" />
  </Icon>
);

export const CopyIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
    <path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" />
  </Icon>
);

export const PinIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M9 4h6l-1 5.5 3 3V14H7v-1.5l3-3Z" />
    <path d="M12 14v6" />
  </Icon>
);

/* Чаттар тізімі және 3-кезең (дауыс, сауалнама, сақталған) */
export const BookmarkIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" />
  </Icon>
);

export const ArchiveIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1.2" />
    <path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5" />
    <path d="M10 12.5h4" />
  </Icon>
);

export const BellIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const BellOffIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M8.2 6.2A6 6 0 0 1 18 11v4.5M6 11v5.5L4.5 18H16" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
    <path d="m4 4 16 16" />
  </Icon>
);

export const PollIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M5 20V12M12 20V5M19 20v-6" />
  </Icon>
);

export const PlayIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />
  </Icon>
);

export const PauseIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth="3" />
  </Icon>
);

export const MailOpenIcon: SizedIcon = ({ size }) => (
  <Icon size={size}>
    <path d="M4 10 12 4.5 20 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" />
    <path d="m4 10 8 5.5 8-5.5" />
  </Icon>
);
