import React, { useMemo, useState } from 'react';
import { ArrowLeftIcon, PlusIcon, SearchIcon, ClockIcon, PinIcon, TrashIcon, XIcon, EditIcon, DownloadIcon } from './icons';
import { FileTypeIcon } from '../vibecoding/fileIcons';
import { historyGroupLabel, historyShortTime } from '../vibecoding/useBurkitHistory';
import type { BurkitConversation } from '../vibecoding/useBurkitHistory';

/* Басты беттегі Бүркіттің ескі сөйлесулері: іздеу, күн бойынша топтар, бекіту, атын өзгерту,
   Markdown ретінде жүктеу, жою.
   Vibecoding-тегі тарих (BurkitHistory) сияқты, бірақ басты беттің дизайнында. */

interface Props {
  conversations: BurkitConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onNew: () => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (conv: BurkitConversation) => void;
  onClearAll: () => void;
}

const SiteAIHistory: React.FC<Props> = ({
  conversations, activeId, onOpen, onBack, onNew, onRemove, onTogglePin, onRename, onExport, onClearAll,
}) => {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Жою екі рет басумен расталады (браузер терезесінсіз)
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [conversations, query]);

  // Бекітілгендер — жоғарыда, қалғаны күн бойынша
  const groups = useMemo(() => {
    const out: { label: string; items: BurkitConversation[] }[] = [];
    const pinned = filtered.filter((c) => c.pinned);
    if (pinned.length) out.push({ label: 'Бекітілген', items: pinned });
    filtered.filter((c) => !c.pinned).forEach((c) => {
      const label = historyGroupLabel(c.updatedAt);
      const group = out.find((g) => g.label === label);
      if (group) group.items.push(c);
      else out.push({ label, items: [c] });
    });
    return out;
  }, [filtered]);

  const unpinnedCount = conversations.filter((c) => !c.pinned).length;

  const startRename = (conv: BurkitConversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const submitRename = (id: string) => {
    const title = renameValue.trim();
    if (title) onRename(id, title);
    setRenamingId(null);
  };

  return (
    <div className="sai__hist">
      <header className="sai__bar">
        <button type="button" className="sai__ghost" onClick={onBack} title="Чатқа оралу">
          <ArrowLeftIcon />
        </button>
        <h2 className="sai__bar-title">Сөйлесулер тарихы</h2>
        <button type="button" className="sai__ghost" onClick={onNew}>
          <PlusIcon />
          <span>Жаңа чат</span>
        </button>
      </header>

      {conversations.length > 0 && (
        <label className="sai__hist-search">
          <SearchIcon />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Сөйлесулерден іздеу..."
          />
        </label>
      )}

      <div className="sai__hist-list">
        {conversations.length === 0 ? (
          <div className="sai__hist-empty">
            <ClockIcon size={22} />
            <p>Әзірге сөйлесу жоқ</p>
            <small>Бүркітпен сөйлескен сайын мұнда сақталады</small>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sai__hist-empty">
            <p>«{query}» бойынша ештеңе табылмады</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="sai__hist-group">
              <h3 className="sai__hist-label">{group.label}</h3>
              {group.items.map((conv) => {
                const last = [...conv.messages].reverse().find((m) => !m.tool);
                const lastContext = [...conv.messages].reverse().find((m) => m.context)?.context;
                const isRenaming = renamingId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={`sai__hist-item ${conv.id === activeId ? 'is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isRenaming && onOpen(conv.id)}
                    onKeyDown={(e) => {
                      if (isRenaming) return;
                      if (e.key === 'Enter') onOpen(conv.id);
                      if (e.key === 'F2') startRename(conv);
                      if (e.key === 'Delete') setConfirmId(conv.id);
                    }}
                  >
                    <div className="sai__hist-top">
                      {conv.pinned && <span className="sai__hist-pin"><PinIcon size={12} /></span>}
                      {isRenaming ? (
                        <input
                          className="sai__hist-rename"
                          value={renameValue}
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => submitRename(conv.id)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') submitRename(conv.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                      ) : (
                        <span className="sai__hist-title">{conv.title}</span>
                      )}
                      <span className="sai__hist-time">{historyShortTime(conv.updatedAt)}</span>
                    </div>
                    {last && (
                      <p className="sai__hist-preview">
                        {last.role === 'assistant' ? 'Бүркіт: ' : ''}
                        {last.content.replace(/```[\s\S]*?```/g, '[код]').replace(/\s+/g, ' ').slice(0, 110)}
                      </p>
                    )}
                    <div className="sai__hist-meta">
                      <span>{conv.messages.length} хабар</span>
                      {conv.projectName && <span>· {conv.projectName}</span>}
                      {lastContext && (
                        <span className="sai__hist-file">
                          <FileTypeIcon name={lastContext} size={12} />
                          {lastContext}
                        </span>
                      )}
                    </div>

                    {!isRenaming && (
                    <div className="sai__hist-actions" onClick={(e) => e.stopPropagation()}>
                      {confirmId === conv.id ? (
                        <>
                          <button type="button" className="sai__hist-btn is-danger" onClick={() => { onRemove(conv.id); setConfirmId(null); }}>
                            Жою
                          </button>
                          <button type="button" className="sai__hist-btn" onClick={() => setConfirmId(null)}>
                            Жоқ
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`sai__hist-icon ${conv.pinned ? 'is-on' : ''}`}
                            onClick={() => onTogglePin(conv.id)}
                            title={conv.pinned ? 'Бекітуді алу' : 'Бекіту'}
                          >
                            <PinIcon size={14} />
                          </button>
                          <button type="button" className="sai__hist-icon" onClick={() => startRename(conv)} title="Атауын өзгерту (F2)">
                            <EditIcon size={14} />
                          </button>
                          <button type="button" className="sai__hist-icon" onClick={() => onExport(conv)} title="Markdown ретінде жүктеу">
                            <DownloadIcon size={14} />
                          </button>
                          <button type="button" className="sai__hist-icon is-danger" onClick={() => setConfirmId(conv.id)} title="Жою (Del)">
                            <TrashIcon size={14} />
                          </button>
                        </>
                      )}
                    </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      {unpinnedCount > 0 && (
        <div className="sai__hist-foot">
          {confirmClear ? (
            <>
              <span>Бекітілмеген {unpinnedCount} сөйлесу өшеді</span>
              <button type="button" className="sai__hist-btn is-danger" onClick={() => { onClearAll(); setConfirmClear(false); }}>
                Тазалау
              </button>
              <button type="button" className="sai__hist-btn" onClick={() => setConfirmClear(false)}>
                <XIcon />
              </button>
            </>
          ) : (
            <button type="button" className="sai__hist-btn" onClick={() => setConfirmClear(true)}>
              <TrashIcon size={14} />
              Тарихты тазалау
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SiteAIHistory;
