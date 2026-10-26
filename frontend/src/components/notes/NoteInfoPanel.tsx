import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRightToBracket, faArrowUpRightFromSquare, faListOl, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import type { NoteMeta } from '../../utils/api';
import { backlinksOf, outlineOf, resolveLink, type OutlineItem } from './noteLinks';

type InfoTab = 'backlinks' | 'outgoing' | 'outline' | 'info';

interface Props {
  note: NoteMeta;
  content: string;
  notes: NoteMeta[];
  onOpen: (id: string) => void;
  onOpenLink: (target: string) => void;
  onHeading: (item: OutlineItem) => void;
  onTag: (tag: string) => void;
}

const NoteInfoPanel: React.FC<Props> = ({ note, content, notes, onOpen, onOpenLink, onHeading, onTag }) => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<InfoTab>('backlinks');

  const backlinks = useMemo(() => backlinksOf(note, notes), [note, notes]);
  const outgoing = useMemo(
    () => note.links.map((link) => ({ link, target: resolveLink(link, notes) })),
    [note.links, notes]
  );
  const outline = useMemo(() => (note.kind === 'note' ? outlineOf(content) : []), [content, note.kind]);
  const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(i18n.language) : '—');

  const tabs: [InfoTab, typeof faListOl, string, number?][] = [
    ['backlinks', faArrowRightToBracket, t('notes.info.backlinks'), backlinks.length],
    ['outgoing', faArrowUpRightFromSquare, t('notes.info.outgoing'), outgoing.length],
    ['outline', faListOl, t('notes.info.outline')],
    ['info', faCircleInfo, t('notes.info.details')],
  ];

  return (
    <aside className="nt-info">
      <div className="nt-sidebar__tabs">
        {tabs.map(([key, icon, label, count]) => (
          <button key={key} type="button" className={`nt-icon-btn${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)} title={label}>
            <FontAwesomeIcon icon={icon} />
            {!!count && <span className="nt-icon-btn__badge">{count}</span>}
          </button>
        ))}
      </div>
      <h4 className="nt-info__heading">{tabs.find(([k]) => k === tab)?.[2]}</h4>

      {tab === 'backlinks' && (
        <div className="nt-info__list">
          {backlinks.length ? (
            backlinks.map((n) => (
              <button key={n.id} type="button" className="nt-info__item" onClick={() => onOpen(n.id)}>
                <span>{n.title}</span>
                {n.folder && <small>{n.folder}</small>}
              </button>
            ))
          ) : (
            <p className="nt-sidebar__empty">{t('notes.info.noBacklinks')}</p>
          )}
        </div>
      )}

      {tab === 'outgoing' && (
        <div className="nt-info__list">
          {outgoing.length ? (
            outgoing.map(({ link, target }) => (
              <button
                key={link}
                type="button"
                className={`nt-info__item${target ? '' : ' is-missing'}`}
                onClick={() => (target ? onOpen(target.id) : onOpenLink(link))}
                title={target ? undefined : t('notes.info.missingHint')}
              >
                <span>{target?.title ?? link}</span>
                {target?.folder && <small>{target.folder}</small>}
                {!target && <small>{t('notes.info.missing')}</small>}
              </button>
            ))
          ) : (
            <p className="nt-sidebar__empty">{t('notes.info.noOutgoing')}</p>
          )}
        </div>
      )}

      {tab === 'outline' && (
        <div className="nt-info__list">
          {outline.length ? (
            outline.map((item) => (
              <button
                key={`${item.slug}-${item.line}`}
                type="button"
                className="nt-info__item nt-info__item--outline"
                style={{ paddingLeft: 8 + (item.level - 1) * 12 }}
                onClick={() => onHeading(item)}
              >
                <span>{item.text}</span>
              </button>
            ))
          ) : (
            <p className="nt-sidebar__empty">{t('notes.info.noHeadings')}</p>
          )}
        </div>
      )}

      {tab === 'info' && (
        <dl className="nt-info__details">
          <dt>{t('notes.info.folder')}</dt>
          <dd>{note.folder || '/'}</dd>
          <dt>{t('notes.info.created')}</dt>
          <dd>{fmt(note.createdAt)}</dd>
          <dt>{t('notes.info.updated')}</dt>
          <dd>{fmt(note.updatedAt)}</dd>
          <dt>{t('notes.info.size')}</dt>
          <dd>{t('notes.charCount', { count: content.length })}</dd>
          {!!note.tags.length && (
            <>
              <dt>{t('notes.tabs.tags')}</dt>
              <dd className="nt-tags">
                {note.tags.map((tag) => (
                  <button key={tag} type="button" className="nt-chip" onClick={() => onTag(tag)}>#{tag}</button>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
    </aside>
  );
};

export default NoteInfoPanel;
