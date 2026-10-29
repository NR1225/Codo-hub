import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { apiService, CodeFile, StoryGroup, StoryItem } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import StoryViewer from './stories/StoryViewer';
import StoryComposer from './stories/StoryComposer';
import { avatarSrc, firstUnseenIndex, isGroupSeen, readSeen, sortGroups, writeSeen } from './stories/storyUtils';
import './stories/Stories.css';

/* Басты беттегі сторис — қолданушылар өздері жариялайтын жарнама:
   фото/видео + жазу + Codo Hub-тағы жобасына «Жобаға өту» сілтемесі. 24 сағат тұрады. */

interface HomeStoriesProps {
  codes: CodeFile[];
}

const HomeStories: React.FC<HomeStoriesProps> = ({ codes }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(readSeen()));
  const [open, setOpen] = useState<{ group: number; item: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const viewed = useRef(new Set<string>());
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get('story');

  const load = useCallback(async () => {
    try {
      const data = await apiService.getStories();
      // Серверде «көрдім» деп белгіленгендер (басқа құрылғыда көрсем де) + осы браузердегілер
      const merged = new Set(readSeen());
      data.forEach((g) => g.items.forEach((it) => it.seen && merged.add(it.id)));
      writeSeen([...merged]);
      setSeen(merged);
      setGroups(sortGroups(data, merged, user?.id));
    } catch {
      // Сторис жүктелмесе — жолақ бос қалады, бетке кедергі емес
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Сілтеме (/?story=<id>) арқылы келсе — сол стористі бірден ашу
  useEffect(() => {
    if (!deepLinkId || loading) return;
    const group = groups.findIndex((g) => g.items.some((it) => it.id === deepLinkId));
    if (group >= 0) setOpen({ group, item: groups[group].items.findIndex((it) => it.id === deepLinkId) });
    else toast.info(t('home.story.notFound'));
    const next = new URLSearchParams(searchParams);
    next.delete('story');
    setSearchParams(next, { replace: true });
  }, [deepLinkId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Реакция сияқты өзгерістер — бір сторисін жаңарту
  const patchItem = useCallback((storyId: string, patch: Partial<StoryItem>) => {
    setGroups((prev) => prev.map((g) => ({
      ...g,
      items: g.items.map((it) => (it.id === storyId ? { ...it, ...patch } : it)),
    })));
  }, []);

  // Жабылғанда — толық көрілгендер соңына жылжиды (көріп жатқанда реті өзгермейді)
  const closeViewer = () => {
    setOpen(null);
    setGroups((prev) => sortGroups(prev, seen, user?.id));
  };

  // «Жобаға өту» үшін тек өз жобаларым (папка ішіндегі файлдар емес)
  const myProjects = useMemo(
    () => (user ? codes.filter((c) => c.author === user.username && !c.folderId) : []),
    [codes, user]
  );

  const ownGroupIndex = user ? groups.findIndex((g) => g.authorId === user.id) : -1;
  const ownGroup = ownGroupIndex >= 0 ? groups[ownGroupIndex] : null;

  const onShown = useCallback((storyId: string) => {
    setSeen((prev) => {
      if (prev.has(storyId)) return prev;
      const next = new Set(prev).add(storyId);
      writeSeen([...next]);
      return next;
    });
    if (!viewed.current.has(storyId)) {
      viewed.current.add(storyId);
      apiService.markStoryViewed(storyId).catch(() => {});
    }
  }, []);

  const openGroup = (index: number) => setOpen({ group: index, item: firstUnseenIndex(groups[index], seen) });

  const startCompose = () => (user ? setComposing(true) : navigate('/login'));

  const onCreated = (story: StoryItem) => {
    setComposing(false);
    if (!user) return;
    setGroups((prev) => {
      const rest = prev.filter((g) => g.authorId !== user.id);
      const own = prev.find((g) => g.authorId === user.id);
      const updated: StoryGroup = own
        ? { ...own, items: [...own.items, story] }
        : { authorId: user.id, author: user.username, avatar: user.avatar, items: [story] };
      return [updated, ...rest];
    });
  };

  const onDelete = async (storyId: string) => {
    try {
      await apiService.deleteStory(storyId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('home.story.errDelete'));
      return;
    }
    const current = open;
    const nextGroups = groups
      .map((g) => ({ ...g, items: g.items.filter((it) => it.id !== storyId) }))
      .filter((g) => g.items.length > 0);
    setGroups(nextGroups);
    // Өшірілген соң — сол топтың келесісіне, топ бос қалса жабу
    if (current) {
      const group = nextGroups.findIndex((g) => g.authorId === groups[current.group].authorId);
      if (group < 0) closeViewer();
      else setOpen({ group, item: Math.min(current.item, nextGroups[group].items.length - 1) });
    }
  };

  // Дөңгелекте — тек профиль суреті (жоқ болса — аттың бірінші әрпі)
  const renderAvatar = (avatar: string | null | undefined, name: string) => {
    const src = avatarSrc(avatar);
    return src ? <img src={src} alt="" /> : name.charAt(0).toUpperCase();
  };

  const others = groups.map((g, i) => ({ g, i })).filter(({ i }) => i !== ownGroupIndex);

  return (
    <section className="hs" aria-label={t('home.stories')}>
      <ul className="hs__list">
        {/* Өз дөңгелегім — профиль суретім + «+»; сторис бар болса басқанда ашылады */}
        <li>
          {ownGroup ? (
            <div className={`hs-item ${isGroupSeen(ownGroup, seen) ? 'is-seen' : ''}`}>
              <button type="button" className="hs-item__hit" onClick={() => openGroup(ownGroupIndex)} aria-label={t('home.yourStory')}>
                <span className="hs-ring">
                  <span className="hs-bubble hs-bubble--avatar">{renderAvatar(ownGroup.avatar ?? user?.avatar, ownGroup.author)}</span>
                </span>
                <span className="hs-item__name">{t('home.yourStory')}</span>
              </button>
              <button type="button" className="hs-item__add" onClick={startCompose} aria-label={t('home.story.newTitle')}>
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </div>
          ) : (
            <button type="button" className="hs-item hs-item--new" onClick={startCompose}>
              <span className="hs-ring">
                {user ? (
                  <span className="hs-bubble hs-bubble--avatar">{renderAvatar(user.avatar, user.username)}</span>
                ) : (
                  <span className="hs-bubble"><FontAwesomeIcon icon={faPlus} /></span>
                )}
              </span>
              {user && <span className="hs-item__add" aria-hidden><FontAwesomeIcon icon={faPlus} /></span>}
              <span className="hs-item__name">{t('home.story.create')}</span>
            </button>
          )}
        </li>

        {others.map(({ g, i }) => (
          <li key={g.authorId}>
            <button type="button" className={`hs-item ${isGroupSeen(g, seen) ? 'is-seen' : ''}`} onClick={() => openGroup(i)}>
              {/* Басқа адамдікі — тек профиль суреті (жоқ болса — аты бірінші әрпі) */}
              <span className="hs-ring">
                <span className="hs-bubble hs-bubble--avatar">{renderAvatar(g.avatar, g.author)}</span>
              </span>
              <span className="hs-item__name">{g.author}</span>
            </button>
          </li>
        ))}

        {loading && groups.length === 0 && [0, 1, 2].map((k) => (
          <li key={`sk-${k}`} aria-hidden>
            <span className="hs-item hs-item--skeleton"><span className="hs-ring"><span className="hs-bubble" /></span></span>
          </li>
        ))}
      </ul>

      {open && groups[open.group] && (
        <StoryViewer
          groups={groups}
          groupIndex={open.group}
          itemIndex={open.item}
          currentUserId={user?.id}
          onChange={(group, item) => {
            // Келесі адамға өткенде — оның алғашқы көрілмеген сторисінен (5-тің 2-еуі көрілсе, 3-шісінен)
            const forwardToNewGroup = open && group > open.group && item === 0;
            setOpen({ group, item: forwardToNewGroup ? firstUnseenIndex(groups[group], seen) : item });
          }}
          onShown={onShown}
          onDelete={onDelete}
          onPatch={patchItem}
          onClose={closeViewer}
        />
      )}

      {composing && <StoryComposer projects={myProjects} onClose={() => setComposing(false)} onCreated={onCreated} />}
    </section>
  );
};

export default HomeStories;
