import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faHeart, faComment, faEye, faChevronDown, faChevronUp, faFolder, faFile } from '@fortawesome/free-solid-svg-icons';
import { CodeFile } from '../utils/api';
import './CodeCard.css';

interface CodeCardProps {
  code: CodeFile;
  viewMode?: 'grid' | 'list';
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const CodeCard: React.FC<CodeCardProps> = ({ code, viewMode = 'grid', isSelected = false, onToggleSelect }) => {
  const { t } = useTranslation();
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const cardWrapperRef = useRef<HTMLDivElement>(null);

  const truncateContent = (content: string, maxLength: number = 150): string => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Check if content is JSON structure (folder structure data)
  const isJsonStructure = (content: string): boolean => {
    if (!content) return false;
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' && 'structure' in parsed;
    } catch {
      // If content starts with JSON-like structure indicators, hide it
      return content.trim().startsWith('{') && content.includes('"structure"');
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleSelect?.();
  };

  const handleToggleDescription = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const willExpand = !isDescriptionExpanded;
    setIsDescriptionExpanded(willExpand);

    // Scroll into view when expanding - scroll card to top of scrollable container
    if (willExpand) {
      // Find the scrollable parent container
      const findScrollableParent = (element: HTMLElement | null): HTMLElement | null => {
        if (!element) return null;
        let parent = element.parentElement;

        while (parent) {
          const style = window.getComputedStyle(parent);
          const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const hasMaxHeight = style.maxHeight && style.maxHeight !== 'none';

          if (hasOverflow && hasMaxHeight) {
            return parent;
          }

          parent = parent.parentElement;
        }

        return null;
      };

      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (cardWrapperRef.current) {
            const scrollableParent = findScrollableParent(cardWrapperRef.current);

            if (scrollableParent) {
              // Get current positions
              const cardRect = cardWrapperRef.current.getBoundingClientRect();
              const parentRect = scrollableParent.getBoundingClientRect();
              const currentScrollTop = scrollableParent.scrollTop;

              // Calculate the card's position relative to the scrollable parent's content
              const cardTopInParent = cardRect.top - parentRect.top + currentScrollTop;

              // Scroll to position card at the top of the visible area
              scrollableParent.scrollTo({
                top: cardTopInParent,
                behavior: 'smooth'
              });
            } else {
              // Fallback to scrollIntoView if no scrollable parent found
              cardWrapperRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
                inline: 'nearest'
              });
            }
          }
        }, 150);
      });
    }
  };

  const fullDescriptionText = code.description
    ? code.description
    : !code.isFolder && !isJsonStructure(code.content)
      ? code.content
      : null;

  const truncatedDescriptionText = fullDescriptionText
    ? truncateContent(fullDescriptionText, 100)
    : null;

  const descriptionText = isDescriptionExpanded
    ? fullDescriptionText
    : truncatedDescriptionText;

  const shouldShowToggleButton = fullDescriptionText && fullDescriptionText.length > 100;

  // Folder counts
  const { fileCount, folderCount } = React.useMemo(() => {
    if (!code.isFolder || !code.folderStructure) return { fileCount: 0, folderCount: 0 };
    const keys = Object.keys(code.folderStructure);
    return {
      fileCount: keys.filter(key => code.folderStructure![key].type === 'file').length,
      folderCount: keys.filter(key => code.folderStructure![key].type === 'folder').length,
    };
  }, [code]);

  const getPlural = (count: number, singular: string, plural: string) =>
    count === 1 ? singular : plural;

  return (
    <div
      ref={cardWrapperRef}
      className={`code-card-wrapper ${viewMode === 'list' ? 'list-mode' : ''} ${isSelected ? 'selected' : ''}`}
    >
      <Link
        to={`/view/${code.id}`}
        className={`code-card ${viewMode === 'list' ? 'list-mode' : ''}`}
        onClick={(e) => {
          // If clicking on checkbox or toggle button, prevent navigation
          if ((e.target as HTMLElement).closest('.code-card-checkbox') ||
              (e.target as HTMLElement).closest('.code-card-description-toggle')) {
            e.preventDefault();
          }
        }}
      >
        {/* Header row: title, author, stats */}
        <div className="code-card-header">
          <h3 className="code-card-title">
            {code.isFolder ? code.title : (code.title || (code.language || 'other').toLowerCase())}
          </h3>

          <div className="code-card-author-pill">
            <FontAwesomeIcon icon={faUser} />
            <span>{code.author.toUpperCase()}</span>
          </div>

          <div className="code-card-stats">
            <span className="code-card-stat code-card-stat--likes">
              <FontAwesomeIcon icon={faHeart} /> {code.likes?.length || 0}
            </span>
            <span className="code-card-stat code-card-stat--comments">
              <FontAwesomeIcon icon={faComment} /> {code.comments?.length || 0}
            </span>
            <span className="code-card-stat code-card-stat--views">
              <FontAwesomeIcon icon={faEye} /> {code.views || 0}
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="code-card-description-row">
          <p
            ref={descriptionRef}
            className={`code-card-description ${isDescriptionExpanded ? 'expanded' : ''}`}
          >
            {descriptionText ? (
              descriptionText
            ) : (
              <span className="code-card-description-placeholder">
                {code.isFolder ? t('codeCard.folderInfo') : t('codeCard.noDescription')}
              </span>
            )}
          </p>
          {shouldShowToggleButton && (
            <button
              className="code-card-description-toggle"
              onClick={handleToggleDescription}
              type="button"
            >
              <FontAwesomeIcon icon={isDescriptionExpanded ? faChevronUp : faChevronDown} />
            </button>
          )}
        </div>

        {/* Footer row: folder info or language tag */}
        <div className="code-card-footer-row">
          {!code.isFolder && code.language && (
            <span className="code-card-language-tag">
              {code.language.toLowerCase()}
            </span>
          )}

          {code.isFolder && (
            <div className="code-card-folder-meta">
              {fileCount > 0 && (
                <span className="code-card-folder-stat">
                  <FontAwesomeIcon icon={faFile} />
                  {fileCount} {getPlural(fileCount, t('viewCode.file'), t('viewCode.filesPlural'))}
                </span>
              )}
              {folderCount > 0 && (
                <span className="code-card-folder-stat">
                  <FontAwesomeIcon icon={faFolder} />
                  {folderCount} {getPlural(folderCount, t('viewCode.folder'), t('viewCode.foldersPlural'))}
                </span>
              )}
            </div>
          )}

          {/* Checkbox for files */}
          {onToggleSelect && !code.isFolder && (
            <div className="code-card-checkbox" onClick={handleCheckboxClick}>
              <input
                type="checkbox"
                id={`checkbox-${code.id}`}
                checked={isSelected}
                onChange={() => {}}
                onClick={handleCheckboxClick}
                readOnly
              />
              <label htmlFor={`checkbox-${code.id}`} className="checkbox-label">
                {isSelected && <span className="checkbox-checkmark">✓</span>}
              </label>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
};

export default CodeCard;
