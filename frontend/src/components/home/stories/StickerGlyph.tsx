import React from 'react';
import { stickerSrc } from './storyUtils';

/** Стикерді көрсету: «wolf:<аты>» — Codo қасқыр суреті, әйтпесе эмодзи мәтіні */
const StickerGlyph: React.FC<{ value: string; className?: string }> = ({ value, className }) => {
  const src = stickerSrc(value);
  if (src) return <img src={src} alt="" className={`sticker-img ${className ?? ''}`} draggable={false} />;
  return <>{value}</>;
};

export default StickerGlyph;
