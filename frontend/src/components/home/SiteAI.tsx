import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile, apiService } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { SparkleIcon, ArrowUpIcon, ArrowRightIcon, RefreshIcon } from './icons';
import { monogram } from './monogram';
import './SiteAI.css';

const MAX_MATCHES = 4;
// Жауап бірден шықпай, «ойланып» барып келеді — сөйлесу сезімі үшін
const THINKING_MS = 650;

// Сайттың мүмкіндіктері — ЖИ тек осыларға және сайттағы жобаларға сілтейді
const SITE_FEATURES: { key: string; to: string; keywords: string[] }[] = [
  { key: 'upload', to: '/upload', keywords: ['жүкте', 'жүктеу', 'қос', 'upload', 'загруз', 'добав'] },
  { key: 'vibecoding', to: '/vibecoding', keywords: ['vibecoding', 'вайб', 'редактор', 'editor', 'ide', 'терминал', 'terminal'] },
  { key: 'chat', to: '/chat', keywords: ['чат', 'chat', 'хабар', 'дос', 'friend', 'message', 'сообщ', 'друз'] },
  { key: 'profile', to: '/profile', keywords: ['профиль', 'profile', 'аватар', 'avatar'] },
  { key: 'settings', to: '/settings', keywords: ['баптау', 'settings', 'настрой', 'құпиясөз', 'пароль', 'password', '2fa', 'тақырып', 'theme'] },
];

// Қарапайым сөйлесу: сәлемдесу, алғыс, көмек т.б. — «мүмкіндіктен тыс» деп жауап бермеу үшін.
// Қысқа кілттер (2–3 әріп) тек толық сәйкес келгенде ғана есептеледі.
type SmallTalk = 'greeting' | 'thanks' | 'help' | 'about' | 'bye';
const SMALL_TALK: { key: SmallTalk; keywords: string[] }[] = [
  {
    key: 'greeting',
    keywords: ['сәлем', 'салем', 'сәләм', 'салам', 'сәлемет', 'салемет', 'амансыз', 'амансың', 'қалайсың', 'қалайсыз', 'калайсын',
      'қайырлы', 'hello', 'hi', 'hey', 'hii', 'привет', 'приветствую', 'здравств', 'здрасте', 'добрый', 'ку', 'салют'],
  },
  { key: 'thanks', keywords: ['рахмет', 'рақмет', 'рахмат', 'спасибо', 'спс', 'благодар', 'thanks', 'thank', 'thx', 'ty'] },
  {
    key: 'help',
    keywords: ['көмек', 'комек', 'help', 'помощь', 'помоги', 'умеешь', 'можешь', 'аласың', 'аласыз', 'істей', 'can', 'what'],
  },
  { key: 'about', keywords: ['кімсің', 'кімсіз', 'кимсин', 'who', 'кто', 'атың', 'есімің'] },
  { key: 'bye', keywords: ['сау', 'көріскенше', 'пока', 'bye', 'goodbye', 'свидания'] },
];

// Жоба сұралып тұрғанын білдіретін сөздер — ұқсасы табылмаса да пайдалы жауап беру үшін
const BUILD_WORDS = ['жаса', 'құр', 'керек', 'қалаймын', 'create', 'make', 'build', 'need', 'want', 'сделай', 'создай', 'нужен', 'нужна', 'нужно', 'хочу'];

// Мағынасы жоқ көмекші сөздер — іздеуге араласпайды
const STOP_WORDS = new Set([
  'не', 'бұл', 'сол', 'мен', 'сен', 'сіз', 'маған', 'саған', 'сізге', 'бе', 'ба', 'ма', 'ме', 'па', 'пе', 'қандай', 'қалай', 'және', 'да', 'де',
  'the', 'is', 'are', 'you', 'me', 'my', 'do', 'to', 'and', 'please',
  'что', 'ты', 'вы', 'мне', 'как', 'это', 'и', 'а', 'пожалуйста',
  // ЖИ-дің өз аты: «Сәлем, Бүркіт» — жоба іздеуге кірмейді
  'бүркіт', 'буркит', 'burkit',
]);

const keywordHit = (w: string, k: string) => (k.length <= 3 ? w === k : w.startsWith(k));

function detectSmallTalk(words: string[]): { intents: SmallTalk[]; rest: string[] } {
  const intents = new Set<SmallTalk>();
  const rest = words.filter((w) => {
    if (STOP_WORDS.has(w)) return false;
    const hit = SMALL_TALK.find((s) => s.keywords.some((k) => keywordHit(w, k)));
    if (hit) intents.add(hit.key);
    return !hit;
  });
  return { intents: SMALL_TALK.map((s) => s.key).filter((k) => intents.has(k)), rest };
}

function findFeatures(words: string[]) {
  return SITE_FEATURES.filter((f) => f.keywords.some((k) => words.some((w) => w.startsWith(k) || (w.length >= 4 && k.startsWith(w)))));
}

interface AiMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  prompt?: string;
  matches?: CodeFile[];
  createdId?: string;
  features?: typeof SITE_FEATURES;
  /** Астында дайын сұраулар көрсетілсін */
  suggest?: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}#+]+/u)
    .filter((w) => w.length >= 2);
}

// ЖИ тек сайттағы жобалармен шектелген: сұрауға ұқсас жобаларды ұпаймен іздейді
function findMatches(codes: CodeFile[], words: string[]): CodeFile[] {
  if (words.length === 0) return [];

  return codes
    .filter((code) => !code.folderId)
    .map((code) => {
      const title = code.title?.toLowerCase() || '';
      const desc = code.description?.toLowerCase() || '';
      const lang = code.language?.toLowerCase() || '';
      const tags = (code.tags || []).map((tag) => tag.toLowerCase());
      const content = code.isFolder ? '' : (code.content || '').toLowerCase().slice(0, 5000);
      let score = 0;
      words.forEach((w) => {
        if (title.includes(w)) score += 3;
        if (tags.some((tag) => tag.includes(w))) score += 2;
        if (lang === w) score += 2;
        if (desc.includes(w)) score += 1;
        if (content.includes(w)) score += 0.5;
      });
      return { code, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map((m) => m.code);
}

const isBuildWord = (w: string) => BUILD_WORDS.some((k) => w.startsWith(k));

// Сұрауды талдау: сөйлесу ниеті, жоба жасау ниеті, сайт бөлімдері және ұқсас жобалар
function analyze(prompt: string, codes: CodeFile[]) {
  // Сәлемдесу сияқты сөздер жоба іздеуге араласпайды
  const { intents, rest } = detectSmallTalk(tokenize(prompt));
  const wantsProject = rest.some(isBuildWord);
  // «жаса», «керек» сияқты сөздер жоба мазмұнынан іздеуге қосылмайды
  const topic = rest.filter((w) => !isBuildWord(w));
  return { intents, wantsProject, features: findFeatures(topic), matches: findMatches(codes, topic) };
}

// Бүркіт шынымен жауап бере ала ма — тек осындай ұсыныстар көрсетіледі
function isAnswerable(prompt: string, codes: CodeFile[]): boolean {
  const { intents, features, matches } = analyze(prompt, codes);
  return intents.length > 0 || features.length > 0 || matches.length > 0;
}

// Тілдің әдемі жазылуы (тек кіші әріппен жазғанда атауы сәйкес келетіндері — іздеу бұзылмас үшін)
const LANG_NAMES: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', go: 'Go', rust: 'Rust',
  php: 'PHP', html: 'HTML', css: 'CSS', sql: 'SQL', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', dart: 'Dart',
};
const prettyLang = (lang: string) => LANG_NAMES[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);

// Ең жиі кездесетін тілдер
function topLanguages(list: CodeFile[]): string[] {
  const counts = new Map<string, number>();
  list.forEach((c) => {
    const lang = c.language?.toLowerCase().trim();
    if (lang && lang !== 'text' && lang !== 'plaintext') counts.set(lang, (counts.get(lang) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

/* Адамға бейімделген дайын сұраулар (ең көбі 4):
   жобасы жоқ адамға — жүктеу, өзі жазатын тілдегі жобалар, сайттағы танымал жоба,
   сайттағы басқа танымал тіл, Vibecoding, «Не істей аласың?». Әрқайсысы Бүркіттің
   өзінен өткізіліп тексеріледі — жауабы жоқ ұсыныс көрсетілмейді. */
function buildSuggestions(codes: CodeFile[], username: string | undefined, t: TFunction): string[] {
  const out: string[] = [];
  const add = (text?: string) => {
    if (text && out.length < 4 && !out.includes(text) && isAnswerable(text, codes)) out.push(text);
  };

  const roots = codes.filter((c) => !c.folderId);
  const mine = username ? roots.filter((c) => c.author === username) : [];
  const others = roots.filter((c) => c.author !== username);
  const popularity = (c: CodeFile) => (c.likes?.length || 0) * 3 + (c.views || 0);
  const popular = [...others]
    .sort((a, b) => popularity(b) - popularity(a))
    .map((c) => c.title?.trim())
    .find((title) => title && title.length <= 28);
  const myLang = topLanguages(mine)[0];
  const siteLang = topLanguages(others).find((lang) => lang !== myLang);

  // Кодтар әлі жүктелмей тұрғанда «жобаңыз жоқ» деп қате ұсынбау үшін
  if (username && roots.length > 0 && mine.length === 0) add(t('home.siteAiSuggest.upload'));
  if (myLang) add(t('home.siteAiSuggest.lang', { lang: prettyLang(myLang) }));
  add(popular);
  if (siteLang) add(t('home.siteAiSuggest.lang', { lang: prettyLang(siteLang) }));
  add(t('home.siteAiSuggest.vibecoding'));
  add(t('home.siteAiSuggest.help'));
  return out;
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

interface SiteAIProps {
  codes: CodeFile[];
}

const SiteAI: React.FC<SiteAIProps> = ({ codes }) => {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const [input, setInput] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const suggestions = useMemo(() => buildSuggestions(codes, user?.username, t), [codes, user?.username, t]);
  const isEmpty = messages.length === 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Өріс мәтінге қарай өседі (ең көбі ~6 жол), содан кейін ішінде айналады
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const push = (...msgs: Omit<AiMessage, 'id'>[]) => {
    setMessages((prev) => [...prev, ...msgs.map((msg) => ({ ...msg, id: nextId.current++ }))]);
  };

  const ask = (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || thinking) return;
    setInput('');
    push({ role: 'user', text: prompt });
    setThinking(true);

    timerRef.current = window.setTimeout(() => {
      const { intents, wantsProject, features, matches } = analyze(prompt, codes);
      const replies: Omit<AiMessage, 'id'>[] = [];
      const unmatched = features.length === 0 && matches.length === 0;

      intents.forEach((intent) => {
        // Сәлем/көмек жеке келсе — не істей алатынымды айтып, дайын сұрауларды ұсынамын
        const suggest = unmatched && !wantsProject && (intent === 'greeting' || intent === 'help' || intent === 'about');
        replies.push({ role: 'assistant', text: t(`home.siteAiReply.${intent}`), suggest });
      });
      if (features.length > 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiFeatures'), features });
      }
      if (matches.length > 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiFound', { count: matches.length }), prompt, matches });
      }
      if (unmatched && wantsProject) {
        // Ұқсас жоба жоқ — өзі жасай алатын бөлімдерге бағыттаймын
        replies.push({
          role: 'assistant',
          text: t('home.siteAiNoMatchBuild'),
          features: SITE_FEATURES.filter((f) => f.key === 'vibecoding' || f.key === 'upload'),
        });
      } else if (replies.length === 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiNotFound'), suggest: true });
      }
      push(...replies);
      setThinking(false);
    }, THINKING_MS);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  // Enter — жіберу, Shift+Enter — жаңа жол (әріп теру кезінде IME-ге кедергі жасамау)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  };

  const resetChat = () => {
    window.clearTimeout(timerRef.current);
    setThinking(false);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleCreate = async (base: CodeFile, prompt: string) => {
    if (!isAuthenticated || !user) {
      push({ role: 'assistant', text: t('home.siteAiLoginRequired') });
      return;
    }
    setCreatingId(base.id);
    try {
      const title = titleFromPrompt(prompt);
      // Тізімдегі кодтар мазмұнсыз келеді — толық нұсқасын жүктеу
      const full = await apiService.getCodeFile(base.id);
      const created = await apiService.createCodeFile({
        title,
        content: full.content,
        language: base.language,
        author: user.username,
        description: t('home.siteAiBasedOn', { title: base.title, author: base.author }),
        tags: Array.from(new Set([...(base.tags || []), 'site-ai'])),
      });
      window.dispatchEvent(new CustomEvent('codesUpdated'));
      push({ role: 'assistant', text: t('home.siteAiCreated', { title }), createdId: created.id });
    } catch {
      push({ role: 'assistant', text: t('home.siteAiCreateError') });
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <section className={`sai ${isEmpty ? 'is-empty' : ''}`} aria-labelledby="site-ai-title">
      {/* Сөйлесу басталғанда — жоғарыда жіңішке тақырып жолы */}
      {!isEmpty && (
        <header className="sai__bar">
          <span className="sai__bar-orb">
            <SparkleIcon size={16} />
          </span>
          <h2 id="site-ai-title" className="sai__bar-title">
            {t('home.siteAiTitle')}
          </h2>
          <button type="button" className="sai__ghost" onClick={resetChat}>
            <RefreshIcon />
            <span>{t('home.siteAiNewChat')}</span>
          </button>
        </header>
      )}

      <div className="sai__scroll" ref={listRef} aria-live="polite">
        {isEmpty ? (
          // Бос күй: ортада белгіше, тақырып және дайын сұраулар
          <div className="sai__hero">
            <div className="sai__orb" aria-hidden="true">
              <SparkleIcon size={30} />
            </div>
            <h2 id="site-ai-title" className="sai__title">
              {t('home.siteAiTitle')}
            </h2>
            <p className="sai__subtitle">{t('home.siteAiSubtitle')}</p>
            <div className="sai__chips">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="sai__chip"
                  style={{ '--d': i } as React.CSSProperties}
                  onClick={() => ask(s)}
                >
                  {s}
                  <ArrowRightIcon />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="sai__thread">
            {messages.map((msg) => (
              <div key={msg.id} className={`sai__msg sai__msg--${msg.role}`}>
                {msg.role === 'assistant' && (
                  <span className="sai__avatar" aria-hidden="true">
                    <SparkleIcon size={15} />
                  </span>
                )}
                <div className="sai__content">
                  <p className="sai__text">{msg.text}</p>

                  {msg.suggest && (
                    <div className="sai__chips sai__chips--inline">
                      {suggestions.map((s) => (
                        <button key={s} type="button" className="sai__chip sai__chip--sm" onClick={() => ask(s)}>
                          {s}
                          <ArrowRightIcon />
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.createdId && (
                    <Link to={`/view/${msg.createdId}`} className="sai__pill">
                      {t('home.siteAiOpenNew')}
                      <ArrowRightIcon />
                    </Link>
                  )}

                  {msg.features && (
                    <ul className="sai__features">
                      {msg.features.map((f) => (
                        <li key={f.key}>
                          <Link to={f.to} className="sai__feature">
                            <span className="sai__feature-text">
                              <strong>{t(`home.siteAiFeature.${f.key}.title`)}</strong>
                              <span>{t(`home.siteAiFeature.${f.key}.desc`)}</span>
                            </span>
                            <span className="sai__feature-arrow">
                              <ArrowRightIcon />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  {msg.matches && (
                    <ul className="sai__matches">
                      {msg.matches.map((code) => (
                        <li key={code.id} className="sai__match">
                          <span className="sai__mono" aria-hidden="true">
                            {monogram(code.title)}
                          </span>
                          <div className="sai__match-info">
                            <Link to={`/view/${code.id}`} className="sai__match-title">
                              {code.title}
                            </Link>
                            <span className="sai__match-meta">
                              {code.language} · {code.author}
                            </span>
                          </div>
                          {code.isFolder ? (
                            <Link to={`/view/${code.id}`} className="sai__pill" title={t('home.siteAiFolderNote')}>
                              {t('home.siteAiOpenNew')}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="sai__pill sai__pill--solid"
                              disabled={creatingId !== null}
                              onClick={() => handleCreate(code, msg.prompt || code.title)}
                            >
                              <SparkleIcon size={14} />
                              {creatingId === code.id ? t('home.siteAiCreating') : t('home.siteAiCreate')}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="sai__msg sai__msg--assistant">
                <span className="sai__avatar is-thinking" aria-hidden="true">
                  <SparkleIcon size={15} />
                </span>
                <div className="sai__dots" aria-label={t('home.siteAiThinking')}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form className="sai__composer" onSubmit={handleSubmit}>
        {/* Өрістің кез келген жерін басса — мәтін жолына фокус */}
        <div
          className="sai__box"
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('textarea, button')) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            className="sai__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('home.siteAiPlaceholder')}
            aria-label={t('home.siteAiTitle')}
          />
          <button
            type="submit"
            className="sai__send"
            disabled={!input.trim() || thinking}
            aria-label={t('home.siteAiSend')}
            title={t('home.siteAiSend')}
          >
            <ArrowUpIcon />
          </button>
        </div>
        <p className="sai__hint">{t('home.siteAiHint')}</p>
      </form>
    </section>
  );
};

export default SiteAI;
