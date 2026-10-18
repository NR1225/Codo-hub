import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminal } from '../../hooks/useTerminal';
import { useAuth } from '../../contexts/AuthContext';
import { PlugIcon, CloseIcon, TrashIcon, TerminalIcon, ExpandIcon, CollapseIcon } from './icons';

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

  const status = isConnected ? 'on' : connecting ? 'wait' : 'off';

  return (
    <div className={`vx-term ${isMaximized ? 'is-max' : ''}`}>
      {/* Терминал тақырыбы */}
      <div className="vx-term__bar select-none">
        <span className="vx-term__tab">
          <TerminalIcon size={14} />
          Terminal
        </span>
        {/* Күй белгісі — жарқырайтын нүкте */}
        <span className={`vx-term__status is-${status}`}>
          <span className="vx-term__dot" />
          {isConnected
            ? t('vibecoding.terminal.connected', 'Қосылды')
            : connecting
              ? t('vibecoding.terminal.connecting', 'Қосылу...')
              : t('vibecoding.terminal.disconnected', 'Ажыратылған')}
        </span>
        {error && <span className="vx-term__error">{error}</span>}

        <div className="vx-term__actions">
          {!isConnected ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="vx-btn vx-btn--primary vx-btn--xs"
            >
              <PlugIcon size={13} />
              Connect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              className="vx-icon-btn vx-icon-btn--danger"
              title={t('vibecoding.terminal.disconnect', 'Ажырату')}
            >
              <CloseIcon size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={clear}
            className="vx-icon-btn"
            title={t('vibecoding.terminal.clear', 'Тазалау')}
          >
            <TrashIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => setIsMaximized(!isMaximized)}
            className="vx-icon-btn"
            title={isMaximized ? 'Кішірейту' : 'Жаю'}
          >
            {isMaximized ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div ref={(el) => { if (el) (terminalRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }} className="vx-term__screen" />
    </div>
  );
};

export default TerminalPanel;