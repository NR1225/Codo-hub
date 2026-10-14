import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { processFile, FileInfo, buildFolderManifest } from '../utils/fileHandler';
import { apiService } from '../utils/api';
import { offlineStorage, PendingUpload } from '../utils/offlineStorage';
import { API_BASE_URL } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { v4 as uuidv4 } from 'uuid';

interface UseFileUploadReturn {
  uploading: boolean;
  error: string | null;
  uploadProgress: { current: number; total: number; startTime: number } | null;
  uploadFolder: (files: FileList | File[], metadata?: { title?: string; description?: string; tags?: string[]; language?: string }) => Promise<void>;
  reset: () => void;
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
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; startTime: number } | null>(null);

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
    metadata?: { title?: string; description?: string; tags?: string[]; language?: string }
  ): Promise<void> => {
    setUploading(true);
    setError(null);
    const startTime = Date.now();
    setUploadProgress({ current: 0, total: 1, startTime });

    try {
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
    metadata?: { title?: string; description?: string; tags?: string[]; language?: string }
  ): Promise<void> => {
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
        return;
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

      setUploadProgress({ current: 0, total: manifestInfo.files.length, startTime });

      const manifest = {
        folderName: manifestInfo.folderName,
        title: metadata?.title || manifestInfo.folderName,
        description: metadata?.description,
        tags: metadata?.tags || ['folder'],
        language: metadata?.language || 'folder',
        structure: manifestInfo.structure,
        files: manifestInfo.files.map((f) => ({
          path: f.path,
          name: f.name,
          language: f.language,
          isImage: f.isImage,
          size: f.size,
        })),
      };

      const fileArray = Array.from(files);

      // Бір multipart сұрау: manifest JSON + шикі File-дар.
      const formData = new FormData();
      formData.append('manifest', JSON.stringify(manifest));
      fileArray.forEach((file) => {
        formData.append('files', file, (file as File).webkitRelativePath || file.name);
      });

      // Бір XHR сұрау — нақты жүктеу прогрессын көрсету үшін.
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/codes/folder`);
        xhr.withCredentials = true;
        const token = getAccessToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        const totalFiles = manifestInfo.files.length;
        let lastPct = 0;

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = e.loaded / e.total;
          // UI "X / N файл" форматында көрсету үшін файл санына бөлеміз.
          const current = Math.min(totalFiles, Math.max(1, Math.round(pct * totalFiles)));
          if (pct > lastPct) {
            lastPct = pct;
            setUploadProgress({ current, total: totalFiles, startTime });
          }
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
            reject(new Error(detail));
          }
        };

        xhr.onerror = () => reject(new Error(t('fileUpload.backendUnreachable')));
        xhr.ontimeout = () => reject(new Error(t('fileUpload.backendUnreachable')));
        xhr.send(formData);
      });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
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

