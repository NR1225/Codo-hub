import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { useConfirm } from '../../contexts/ToastContext';
import { adminApi, errText, fmtDate } from './adminApi';
import { ListState, PAGE_SIZE, Pager, PersonTag, useAdminToast, usePaged } from './AdminShared';

/* Сторис және олардағы пікірлер (мақтау / шағым) */

const AdminStories: React.FC = () => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [kind, setKind] = useState('');
  const stories = usePaged((offset) => adminApi.stories({ offset, limit: PAGE_SIZE }), []);
  const opinions = usePaged((offset) => adminApi.opinions({ kind, offset, limit: PAGE_SIZE }), [kind]);

  const del = async (title: string, fn: () => Promise<unknown>, after: () => void) => {
    if (!(await confirm({ title, danger: true }))) return;
    try {
      await fn();
      toast.success(t('admin.deleted'));
      after();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <>
      <section className="mon__card">
        <h2>{t('admin.nav.stories')}</h2>
        <ListState loading={stories.loading} error={stories.error} empty={stories.items.length === 0} />
        {stories.items.length > 0 && (
          <div className="mon__scroll">
            <table className="mon__table">
              <thead>
                <tr>
                  <th>{t('admin.projects.author')}</th>
                  <th>{t('admin.stories.content')}</th>
                  <th>{t('admin.stories.status')}</th>
                  <th className="mon__num">👁</th>
                  <th>{t('admin.created')}</th>
                  <th>{t('admin.stories.expires')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {stories.items.map((s) => (
                  <tr key={s.id}>
                    <td><PersonTag p={s.author} /></td>
                    <td>
                      <span className="adm__badge">{s.mediaType}</span> {s.caption || <span className="adm__muted">—</span>}
                      {s.mention && (
                        <div className="adm__muted">
                          {t(`admin.stories.${s.mention.kind}`, { defaultValue: s.mention.kind })} → <PersonTag p={s.mention} />: {s.mention.text}
                        </div>
                      )}
                    </td>
                    <td>{s.status}</td>
                    <td className="mon__num">{s.views}</td>
                    <td className="mon__nowrap">{fmtDate(s.createdAt)}</td>
                    <td className="mon__nowrap">{fmtDate(s.expiresAt)}</td>
                    <td>
                      <button type="button" className="mon__icon-btn" title={t('admin.delete')}
                        onClick={() => del(t('admin.stories.deleteConfirm'), () => adminApi.deleteStory(s.id), () => { stories.reload(); opinions.reload(); })}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager total={stories.total} offset={stories.offset} go={stories.go} />
      </section>

      <section className="mon__card">
        <div className="adm__toolbar">
          <h2>{t('admin.stories.opinions')}</h2>
          <div className="adm__chips">
            {['', 'praise', 'complaint'].map((k) => (
              <button key={k} type="button" className={`adm__chip${kind === k ? ' is-active' : ''}`} onClick={() => setKind(k)}>
                {k ? t(`admin.stories.${k}`) : t('admin.users.filter.all')}
              </button>
            ))}
          </div>
        </div>
        <ListState loading={opinions.loading} error={opinions.error} empty={opinions.items.length === 0} />
        {opinions.items.length > 0 && (
          <div className="mon__scroll">
            <table className="mon__table">
              <thead>
                <tr>
                  <th>{t('admin.stories.kind')}</th>
                  <th>{t('admin.projects.author')}</th>
                  <th>{t('admin.stories.target')}</th>
                  <th>{t('admin.stories.text')}</th>
                  <th>{t('admin.stories.status')}</th>
                  <th>{t('admin.created')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {opinions.items.map((o) => (
                  <tr key={o.id}>
                    <td><span className={`adm__badge${o.kind === 'complaint' ? ' adm__badge--warn' : ''}`}>{t(`admin.stories.${o.kind}`)}</span></td>
                    <td><PersonTag p={o.author} /></td>
                    <td><PersonTag p={o.target} /></td>
                    <td>
                      {o.text}
                      {o.evidence && <div className="adm__muted">{o.evidence}</div>}
                    </td>
                    <td>{o.status}</td>
                    <td className="mon__nowrap">{fmtDate(o.createdAt)}</td>
                    <td>
                      <button type="button" className="mon__icon-btn" title={t('admin.delete')}
                        onClick={() => del(t('admin.stories.deleteOpinionConfirm'), () => adminApi.deleteOpinion(o.id), opinions.reload)}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager total={opinions.total} offset={opinions.offset} go={opinions.go} />
      </section>
    </>
  );
};

export default AdminStories;
