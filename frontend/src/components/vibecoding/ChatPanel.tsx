import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../contexts/VibecodingContext';
import {
  SparkleIcon,
  PlusIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  InsertIcon,
  UserIcon,
  CloseIcon,
  ArrowUpIcon,
  ChevronIcon,
} from './icons';

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
          <code key={`c-${keyIndex}`} className="vx-ai__inline-code">
            {inlineMatch[6]}
          </code>
        );
      } else if (inlineMatch[7]) {
        // Link [text](url)
        parts.push(
          <a key={`a-${keyIndex}`} href={inlineMatch[9]} target="_blank" rel="noopener noreferrer" className="vx-ai__link">
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
        elements.push(<div key={i} className="vx-ai__heading">{renderInlineMarkdown(line.slice(4))}</div>);
      } else if (line.startsWith('## ')) {
        elements.push(<div key={i} className="vx-ai__heading">{renderInlineMarkdown(line.slice(3))}</div>);
      } else if (line.startsWith('# ')) {
        elements.push(<div key={i} className="vx-ai__heading">{renderInlineMarkdown(line.slice(2))}</div>);
      } else if (line.startsWith('- ')) {
        elements.push(<div key={i} className="vx-ai__li"><span className="vx-ai__bullet" /><span>{renderInlineMarkdown(line.slice(2))}</span></div>);
      } else if (line.startsWith('**') && line.endsWith('**')) {
        elements.push(<div key={i} className="font-semibold">{renderInlineMarkdown(line)}</div>);
      } else {
        elements.push(<div key={i}>{line ? renderInlineMarkdown(line) : <br />}</div>);
      }
    }

    if (codeBlocks && codeBlocks.length > 0) {
      codeBlocks.forEach((block, idx) => {
        const blockId = `${msgId}-code-${idx}`;
        const copied = copiedId === blockId;
        elements.push(
          <div key={`code-${idx}`} className="vx-ai__code">
            <div className="vx-ai__code-bar">
              <span className="vx-ai__code-lang">{block.language}</span>
              <div className="vx-ai__code-actions">
                <button
                  type="button"
                  onClick={() => handleCopyCode(block.code, blockId)}
                  className={`vx-chip-btn ${copied ? 'is-done' : ''}`}
                  title={t('vibecoding.chat.copyCode')}
                >
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  <span>{copied ? t('vibecoding.chat.copied') : t('vibecoding.chat.copy')}</span>
                </button>
                {activeFile && (
                  <button
                    type="button"
                    onClick={() => handleInsertCode(block.code)}
                    className="vx-chip-btn"
                    title={t('vibecoding.chat.insertCode')}
                  >
                    <InsertIcon size={12} />
                    <span>{t('vibecoding.chat.insert')}</span>
                  </button>
                )}
              </div>
            </div>
            <pre>
              <code>{block.code}</code>
            </pre>
          </div>
        );
      });
    }

    return elements;
  };

  const suggestions = [
    t('vibecoding.chat.suggestExplain'),
    t('vibecoding.chat.suggestBugs'),
    t('vibecoding.chat.suggestRefactor'),
  ];

  const askSuggestion = (text: string) => {
    setInputValue(text);
    inputRef.current?.focus();
  };

  return (
    <div className={`vx-ai ${messages.length === 0 ? 'is-empty' : ''}`}>
      {/* ЖИ тақырыбы */}
      <div className="vx-ai__bar">
        {isOverlay && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false })}
            className="vx-icon-btn"
            title={t('vibecoding.chat.closeChat')}
          >
            <CloseIcon size={15} />
          </button>
        )}
        <span className="vx-ai__bar-orb">
          <SparkleIcon size={16} />
        </span>
        <div className="vx-ai__bar-text">
          <div className="vx-ai__bar-title">{t('vibecoding.chat.title', 'ЖИ Көмекші')}</div>
          <div className="vx-ai__status">
            <span className="vx-ai__status-dot" />
            {t('vibecoding.chat.ready', 'Дайын')}
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="vx-icon-btn"
          title={t('vibecoding.chat.newChat')}
        >
          <PlusIcon size={15} />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleNewChat}
            className="vx-icon-btn vx-icon-btn--danger"
            title={t('vibecoding.chat.clearChat')}
          >
            <TrashIcon size={15} />
          </button>
        )}
      </div>

      {/* Хабарлар */}
      <div className="vx-ai__scroll" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="vx-ai__hero">
            <div className="vx-orb vx-orb--spin">
              <SparkleIcon size={26} />
            </div>
            <p className="vx-ai__hero-title">{t('vibecoding.chat.title')}</p>
            <p className="vx-ai__hero-sub">{t('vibecoding.chat.subtitle')}</p>
            <div className="vx-ai__chips">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="vx-ai__chip"
                  style={{ ['--d' as string]: i }}
                  onClick={() => askSuggestion(s)}
                >
                  {s}
                  <ChevronIcon size={12} />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`vx-ai__msg vx-ai__msg--${msg.role}`}>
            {msg.role === 'assistant' && (
              <span className="vx-ai__avatar">
                <SparkleIcon size={14} />
              </span>
            )}
            <div className="vx-ai__content">
              <div className="vx-ai__text">{renderMessageContent(msg.content, msg.codeBlocks, msg.id)}</div>
              <div className="vx-ai__time">{formatTime(msg.timestamp)}</div>
            </div>
            {msg.role === 'user' && (
              <span className="vx-ai__avatar vx-ai__avatar--user">
                <UserIcon size={14} />
              </span>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="vx-ai__msg vx-ai__msg--assistant">
            <span className="vx-ai__avatar is-thinking">
              <SparkleIcon size={14} />
            </span>
            <div className="vx-ai__dots" aria-label={t('vibecoding.chat.thinking')}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Жазу өрісі — фокуста жарық жиек */}
      <div className="vx-ai__composer">
        <div className="vx-ai__box">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('vibecoding.chat.placeholder')}
            rows={1}
            className="vx-ai__input"
            style={{ maxHeight: '120px' }}
          />
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="vx-ai__send"
            title={t('vibecoding.chat.send')}
          >
            <ArrowUpIcon size={16} />
          </button>
        </div>
        <p className="vx-ai__hint">{t('vibecoding.chat.hint')}</p>
      </div>
    </div>
  );
};

export default ChatPanel;
