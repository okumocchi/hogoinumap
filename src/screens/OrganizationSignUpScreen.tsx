import { autoSignIn, confirmSignUp, getCurrentUser, resendSignUpCode, signUp } from 'aws-amplify/auth';
import { type FormEvent, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { translateAuthError } from '../utils/authErrors';
import { geocodeAddress } from '../utils/geocode';
import { PREFECTURES } from '../utils/prefectures';
import './OrganizationSignUpScreen.css';

interface OrganizationSignUpScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

type Step = 'form' | 'confirm' | 'done';

interface FormState {
  email: string;
  password: string;
  passwordConfirm: string;
  name: string;
  prefecture: string;
  city: string;
  addressLine: string;
  contactEmail: string;
  contactPhone: string;
  wishlistUrl: string;
}

const INITIAL_FORM: FormState = {
  email: '',
  password: '',
  passwordConfirm: '',
  name: '',
  prefecture: PREFECTURES[0],
  city: '',
  addressLine: '',
  contactEmail: '',
  contactPhone: '',
  wishlistUrl: '',
};

export function OrganizationSignUpScreen({ onBack, onComplete }: OrganizationSignUpScreenProps) {
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function completeRegistration() {
    // 地図表示用に、番地まで含めた実際の所在地の緯度経度を求めておく
    const geocoded = await geocodeAddress(form.prefecture, form.city, form.addressLine);

    // ボランティアが所属申請(Affiliation)を作成する際にowners配列を組み立てられるよう、
    // owner認可の内部フィールドと同じ形式(sub::username)の値を明示的なフィールドとして保存する
    const { userId, username } = await getCurrentUser();

    const organizationInput = {
      name: form.name,
      prefecture: form.prefecture,
      city: form.city,
      addressLine: form.addressLine,
      latitude: geocoded?.latitude,
      longitude: geocoded?.longitude,
      contactEmail: form.contactEmail || undefined,
      contactPhone: form.contactPhone || undefined,
      wishlistUrl: form.wishlistUrl || undefined,
      ownerSub: `${userId}::${username}`,
    };
    // @aws-amplify/data-schema(1.26.0)には、必須のstringフィールドがcreate()の
    // 引数型でstring[]に誤推論されるバグがある(aws-amplify/amplify-js#13523と同種)。
    // 実行時の動作には影響しないため、この呼び出しのみ型チェックを回避する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await dataClient.models.Organization.create(organizationInput as any);

    if (result.errors?.length) {
      throw new Error(result.errors.map((e) => e.message).join(' / '));
    }

    setStep('done');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.password !== form.passwordConfirm) {
      setError('パスワードが一致しません。');
      return;
    }
    if (!form.name || !form.prefecture || !form.city || !form.addressLine) {
      setError('団体名・都道府県・市区町村・番地以降の住所は必須です。');
      return;
    }

    setSubmitting(true);
    try {
      const { nextStep } = await signUp({
        username: form.email,
        password: form.password,
        options: {
          userAttributes: { email: form.email },
          autoSignIn: true,
        },
      });

      if (nextStep.signUpStep === 'DONE') {
        await completeRegistration();
      } else {
        setStep('confirm');
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { nextStep } = await confirmSignUp({ username: form.email, confirmationCode: code });
      if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        await autoSignIn();
      }
      await completeRegistration();
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResendMessage(null);
    try {
      await resendSignUpCode({ username: form.email });
      setResendMessage('確認コードを再送信しました。');
    } catch (err) {
      setError(translateAuthError(err));
    }
  }

  if (step === 'done') {
    return (
      <div className="org-signup">
        <div className="org-signup__body org-signup__done">
          <h1>登録が完了しました</h1>
          <p>「{form.name}」の団体アカウントを作成しました。地図に保護犬を登録できるようになります。</p>
          <button type="button" className="org-signup__primary-button" onClick={onComplete}>
            地図に戻る
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="org-signup">
        <header className="org-signup__topbar">
          <button type="button" className="org-signup__back" onClick={() => setStep('form')}>
            ← 入力内容を修正する
          </button>
        </header>
        <div className="org-signup__body">
          <h1>メールアドレスの確認</h1>
          <p className="org-signup__lead">{form.email} 宛に確認コードを送信しました。メールに記載のコードを入力してください。</p>
          <form className="org-signup__form" onSubmit={handleConfirm}>
            <label className="org-signup__field">
              <span>確認コード</span>
              <input
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {error && <p className="org-signup__error">{error}</p>}
            {resendMessage && <p className="org-signup__notice">{resendMessage}</p>}
            <button type="submit" className="org-signup__primary-button" disabled={submitting}>
              {submitting ? '確認中…' : '確認して登録を完了する'}
            </button>
            <button type="button" className="org-signup__link-button" onClick={handleResend}>
              確認コードを再送信する
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="org-signup">
      <header className="org-signup__topbar">
        <button type="button" className="org-signup__back" onClick={onBack}>
          &lt;
        </button>
      </header>
      <div className="org-signup__body">
        <h1>保護団体として登録</h1>
        <p className="org-signup__lead">保護犬の情報登録や預かりボランティアの募集に、団体アカウントが必要です。</p>
        <form className="org-signup__form" onSubmit={handleSubmit}>
          <h2>アカウント情報</h2>
          <label className="org-signup__field">
            <span>メールアドレス</span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
          </label>
          <label className="org-signup__field">
            <span>パスワード</span>
            <input
              type="password"
              required
              minLength={15}
              value={form.password}
              onChange={(e) => updateField('password', e.target.value)}
            />
            <small>15文字以上で入力してください(大文字・小文字・数字・記号の組み合わせは不要です)</small>
          </label>
          <label className="org-signup__field">
            <span>パスワード(確認)</span>
            <input
              type="password"
              required
              value={form.passwordConfirm}
              onChange={(e) => updateField('passwordConfirm', e.target.value)}
            />
          </label>

          <h2>団体情報</h2>
          <label className="org-signup__field">
            <span>団体名</span>
            <input type="text" required value={form.name} onChange={(e) => updateField('name', e.target.value)} />
          </label>
          <div className="org-signup__row">
            <label className="org-signup__field">
              <span>都道府県</span>
              <select value={form.prefecture} onChange={(e) => updateField('prefecture', e.target.value)}>
                {PREFECTURES.map((pref) => (
                  <option key={pref} value={pref}>
                    {pref}
                  </option>
                ))}
              </select>
            </label>
            <label className="org-signup__field">
              <span>市区町村</span>
              <input type="text" required value={form.city} onChange={(e) => updateField('city', e.target.value)} />
            </label>
          </div>
          <label className="org-signup__field">
            <span>番地・建物名など</span>
            <input
              type="text"
              required
              placeholder="例: 1-2-3 ○○ビル4F"
              value={form.addressLine}
              onChange={(e) => updateField('addressLine', e.target.value)}
            />
          </label>
          <label className="org-signup__field">
            <span>連絡先メールアドレス(任意)</span>
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => updateField('contactEmail', e.target.value)}
            />
          </label>
          <label className="org-signup__field">
            <span>連絡先電話番号(任意)</span>
            <input
              type="tel"
              value={form.contactPhone}
              onChange={(e) => updateField('contactPhone', e.target.value)}
            />
          </label>
          <label className="org-signup__field">
            <span>ほしいものリストURL(任意)</span>
            <input
              type="url"
              value={form.wishlistUrl}
              onChange={(e) => updateField('wishlistUrl', e.target.value)}
            />
          </label>

          {error && <p className="org-signup__error">{error}</p>}

          <button type="submit" className="org-signup__primary-button" disabled={submitting}>
            {submitting ? '登録中…' : '登録する'}
          </button>
        </form>
      </div>
    </div>
  );
}
