import { useEffect, useRef, useState } from 'react';
import logoImg from '../assets/logo.png';
import {
  getNotificationPermission,
  isWebNotificationEnabled,
  requestNotificationPermission,
  setWebNotificationEnabled,
} from '../utils/webNotification';
import './AppHeader.css';

export type BrowseView = 'map' | 'list';

interface AppHeaderProps {
  onOpenList: () => void;
  onOpenGallery: () => void;
  currentUserEmail: string | null | undefined;
  onLogin: () => void;
  onLogout: () => void;
  showDashboardButton?: boolean;
  onOpenDashboard?: () => void;
  dashboardBadgeCount?: number;
}

export function AppHeader({
  onOpenList,
  onOpenGallery,
  currentUserEmail,
  onLogin,
  onLogout,
  showDashboardButton,
  onOpenDashboard,
  dashboardBadgeCount,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPermission(getNotificationPermission());
    setNotificationEnabled(isWebNotificationEnabled());
  }, []);

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

  const handleRequestPermission = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    setNotificationEnabled(isWebNotificationEnabled());
  };

  const handleToggleNotification = () => {
    const next = !notificationEnabled;
    setWebNotificationEnabled(next);
    setNotificationEnabled(next);
  };

  return (
    <header className="app-header">
      <h1 className="app-header__title">
        <img src={logoImg} alt="保護犬マップ" className="app-header__logo" />
      </h1>
      <nav className="app-header__tabs">
        <button
          type="button"
          className="app-header__tab"
          onClick={onOpenList}
        >
          保護犬一覧
        </button>
        <button
          type="button"
          className="app-header__tab"
          onClick={onOpenGallery}
        >
          ギャラリー
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 50 50"
                className="app-header__dashboard-icon"
                fill="currentColor"
              >
                <path d="M47.16,21.221l-5.91-0.966c-0.346-1.186-0.819-2.326-1.411-3.405l3.45-4.917c0.279-0.397,0.231-0.938-0.112-1.282 l-3.889-3.887c-0.347-0.346-0.893-0.391-1.291-0.104l-4.843,3.481c-1.089-0.602-2.239-1.08-3.432-1.427l-1.031-5.886 C28.607,2.35,28.192,2,27.706,2h-5.5c-0.49,0-0.908,0.355-0.987,0.839l-0.956,5.854c-1.2,0.345-2.352,0.818-3.437,1.412l-4.83-3.45 c-0.399-0.285-0.942-0.239-1.289,0.106L6.82,10.648c-0.343,0.343-0.391,0.883-0.112,1.28l3.399,4.863 c-0.605,1.095-1.087,2.254-1.438,3.46l-5.831,0.971c-0.482,0.08-0.836,0.498-0.836,0.986v5.5c0,0.485,0.348,0.9,0.825,0.985 l5.831,1.034c0.349,1.203,0.831,2.362,1.438,3.46l-3.441,4.813c-0.284,0.397-0.239,0.942,0.106,1.289l3.888,3.891 c0.343,0.343,0.884,0.391,1.281,0.112l4.87-3.411c1.093,0.601,2.248,1.078,3.445,1.424l0.976,5.861C21.3,47.647,21.717,48,22.206,48 h5.5c0.485,0,0.9-0.348,0.984-0.825l1.045-5.89c1.199-0.353,2.348-0.833,3.43-1.435l4.905,3.441 c0.398,0.281,0.938,0.232,1.282-0.111l3.888-3.891c0.346-0.347,0.391-0.894,0.104-1.292l-3.498-4.857 c0.593-1.08,1.064-2.222,1.407-3.408l5.918-1.039c0.479-0.084,0.827-0.5,0.827-0.985v-5.5C47.999,21.718,47.644,21.3,47.16,21.221z M25,32c-3.866,0-7-3.134-7-7c0-3.866,3.134-7,7-7s7,3.134,7,7C32,28.866,28.866,32,25,32z" />
              </svg>
              {!!dashboardBadgeCount && (
                <span className="app-header__dashboard-badge">{dashboardBadgeCount}</span>
              )}
            </button>
          )}
          <button
            type="button"
            className="app-header__menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="メニュー"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 50 50"
              className="app-header__menu-icon"
              fill="currentColor"
            >
              <path d="M 5 8 A 2.0002 2.0002 0 1 0 5 12 L 45 12 A 2.0002 2.0002 0 1 0 45 8 L 5 8 z M 5 23 A 2.0002 2.0002 0 1 0 5 27 L 45 27 A 2.0002 2.0002 0 1 0 45 23 L 5 23 z M 5 38 A 2.0002 2.0002 0 1 0 5 42 L 45 42 A 2.0002 2.0002 0 1 0 45 38 L 5 38 z" />
            </svg>
          </button>
          {menuOpen && (
            <div className="app-header__dropdown-menu">
              <div className="app-header__dropdown-email">{currentUserEmail}</div>
              <div className="app-header__dropdown-section">
                {permission === 'unsupported' ? (
                  <div className="app-header__dropdown-text">WEB通知: 非対応ブラウザ</div>
                ) : permission === 'denied' ? (
                  <div className="app-header__dropdown-text app-header__dropdown-text--warning">
                    WEB通知: ブラウザで拒否中
                  </div>
                ) : permission === 'default' ? (
                  <button
                    type="button"
                    className="app-header__dropdown-item app-header__dropdown-item--action"
                    onClick={handleRequestPermission}
                  >
                    <span>WEB通知を有効化</span>
                    <span className="app-header__notification-badge">許可</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="app-header__dropdown-item"
                    onClick={handleToggleNotification}
                  >
                    <span>WEB通知</span>
                    <span className={`app-header__toggle-status ${notificationEnabled ? 'is-enabled' : ''}`}>
                      {notificationEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )}
              </div>
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
        </div>
      )}
    </header>
  );
}
