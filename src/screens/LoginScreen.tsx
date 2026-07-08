import { confirmResetPassword, confirmSignUp, resendSignUpCode, resetPassword, signIn } from 'aws-amplify/auth';
import { type FormEvent, useState } from 'react';
import { translateAuthError } from '../utils/authErrors';
import './LoginScreen.css';

interface LoginScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

type Step = 'login' | 'confirm-signup' | 'reset-request' | 'reset-confirm' | 'reset-done';

export function LoginScreen({ onBack, onComplete }: LoginScreenProps) {
  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { nextStep } = await signIn({ username: email, password });
      if (nextStep.signInStep === 'DONE') {
        onComplete();
      } else if (nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        await resendSignUpCode({ username: email });
        setNotice('メールアドレスの確認が完了していません。確認コードを送信しました。');
        setStep('confirm-signup');
      } else if (nextStep.signInStep === 'RESET_PASSWORD') {
        await resetPassword({ username: email });
        setNotice('パスワードの再設定が必要です。確認コードを送信しました。');
        setStep('reset-confirm');
      } else {
        setError('このアカウントではサポートされていないログイン方法が必要です。');
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSignUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      const { nextStep } = await signIn({ username: email, password });
      if (nextStep.signInStep === 'DONE') {
        onComplete();
      } else {
        setStep('login');
        setNotice('確認が完了しました。もう一度ログインしてください。');
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestReset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ username: email });
      setNotice(`${email} 宛に確認コードを送信しました。`);
      setStep('reset-confirm');
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReset(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== newPasswordConfirm) {
      setError('パスワードが一致しません。');
      return;
    }

    setSubmitting(true);
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setStep('reset-done');
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'reset-done') {
    return (
      <div className="login-screen">
        <div className="login-screen__body login-screen__done">
          <h1>パスワードを再設定しました</h1>
          <p>新しいパスワードでログインしてください。</p>
          <button
            type="button"
            className="login-screen__primary-button"
            onClick={() => {
              setPassword('');
              setCode('');
              setNewPassword('');
              setNewPasswordConfirm('');
              setNotice(null);
              setStep('login');
            }}
          >
            ログイン画面に戻る
          </button>
        </div>
      </div>
    );
  }

  if (step === 'reset-confirm') {
    return (
      <div className="login-screen">
        <header className="login-screen__topbar">
          <button type="button" className="login-screen__back" onClick={() => setStep('login')}>
            ← ログインに戻る
          </button>
        </header>
        <div className="login-screen__body">
          <h1>パスワードの再設定</h1>
          <p className="login-screen__lead">{email} 宛に送信された確認コードと、新しいパスワードを入力してください。</p>
          <form className="login-screen__form" onSubmit={handleConfirmReset}>
            <label className="login-screen__field">
              <span>確認コード</span>
              <input type="text" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="login-screen__field">
              <span>新しいパスワード</span>
              <input
                type="password"
                required
                minLength={15}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <small>15文字以上で入力してください(大文字・小文字・数字・記号の組み合わせは不要です)</small>
            </label>
            <label className="login-screen__field">
              <span>新しいパスワード(確認)</span>
              <input
                type="password"
                required
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
              />
            </label>
            {error && <p className="login-screen__error">{error}</p>}
            <button type="submit" className="login-screen__primary-button" disabled={submitting}>
              {submitting ? '設定中…' : 'パスワードを再設定する'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'reset-request') {
    return (
      <div className="login-screen">
        <header className="login-screen__topbar">
          <button type="button" className="login-screen__back" onClick={() => setStep('login')}>
            ← ログインに戻る
          </button>
        </header>
        <div className="login-screen__body">
          <h1>パスワードをお忘れの方</h1>
          <p className="login-screen__lead">登録済みのメールアドレスに確認コードを送信します。</p>
          <form className="login-screen__form" onSubmit={handleRequestReset}>
            <label className="login-screen__field">
              <span>メールアドレス</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <p className="login-screen__error">{error}</p>}
            <button type="submit" className="login-screen__primary-button" disabled={submitting}>
              {submitting ? '送信中…' : '確認コードを送信する'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'confirm-signup') {
    return (
      <div className="login-screen">
        <header className="login-screen__topbar">
          <button type="button" className="login-screen__back" onClick={() => setStep('login')}>
            ← ログインに戻る
          </button>
        </header>
        <div className="login-screen__body">
          <h1>メールアドレスの確認</h1>
          <p className="login-screen__lead">{email} 宛に確認コードを送信しました。メールに記載のコードを入力してください。</p>
          <form className="login-screen__form" onSubmit={handleConfirmSignUp}>
            <label className="login-screen__field">
              <span>確認コード</span>
              <input type="text" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            {error && <p className="login-screen__error">{error}</p>}
            <button type="submit" className="login-screen__primary-button" disabled={submitting}>
              {submitting ? '確認中…' : '確認してログインする'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <header className="login-screen__topbar">
        <button type="button" className="login-screen__back" onClick={onBack}>
          &lt;
        </button>
      </header>
      <div className="login-screen__body">
        <h1>ログイン</h1>
        <p className="login-screen__lead">保護団体・預かりボランティア共通のログインです。</p>
        <form className="login-screen__form" onSubmit={handleLogin}>
          <label className="login-screen__field">
            <span>メールアドレス</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="login-screen__field">
            <span>パスワード</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          {error && <p className="login-screen__error">{error}</p>}
          {notice && <p className="login-screen__notice">{notice}</p>}

          <button type="submit" className="login-screen__primary-button" disabled={submitting}>
            {submitting ? 'ログイン中…' : 'ログイン'}
          </button>
          <button type="button" className="login-screen__link-button" onClick={() => setStep('reset-request')}>
            パスワードをお忘れですか？
          </button>
        </form>
      </div>
    </div>
  );
}
