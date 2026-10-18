import React from 'react';
import { Icon } from '../home/icons';

/* Vibecoding белгішелері — басты беттегідей сызықтық стиль (stroke 1.8, currentColor).
   Барлық IDE панельдері осы жиынды қолданады. */

type P = { size?: number };

export const ExplorerIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  </Icon>
);

export const FolderIcon: React.FC<P & { open?: boolean }> = ({ size, open }) => (
  <Icon size={size}>
    {open ? (
      <>
        <path d="M3.5 17V7.5a2 2 0 0 1 2-2h3.6l2 2h6.4a2 2 0 0 1 2 2v1" />
        <path d="M3.5 17.5 6 11.8a1.6 1.6 0 0 1 1.5-1h12.3a1 1 0 0 1 .9 1.4l-2.3 5.4a1.6 1.6 0 0 1-1.5 1H5a1.5 1.5 0 0 1-1.5-1.1Z" />
      </>
    ) : (
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    )}
  </Icon>
);

export const FolderPlusIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </Icon>
);

export const FileIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3.5V8h4.5" />
  </Icon>
);

export const FilePlusIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3.5V8h4.5M12 11.5v5M9.5 14h5" />
  </Icon>
);

export const CodeIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5M13.5 5l-3 14" />
  </Icon>
);

export const TerminalIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="m7.5 9.5 2.5 2.5-2.5 2.5M12.5 15h4" />
  </Icon>
);

export const SparkleIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5Z" />
    <path d="M19 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" />
  </Icon>
);

export const SearchIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.9-3.9" />
  </Icon>
);

export const CommandIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9Zm0 0v11m0-11h6m-6 11A2.5 2.5 0 1 1 6.5 15H9Zm0 0h6m0-11A2.5 2.5 0 1 1 17.5 9H15Zm0 0v11m0 0a2.5 2.5 0 1 0 2.5-2.5H15" />
  </Icon>
);

export const PlusIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Icon>
);

export const TrashIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 7h15M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
  </Icon>
);

export const EditIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const MoreIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="6" cy="12" r="0.9" fill="currentColor" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    <circle cx="18" cy="12" r="0.9" fill="currentColor" />
  </Icon>
);

export const ChevronIcon: React.FC<P> = ({ size = 14 }) => (
  <Icon size={size}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const ChevronDownIcon: React.FC<P> = ({ size = 14 }) => (
  <Icon size={size}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const ArrowLeftIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowUpIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const CopyIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const CheckIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const InsertIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 4v10M7.5 9.5 12 14l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const UserIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5a7 7 0 0 1 14 0" />
  </Icon>
);

export const PlugIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0ZM12 16v4.5" />
  </Icon>
);

export const ExpandIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-6 6M4.5 19.5l6-6" />
  </Icon>
);

export const CollapseIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M19.5 9.5h-5v-5M4.5 14.5h5v5M14.5 9.5l6-6M9.5 14.5l-6 6" />
  </Icon>
);

export const BranchIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="7" cy="5.5" r="2" />
    <circle cx="7" cy="18.5" r="2" />
    <circle cx="17" cy="8" r="2" />
    <path d="M7 7.5v9M17 10a5 5 0 0 1-5 5H7" />
  </Icon>
);

export const CircleCheckIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.3 2.4 2.4 4.6-4.9" />
  </Icon>
);

export const CircleAlertIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.8v5M12 16.2v.01" />
  </Icon>
);

export const ZoomInIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.9-3.9M11 8.5v5M8.5 11h5" />
  </Icon>
);

export const ZoomOutIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.9-3.9M8.5 11h5" />
  </Icon>
);

export const SettingsIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9" />
    <circle cx="15.5" cy="7" r="2" />
    <circle cx="8.5" cy="17" r="2" />
  </Icon>
);

export const MenuIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
  </Icon>
);

export const SaveIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M5.5 4.5h10l3 3v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
    <path d="M8 4.5v4h7v-4M8 19.5v-5h8v5" />
  </Icon>
);

export const WandIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="m4.5 19.5 10-10M13 5.5l1-2 1 2 2 1-2 1-1 2-1-2-2-1ZM18.5 11.5l.6-1.2.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6Z" />
  </Icon>
);

export const SunIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
  </Icon>
);

export const MoonIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
  </Icon>
);

export const UploadIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
  </Icon>
);

export const ChatIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M5 18.5V7.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7.5v6a2.5 2.5 0 0 1-2.5 2.5H8.5Z" />
    <path d="M9 10h6M9 13h3.5" />
  </Icon>
);

export const HomeIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 10.5 12 4.5l7.5 6V18a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5h-5v5H6A1.5 1.5 0 0 1 4.5 18Z" />
  </Icon>
);

export const FontIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M5 19 10 5h1l5 14M7 14h7M17 13.5v5.5M17 16.2a2.3 2.3 0 1 1 4.5 0 2.3 2.3 0 1 1-4.5 0" />
  </Icon>
);

export const IndentIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 5.5h15M10.5 10h9M10.5 14h9M4.5 18.5h15M4.5 9.5l3 2.5-3 2.5" />
  </Icon>
);

export const WrapIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 6.5h15M4.5 12h12a3 3 0 0 1 0 6h-4M14.5 16l-2 2 2 2M4.5 17.5h4" />
  </Icon>
);

export const MapIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
    <path d="M15 4.5v15M7 8.5h5M7 11.5h3.5M7 14.5h5" />
  </Icon>
);

export const ListNumIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M10 6.5h9.5M10 12h9.5M10 17.5h9.5M5 5.5l1-1v4M4.5 14a1.3 1.3 0 0 1 2.5.5c0 .8-2.5 2-2.5 3h2.5" />
  </Icon>
);

export const LigatureIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M4.5 12h6M13.5 12h6M8 8.5 11.5 12 8 15.5M16 8.5 12.5 12l3.5 3.5" />
  </Icon>
);

export const BracketsIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M8.5 4.5H7a2 2 0 0 0-2 2v3.2a2.3 2.3 0 0 1-1.5 2.3A2.3 2.3 0 0 1 5 14.3v3.2a2 2 0 0 0 2 2h1.5M15.5 4.5H17a2 2 0 0 1 2 2v3.2a2.3 2.3 0 0 0 1.5 2.3 2.3 2.3 0 0 0-1.5 2.3v3.2a2 2 0 0 1-2 2h-1.5" />
  </Icon>
);

export const LinkIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const CursorIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M9 4.5h1.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H9M15 4.5h-1.5A1.5 1.5 0 0 0 12 6v12a1.5 1.5 0 0 0 1.5 1.5H15" />
  </Icon>
);

export const PaletteIcon: React.FC<P> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 4a8 8 0 1 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.7 1.8-1.7H17a3 3 0 0 0 3-3C20 7 16.4 4 12 4Z" />
    <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    <circle cx="10.5" cy="7.8" r="0.9" fill="currentColor" />
    <circle cx="14.5" cy="7.8" r="0.9" fill="currentColor" />
  </Icon>
);
