// «Біз жайлы» қойындысының ішкі беттері: /settings/info/<doc>
export const INFO_DOCS = ['about', 'terms', 'privacy', 'contact'] as const;
export type InfoDoc = typeof INFO_DOCS[number];

export const isInfoDoc = (value: string | undefined): value is InfoDoc =>
  INFO_DOCS.includes(value as InfoDoc);
