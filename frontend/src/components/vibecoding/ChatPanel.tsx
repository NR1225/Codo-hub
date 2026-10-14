import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faPaperPlane,
  faPlus,
  faTrash,
  faCopy,
  faCode,
  faUser,
  faCheck,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  codeBlocks?: { language: string; code: string }[];
}

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function extractCodeBlocks(content: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({ language: match[1] || 'plaintext', code: match[2].trim() });
  }
  return blocks;
}

const ChatPanel: React.FC = () => {
  const { t } = useTranslation();
  const { dispatch, activeFile, isMobile, isTablet } = useVibecoding();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isOverlay = isMobile || isTablet;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 1000);
      });

      const responseContent = activeFile
        ? t('vibecoding.chat.fakeResponseActiveFile', { fileName: activeFile.name })
        : t('vibecoding.chat.fakeResponseNoFile');

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        codeBlocks: extractCodeBlocks(responseContent),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch {
      // Even if something fails, add a fallback message so the user isn't stuck
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: t('vibecoding.chat.placeholder'),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, activeFile, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
  }, []);

  const handleCopyCode = useCallback(async (code: string, blockId: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(blockId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for older browsers or insecure contexts
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopiedId(blockId);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        // Copy failed silently
      }
      document.body.removeChild(textarea);
    }
  }, []);

  const handleInsertCode = useCallback((code: string) => {
    if (!activeFile) return;
    dispatch({
      type: 'UPDATE_FILE_CONTENT',
      payload: { fileId: activeFile.id, content: activeFile.content + '\n' + code },
    });
  }, [activeFile, dispatch]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderInlineMarkdown = (text: string): React.ReactNode => {
    // Process inline markdown: **bold**, *italic*, `code`, [links](url)
    const parts: React.ReactNode[] = [];
    // Match bold, italic, inline code, and links
    const inlineRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let inlineMatch;
    let keyIndex = 0;

    while ((inlineMatch = inlineRegex.exec(text)) !== null) {
      // Add text before the match
      if (inlineMatch.index > lastIndex) {
        parts.push(text.slice(lastIndex, inlineMatch.index));
      }

      if (inlineMatch[1]) {
        // Bold **text**
        parts.push(<strong key={`b-${keyIndex}`}>{inlineMatch[2]}</strong>);
      } else if (inlineMatch[3]) {
        // Italic *text*
        parts.push(<em key={`i-${keyIndex}`}>{inlineMatch[4]}</em>);
      } else if (inlineMatch[5]) {
        // Inline code `code`
        parts.push(
          <code key={`c-${keyIndex}`} className="px-1 py-0.5 rounded bg-[var(--ide-terminal-bg)] text-[var(--ide-accent)] text-[10px]">
            {inlineMatch[6]}
          </code>
        );
      } else if (inlineMatch[7]) {
        // Link [text](url)
        parts.push(
          <a key={`a-${keyIndex}`} href={inlineMatch[9]} target="_blank" rel="noopener noreferrer" className="text-[var(--ide-accent)] underline hover:opacity-80">
            {inlineMatch[8]}
          </a>
        );
      }

      lastIndex = inlineMatch.index + inlineMatch[0].length;
      keyIndex++;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const renderMessageContent = (content: string, codeBlocks: { language: string; code: string }[] | undefined, msgId: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          inCodeBlock = false;
          continue;
        }
        inCodeBlock = true;
        continue;
      }
      if (inCodeBlock) continue;

      if (line.startsWith('### ')) {
        elements.push(<div key={i} className="text-sm font-bold mt-1">{renderInlineMarkdown(line.slice(4))}</div>);
      } else if (line.startsWith('## ')) {
        elements.push(<div key={i} className="text-sm font-bold mt-1">{renderInlineMarkdown(line.slice(3))}</div>);
      } else if (line.startsWith('# ')) {
        elements.push(<div key={i} className="text-sm font-bold mt-1">{renderInlineMarkdown(line.slice(2))}</div>);
      } else if (line.startsWith('- ')) {
        elements.push(<div key={i} className="ml-2 flex items-start gap-1.5"><span className="text-[var(--ide-accent)] mt-0.5">•</span><span>{renderInlineMarkdown(line.slice(2))}</span></div>);
      } else if (line.startsWith('**') && line.endsWith('**')) {
        elements.push(<div key={i} className="font-semibold">{renderInlineMarkdown(line)}</div>);
      } else {
        elements.push(<div key={i}>{line ? renderInlineMarkdown(line) : <br />}</div>);
      }
    }

    if (codeBlocks && codeBlocks.length > 0) {
      codeBlocks.forEach((block, idx) => {
        const blockId = `${msgId}-code-${idx}`;
        elements.push(
          <div key={`code-${idx}`} className="mt-2 rounded-lg overflow-hidden border border-[var(--ide-border)]">
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--ide-border)]/50 text-[10px]">
              <span className="font-medium">{block.language}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleCopyCode(block.code, blockId)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--ide-hover)] transition-colors"
                  title={t('vibecoding.chat.copyCode')}
                >
                  <FontAwesomeIcon icon={copiedId === blockId ? faCheck : faCopy} className="text-[8px]" />
                  <span>{copiedId === blockId ? t('vibecoding.chat.copied') : t('vibecoding.chat.copy')}</span>
                </button>
                {activeFile && (
                  <button
                    onClick={() => handleInsertCode(block.code)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--ide-hover)] transition-colors"
                    title={t('vibecoding.chat.insertCode')}
                  >
                    <FontAwesomeIcon icon={faCode} className="text-[8px]" />
                    <span>{t('vibecoding.chat.insert')}</span>
                  </button>
                )}
              </div>
            </div>
            <pre className="p-2.5 text-[11px] overflow-x-auto bg-[var(--ide-terminal-bg)] text-[var(--ide-text)] leading-relaxed">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      });
    }

    return elements;
  };

  return (
    <div className="h-full flex flex-col bg-[var(--ide-sidebar-bg)]">
      {/* Chat header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--ide-border)] flex-shrink-0"
      >
        <div className="flex items-center gap-2.5">
          {/* Overlay close button (mobile/tablet) */}
          {isOverlay && (
            <button
              onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false })}
              className="p-1.5 rounded-md text-[var(--ide-text-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-hover)] transition-colors mr-1"
              title={t('vibecoding.chat.closeChat')}
            >
              <FontAwesomeIcon icon={faTimes} className="text-[11px]" />
            </button>
          )}
          <div className="vibe-ai-avatar">
            <FontAwesomeIcon icon={faRobot} className="text-white text-xs" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--ide-text)]">{t('vibecoding.chat.title', 'ЖИ Көмекші')}</div>
            <div className="text-[10px] text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {t('vibecoding.chat.ready', 'Дайын')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md text-[var(--ide-text-muted)] hover:text-[var(--ide-text)] hover:bg-[var(--ide-hover)] transition-colors"
            title={t('vibecoding.chat.newChat')}
          >
            <FontAwesomeIcon icon={faPlus} className="text-[10px]" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleNewChat}
              className="p-1.5 rounded-md text-[var(--ide-text-muted)] hover:text-red-400 hover:bg-[var(--ide-hover)] transition-colors"
              title={t('vibecoding.chat.clearChat')}
            >
              <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-[var(--ide-text-muted)] animate-fadeIn">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--ide-accent)', opacity: 0.1 }}>
                <FontAwesomeIcon icon={faRobot} className="text-2xl" style={{ color: 'var(--ide-accent)' }} />
              </div>
              <p className="text-sm font-medium text-[var(--ide-text)] mb-1.5">
                {t('vibecoding.chat.title')}
              </p>
              <p className="text-xs leading-relaxed max-w-[200px] mx-auto">
                {t('vibecoding.chat.placeholder')}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs"
              style={{
                backgroundColor: msg.role === 'assistant' ? 'var(--ide-accent)' : 'var(--ide-border)',
                color: msg.role === 'assistant' ? '#fff' : 'var(--ide-text)',
              }}
            >
              <FontAwesomeIcon icon={msg.role === 'assistant' ? faRobot : faUser} className="text-[10px]" />
            </div>

            {/* Message bubble */}
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`rounded-2xl px-3 py-2.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-tr-md text-white'
                    : 'rounded-tl-md text-[var(--ide-text)] border border-[var(--ide-border)]'
                }`}
                style={{
                  backgroundColor: msg.role === 'user' ? 'var(--ide-accent)' : 'var(--ide-editor-bg)',
                }}
              >
                {renderMessageContent(msg.content, msg.codeBlocks, msg.id)}
              </div>
              <div className={`text-[9px] text-[var(--ide-text-muted)] mt-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--ide-accent)' }}>
              <FontAwesomeIcon icon={faRobot} className="text-white text-[10px]" />
            </div>
            <div className="rounded-2xl rounded-tl-md px-3 py-2.5 border border-[var(--ide-border)]" style={{ backgroundColor: 'var(--ide-editor-bg)' }}>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ide-accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ide-accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ide-accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[var(--ide-text-muted)] text-xs">
                  {t('vibecoding.chat.thinking')}
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--ide-border)] p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('vibecoding.chat.placeholder')}
              rows={1}
              className="w-full resize-none bg-[var(--ide-editor-bg)] border border-[var(--ide-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--ide-text)] placeholder-[var(--ide-text-muted)] outline-none focus:border-[var(--ide-accent)] focus:ring-1 focus:ring-[var(--ide-accent)]/30 transition-all"
              style={{ maxHeight: '120px' }}
            />
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="p-2.5 rounded-xl transition-all duration-200 flex-shrink-0"
            style={{
              backgroundColor: 'var(--ide-accent)',
              color: '#fff',
              opacity: !inputValue.trim() || isLoading ? 0.4 : 1,
              cursor: !inputValue.trim() || isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <FontAwesomeIcon icon={faPaperPlane} className="text-xs" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;