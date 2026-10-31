import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { processFile, FileInfo, buildFolderManifest, filePath } from '../utils/fileHandler';
import { classifyUploadPath, isSkipped } from '../utils/uploadRules';
import { apiService } from '../utils/api';
import { offlineStorage, PendingUpload } from '../utils/offlineStorage';
import { API_BASE_URL } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { v4 as uuidv4 } from 'uuid';

// current/total — файл саны; loaded/bytes — жіберілген/барлық байт
export interface UploadProgress {
  current: number;
  total: number;
  startTime: number;
  loaded?: number;
  bytes?: number;
}

// Жобаны жүктеу нәтижесі (backend /codes/folder жауабы)
export interface FolderUploadResult {
  folderId: string;
  created: number;
  failed: number;
  failedFiles: string[];
  /** Басынан соңына дейінгі уақыт (жіберу + сервер), секунд */
  totalSeconds: number;
  /** Сервердің файлдарды тексеріп сақтауға кеткен уақыты, мс */
  serverMs: number;
}

interface UseFileUploadReturn {
  uploading: boolean;
  error: string | null;
  uploadProgress: UploadProgress | null;
  uploadFolder: (files: FileList | File[], metadata?: { title?: string; description?: string; tags?: string[]; language?: string; isPrivate?: boolean }) => Promise<FolderUploadResult | null>;
  reset: () => void;
}

// Бір сұраудың шегі: Cloud Run ~32 МБ қабылдайды, multipart үшін қор қалдырамыз
const BATCH_BYTES = 24 * 1024 * 1024;
// backend config.MAX_PROJECT_FILES (5000) — бір сұраудағы файл шегі
const BATCH_FILES = 1000;
const BATCH_RETRIES = 2;

/** Файлдарды ~24 МБ бөліктерге бөлу (ретімен). Бөліктен үлкен жалғыз файл — өз бөлігінде */
function splitIntoBatches<T extends { file: File }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length && (bytes + item.file.size > BATCH_BYTES || current.length >= BATCH_FILES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Check if online
const isOnline = (): boolean => {
  return navigator.onLine;
};

// Convert FileList to Array for storage
const fileListToArray = (files: FileList | File[]): File[] => {
  if (Array.isArray(files)) return files;
  return Array.from(files);
};

export const useFileUpload = (): UseFileUploadReturn => {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // Initialize offline storage
  useEffect(() => {
    offlineStorage.init().catch(console.error);

    // Retry pending uploads when the connection comes back
    const handleOnline = () => {
      retryPendingUploads();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const retryPendingUploads = async () => {
    if (!isOnline()) return;

    try {
      const pending = await offlineStorage.getPendingUploads();
      if (pending.length === 0) return;

      console.log(t('fileUpload.pendingUploadsFound', { count: pending.length }));

      for (const upload of pending) {
        try {
          // Remove from cache first to prevent duplicates if uploadFolder creates a new pending upload
          await offlineStorage.removePendingUpload(upload.id);

          if (upload.type === 'folder') {
            // Convert stored files back to FileList-like structure
            const files = fileListToArray(upload.files as File[]);
            const fileList = files as any as FileList;
            await uploadFolder(fileList, upload.metadata);
          } else {
            const file = (upload.files as File[])[0];
            await uploadFile(file, upload.metadata);
          }
        } catch (err) {
          console.error(t('fileUpload.retryError', { id: upload.id }), err);
          // Increment retry count and re-save
          upload.retryCount++;
          if (upload.retryCount < 5) {
            await offlineStorage.savePendingUpload(upload);
          }
          // If too many retries, it's already removed from cache
        }
      }
    } catch (err) {
      console.error(t('fileUpload.checkPendingError'), err);
    }
  };

  const uploadFile = async (
    file: File,
    metadata?: { title?: string; description?: string; tags?: string[]; language?: string; isPrivate?: boolean }
  ): Promise<void> => {
    setUploading(true);
    setError(null);
    const startTime = Date.now();
    setUploadProgress({ current: 0, total: 1, startTime });

    try {
      // Кэш/қоқыс пен .exe жіберілмейді (uploadRules.ts); құпия файлды сервер қорғайды
      if (isSkipped(classifyUploadPath(file.name))) {
        throw new Error(t('fileUpload.notCodeFile', { name: file.name }));
      }

      // Step 1: Process file
      setUploadProgress({ current: 0, total: 1, startTime });
      const fileInfo: FileInfo = await processFile(file);
      
      // Step 2: Upload to server
      setUploadProgress({ current: 1, total: 1, startTime });
      
      // Get current user
      const storedUser = localStorage.getItem('user');
      const currentUser = storedUser ? JSON.parse(storedUser) : { username: 'guest' };
      
      await apiService.createCodeFile({
        title: metadata?.title || fileInfo.name,
        content: fileInfo.content,
        language: metadata?.language || fileInfo.language,
        author: currentUser.username || 'guest',
        description: metadata?.description,
        tags: metadata?.tags,
        isPrivate: metadata?.isPrivate,
      });
      
      // Dispatch event to refresh codes list
      window.dispatchEvent(new CustomEvent('codesUpdated'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('fileUpload.uploadFileError');
      setError(errorMessage);
      throw err;
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const uploadFolder = async (
    files: FileList | File[],
    metadata?: { title?: string; description?: string; tags?: string[]; language?: string; isPrivate?: boolean }
  ): Promise<FolderUploadResult | null> => {
    setUploading(true);
    setError(null);
    const startTime = Date.now();
    const uploadId = uuidv4();

    // Check if offline
    if (!isOnline()) {
      try {
        // Save to cache
        const pendingUpload: PendingUpload = {
          id: uploadId,
          type: 'folder',
          files: fileListToArray(files),
          metadata: metadata || {},
          timestamp: Date.now(),
          retryCount: 0,
        };
        await offlineStorage.savePendingUpload(pendingUpload);
        setError(t('fileUpload.uploadOfflineCached'));
        setUploading(false);
        return null;
      } catch (cacheErr) {
        setError(t('fileUpload.uploadOfflineCacheFailed'));
        setUploading(false);
        throw cacheErr;
      }
    }

    try {
      if (!files || files.length === 0) {
        throw new Error(t('fileUpload.folderEmpty'));
      }

      // Файл мазмұнын оқымай-ақ манифест құру (FileReader циклсіз — бет қатпайды).
      // Контентті backend өзі оқиды.
      const manifestInfo = buildFolderManifest(files);
      if (!manifestInfo.files || manifestInfo.files.length === 0) {
        throw new Error(t('fileUpload.folderNoProcessableFiles'));
      }

      setUploadProgress({ current: 0, total: manifestInfo.files.length, startTime, loaded: 0, bytes: manifestInfo.totalSize });

      const manifest = {
        folderName: manifestInfo.folderName,
        title: metadata?.title || manifestInfo.folderName,
        description: metadata?.description,
        tags: metadata?.tags || ['folder'],
        language: metadata?.language || 'folder',
        isPrivate: !!metadata?.isPrivate,
        structure: manifestInfo.structure,
        files: manifestInfo.files.map((f) => ({
          path: f.path,
          name: f.name,
          language: f.language,
          isImage: f.isImage,
          size: f.size,
        })),
      };

      // Тек сүзгіден өткендері (кэш, .exe жіберілмейді) — manifest.files-пен бір ретте
      const fileArray = manifestInfo.selected;
      const token = getAccessToken();

      // Бір multipart сұрау: manifest JSON + шикі File-дар. XHR — нақты жүктеу прогрессы үшін.
      const sendBatch = (url: string, batchManifest: object, batchFiles: File[], onProgress: (loaded: number) => void) =>
        new Promise<any>((resolve, reject) => {
          const formData = new FormData();
          formData.append('manifest', JSON.stringify(batchManifest));
          batchFiles.forEach((file) => formData.append('files', file, filePath(file)));

          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          xhr.withCredentials = true;
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(e.loaded / e.total);
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error(t('fileUpload.apiError')));
              }
            } else {
              let detail = xhr.statusText;
              try {
                const data = JSON.parse(xhr.responseText);
                detail = data.detail || data.error || detail;
              } catch { /* ignore */ }
              reject(Object.assign(new Error(detail), { status: xhr.status }));
            }
          };
          xhr.onerror = () => reject(Object.assign(new Error(t('fileUpload.backendUnreachable')), { status: 0 }));
          xhr.send(formData);
        });

      // Желі үзілсе немесе сервер 5xx берсе — бөлік қайта жіберіледі (сервер қайталанған жолдарды өткізеді)
      const sendWithRetry = async (...args: Parameters<typeof sendBatch>) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await sendBatch(...args);
          } catch (err) {
            const status = (err as { status?: number }).status ?? 0;
            if (attempt >= BATCH_RETRIES || (status !== 0 && status < 500)) throw err;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      };

      // Жоба көлеміне шек жоқ: Cloud Run бір сұрауды ~32 МБ-пен шектейді, сондықтан жоба
      // бөліктерге бөлінеді. Бірінші бөлік жобаны құрады, қалғандары /codes/{id}/files-ке қосылады.
      const batches = splitIntoBatches(manifestInfo.files.map((f, i) => ({ entry: f, file: fileArray[i] })));
      const totalBytes = manifestInfo.totalSize || 1;
      let doneBytes = 0;
      let folderId = '';
      let created = 0;
      let failed = 0;
      let serverMs = 0;
      const failedFiles: string[] = [];

      for (const [index, batch] of batches.entries()) {
        const batchBytes = batch.reduce((sum, item) => sum + item.file.size, 0);
        const onProgress = (pct: number) => {
          const loaded = Math.min(totalBytes, doneBytes + pct * batchBytes);
          const current = Math.min(manifestInfo.files.length, Math.max(1, Math.round((loaded / totalBytes) * manifestInfo.files.length)));
          setUploadProgress({ current, total: manifestInfo.files.length, startTime, loaded, bytes: totalBytes });
        };
        const entries = batch.map((item) => item.entry);
        const files = batch.map((item) => item.file);
        try {
          const res = index === 0
            ? await sendWithRetry(`${API_BASE_URL}/codes/folder`, { ...manifest, files: entries }, files, onProgress)
            : await sendWithRetry(`${API_BASE_URL}/codes/${folderId}/files`, { files: entries }, files, onProgress);
          if (index === 0) folderId = res?.folderId ?? res?.folder?.id;
          created += res?.created ?? 0;
          failed += res?.failed ?? 0;
          failedFiles.push(...(res?.failedFiles ?? []));
          serverMs += res?.serverMs ?? 0;
        } catch (err) {
          // Бірінші бөліксіз жоба жоқ — қате. Кейінгі бөлік өтпесе, оның файлдары «өтпеді» тізіміне
          if (index === 0) throw err;
          console.error(`Upload batch ${index + 1}/${batches.length} failed:`, err);
          failed += entries.length;
          failedFiles.push(...entries.map((e) => e.path));
        }
        doneBytes += batchBytes;
      }
      const result = { folderId, created, failed, failedFiles, serverMs };

      const totalSeconds = (Date.now() - startTime) / 1000;
      const totalTime = totalSeconds.toFixed(1);
      console.log(t('fileUpload.folderUploadComplete', {
        successful: result?.created ?? 0,
        total: manifestInfo.files.length,
        failed: result?.failed ?? 0,
        time: totalTime,
      }));

      if (result?.failed > 0 && result?.created > 0) {
        const failedFileNames = (result.failedFiles || []).join(', ');
        console.warn(t('fileUpload.someFilesFailed', {
          failed: result.failed,
          maxRetries: 0,
          names: failedFileNames,
        }));
      }

      if (result?.created === 0 && manifestInfo.files.length > 0) {
        throw new Error(t('fileUpload.allFilesFailed'));
      }

      // Remove from cache if it was a retry
      try {
        await offlineStorage.removePendingUpload(uploadId);
      } catch (cacheErr) {
        // Ignore cache errors
      }

      // Dispatch event to refresh codes list
      window.dispatchEvent(new CustomEvent('codesUpdated'));
      return { ...result, totalSeconds };
    } catch (err) {
      console.error(t('fileUpload.folderError'), err);
      let errorMessage = t('fileUpload.folderUploadError');
      if (err instanceof Error) {
        errorMessage = err.message;
        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
          if (!isOnline()) {
            try {
              const pendingUpload: PendingUpload = {
                id: uploadId,
                type: 'folder',
                files: fileListToArray(files),
                metadata: metadata || {},
                timestamp: Date.now(),
                retryCount: 0,
              };
              await offlineStorage.savePendingUpload(pendingUpload);
              errorMessage = t('fileUpload.offlineCached');
            } catch (cacheErr) {
              errorMessage = t('fileUpload.offlineCacheFailed');
            }
          } else {
            errorMessage = t('fileUpload.backendUnreachable');
          }
        } else if (errorMessage.includes('API Error')) {
          errorMessage = t('fileUpload.apiError');
        }
      }
      console.error(t('fileUpload.errorMessage'), errorMessage);
      setError(errorMessage);
      throw err;
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const reset = () => {
    setError(null);
    setUploading(false);
    setUploadProgress(null);
  };

  return {
    uploading,
    error,
    uploadProgress,
    uploadFolder,
    reset
  };
};

