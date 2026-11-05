import { FILE_TYPES } from './constants';
import i18n from '../i18n/config';
import { classifyUploadPath, innerPath, isSkipped } from './uploadRules';

export interface FileInfo {
  name: string;
  content: string;
  language: string;
  size: number;
}

interface FolderStructure {
  [path: string]: {
    type: 'file' | 'folder';
    name: string;
    size?: number;
    language?: string;
  };
}

// Сүйреп әкелінген немесе ZIP-тен шыққан File-да webkitRelativePath бос (ол тек оқылады),
// сондықтан жобадағы жолы осы қасиетте сақталады
const PATH_KEY = '__projectPath';

/** File-ға жобадағы жолын («жоба/src/a.ts») бекіту */
export const withPath = (file: File, path: string): File => {
  Object.defineProperty(file, PATH_KEY, { value: path, enumerable: false });
  return file;
};

/** Файлдың жобадағы жолы: бекітілгені → папка таңдағыштың жолы → аты */
export const filePath = (file: File): string =>
  (file as unknown as Record<string, string | undefined>)[PATH_KEY] || file.webkitRelativePath || file.name;

const getFileExtension = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) return '';
  return filename.toLowerCase().substring(lastDotIndex);
};

export const isImageFile = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
  return imageExtensions.includes(ext);
};

const detectLanguage = (filename: string): string => {
  const ext = getFileExtension(filename);
  
  const languageMap: Record<string, string> = {
    '.js': FILE_TYPES.JAVASCRIPT,
    '.jsx': FILE_TYPES.JAVASCRIPT,
    '.ts': FILE_TYPES.TYPESCRIPT,
    '.tsx': FILE_TYPES.TYPESCRIPT,
    '.py': FILE_TYPES.PYTHON,
    '.java': FILE_TYPES.JAVA,
    '.cpp': FILE_TYPES.CPP,
    '.c': FILE_TYPES.C,
    '.h': FILE_TYPES.C,
    '.html': FILE_TYPES.HTML,
    '.css': FILE_TYPES.CSS,
    '.json': FILE_TYPES.JSON,
    '.md': FILE_TYPES.MARKDOWN,
  };

  return languageMap[ext] || FILE_TYPES.OTHER;
};

const readFileContent = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    // For image files, read as data URL (base64)
    if (isImageFile(file.name)) {
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve(result); // Returns data:image/...;base64,... format
        } else {
          reject(new Error(i18n.t('fileHandler.imageReadFailed', { name: file.name })));
        }
      };
      reader.onerror = () => {
        reject(new Error(i18n.t('fileHandler.imageReadError', { name: file.name })));
      };
      try {
        reader.readAsDataURL(file);
      } catch (err) {
        reject(new Error(i18n.t('fileHandler.imageReadFailed', { name: file.name })));
      }
    } else {
      // For text files, read as text
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error(i18n.t('fileHandler.fileNotText', { name: file.name })));
        }
      };
      reader.onerror = () => {
        reject(new Error(i18n.t('fileHandler.fileReadError', { name: file.name })));
      };
      try {
        reader.readAsText(file, 'UTF-8');
      } catch (err) {
        reject(new Error(i18n.t('fileHandler.fileReadFailed', { name: file.name })));
      }
    }
  });
};

export const processFile = async (file: File): Promise<FileInfo> => {
  const content = await readFileContent(file);
  const language = detectLanguage(file.name);

  return {
    name: file.name,
    content,
    language,
    size: file.size,
  };
};

/**
 * Манифест құру — файлдарды оқымай-ақ (FileReader циклсіз) бүтін папканы
 * бір multipart сұраумен backend-ке жіберуге арналған. Контентті сервер өзі
 * оқиды, сондықтан бет қатып қалмайды.
 *
 * files: input-тан келген File тізімі (webkitRelativePath сақталған).
 */
export const buildFolderManifest = (
  files: FileList | File[]
): {
  folderName: string;
  structure: FolderStructure;
  files: Array<{ path: string; name: string; language: string; isImage: boolean; size: number }>;
  totalSize: number;
  /** Серверге жіберілетін File-дар (files-пен бір ретте) */
  selected: File[];
  /** Өткізілген құпия/бинарлы файлдар (қолданушыға айтылады) */
  skipped: string[];
  /** Үнсіз өткізілген кэш/қоқыс файлдарының саны (node_modules т.б.) */
  junkSkipped: number;
} => {
  const fileArray = Array.from(files);
  const folderName = filePath(fileArray[0] ?? new File([], 'folder')).split('/')[0] || 'folder';
  const structure: FolderStructure = {};
  const entries: Array<{ path: string; name: string; language: string; isImage: boolean; size: number }> = [];
  const selected: File[] = [];
  const skipped: string[] = [];
  let junkSkipped = 0;
  let totalSize = 0;

  for (const file of fileArray) {
    const path = filePath(file);
    // Тек кэш/қоқыс пен .exe структураға да, сұрауға да кірмейді (uploadRules.ts);
    // құпия, база, тест деректері жіберіледі — оларды сервер қорғайды
    if (isSkipped(classifyUploadPath(innerPath(path)))) {
      junkSkipped++;
      continue;
    }
    selected.push(file);
    const pathParts = path.split('/');

    // Қапшық структурасын құру
    let currentPath = '';
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!structure[currentPath]) {
        structure[currentPath] = { type: 'folder', name: part };
      }
    }

    const language = detectLanguage(file.name);
    const isImg = isImageFile(file.name);
    structure[path] = { type: 'file', name: file.name, size: file.size, language };

    entries.push({
      path,
      name: file.name,
      language,
      isImage: isImg,
      size: file.size,
    });
    totalSize += file.size;
  }

  return { folderName, structure, files: entries, totalSize, selected, skipped, junkSkipped };
};