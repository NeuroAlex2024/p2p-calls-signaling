import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import MainScreen from './pages/MainScreen.tsx';
import RoomScreen from './pages/RoomScreen.tsx';
import PermissionModal from './components/PermissionModal';
import { useCallStore } from './store/useCallStore';

function AppContent() {
  const showPermissionModal = useCallStore((state) => state.showPermissionModal);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we are inside Telegram and expand the web app
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();

      // Handle startapp parameter for direct room links natively in Telegram (prevent infinite loop)
      const startParam = tg.initDataUnsafe?.start_param;
      const isStartParamConsumed = sessionStorage.getItem('startParamConsumed');
      if (startParam && window.location.pathname === '/' && !isStartParamConsumed) {
        sessionStorage.setItem('startParamConsumed', 'true');
        navigate(`/room/${startParam}`, { replace: true });
      }

      const theme = tg.themeParams;
      const setBgAndText = (bg?: string, text?: string) => {
        if (bg) {
          document.body.style.backgroundColor = bg;
          const rootElem = document.getElementById('root');
          if (rootElem) rootElem.style.backgroundColor = bg;
        }
        if (text) {
          document.body.style.color = text;
          const rootElem = document.getElementById('root');
          if (rootElem) rootElem.style.color = text;
        }
      };

      setBgAndText(theme.bg_color, theme.text_color);

      try {
        tg.setHeaderColor('bg_color');
        tg.setBackgroundColor('bg_color');
      } catch (e) {
        console.log('Failed to set header/bg colors natively', e);
      }
    }
  }, [navigate]);

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/room/:id" element={<RoomScreen />} />
      </Routes>
      <PermissionModal isOpen={showPermissionModal} />
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
