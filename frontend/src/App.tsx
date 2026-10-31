import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SiteConfigProvider, useSiteConfig } from './contexts/SiteConfigContext';
import { ToastProvider } from './contexts/ToastContext';
import { apiService } from './utils/api';
import { websocketService } from './utils/websocket';
import { initializeFirebase, isFirebaseInitialized } from './utils/firebase';
import Header from './components/layout/Header';
import ScrollToTop from './components/layout/ScrollToTop';
import ProtectedRoute from './components/ProtectedRoute';
import './styles/globals.css';
import './styles/theme.css';

// Lazy load pages for better performance
const Home = lazy(() => import('./pages/Home'));
const Upload = lazy(() => import('./pages/Upload'));
const CodesPage = lazy(() => import('./pages/CodesPage'));
const CodesListPage = lazy(() => import('./pages/CodesListPage'));
const ViewCode = lazy(() => import('./pages/ViewCode'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'));
const VibecodingPage = lazy(() => import('./pages/VibecodingPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const ModerationPage = lazy(() => import('./pages/ModerationPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const SharedProjectPage = lazy(() => import('./pages/SharedProjectPage'));
const CliLoginPage = lazy(() => import('./pages/CliLoginPage'));
const GithubCallbackPage = lazy(() => import('./pages/GithubCallbackPage'));

// Bridge: connect AuthContext token to apiService
const AuthBridge: React.FC = () => {
  const { getAccessToken } = useAuth();
  useEffect(() => {
    apiService.setTokenGetter(getAccessToken);
    websocketService.setTokenGetter(getAccessToken);
  }, [getAccessToken]);
  return null;
};

// Bridge: initialize Firebase when SiteConfig becomes available
const FirebaseBridge: React.FC = () => {
  const { config } = useSiteConfig();
  useEffect(() => {
    if (config?.firebaseConfig && !isFirebaseInitialized()) {
      initializeFirebase(config.firebaseConfig);
    }
  }, [config?.firebaseConfig]);
  return null;
};

// Loading component — беттің қаңқасын (skeleton) көрсетіп, толық spinner
// флешын азайтады; беттің ашылып жатқанын бірден көрсетеді.
const PageLoader: React.FC = () => {
  const { pathname } = useLocation();
  // Басты бет қара фонда — жүктелу кезінде де қара болсын, әйтпесе сұр қаңқа
  // түсті body фонында жыпылықтап, содан кейін қара бетке ауысады
  // Кодтар, Чат, Vibecoding, Баптаулар және Профиль беттері де басты беттің қара дизайнында
  const isDarkPage = pathname === '/' || pathname === '/chat' || pathname.startsWith('/chat/') || pathname.startsWith('/codes') || pathname === '/vibecoding' || pathname.startsWith('/vibecoding/shared/') || pathname.startsWith('/settings') || pathname.startsWith('/profile') || pathname.startsWith('/cli/');
  if (isDarkPage) return <div className="page-skeleton--home" aria-hidden="true" />;
  return (
    <div className="page-skeleton" aria-hidden="true">
      <div className="page-skeleton-bar page-skeleton-bar--lg" />
      <div className="page-skeleton-bar page-skeleton-bar--md" />
      <div className="page-skeleton-grid">
        <div className="page-skeleton-card" />
        <div className="page-skeleton-card" />
        <div className="page-skeleton-card" />
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  
  // Hide header and sidebar on auth pages (login, register)
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  return (
    <div className="app">
      {!isAuthPage && <Header />}
      {!isAuthPage ? (
        <main className="app-main">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/codes" element={<CodesPage />} />
              <Route path="/codes/list" element={<CodesListPage />} />
              <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
              <Route path="/view/:id" element={<ProtectedRoute><ViewCode /></ProtectedRoute>} />
              <Route path="/profile/:username?" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/settings/:tab?" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/settings/:tab/:doc" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/chat/*" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              {/* Ақпарат беттері «Баптаулар → Біз жайлы» ішіне көшті */}
              <Route path="/about" element={<Navigate to="/settings/info/about" replace />} />
              <Route path="/features" element={<ProtectedRoute><FeaturesPage /></ProtectedRoute>} />
              <Route path="/terms" element={<Navigate to="/settings/info/terms" replace />} />
              <Route path="/privacy" element={<Navigate to="/settings/info/privacy" replace />} />
              <Route path="/contact" element={<Navigate to="/settings/info/contact" replace />} />
              <Route path="/vibecoding" element={<ProtectedRoute><VibecodingPage /></ProtectedRoute>} />
              <Route path="/vibecoding/shared/:token" element={<ProtectedRoute><SharedProjectPage /></ProtectedRoute>} />
              <Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
              <Route path="/moderation" element={<ProtectedRoute><ModerationPage /></ProtectedRoute>} />
              <Route path="/admin/monitoring" element={<ProtectedRoute><MonitoringPage /></ProtectedRoute>} />
              <Route path="/cli/login" element={<ProtectedRoute><CliLoginPage /></ProtectedRoute>} />
              <Route path="/github/callback" element={<ProtectedRoute><GithubCallbackPage /></ProtectedRoute>} />
              <Route path="*" element={
                <ProtectedRoute>
                  <div style={{ padding: '2rem', textAlign: 'center' }}>
                    <h1>{t('viewCode.404')}</h1>
                    <p>{t('viewCode.pageNotFound')}</p>
                  </div>
                </ProtectedRoute>
              } />
            </Routes>
          </Suspense>
        </main>
      ) : (
        <main className="app-main-auth">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Routes>
          </Suspense>
        </main>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SiteConfigProvider>
          <ToastProvider>
            <Router>
              <AuthBridge />
              <FirebaseBridge />
              <ScrollToTop />
              <AppContent />
            </Router>
          </ToastProvider>
        </SiteConfigProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;