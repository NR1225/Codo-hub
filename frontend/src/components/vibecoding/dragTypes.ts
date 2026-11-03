// Файлдар ағашынан сүйрелген жоба файлы/папкасы: { path, folder }
export const VIBE_PATH_MIME = 'application/x-vibe-path';

export function readVibePath(dt: DataTransfer): { path: string; folder: boolean } | null {
  try {
    const raw = JSON.parse(dt.getData(VIBE_PATH_MIME) || 'null');
    return raw && typeof raw.path === 'string' ? { path: raw.path, folder: !!raw.folder } : null;
  } catch {
    return null;
  }
}
