import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminal } from '../../hooks/useTerminal';
import { useAuth } from '../../contexts/AuthContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlug, faXmark, faTrash, faTerminal, faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';

const TerminalPanel: React.FC = () => {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { terminalRef, isConnected, error, connect, disconnect, clear } = useTerminal();
  const [connecting, setConnecting] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const handleConnect = useCallback(async () => {
    try {
      setConnecting(true);
      const token = await getAccessToken();
      if (token) {
        connect(token);
      }
    } catch (err) {
      console.error('Failed to connect terminal:', err);
    } finally {
      setConnecting(false);
    }
  }, [getAccessToken, connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return (
    <div className={`h-full flex flex-col bg-[var(--ide-terminal-bg)] ${isMaximized ? 'fixed inset-0 z-50' : ''}`}>
      {/* Terminal header */}
      <div
        className="vibe-terminal-header flex items-center justify-between px-3 py-1 flex-shrink-0 select-none"
        style={{
          borderBottom: '1px solid var(--ide-border)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <FontAwesomeIcon icon={faTerminal} className="text-[var(--ide-accent)] text-[10px]" />
            <span className="text-[11px] font-semibold text-[var(--ide-text)]">
              Vibecoding Terminal
            </span>
          </div>
          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            {isConnected && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {t('vibecoding.terminal.connected', 'Қосылды')}
              </span>
            )}
            {!isConnected && !connecting && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--ide-text-muted)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ide-text-muted)]" />
                {t('vibecoding.terminal.disconnected', 'Ажыратылған')}
              </span>
            )}
            {connecting && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                {t('vibecoding.terminal.connecting', 'Қосылу...')}
              </span>
            )}
            {error && (
              <span className="text-[10px] text-red-400">{error}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {!isConnected ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="vibe-terminal-connect flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-md transition-all duration-200"
              style={{
                color: '#fff',
                opacity: connecting ? 0.6 : 1,
              }}
            >
              <FontAwesomeIcon icon={faPlug} className="text-[8px]" />
              Connect
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-md transition-colors text-[var(--ide-text-muted)] hover:text-red-400 hover:bg-red-500/10"
            >
              <FontAwesomeIcon icon={faXmark} className="text-[8px]" />
            </button>
          )}
          <button
            onClick={clear}
            className="p-1 rounded text-[var(--ide-text-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-hover)] transition-colors"
            title={t('vibecoding.terminal.clear', 'Тазалау')}
          >
            <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 rounded text-[var(--ide-text-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-hover)] transition-colors"
            title={isMaximized ? 'Кішірейту' : 'Жаю'}
          >
            <FontAwesomeIcon icon={isMaximized ? faCompress : faExpand} className="text-[10px]" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div ref={(el) => { if (el) (terminalRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />
    </div>
  );
};

export default TerminalPanel;