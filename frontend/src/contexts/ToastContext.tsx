import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamation, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import './Toast.css';

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

const CONFIRM_EXIT_MS = 200;

// Оң жақ жоғарыдағы toast хабарламалары сайттың ешбір жерінде көрсетілмейді:
// useToast() API-і сақталған (шақырған жерлер сынбасын), бірақ ештеңе шығармайды.
const noop = () => {};
const SILENT_TOAST: ToastApi = { success: noop, error: noop, info: noop };

// Растау терезесі — браузердің confirm() терезесінің орнына.
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
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
    setTimeout(() => setConfirmState(null), CONFIRM_EXIT_MS);
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

  return (
    <ToastContext.Provider value={SILENT_TOAST}>
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
