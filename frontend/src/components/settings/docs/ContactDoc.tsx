import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faEnvelope, faPhone, faMapMarkerAlt, faPaperPlane, faCheckCircle, faExclamationCircle,
  faCircleQuestion, faLightbulb, faBug, faEllipsis,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, SiteConfig } from '../../../utils/api';
import { useAuth } from '../../../contexts/AuthContext';

/* «Біз жайлы» → Байланыс: байланыс жолдары (сайт конфигінен) + жинақы хабарлама формасы.
   Шектеулер сервердегімен бірдей (routes/contact.py): тақырып 3–200, хабарлама 10–5000. */

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

type Topic = 'question' | 'idea' | 'bug' | 'other';
const TOPICS: { key: Topic; icon: IconDefinition }[] = [
  { key: 'question', icon: faCircleQuestion },
  { key: 'idea', icon: faLightbulb },
  { key: 'bug', icon: faBug },
  { key: 'other', icon: faEllipsis },
];

const ContactDoc: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  // Кірген қолданушының аты мен поштасы өзі толады (өзгертуге болады)
  const initialForm = () => ({ name: user?.username ?? '', email: user?.email ?? '', subject: '', message: '' });
  const [form, setForm] = useState(initialForm);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Аккаунт кейінірек жүктелсе — бос өрістерді толтырамыз
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      name: prev.name || user.username || '',
      email: prev.email || user.email || '',
    }));
  }, [user]);

  const contact = config?.contact;
  const address = contact?.address || (i18n.language === 'en' ? contact?.addressEn : '') || t('contact.addressValue');
  // Конфигте бос тұрған жолдарды көрсетпейміз
  const methods = [
    { key: 'email', icon: faEnvelope, label: t('contact.email'), value: contact?.email, href: contact?.email ? `mailto:${contact.email}` : undefined },
    { key: 'phone', icon: faPhone, label: t('contact.phone'), value: contact?.phone, href: contact?.phone ? `tel:${contact.phone.replace(/\s+/g, '')}` : undefined },
    { key: 'address', icon: faMapMarkerAlt, label: t('contact.address'), value: address, href: undefined },
  ].filter((m) => m.value);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // Тақырып батырмасы — тақырып өрісін толтырады (қолмен жазылғанды ауыстырмайды)
  const pickTopic = (key: Topic) => {
    const prevLabel = topic ? t(`settings.docs.contact.topics.${topic}`) : '';
    setTopic(key);
    setForm((prev) => (
      !prev.subject || prev.subject === prevLabel
        ? { ...prev, subject: t(`settings.docs.contact.topics.${key}`) }
        : prev
    ));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await apiService.submitContactForm(form);
      setSent(true);
      setTopic(null);
      setForm(initialForm());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contact.submitError', 'Failed to send message. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  const length = form.message.length;

  return (
    <article className="stg-article stg-article--compact">
      <header className="stg-article__hero">
        <span className="stg-article__icon"><FontAwesomeIcon icon={faEnvelope} /></span>
        <div className="stg-article__intro">
          <h1 className="stg-article__title">{t('settings.docs.contact.title')}</h1>
          <p className="stg-article__lead">{t('settings.docs.contact.lead')}</p>
        </div>
      </header>

      {methods.length > 0 && (
        <ul className="stg-contact__chips" aria-label={t('settings.docs.contact.methods')}>
          {methods.map((m) => {
            const body = (
              <>
                <FontAwesomeIcon icon={m.icon} />
                <span className="stg-contact__chip-text">{m.value}</span>
              </>
            );
            return (
              <li key={m.key}>
                {m.href
                  ? <a href={m.href} className="stg-contact__chip is-link" title={m.label}>{body}</a>
                  : <span className="stg-contact__chip" title={m.label}>{body}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {sent ? (
        <div className="stg-contact__success" role="status">
          <FontAwesomeIcon icon={faCheckCircle} />
          <p>{t('contact.successMessage')}</p>
          <button type="button" className="stg-btn stg-btn--ghost" onClick={() => setSent(false)}>
            {t('settings.docs.contact.sendAnother')}
          </button>
        </div>
      ) : (
        <form className="stg-contact__form" onSubmit={onSubmit}>
          <div className="stg-field">
            <span className="stg-field__label">{t('settings.docs.contact.topic')}</span>
            <div className="stg-contact__topics" role="radiogroup" aria-label={t('settings.docs.contact.topic')}>
              {TOPICS.map(({ key, icon }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={topic === key}
                  className={`stg-contact__topic ${topic === key ? 'is-active' : ''}`}
                  onClick={() => pickTopic(key)}
                  disabled={sending}
                >
                  <FontAwesomeIcon icon={icon} />
                  {t(`settings.docs.contact.topics.${key}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="stg-contact__row">
            <label className="stg-field">
              <span className="stg-field__label">{t('contact.form.name')}</span>
              <input
                className="stg-input"
                name="name"
                value={form.name}
                onChange={onChange}
                required
                maxLength={200}
                autoComplete="name"
                placeholder={t('contact.form.namePlaceholder')}
                disabled={sending}
              />
            </label>
            <label className="stg-field">
              <span className="stg-field__label">{t('contact.form.email')}</span>
              <input
                className="stg-input"
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                required
                autoComplete="email"
                placeholder={t('contact.form.emailPlaceholder')}
                disabled={sending}
              />
            </label>
          </div>

          <label className="stg-field">
            <span className="stg-field__label">{t('contact.form.subject')}</span>
            <input
              className="stg-input"
              name="subject"
              value={form.subject}
              onChange={onChange}
              required
              minLength={3}
              maxLength={200}
              placeholder={t('contact.form.subjectPlaceholder')}
              disabled={sending}
            />
          </label>

          <label className="stg-field">
            <span className="stg-field__label stg-field__label--row">
              {t('contact.form.message')}
              <span className={`stg-contact__count ${length > 0 && length < MESSAGE_MIN ? 'is-low' : ''}`}>
                {length}/{MESSAGE_MAX}
              </span>
            </span>
            <textarea
              className="stg-input stg-input--area"
              name="message"
              value={form.message}
              onChange={onChange}
              required
              minLength={MESSAGE_MIN}
              maxLength={MESSAGE_MAX}
              rows={4}
              placeholder={t('contact.form.messagePlaceholder')}
              disabled={sending}
            />
          </label>

          {error && (
            <div className="stg-contact__error" role="alert">
              <FontAwesomeIcon icon={faExclamationCircle} />
              <span>{error}</span>
            </div>
          )}

          <div className="stg-contact__footer">
            <span className="stg-contact__hint">{t('settings.docs.contact.replyHint')}</span>
            <button type="submit" className="stg-btn stg-btn--primary" disabled={sending}>
              <FontAwesomeIcon icon={faPaperPlane} />
              <span>{sending ? t('contact.form.submitting', 'Жіберілуде...') : t('contact.form.submit')}</span>
            </button>
          </div>
        </form>
      )}
    </article>
  );
};

export default ContactDoc;
