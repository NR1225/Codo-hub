import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { MotionProvider } from './contexts/MotionContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SiteConfigProvider, useSiteConfig } from './contexts/SiteConfigContext';
import { ToastProvider } from './contexts/ToastContext';
import { apiService } from './utils/api';
import { websocketService } from './utils/websocket';
import { initializeFirebase, isFirebaseInitialized } from './utils/firebase';
import Header from './components/layout/Header';
import ScrollToTop from './components/layout/ScrollToTop';
import ProtectedRoute from './components/ProtectedRoute';
import { VIEW_PARENT_ROUTES } from './utils/viewPath';
import { hasSeenWelcome, markWelcomeSeen } from './utils/welcome';
import './styles/globals.css';
import './styles/theme.css';
import './styles/light-theme.css';

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
const AdminPage = lazy(() => import('./pages/AdminPage'));
const SharedProjectPage = lazy(() => import('./pages/SharedProjectPage'));
const CliLoginPage = lazy(() => import('./pages/CliLoginPage'));
const GithubCallbackPage = lazy(() => import('./pages/GithubCallbackPage'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));

// Басты бет: кіру жасамаған қолданушы сайтқа алғаш келгенде — бір рет қарсы алу беті
// (/welcome), кейін және кірген қолданушыға — Home
const HomeGate: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  // Шешім бір рет қабылданады — Welcome белгіні қойғаннан кейін қайта есептелмейді
  const [seenWelcome] = useState(hasSeenWelcome);
  useEffect(() => {
    if (isAuthenticated) markWelcomeSeen();
  }, [isAuthenticated]);
  if (isLoading) return <div className="page-skeleton--home" aria-hidden="true" />;
  if (!isAuthenticated && !seenWelcome) return <Navigate to="/welcome" replace />;
  return <Home />;
};

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
  // Кодтар, Чат, Баптаулар және Профиль беттері де басты беттің қара дизайнында
  // Vibecoding сайт тақырыбына ереді: қара тақырыпта — қара, жарықта — ақ
  const isVibePage = pathname === '/vibecoding' || pathname.startsWith('/vibecoding/shared/');
  const isDarkPage = pathname === '/' || pathname === '/welcome' || pathname === '/chat' || pathname.startsWith('/chat/') || pathname.startsWith('/codes') || (isVibePage && document.documentElement.classList.contains('dark-theme')) || pathname.startsWith('/settings') || pathname.startsWith('/profile') || pathname.startsWith('/cli/');
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
  const isAuthPage = location.pathname === '/login' || location.pathname === '/login/code' || location.pathname === '/register';
  // Welcome беті толық экранда — өз навигациясы бар, сайт хедері жасырылады
  const isWelcomePage = location.pathname === '/welcome';
  const hideHeader = isAuthPage || isWelcomePage;
  return (
    <div className="app">
      {!hideHeader && <Header />}
      {!hideHeader ? (
        <main className="app-main">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomeGate />} />
              <Route path="/codes" element={<CodesPage />} />
              <Route path="/codes/list" element={<CodesListPage />} />
              <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
              <Route path="/view/:id" element={<ProtectedRoute><ViewCode /></ProtectedRoute>} />
              {/* Жоба ашылған беттің ішінде қалады: /profile/view/:id, /codes/view/:id т.б. */}
              {VIEW_PARENT_ROUTES.map((parent) => (
                <Route key={parent} path={`${parent}/view/:id`} element={<ProtectedRoute><ViewCode /></ProtectedRoute>} />
              ))}
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
              {/* Әкімші панелі: /admin/monitoring, /admin/users/:id, /admin/projects/:id т.б. */}
              <Route path="/admin/:section?/:itemId?" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
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
              <Route path="/login/code" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/welcome" element={<WelcomePage />} />
            </Routes>
          </Suspense>
        </main>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <MotionProvider>
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
    </MotionProvider>
  );
};

export default App;