import React, { useEffect, useRef, useState } from 'react';
import { PaperclipIcon, ImageIcon, FileIcon, FolderIcon, CloseIcon } from './home/icons';
import type { Attachment } from '../utils/burkitAttachments';

/* Бүркітке фото / файл / папка тіркеу — басты бет пен Vibecoding-ке ортақ.
   cls — CSS класс түбірі (sai немесе vx-ai): әр жерде өз дизайнымен. */

// Тіркеме белгісі: сурет — кішкене көрінісімен, файл/папка — атымен
export const BurkitAttachmentChip: React.FC<{ cls: string; item: Attachment; onRemove?: () => void }> = ({ cls, item, onRemove }) => (
  <span className={`${cls}__att ${cls}__att--${item.kind}`} title={item.name}>
    {item.preview ? (
      <img src={item.preview} alt="" className={`${cls}__att-thumb`} />
    ) : (
      <span className={`${cls}__att-icon`}>
        {item.kind === 'image' ? <ImageIcon size={14} /> : item.kind === 'folder' ? <FolderIcon size={14} /> : <FileIcon size={14} />}
      </span>
    )}
    <span className={`${cls}__att-name`}>{item.name}</span>
    {item.kind === 'folder' && item.count !== undefined && <span className={`${cls}__att-count`}>{item.count}</span>}
    {onRemove && (
      <button type="button" className={`${cls}__att-remove`} onClick={onRemove} aria-label={`${item.name} — алып тастау`}>
        <CloseIcon size={12} />
      </button>
    )}
  </span>
);

// 📎 батырмасы және Фото / Файл / Папка мәзірі
export const BurkitAttachButton: React.FC<{
  cls: string;
  disabled?: boolean;
  iconSize?: number;
  onFiles: (files: File[], folder?: boolean) => void;
}> = ({ cls, disabled, iconSize = 18, onFiles }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Мәзір сыртын басқанда / Esc — жабылады
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>, folder = false) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    setOpen(false);
    onFiles(list, folder);
  };

  return (
    <div className={`${cls}__attach`} ref={rootRef}>
      <button
        type="button"
        className={`${cls}__attach-btn ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Тіркеу"
        aria-expanded={open}
        title="Фото, файл немесе папка тіркеу"
      >
        <PaperclipIcon size={iconSize} />
      </button>
      {open && (
        <div className={`${cls}__attach-menu`} role="menu">
          <button type="button" role="menuitem" onClick={() => photoRef.current?.click()}>
            <ImageIcon size={16} />
            Фото
          </button>
          <button type="button" role="menuitem" onClick={() => fileRef.current?.click()}>
            <FileIcon size={16} />
            Файл
          </button>
          <button type="button" role="menuitem" onClick={() => folderRef.current?.click()}>
            <FolderIcon size={16} />
            Папка
          </button>
        </div>
      )}
      <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => pick(e)} />
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => pick(e)} />
      <input
        ref={folderRef}
        type="file"
        hidden
        onChange={(e) => pick(e, true)}
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    </div>
  );
};
