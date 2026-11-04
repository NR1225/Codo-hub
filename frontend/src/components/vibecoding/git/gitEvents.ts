/** Source Control панелі ↔ IDE (diff көрінісі, статус жолағы) арасындағы оқиғалар */

export const GIT_DIFF_EVENT = 'vibecoding:git-diff';
export const GIT_BRANCH_EVENT = 'vibecoding:git-branch';

export interface GitDiffTarget {
  projectId: string;
  path: string;
  title: string;
  /** Жұмыс папкасы (false) немесе индекс (true) өзгерісі */
  staged?: boolean;
  /** Берілсе — осы коммиттегі өзгеріс */
  sha?: string;
  /** Берілсе — осы pull request-тегі өзгеріс */
  prId?: string;
}

export function openGitDiff(target: GitDiffTarget): void {
  window.dispatchEvent(new CustomEvent<GitDiffTarget>(GIT_DIFF_EVENT, { detail: target }));
}
