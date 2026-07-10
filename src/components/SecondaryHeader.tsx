import './SecondaryHeader.css';

interface SecondaryHeaderProps {
  title: string;
  onBack: () => void;
}

export function SecondaryHeader({ title, onBack }: SecondaryHeaderProps) {
  return (
    <header className="secondary-header">
      <button type="button" className="secondary-header__back" onClick={onBack} aria-label="戻る">
        &lt;
      </button>
      <h1 className="secondary-header__title">{title}</h1>
      <div className="secondary-header__placeholder" aria-hidden="true" />
    </header>
  );
}
