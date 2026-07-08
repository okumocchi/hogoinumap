import './SignUpChoiceScreen.css';

interface SignUpChoiceScreenProps {
  onBack: () => void;
  onSelectOrganization: () => void;
  onSelectVolunteer: () => void;
}

export function SignUpChoiceScreen({ onBack, onSelectOrganization, onSelectVolunteer }: SignUpChoiceScreenProps) {
  return (
    <div className="signup-choice">
      <header className="signup-choice__topbar">
        <button type="button" className="signup-choice__back" onClick={onBack}>
          &lt;
        </button>
      </header>
      <div className="signup-choice__body">
        <h1>新規登録</h1>
        <p className="signup-choice__lead">登録する種別を選んでください。</p>

        <button type="button" className="signup-choice__card" onClick={onSelectOrganization}>
          <span className="signup-choice__card-title">保護団体として登録</span>
          <span className="signup-choice__card-desc">保護犬の情報登録や、預かりボランティアの募集ができます。</span>
        </button>

        <button type="button" className="signup-choice__card" onClick={onSelectVolunteer}>
          <span className="signup-choice__card-title">預かりボランティアとして登録</span>
          <span className="signup-choice__card-desc">預かりスロットの登録や、団体への所属申請ができます。</span>
        </button>
      </div>
    </div>
  );
}
