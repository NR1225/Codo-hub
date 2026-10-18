import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark, faChevronLeft, faChevronRight, faFolder, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { CodeFile } from '../../utils/api';
import { formatDate } from '../../utils/dateFormatter';

const STORY_DURATION_MS = 5000;
const MAX_STORY_AUTHORS = 20;
const MAX_ITEMS_PER_AUTHOR = 10;
const SEEN_STORAGE_KEY = 'kh-seen-stories';

interface AuthorStory {
  author: string;
  items: CodeFile[];
  latest: number;
}

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // localStorage қолжетімсіз болса — елемеу
  }
}

// Папка құрылымы (JSON) болса, үзіндіні көрсетпейміз
function previewSnippet(code: CodeFile): string {
  if (code.isFolder || !code.content) return '';
  const trimmed = code.content.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"structure"')) return '';
  return trimmed.slice(0, 420);
}

interface HomeStoriesProps {
  codes: CodeFile[];
}

const HomeStories: React.FC<HomeStoriesProps> = ({ codes }) => {
  const { t } = useTranslation();
  const [seen, setSeen] = useState<Record<string, number>>(readSeen);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [itemIndex, setItemIndex] = useState(0);

  // Авторлар бойынша топтау — ең соңғы жарияланғаны бірінші
  const stories = useMemo<AuthorStory[]>(() => {
    const byAuthor = new Map<string, CodeFile[]>();
    codes.forEach((code) => {
      if (!code.author || code.folderId) return;
      const list = byAuthor.get(code.author);
      if (list) list.push(code);
      else byAuthor.set(code.author, [code]);
    });
    return Array.from(byAuthor.entries())
      .map(([author, items]) => {
        const sorted = [...items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        return {
          author,
          items: sorted.slice(0, MAX_ITEMS_PER_AUTHOR),
          latest: new Date(sorted[0].createdAt).getTime(),
        };
      })
      .sort((a, b) => b.latest - a.latest)
      .slice(0, MAX_STORY_AUTHORS);
  }, [codes]);

  const isSeen = (story: AuthorStory) => (seen[story.author] ?? 0) >= story.latest;

  const markSeen = useCallback((story: AuthorStory) => {
    setSeen((prev) => {
      if ((prev[story.author] ?? 0) >= story.latest) return prev;
      const next = { ...prev, [story.author]: story.latest };
      writeSeen(next);
      return next;
    });
  }, []);

  const close = useCallback(() => setOpenIndex(null), []);

  const goNext = useCallback(() => {
    if (openIndex === null) return;
    const story = stories[openIndex];
    if (itemIndex < story.items.length - 1) {
      setItemIndex(itemIndex + 1);
    } else if (openIndex < stories.length - 1) {
      setOpenIndex(openIndex + 1);
      setItemIndex(0);
    } else {
      close();
    }
  }, [openIndex, itemIndex, stories, close]);

  const goPrev = useCallback(() => {
    if (openIndex === null) return;
    if (itemIndex > 0) {
      setItemIndex(itemIndex - 1);
    } else if (openIndex > 0) {
      setOpenIndex(openIndex - 1);
      setItemIndex(stories[openIndex - 1].items.length - 1);
    }
  }, [openIndex, itemIndex, stories]);

  const activeStory = openIndex !== null ? stories[openIndex] : null;
  const activeItem = activeStory?.items[itemIndex];

  useEffect(() => {
    if (activeStory) markSeen(activeStory);
  }, [activeStory, markSeen]);

  // Авто-ауысу
  useEffect(() => {
    if (!activeItem) return;
    const timer = setTimeout(goNext, STORY_DURATION_MS);
    return () => clearTimeout(timer);
  }, [activeItem, goNext]);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex, close, goNext, goPrev]);

  const openStory = (index: number) => {
    setOpenIndex(index);
    setItemIndex(0);
  };

  const snippet = activeItem ? previewSnippet(activeItem) : '';

  return (
    <section className="home-stories" aria-label={t('home.stories')}>
      <ul className="home-stories__list">
        <li>
          <Link to="/upload" className="home-story home-story--add">
            <span className="home-story__ring">
              <span className="home-story__avatar">
                <FontAwesomeIcon icon={faPlus} />
              </span>
            </span>
            <span className="home-story__name">{t('home.yourStory')}</span>
          </Link>
        </li>
        {stories.map((story, index) => (
          <li key={story.author}>
            <button
              type="button"
              className={`home-story ${isSeen(story) ? 'is-seen' : ''}`}
              onClick={() => openStory(index)}
            >
              <span className="home-story__ring">
                <span className="home-story__avatar">{story.author.charAt(0).toUpperCase()}</span>
              </span>
              <span className="home-story__name">{story.author}</span>
            </button>
          </li>
        ))}
      </ul>

      {activeStory && activeItem && (
        <div className="story-viewer" role="dialog" aria-modal="true" aria-label={activeStory.author} onClick={close}>
          <div className="story-viewer__card" onClick={(e) => e.stopPropagation()}>
            <div className="story-viewer__progress">
              {activeStory.items.map((item, i) => (
                <span key={item.id} className="story-viewer__bar">
                  <span
                    key={i === itemIndex ? `${item.id}-active` : item.id}
                    className={`story-viewer__fill ${i < itemIndex ? 'is-done' : ''} ${i === itemIndex ? 'is-active' : ''}`}
                    style={{ animationDuration: `${STORY_DURATION_MS}ms` }}
                  />
                </span>
              ))}
            </div>

            <header className="story-viewer__head">
              <span className="story-viewer__avatar">{activeStory.author.charAt(0).toUpperCase()}</span>
              <div className="story-viewer__meta">
                <Link to={`/profile/${activeStory.author}`} className="story-viewer__author">
                  {activeStory.author}
                </Link>
                <span className="story-viewer__date">{formatDate(activeItem.createdAt)}</span>
              </div>
              <button type="button" className="story-viewer__close" onClick={close} aria-label={t('home.storyClose')}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>

            <div className="story-viewer__body">
              <span className="story-viewer__lang">
                {activeItem.isFolder && <FontAwesomeIcon icon={faFolder} />}
                {activeItem.language}
              </span>
              <h3 className="story-viewer__title">{activeItem.title}</h3>
              {activeItem.description && <p className="story-viewer__desc">{activeItem.description}</p>}
              {snippet && <pre className="story-viewer__code">{snippet}</pre>}
            </div>

            <Link to={`/view/${activeItem.id}`} className="home-btn home-btn--primary story-viewer__open">
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
              {t('home.storyOpen')}
            </Link>

            <button type="button" className="story-viewer__nav story-viewer__nav--prev" onClick={goPrev} aria-label={t('home.storyPrev')}>
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
            <button type="button" className="story-viewer__nav story-viewer__nav--next" onClick={goNext} aria-label={t('home.storyNext')}>
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default HomeStories;
