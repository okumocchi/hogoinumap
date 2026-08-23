import './SecondaryHeader.css';

interface SecondaryHeaderProps {
  title: string;
  onBack: () => void;
}

export function SecondaryHeader({ title, onBack }: SecondaryHeaderProps) {
  return (
    <>
      <header className="secondary-header">
        <button type="button" className="secondary-header__back" onClick={onBack} aria-label="戻る">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="secondary-header__title">{title}</h1>
        <div className="secondary-header__placeholder" aria-hidden="true" />
      </header>
      <div className="secondary-header-spacer" aria-hidden="true" />
    </>
  );
}
