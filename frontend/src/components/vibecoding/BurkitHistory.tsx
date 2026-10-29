import React, { useMemo, useState } from 'react';
import { ArrowLeftIcon, PlusIcon, SearchIcon, CloseIcon, PinIcon, EditIcon, TrashIcon, DownloadIcon, HistoryIcon } from './icons';
import { FileTypeIcon } from './fileIcons';
import { historyGroupLabel as groupLabel, historyShortTime as shortTime } from './useBurkitHistory';
import type { BurkitConversation } from './useBurkitHistory';

/* Бүркіт тарихы: іздеу, күн бойынша топтар, бекіту, атын өзгерту,
   Markdown ретінде жүктеу, жою және тарихты тазалау */

interface Props {
  conversations: BurkitConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onNew: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onExport: (conv: BurkitConversation) => void;
  onClearAll: () => void;
}

const BurkitHistory: React.FC<Props> = ({
  conversations, activeId, onOpen, onBack, onNew, onRemove, onRename, onTogglePin, onExport, onClearAll,
}) => {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Жою екі рет басумен расталады (браузер терезесінсіз)
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Іздеу: атауы мен хабарлар мәтінінен
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [conversations, query]);

  // Бекітілгендер — жоғарыда, қалғаны күн бойынша топталады
  const groups = useMemo(() => {
    const out: { label: string; items: BurkitConversation[] }[] = [];
    const pinned = filtered.filter((c) => c.pinned);
    if (pinned.length) out.push({ label: 'Бекітілген', items: pinned });
    filtered.filter((c) => !c.pinned).forEach((c) => {
      const label = groupLabel(c.updatedAt);
      const group = out.find((g) => g.label === label);
      if (group) group.items.push(c);
      else out.push({ label, items: [c] });
    });
    return out;
  }, [filtered]);

  const submitRename = (id: string) => {
    const title = renameValue.trim();
    if (title) onRename(id, title);
    setRenamingId(null);
  };

  const unpinnedCount = conversations.filter((c) => !c.pinned).length;

  return (
    <div className="vx-hist">
      <div className="vx-ai__bar">
        <button type="button" className="vx-icon-btn vx-icon-btn--sm" onClick={onBack} title="Чатқа оралу">
          <ArrowLeftIcon size={17} />
        </button>
        <span className="vx-ai__bar-title">Тарих</span>
        {conversations.length > 0 && <span className="vx-hist__count">{conversations.length}</span>}
        <div className="vx-ai__bar-actions">
          <button type="button" className="vx-icon-btn vx-icon-btn--sm" onClick={onNew} title="Жаңа чат">
            <PlusIcon size={17} />
          </button>
        </div>
      </div>

      {conversations.length > 0 && (
        <div className="vx-hist__search">
          <SearchIcon size={14} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Сөйлесулерден іздеу..."
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
          {query && (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => setQuery('')} title="Тазалау">
              <CloseIcon size={11} />
            </button>
          )}
        </div>
      )}

      <div className="vx-hist__list ide-scrollbar">
        {conversations.length === 0 ? (
          <div className="vx-hist__empty">
            <span className="vx-hist__empty-icon">
              <HistoryIcon size={22} />
            </span>
            <p>Әзірге сөйлесу жоқ</p>
            <small>Бүркітпен сөйлескен сайын мұнда сақталады</small>
            <button type="button" className="vx-hist__new" onClick={onNew}>
              <PlusIcon size={14} />
              Жаңа чат бастау
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="vx-hist__empty">
            <p>«{query}» бойынша ештеңе табылмады</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="vx-hist__group">
              <h4 className="vx-hist__label">{group.label}</h4>
              {group.items.map((conv, i) => {
                const last = conv.messages[conv.messages.length - 1];
                const lastContext = [...conv.messages].reverse().find((m) => m.context)?.context;
                const isRenaming = renamingId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={`vx-hist__item ${conv.id === activeId ? 'is-active' : ''}`}
                    style={{ ['--d' as string]: Math.min(i, 8) }}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isRenaming && onOpen(conv.id)}
                    onKeyDown={(e) => {
                      if (isRenaming) return;
                      if (e.key === 'Enter') onOpen(conv.id);
                      if (e.key === 'F2') {
                        setRenamingId(conv.id);
                        setRenameValue(conv.title);
                      }
                      if (e.key === 'Delete') setConfirmId(conv.id);
                    }}
                  >
                    <div className="vx-hist__top">
                      {conv.pinned && <span className="vx-hist__pin"><PinIcon size={12} /></span>}
                      {isRenaming ? (
                        <input
                          className="vx-hist__rename"
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
                        <span className="vx-hist__title">{conv.title}</span>
                      )}
                      <span className="vx-hist__time">{shortTime(conv.updatedAt)}</span>
                    </div>
                    {last && (
                      <p className="vx-hist__preview">
                        {last.role === 'assistant' ? 'Бүркіт: ' : ''}
                        {last.content.replace(/```[\s\S]*?```/g, '[код]').replace(/\s+/g, ' ').slice(0, 90)}
                      </p>
                    )}
                    <div className="vx-hist__meta">
                      <span>{conv.messages.length} хабар</span>
                      {conv.projectName && <span>· {conv.projectName}</span>}
                      {lastContext && (
                        <span className="vx-hist__file">
                          <FileTypeIcon name={lastContext} size={12} />
                          {lastContext}
                        </span>
                      )}
                    </div>

                    {/* Әрекеттер — тінтуір апарғанда */}
                    {!isRenaming && (
                      <div className="vx-hist__actions" onClick={(e) => e.stopPropagation()}>
                        {confirmId === conv.id ? (
                          <>
                            <button type="button" className="vx-hist__confirm is-danger" onClick={() => { onRemove(conv.id); setConfirmId(null); }}>
                              Жою
                            </button>
                            <button type="button" className="vx-hist__confirm" onClick={() => setConfirmId(null)}>
                              Жоқ
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`vx-icon-btn vx-icon-btn--xs ${conv.pinned ? 'is-on' : ''}`}
                              onClick={() => onTogglePin(conv.id)}
                              title={conv.pinned ? 'Бекітуді алу' : 'Бекіту'}
                            >
                              <PinIcon size={13} />
                            </button>
                            <button
                              type="button"
                              className="vx-icon-btn vx-icon-btn--xs"
                              onClick={() => {
                                setRenamingId(conv.id);
                                setRenameValue(conv.title);
                              }}
                              title="Атауын өзгерту (F2)"
                            >
                              <EditIcon size={13} />
                            </button>
                            <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => onExport(conv)} title="Markdown ретінде жүктеу">
                              <DownloadIcon size={13} />
                            </button>
                            <button type="button" className="vx-icon-btn vx-icon-btn--xs vx-icon-btn--danger" onClick={() => setConfirmId(conv.id)} title="Жою (Del)">
                              <TrashIcon size={13} />
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
        <div className="vx-hist__foot">
          {confirmClear ? (
            <>
              <span>Бекітілмеген {unpinnedCount} сөйлесу өшеді</span>
              <button type="button" className="vx-hist__confirm is-danger" onClick={() => { onClearAll(); setConfirmClear(false); }}>
                Тазалау
              </button>
              <button type="button" className="vx-hist__confirm" onClick={() => setConfirmClear(false)}>
                Жоқ
              </button>
            </>
          ) : (
            <button type="button" className="vx-hist__clear" onClick={() => setConfirmClear(true)}>
              <TrashIcon size={13} />
              Тарихты тазалау
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default BurkitHistory;
