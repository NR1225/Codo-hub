import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '../../utils/api';

/* Карта ішіндегі іске қосылған жоба — кішірейтілген sandbox iframe.
   Тек экранда көрінгенде жүктеледі; бет сәтті ашылғанда ғана (көпір «page» хабарын
   жібергенде) көрсетіледі, әйтпесе астындағы код үзіндісі қалады. */

const RUN_MSG = 'code-run';
// iframe ішіндегі «виртуал экран» ені — карта еніне дейін кішірейтіледі
const VIRTUAL_WIDTH = 1024;

const CodeLivePreview: React.FC<{ codeId: string; title: string }> = ({ codeId, title }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.3);

  // Экранға жақындағанда ғана іске қосамыз, алыстағанда тоқтатамыз (CPU үнемдеу)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / VIRTUAL_WIDTH || 0.3));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.source === RUN_MSG && e.data.type === 'page') setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      setReady(false);
    };
  }, [visible]);

  return (
    <div ref={rootRef} className={`cdx-live ${ready && visible ? 'is-ready' : ''}`} aria-hidden="true">
      {visible && (
        <iframe
          ref={iframeRef}
          className="cdx-live__frame"
          title={title}
          src={apiService.runUrl(codeId, '')}
          // Модалдар, попаптар, формалар жоқ — тек көрініс
          sandbox="allow-scripts"
          tabIndex={-1}
          loading="lazy"
          style={{ width: VIRTUAL_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
};

export default CodeLivePreview;
