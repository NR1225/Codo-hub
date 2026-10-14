import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    host: true,
    open: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          'ui-vendor': ['@fortawesome/react-fontawesome', '@fortawesome/fontawesome-svg-core'],
          // Ауыр кітапханаларды бөлек chunk-қа шығару — бет chunk-тары жеңілдеу,
          // браузер кэші бөлек сақталады (бір рет жүктелгенде қайта жүктелмейді).
          'xterm-vendor': ['@xterm/xterm', '@xterm/addon-fit'],
          'editor-vendor': ['@monaco-editor/react'],
          'zip-vendor': ['jszip'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
    ],
  },
})

