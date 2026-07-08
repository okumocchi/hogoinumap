import { useEffect, useRef, useState } from 'react';
import './AppHeader.css';

export type BrowseView = 'map' | 'list';

interface AppHeaderProps {
  activeView: BrowseView;
  onChangeView: (view: BrowseView) => void;
  onSignUp: () => void;
  currentUserEmail: string | null | undefined;
  onLogin: () => void;
  onLogout: () => void;
  showDashboardButton?: boolean;
  onOpenDashboard?: () => void;
  dashboardBadgeCount?: number;
}

export function AppHeader({
  activeView,
  onChangeView,
  onSignUp,
  currentUserEmail,
  onLogin,
  onLogout,
  showDashboardButton,
  onOpenDashboard,
  dashboardBadgeCount,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className="app-header">
      <h1 className="app-header__title">保護犬マップβ</h1>
      <nav className="app-header__tabs">
        <button
          type="button"
          className={`app-header__tab ${activeView === 'map' ? 'is-active' : ''}`}
          onClick={() => onChangeView('map')}
        >
          地図
        </button>
        <button
          type="button"
          className={`app-header__tab ${activeView === 'list' ? 'is-active' : ''}`}
          onClick={() => onChangeView('list')}
        >
          一覧
        </button>
      </nav>

      {currentUserEmail ? (
        <div className="app-header__account" ref={menuRef}>
          {showDashboardButton && (
            <button
              type="button"
              className="app-header__dashboard-icon-button"
              onClick={onOpenDashboard}
              aria-label="ダッシュボード"
            >
              ⚙️
              {!!dashboardBadgeCount && (
                <span className="app-header__dashboard-badge">{dashboardBadgeCount}</span>
              )}
            </button>
          )}
          <button
            type="button"
            className="app-header__menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰
          </button>
          {menuOpen && (
            <div className="app-header__dropdown-menu">
              <div className="app-header__dropdown-email">{currentUserEmail}</div>
              <button
                type="button"
                className="app-header__dropdown-item app-header__dropdown-item--logout"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="app-header__account">
          <button type="button" className="app-header__account-button" onClick={onLogin}>
            ログイン
          </button>
          <button type="button" className="app-header__signup-button" onClick={onSignUp}>
            新規登録
          </button>
        </div>
      )}
    </header>
  );
}
