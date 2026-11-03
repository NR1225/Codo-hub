import React, { useEffect, useRef } from 'react';
import Parallax from 'parallax-js';
import { useTheme } from '../../contexts/ThemeContext';
import { useAnimation } from '../../contexts/MotionContext';

/** [top %, left %, өлшем px, кідіріс s] — орталықты бос қалдыру үшін шетке жақын */
const DUST_MID: [number, number, number, number][] = [
  [14, 22, 4, 0], [22, 70, 3, 1.2], [30, 12, 5, 2.4], [62, 16, 3, 0.8],
  [74, 28, 4, 3.1], [70, 78, 5, 1.7], [38, 84, 3, 2.9], [18, 46, 3, 4.2],
  [82, 60, 4, 0.4], [50, 8, 3, 3.6], [26, 88, 4, 5.0], [86, 40, 3, 2.0],
];
const DUST_NEAR: [number, number, number, number][] = [
  [20, 30, 7, 0.6], [66, 84, 8, 2.2], [78, 18, 6, 3.4], [34, 74, 6, 1.4], [56, 10, 7, 4.4],
];

const Leaf: React.FC<{ className: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id={`${className.split(' ').pop()}-g`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e3efe6" />
        <stop offset="100%" stopColor="#bcd6c3" />
      </linearGradient>
    </defs>
    <path
      d="M60 4 C 104 44, 114 120, 60 196 C 6 120, 16 44, 60 4 Z"
      fill={`url(#${className.split(' ').pop()}-g)`}
    />
    <path d="M60 18 L 60 190" stroke="rgba(255,255,255,0.75)" strokeWidth="2" fill="none" />
    <path
      d="M60 60 L 84 44 M60 92 L 90 74 M60 124 L 86 108 M60 76 L 36 60 M60 108 L 32 92 M60 140 L 38 126"
      stroke="rgba(255,255,255,0.5)"
      strokeWidth="1.5"
      fill="none"
    />
  </svg>
);

/**
 * Кіру/тіркелу беттерінің фоны.
 *   Қара тақырып — ғарыш: жұлдыздар, метеорлар және тышқанға ілесетін параллакс
 *                  (әрқайсысы баптаулардағы «Анимациялар» бөлімінен бөлек өшіріледі).
 *   Жарық тақырып — ауа тәрізді ақ сахна: бұлттар, күн сәулесі, шыны пішіндер,
 *                    жарық тозаңы және жапырақтар әр түрлі жылдамдықпен параллакста жылжиды.
 */
const AuthBackdrop: React.FC = () => {
  const { theme } = useTheme();
  const meteorsOn = useAnimation('auth.meteors');
  const parallaxOn = useAnimation('auth.parallax');
  const heroRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  const dark = theme === 'dark';
  const useParallax = parallaxOn;

  useEffect(() => {
    const scene = sceneRef.current;
    const hero = heroRef.current;
    if (!dark || !useParallax || !scene || !hero) return;
    let instance: Parallax | null = null;
    const timer = setTimeout(() => {
      try {
        instance = new Parallax(scene, {
          relativeInput: true,
          hoverOnly: false,
          inputElement: hero,
          scalarX: 30,
          scalarY: 30,
          frictionX: 0.08,
          frictionY: 0.08,
          pointerEvents: true,
          precision: 1,
        });
      } catch (err) {
        console.error('Parallax init error:', err);
      }
    }, 60);
    return () => {
      clearTimeout(timer);
      try { instance?.destroy(); } catch { /* бұзылған инстанс — елемейміз */ }
      // destroy() қабаттардағы transform-ды қалдырады — тазалаймыз
      scene.querySelectorAll<HTMLElement>('.parallax-layer').forEach((el) => { el.style.transform = ''; });
    };
  }, [useParallax, meteorsOn, dark]);

  // Жарық тақырып — өз параллакс қозғалтқышы: тегіс инерция, 3D еңкею, гироскоп, бос кездегі баяу дрейф
  useEffect(() => {
    const scene = sceneRef.current;
    const hero = heroRef.current;
    if (dark || !scene || !hero) return;
    const layers = Array.from(scene.querySelectorAll<HTMLElement>('.parallax-layer'));
    if (!useParallax) {
      layers.forEach((el) => { el.style.transform = ''; });
      hero.style.removeProperty('--mx');
      hero.style.removeProperty('--my');
      return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const depths = layers.map((el) => parseFloat(el.dataset.depth || '0'));
    const RANGE_X = 90; // px, depth = 1 кезінде
    const RANGE_Y = 60;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let lastInput = 0;
    let raf = 0;

    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = clamp((e.clientX / window.innerWidth) * 2 - 1);
      target.y = clamp((e.clientY / window.innerHeight) * 2 - 1);
      lastInput = performance.now();
    };
    const onLeave = () => { target.x = 0; target.y = 0; };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.x = clamp(e.gamma / 25);
      target.y = clamp((e.beta - 45) / 25);
      lastInput = performance.now();
    };

    const tick = (t: number) => {
      // Ұзақ уақыт қозғалыс болмаса — сахна өзі ақырын «тыныстайды»
      if (!reduced && meteorsOn && t - lastInput > 2500) {
        target.x = Math.sin(t * 0.00021) * 0.35;
        target.y = Math.cos(t * 0.00017) * 0.25;
      }
      const ease = t - lastInput > 2500 ? 0.02 : 0.07;
      cur.x += (target.x - cur.x) * ease;
      cur.y += (target.y - cur.y) * ease;
      for (let i = 0; i < layers.length; i++) {
        const d = depths[i];
        layers[i].style.transform =
          `translate3d(${(-cur.x * d * RANGE_X).toFixed(2)}px, ${(-cur.y * d * RANGE_Y).toFixed(2)}px, 0)`;
      }
      hero.style.setProperty('--mx', cur.x.toFixed(4));
      hero.style.setProperty('--my', cur.y.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('deviceorientation', onTilt);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onTilt);
      layers.forEach((el) => { el.style.transform = ''; });
    };
  }, [dark, useParallax, meteorsOn]);

  if (!dark) {
    return (
      <div
        ref={heroRef}
        className={`auth-backdrop auth-backdrop--light${useParallax ? ' is-parallax' : ''}${meteorsOn ? ' is-ambient' : ''}`}
        aria-hidden="true"
      >
        <div id="parallax-scene" ref={sceneRef}>
          {/* Алыс бұлттар — ең баяу */}
          <div data-depth="0.12" className="parallax-layer">
            <div className="al-cloud al-cloud--1" />
            <div className="al-cloud al-cloud--2" />
            <div className="al-cloud al-cloud--3" />
            <div className="al-cloud al-cloud--4" />
          </div>
          {/* Жоғарғы оң бұрыштан түскен күн сәулесі */}
          <div data-depth="-0.1" className="parallax-layer">
            <div className="al-sun" />
            <div className="al-rays" />
          </div>
          {/* Шыны пішіндер — орта тереңдік */}
          <div data-depth="0.35" className="parallax-layer">
            <div className="al-glass al-glass--pill" />
            <div className="al-glass al-glass--orb" />
            <div className="al-glass al-glass--tile" />
            <div className="al-glass al-glass--orb-sm" />
          </div>
          {/* Жарық тозаңы — орта тереңдік */}
          <div data-depth="0.6" className="parallax-layer">
            {DUST_MID.map(([top, left, size, delay], i) => (
              <span
                key={i}
                className="al-dust"
                style={{ top: `${top}%`, left: `${left}%`, width: size, height: size, animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          {/* Алдыңғы жапырақтар мен тозаң — ең жылдам */}
          <div data-depth="1" className="parallax-layer">
            <Leaf className="al-leaf al-leaf--1" />
            <Leaf className="al-leaf al-leaf--2" />
            <Leaf className="al-leaf al-leaf--3" />
            {DUST_NEAR.map(([top, left, size, delay], i) => (
              <span
                key={i}
                className="al-dust al-dust--near"
                style={{ top: `${top}%`, left: `${left}%`, width: size, height: size, animationDelay: `${delay}s` }}
              />
            ))}
          </div>
        </div>
        <div className="al-veil" />
      </div>
    );
  }

  return (
    <div
      ref={heroRef}
      className={`landing-hero auth-backdrop auth-backdrop--dark${useParallax ? ' is-parallax' : ''}`}
      aria-hidden="true"
    >
      <div id="parallax-scene" ref={sceneRef}>
        <div data-depth="0.05" className="parallax-layer">
          <div className="meteor-deep-space" />
        </div>
        <div data-depth="0.1" className="parallax-layer">
          <div className="meteor-stars-field">
            <div className="star-layer star-layer-1" />
            <div className="star-layer star-layer-2" />
            <div className="star-layer star-layer-3" />
          </div>
        </div>
        {meteorsOn && (
          <>
            <div data-depth="0.2" className="parallax-layer">
              <div className="meteor-shower meteor-shower-1">
                <div className="meteor meteor-1" />
                <div className="meteor meteor-2" />
                <div className="meteor meteor-3" />
              </div>
            </div>
            <div data-depth="0.4" className="parallax-layer">
              <div className="meteor-shower meteor-shower-2">
                <div className="meteor meteor-4" />
                <div className="meteor meteor-5" />
                <div className="meteor meteor-6" />
                <div className="meteor meteor-7" />
              </div>
            </div>
            <div data-depth="0.8" className="parallax-layer">
              <div className="meteor-shower meteor-shower-3">
                <div className="meteor meteor-8" />
                <div className="meteor meteor-9" />
                <div className="meteor meteor-10" />
                <div className="meteor meteor-11" />
                <div className="meteor meteor-12" />
              </div>
            </div>
            <div data-depth="1.0" className="parallax-layer">
              <div className="meteor-shower meteor-shower-4">
                <div className="meteor meteor-13" />
                <div className="meteor meteor-14" />
                <div className="meteor meteor-15" />
              </div>
            </div>
          </>
        )}
      </div>
      <div className="auth-backdrop__vignette" />
    </div>
  );
};

export default AuthBackdrop;
