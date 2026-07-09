import { type FormEvent, useState } from 'react';
import type { DogGender, DogSize, DogStatus } from '../types/models';
import './DogForm.css';

export interface DogFormValues {
  name: string;
  protectedDate: string;
  gender: DogGender;
  size: DogSize;
  birthDate: string;
  birthDateEstimated: boolean;
  personality: string;
  story: string;
  status: DogStatus;
  seekingAdopter: boolean;
  seekingFoster: boolean;
  sterilizationDate: string;
  rabiesVaccinationDate: string;
  mixedVaccinationDate: string;
}

interface DogFormProps {
  initialValues: DogFormValues;
  submitLabel: string;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (values: DogFormValues) => void;
  onCancel: () => void;
}

// 「保護時の年齢」選択肢とその月齢(0.5ヶ月刻み、1歳以上はまとめて12ヶ月として扱う)
const AGE_AT_PROTECTION_OPTIONS: { label: string; months: number }[] = [
  { label: '0.5ヶ月', months: 0.5 },
  { label: '1ヶ月', months: 1 },
  { label: '1.5ヶ月', months: 1.5 },
  { label: '2ヶ月', months: 2 },
  { label: '2.5ヶ月', months: 2.5 },
  { label: '3ヶ月', months: 3 },
  { label: '4ヶ月', months: 4 },
  { label: '5ヶ月', months: 5 },
  { label: '6ヶ月', months: 6 },
  { label: '7ヶ月', months: 7 },
  { label: '8ヶ月', months: 8 },
  { label: '9ヶ月', months: 9 },
  { label: '10ヶ月', months: 10 },
  { label: '11ヶ月', months: 11 },
  { label: '1歳以上', months: 12 },
];

// 保護日から指定した月齢分さかのぼった生年月日を算出する(0.5ヶ月は15日として扱う)。
// dateStrはタイムゾーンを持たないカレンダー日付として扱うため、UTC基準で計算する
// (ローカル時刻経由で計算するとtoISOString()変換時に日付が前後にずれる)。
function subtractMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const wholeMonths = Math.floor(months);
  const extraDays = Math.round((months - wholeMonths) * 30);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() - wholeMonths);
  date.setUTCDate(date.getUTCDate() - extraDays);
  return date.toISOString().slice(0, 10);
}

export function DogForm({ initialValues, submitLabel, submitting, submitError, onSubmit, onCancel }: DogFormProps) {
  const [form, setForm] = useState<DogFormValues & { ageAtProtection: string }>({
    ...initialValues,
    ageAtProtection: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateField<K extends keyof DogFormValues>(key: K, value: DogFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAgeAtProtectionChange(label: string) {
    const option = AGE_AT_PROTECTION_OPTIONS.find((o) => o.label === label);
    setForm((prev) => ({
      ...prev,
      ageAtProtection: label,
      birthDate: option ? subtractMonths(prev.protectedDate, option.months) : prev.birthDate,
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!form.name || !form.protectedDate || !form.birthDate || !form.personality || !form.story) {
      setValidationError('必須項目をすべて入力してください。');
      return;
    }

    setValidationError(null);
    onSubmit({
      name: form.name,
      protectedDate: form.protectedDate,
      gender: form.gender,
      size: form.size,
      birthDate: form.birthDate,
      birthDateEstimated: form.birthDateEstimated,
      personality: form.personality,
      story: form.story,
      status: form.status,
      seekingAdopter: form.seekingAdopter,
      seekingFoster: form.seekingFoster,
      sterilizationDate: form.sterilizationDate,
      rabiesVaccinationDate: form.rabiesVaccinationDate,
      mixedVaccinationDate: form.mixedVaccinationDate,
    });
  }

  const displayError = validationError ?? submitError;

  return (
    <form className="dog-form" onSubmit={handleSubmit}>
      <h2>保護犬情報</h2>
      <label className="dog-form__field">
        <span>名前</span>
        <input type="text" required value={form.name} onChange={(e) => updateField('name', e.target.value)} />
      </label>
      <div className="dog-form__row">
        <label className="dog-form__field">
          <span>性別</span>
          <select value={form.gender} onChange={(e) => updateField('gender', e.target.value as DogGender)}>
            <option value="MALE">オス</option>
            <option value="FEMALE">メス</option>
            <option value="UNKNOWN">不明</option>
          </select>
        </label>
        <label className="dog-form__field">
          <span>保護時の年齢</span>
          <select value={form.ageAtProtection} onChange={(e) => handleAgeAtProtectionChange(e.target.value)}>
            <option value="">選択してください</option>
            {AGE_AT_PROTECTION_OPTIONS.map((option) => (
              <option key={option.label} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="dog-form__row">

        <label className="dog-form__field">
          <span>生年月日</span>
          <input
            type="date"
            required
            value={form.birthDate}
            onChange={(e) => updateField('birthDate', e.target.value)}
          />
        </label>
        <label className="dog-form__field dog-form__field--checkbox">
          <input
            type="checkbox"
            checked={form.birthDateEstimated}
            onChange={(e) => updateField('birthDateEstimated', e.target.checked)}
          />
          <span>生年月日は推定</span>
        </label>
      </div>


      <div className="dog-form__row">
        <label className="dog-form__field">
          <span>保護日</span>
          <input
            type="date"
            required
            value={form.protectedDate}
            onChange={(e) => updateField('protectedDate', e.target.value)}
          />
        </label>
        <label className="dog-form__field">
          <span>大きさ</span>
          <select value={form.size} onChange={(e) => updateField('size', e.target.value as DogSize)}>
            <option value="SMALL">小型</option>
            <option value="MEDIUM">中型</option>
            <option value="LARGE">大型</option>
          </select>
        </label>
      </div>

      <label className="dog-form__field">
        <span>保護の経緯</span>
        <textarea required rows={2} value={form.story} onChange={(e) => updateField('story', e.target.value)} />
      </label>
      <label className="dog-form__field">
        <span>性格・状態</span>
        <textarea
          required
          rows={4}
          value={form.personality}
          onChange={(e) => updateField('personality', e.target.value)}
        />
      </label>

      <h2>医療情報</h2>
      <div className="dog-form__row">
        <label className="dog-form__field">
          <span>去勢/避妊手術日</span>
          <input
            type="date"
            value={form.sterilizationDate}
            onChange={(e) => updateField('sterilizationDate', e.target.value)}
          />
        </label>
        <label className="dog-form__field">
          <span>狂犬病ワクチン接種日</span>
          <input
            type="date"
            value={form.rabiesVaccinationDate}
            onChange={(e) => updateField('rabiesVaccinationDate', e.target.value)}
          />
        </label>
      </div>
      <label className="dog-form__field">
        <span>混合ワクチン接種日</span>
        <input
          type="date"
          value={form.mixedVaccinationDate}
          onChange={(e) => updateField('mixedVaccinationDate', e.target.value)}
        />
      </label>
      <label className="dog-form__field">
        <span>ステータス</span>
        <select value={form.status} onChange={(e) => updateField('status', e.target.value as DogStatus)}>
          <option value="PROTECTED">保護中</option>
          <option value="FOSTERED">預かり中</option>
          <option value="IN_TRANSIT">搬送中</option>
          <option value="ADOPTED">譲渡済み</option>
          <option value="RETURNED">返還済み</option>
          <option value="SUSPENDED">公開停止中</option>
        </select>
      </label>
      <label className="dog-form__field dog-form__field--checkbox">
        <input
          type="checkbox"
          checked={form.seekingAdopter}
          onChange={(e) => updateField('seekingAdopter', e.target.checked)}
        />
        <span>里親募集中</span>
      </label>
      <label className="dog-form__field dog-form__field--checkbox">
        <input
          type="checkbox"
          checked={form.seekingFoster}
          onChange={(e) => updateField('seekingFoster', e.target.checked)}
        />
        <span>預かりボランティア募集中</span>
      </label>

      {displayError && <p className="dog-form__error">{displayError}</p>}

      <div className="dog-form__actions">
        <button type="button" className="dog-form__link-button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" className="dog-form__primary-button" disabled={submitting}>
          {submitting ? '送信中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
