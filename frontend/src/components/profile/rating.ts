/* Профиль рейтингі: стористегі мақтау мен шағымдардан.
   Пайыз = мақтау / (мақтау + шағым). Түс күйді білдіреді, бірақ әрқашан белгі мен жазумен бірге
   (тек түске сүйенбейміз): жасыл — жақсы, сары — орташа, қызыл — жаман, сұр — әлі пікір жоқ. */

export type RatingLevel = 'none' | 'good' | 'mid' | 'bad';

export interface Rating {
  level: RatingLevel;
  percent: number | null;
  total: number;
}

export const ratingOf = ({ praise, complaint }: { praise: number; complaint: number }): Rating => {
  const total = Math.max(0, praise) + Math.max(0, complaint);
  if (total === 0) return { level: 'none', percent: null, total };
  const percent = Math.round((praise / total) * 100);
  const level: RatingLevel = percent >= 70 ? 'good' : percent >= 40 ? 'mid' : 'bad';
  return { level, percent, total };
};

export const RATING_ICON: Record<RatingLevel, string> = {
  good: '✔',
  mid: '!',
  bad: '✖',
  none: '–',
};
