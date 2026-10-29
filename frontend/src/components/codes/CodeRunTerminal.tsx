import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTerminal } from '../../hooks/useTerminal';

interface CodeRunTerminalProps {
  codeId: string;
  /** Терминал дайын болғанда орындалатын команда (бос болса — жай терминал) */
  command: string | null;
  /** Әр жаңа іске қосуда артады — команда қайта орындалады */
  runKey: number;
  onStatus: (status: 'connecting' | 'open' | 'closed', error: string | null) => void;
}

/* Жүктелген жобаның көшірмесінде ашылатын терминал (xterm ауыр — бөлек lazy жүктеледі).
   Сервер жобаның файлдарын қолданушының терминал папкасына жазып, сол жерде ашады. */
const CodeRunTerminal: React.FC<CodeRunTerminalProps> = ({ codeId, command, runKey, onStatus }) => {
  const { getAccessToken } = useAuth();
  const ranKey = useRef<number | null>(null);
  const term = useTerminal({ codeId });
  const { connect, disconnect, sendText, status, error, isConnected } = term;

  // Токен жаңарып тұрады — қайта қосылу әрқашан ең соңғысын алсын
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  useEffect(() => {
    connect(async () => getTokenRef.current());
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    onStatus(status, error);
  }, [status, error, onStatus]);

  // Shell дайын болған соң командаға жібереміз (қайта қосылғанда қайталамаймыз)
  useEffect(() => {
    if (!isConnected || !command || ranKey.current === runKey) return;
    const timer = window.setTimeout(() => {
      ranKey.current = runKey;
      sendText(command);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isConnected, command, runKey, sendText]);

  const { terminalRef } = term;
  return (
    <div
      ref={(el) => { (terminalRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      className="vc-run__terminal"
    />
  );
};

export default CodeRunTerminal;
