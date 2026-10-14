import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy } from '@fortawesome/free-solid-svg-icons';
// PrismLight: тек қажет тілдер тіркеледі — барлық тілдерді (~900KB) bundle етпейді.
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import './CodeEditor.css';

// Қажет тілдерді бір рет тіркейді
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c', c);
// html үшін Prism 'markup' тілін қолданады — 'html' атауымен де тіркеу
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);

interface CodeEditorProps {
  code: string;
  language: string;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  lineNumbers?: boolean;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  language,
  readOnly = false,
  onChange,
  lineNumbers = true,
}) => {
  const { t } = useTranslation();
  const [content, setContent] = useState(code);

  useEffect(() => {
    setContent(code);
  }, [code]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    onChange?.(newContent);
  };

  const getLanguageId = (lang: string): string => {
    const langMap: Record<string, string> = {
      javascript: 'javascript',
      typescript: 'typescript',
      python: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      html: 'html',
      css: 'css',
      json: 'json',
      markdown: 'markdown',
    };
    return langMap[lang.toLowerCase()] || 'plaintext';
  };

  if (readOnly) {
    return (
      <div className="code-editor read-only">
        <div className="code-editor-content">
        <SyntaxHighlighter
          language={getLanguageId(language)}
          style={vscDarkPlus}
          showLineNumbers={lineNumbers}
          customStyle={{
            margin: 0,
            borderRadius: '8px',
            padding: '1.5rem',
            fontSize: '0.9rem',
            lineHeight: '1.6',
            overflowX: 'auto',
            overflowY: 'visible',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          {content}
        </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  return (
    <div className="code-editor">
      <div className="code-editor-header">
        <span className="code-editor-language">{language}</span>
        <button
          className="code-editor-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(content);
            } catch (err) {
              console.error('Failed to copy:', err);
            }
          }}
        >
          <FontAwesomeIcon icon={faCopy} /> {t('codeEditor.copy')}
        </button>
      </div>
      <textarea
        className="code-editor-textarea"
        value={content}
        onChange={handleChange}
        spellCheck={false}
        placeholder={t('codeEditor.enterCode')}
      />
    </div>
  );
};

export default CodeEditor;