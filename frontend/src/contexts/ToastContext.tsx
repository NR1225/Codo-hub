import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faExclamation, faInfo, faXmark, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import './Toast.css';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  leaving: boolean;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  icon?: IconDefinition;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ToastContext = createContext<ToastApi | null>(null);
const ConfirmContext = createContext<ConfirmFn | null>(null);

export const LOGOUT_ICON = faRightFromBracket;

const TOAST_DURATION_MS = 4000;
const TOAST_EXIT_MS = 200;
const MAX_TOASTS = 4;

const ICONS = {
  success: faCheck,
  error: faExclamation,
  info: faInfo,
};

// Сайт ішіндегі хабарламалар — браузердің alert() / confirm() терезелерінің орнына.
// Уақыт жолағының CSS анимациясы біткенде toast жабылады, сондықтан
// тышқан үстінде тұрғанда (анимация паузада) ол жабылмайды.
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), TOAST_EXIT_MS);
  }, []);

  const show = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, type, message, leaving: false }]);
  }, []);

  const api = useRef<ToastApi>({
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
  }).current;

  // ── Растау терезесі: await confirm({...}) → true / false ──
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { leaving: boolean }) | null>(null);
  const confirmResolve = useRef<((value: boolean) => void) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    confirmResolve.current?.(false);
    setConfirmState({ ...options, leaving: false });
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    confirmResolve.current?.(result);
    confirmResolve.current = null;
    setConfirmState((prev) => (prev ? { ...prev, leaving: true } : prev));
    setTimeout(() => setConfirmState(null), TOAST_EXIT_MS);
  }, []);

  useEffect(() => {
    if (!confirmState || confirmState.leaving) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmState, closeConfirm]);

  const titles: Record<ToastType, string> = {
    success: t('common.success'),
    error: t('common.error'),
    info: t('common.info'),
  };

  return (
    <ToastContext.Provider value={api}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {confirmState && (
          <div
            className={`confirm-overlay${confirmState.leaving ? ' is-leaving' : ''}`}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeConfirm(false);
            }}
          >
            <div
              className={`confirm-dialog${confirmState.danger ? ' confirm-danger' : ''}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby={confirmState.message ? 'confirm-message' : undefined}
            >
              <span className="confirm-icon">
                <FontAwesomeIcon icon={confirmState.icon ?? faExclamation} />
              </span>
              <h2 id="confirm-title" className="confirm-title">{confirmState.title}</h2>
              {confirmState.message && (
                <p id="confirm-message" className="confirm-message">{confirmState.message}</p>
              )}
              <div className="confirm-actions">
                <button
                  type="button"
                  className="confirm-btn confirm-btn--ghost"
                  onClick={() => closeConfirm(false)}
                >
                  {confirmState.cancelText ?? t('common.cancel')}
                </button>
                <button
                  ref={confirmBtnRef}
                  type="button"
                  className="confirm-btn confirm-btn--primary"
                  onClick={() => closeConfirm(true)}
                >
                  {confirmState.confirmText ?? t('common.yes')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="toast-container">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast-${toast.type}${toast.leaving ? ' toast-leaving' : ''}`}
              role={toast.type === 'error' ? 'alert' : 'status'}
              style={{ '--toast-duration': `${TOAST_DURATION_MS}ms` } as React.CSSProperties}
            >
              <span className="toast-icon">
                <FontAwesomeIcon icon={ICONS[toast.type]} />
              </span>
              <div className="toast-body">
                <div className="toast-title">{titles[toast.type]}</div>
                <div className="toast-message">{toast.message}</div>
              </div>
              <button
                type="button"
                className="toast-close"
                onClick={() => dismiss(toast.id)}
                aria-label={t('common.close')}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
              <span
                className="toast-progress"
                onAnimationEnd={() => dismiss(toast.id)}
              />
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ToastProvider');
  return ctx;
};
