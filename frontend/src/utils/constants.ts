export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api';

// File type labels for display purposes only
export const FILE_TYPES = {
  JAVASCRIPT: 'javascript',
  TYPESCRIPT: 'typescript',
  PYTHON: 'python',
  JAVA: 'java',
  CPP: 'cpp',
  C: 'c',
  HTML: 'html',
  CSS: 'css',
  JSON: 'json',
  MARKDOWN: 'markdown',
  OTHER: 'other',
} as const;

// Supported extensions for display/upload filtering
export const SUPPORTED_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h',
  '.html', '.css', '.json', '.md', '.xml', '.yaml', '.yml'
];