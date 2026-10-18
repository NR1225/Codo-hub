import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { useFileUpload } from '../../hooks/useFileUpload';
import { apiService } from '../../utils/api';
import { CATEGORY_TAG_PREFIX } from '../../utils/codeCategories';
import { API_BASE_URL } from '../../utils/constants';
import Button from '../ui/Button';
import './UploadModal.css';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type UploadMode = 'folder' | 'terminal';

const getApiBaseForDisplay = () => {
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return base + (base.endsWith('/api') ? '' : '/api');
};

const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [uploadMode, setUploadMode] = useState<UploadMode>('folder');
  const [apiDisplayUrl, setApiDisplayUrl] = useState<string>(getApiBaseForDisplay());
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [description, setDescription] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const terminalCommandRef = useRef<HTMLInputElement>(null);
  const { uploading, error, uploadProgress, uploadFolder, reset } = useFileUpload();

  useEffect(() => {
    if (isOpen) {
      apiService.getConfig().then((c) => {
        if (c.apiDisplayUrl) setApiDisplayUrl(c.apiDisplayUrl);
        else setApiDisplayUrl(getApiBaseForDisplay());
      }).catch(() => setApiDisplayUrl(getApiBaseForDisplay()));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
      const folderName = e.dataTransfer.files[0]?.webkitRelativePath?.split('/')[0] || 'folder';
      if (!title) {
        setTitle(folderName);
      }
    }
  };

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
      const folderName = e.target.files[0]?.webkitRelativePath?.split('/')[0] || 'folder';
      if (!title) {
        setTitle(folderName);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFiles || selectedFiles.length === 0) return;
    
    // Тіл міндетті
    if (!language) {
      alert(t('settings.selectLanguage'));
      return;
    }
    
    // Папка үшін проект сипаттамасы міндетті
    if (!projectDescription.trim()) {
      alert(t('settings.enterProjectDescription'));
      return;
    }

    try {
      await uploadFolder(selectedFiles, {
        title: title || 'folder',
        description: description.trim() || projectDescription || undefined,
        // Таңдалған категория — Кодтар тізімі беті осы тег бойынша бөледі
        tags: ['folder', `${CATEGORY_TAG_PREFIX}${projectDescription}`],
        language: language,
      });
      onSuccess?.();
      handleClose();
    } catch (err) {
      // Error is handled by the hook
      console.error('Folder upload error:', err);
      // Don't close modal on error so user can see the error message
    }
  };

  const handleClose = () => {
    setSelectedFiles([]);
    setTitle('');
    setLanguage('');
    setProjectDescription('');
    setDescription('');
    setUploadMode('folder');
    reset();
    onClose();
  };

  const copyToClipboard = (text: string, inputElement?: HTMLInputElement) => {
    navigator.clipboard.writeText(text).then(() => {
      if (inputElement) {
        const originalValue = inputElement.value;
        inputElement.value = '✓ ' + t('uploadModal.commandCopied');
        inputElement.style.color = '#0dbc79';
        setTimeout(() => {
          inputElement.value = originalValue;
          inputElement.style.color = '';
        }, 1500);
      }
    }).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);

      if (inputElement) {
        const originalValue = inputElement.value;
        inputElement.value = '✓ ' + t('uploadModal.commandCopied');
        inputElement.style.color = '#0dbc79';
        setTimeout(() => {
          inputElement.value = originalValue;
          inputElement.style.color = '';
        }, 1500);
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.uploadCode')}</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {/* Режим таңдау баттамалары */}
          <div className="upload-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'folder' ? 'active' : ''}`}
              onClick={() => setUploadMode('folder')}
            >
              <FontAwesomeIcon icon={faFolder} style={{ marginRight: '0.5rem' }} />
              {t('settings.folder')}/{t('settings.filesProgress')}
            </button>
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'terminal' ? 'active' : ''}`}
              onClick={() => setUploadMode('terminal')}
            >
              <FontAwesomeIcon icon={faTerminal} style={{ marginRight: '0.5rem' }} />
              {t('uploadModal.openTerminal')}
            </button>
          </div>

          {/* Папка/Файл режимі */}
          {uploadMode === 'folder' && (
            <>
              <div
                className={`upload-dropzone ${dragActive ? 'active' : ''} ${selectedFiles ? 'has-file' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => {
                  folderInputRef.current?.click();
                }}
              >
            <input
              ref={folderInputRef}
              type="file"
              onChange={handleFolderInput}
              {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
              style={{ display: 'none' }}
            />
            {selectedFiles ? (
              <div className="file-selected">
                <span className="file-icon"><FontAwesomeIcon icon={faFolder} /></span>
                <span className="file-name">
                  {selectedFiles[0]?.webkitRelativePath?.split('/')[0] || t('settings.folder')}
                </span>
                <span className="file-size">{selectedFiles.length} {t('settings.files')}</span>
              </div>
            ) : (
              <div className="dropzone-content">
                <span className="dropzone-icon"><FontAwesomeIcon icon={faFolder} /></span>
                <p>{t('settings.dragFolderHere')}</p>
              </div>
            )}
          </div>
          </>
          )}

          {/* Терминал режимі */}
          {uploadMode === 'terminal' && (
            <div className="terminal-upload-section">
              <div className="terminal-instructions">
                <h3>{t('uploadModal.terminalTitle')}</h3>
              </div>

              <div className="terminal-command-section">
                <p className="terminal-start-title"><strong>{t('uploadModal.windowsPowerShell')}</strong></p>
                <div className="terminal-command-box">
                  <input
                    ref={terminalCommandRef}
                    type="text"
                    readOnly
                    value={`$body=@{title="CodeTitle";content="";language="language";author="Author";description="description"}|ConvertTo-Json;Invoke-RestMethod -Uri "${apiDisplayUrl}/codes" -Method POST -Body $body -ContentType "application/json"`}
                    className="terminal-command-input"
                    onClick={(e) => {
                      const target = e.currentTarget;
                      copyToClipboard(target.value, target);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </div>
                
                <p className="terminal-start-title" style={{ marginTop: '1rem' }}><strong>{t('uploadModal.uploadCommand')}</strong></p>
                <div className="terminal-command-box">
                  <input
                    type="text"
                    readOnly
                    value={`$file=Get-Content "filepath" -Raw;$body=@{title="Title";content=$file;language="language";author="Author"}|ConvertTo-Json;Invoke-RestMethod -Uri "${apiDisplayUrl}/codes" -Method POST -Body $body -ContentType "application/json"`}
                    className="terminal-command-input"
                    onClick={(e) => {
                      const target = e.currentTarget;
                      copyToClipboard(target.value, target);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                <p className="terminal-start-title" style={{ marginTop: '1rem' }}><strong>GET:</strong></p>
                <div className="terminal-command-box">
                  <input
                    type="text"
                    readOnly
                    value={`Invoke-RestMethod -Uri "${apiDisplayUrl}/codes" -Method GET`}
                    className="terminal-command-input"
                    onClick={(e) => {
                      const target = e.currentTarget;
                      copyToClipboard(target.value, target);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.75rem', marginBottom: '0', fontStyle: 'italic' }}>
                </p>
              </div>

            </div>
          )}

          {/* Форма өрістері (тек папка режимінде) */}
          {uploadMode === 'folder' && (
            <>
          <div className="form-group">
            <label htmlFor="title">{t('settings.title')}</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('settings.enterCodeTitle')}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="language">{t('settings.languageRequired')} <span className="required">*</span></label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              required
            >
              <option value="">{t('settings.languagePlaceholder')}</option>
              <optgroup label="Web Development">
                <option value="HTML">HTML</option>
                <option value="CSS">CSS</option>
                <option value="JavaScript">JavaScript</option>
                <option value="TypeScript">TypeScript</option>
              </optgroup>
              <optgroup label="Backend">
                <option value="Python">Python</option>
                <option value="Java">Java</option>
                <option value="C++">C++</option>
                <option value="C">C</option>
                <option value="Go">Go</option>
                <option value="Rust">Rust</option>
                <option value="PHP">PHP</option>
                <option value="Ruby">Ruby</option>
              </optgroup>
              <optgroup label="Mobile">
                <option value="Swift">Swift</option>
                <option value="Kotlin">Kotlin</option>
                <option value="Dart">Dart</option>
              </optgroup>
              <optgroup label="Data Science">
                <option value="R">R</option>
                <option value="MATLAB">MATLAB</option>
              </optgroup>
              <optgroup label="Markup/Config">
                <option value="JSON">JSON</option>
                <option value="XML">XML</option>
                <option value="YAML">YAML</option>
                <option value="Markdown">Markdown</option>
              </optgroup>
              <optgroup label="Other">
                <option value="Shell">Shell</option>
                <option value="SQL">SQL</option>
                <option value="Other">Other</option>
              </optgroup>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="projectDescription">{t('settings.projectDescription')} <span className="required">*</span></label>
            <select
              id="projectDescription"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              required
            >
              <option value="">{t('uploadModal.selectCategory')}</option>
              <optgroup label={t('uploadModal.categoryAI')}>
                <option value="machine-learning">{t('uploadModal.categoryAIOption1')}</option>
                <option value="natural-language-processing">{t('uploadModal.categoryAIOption2')}</option>
                <option value="computer-vision">{t('uploadModal.categoryAIOption3')}</option>
                <option value="ai-applications">{t('uploadModal.categoryAIOption4')}</option>
              </optgroup>
              <optgroup label={t('uploadModal.categoryMobile')}>
                <option value="ios-app">{t('uploadModal.categoryMobileOption1')}</option>
                <option value="android-app">{t('uploadModal.categoryMobileOption2')}</option>
                <option value="cross-platform-app">{t('uploadModal.categoryMobileOption3')}</option>
                <option value="mobile-game">{t('uploadModal.categoryMobileOption4')}</option>
              </optgroup>
              <optgroup label={t('uploadModal.categoryOther')}>
                <option value="web-app">{t('uploadModal.categoryOtherOption1')}</option>
                <option value="desktop-app">{t('uploadModal.categoryOtherOption2')}</option>
                <option value="game">{t('uploadModal.categoryOtherOption3')}</option>
                <option value="api">{t('uploadModal.categoryOtherOption4')}</option>
                <option value="database">{t('uploadModal.categoryOtherOption5')}</option>
                <option value="devops">{t('uploadModal.categoryOtherOption6')}</option>
                <option value="other">{t('uploadModal.categoryOtherOption7')}</option>
              </optgroup>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="description">{t('uploadModal.description')}</label>
            <input
              id="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('uploadModal.enterDescription')}
            />
          </div>

          {uploadMode === 'folder' && uploadProgress && uploadProgress.total > 0 && (
            <div className="upload-progress">
              <div className="progress-info">
                <span>
                  {`${t('settings.uploadingProgress')}: ${uploadProgress.current} / ${uploadProgress.total} ${t('settings.filesProgress')}`}
                </span>
                <span className="progress-time">
                  {(() => {
                    const elapsed = ((Date.now() - uploadProgress.startTime) / 1000).toFixed(1);
                    const percentage = uploadProgress.total > 0 
                      ? Math.round((uploadProgress.current / uploadProgress.total) * 100)
                      : 0;
                    const remaining = uploadProgress.current > 0 && uploadProgress.total > uploadProgress.current
                      ? ((Date.now() - uploadProgress.startTime) / uploadProgress.current * (uploadProgress.total - uploadProgress.current) / 1000).toFixed(1)
                      : '0';
                    return `${t('settings.elapsed')}: ${elapsed}с${uploadProgress.total > uploadProgress.current ? ` | ${t('settings.remaining')}: ~${remaining}с` : ''} | ${percentage}%`;
                  })()}
                </span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
          )}

          {uploadMode === 'folder' && error && (
            <div className="form-error">
              {error}
            </div>
          )}
          </>
          )}

          <div className="form-actions">
            <Button type="button" onClick={handleClose} variant="secondary">
              {t('common.cancel')}
            </Button>
            {uploadMode === 'folder' && (
              <Button 
                type="submit" 
                variant="primary" 
                disabled={!selectedFiles || !language || !projectDescription.trim() || uploading}
              >
                {uploading ? t('settings.uploading') : t('settings.upload')}
              </Button>
            )}
            {uploadMode === 'terminal' && (
              <Button 
                type="button" 
                variant="primary" 
                onClick={handleClose}
              >
                {t('uploadModal.understood')}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadModal;
