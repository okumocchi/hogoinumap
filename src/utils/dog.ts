import type { CustodianType, DogGender, DogSize, DogStatus } from '../types/models';

export function calculateAgeLabel(birthDate: string, estimated: boolean): string {
  const birth = new Date(birthDate);
  const now = new Date();

  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const label = years > 0 ? `${years}歳${months}ヶ月` : `${months}ヶ月`;
  return estimated ? `推定${label}` : label;
}

// 生年月日から指定日時点での年齢ラベルを算出する(「推定」接頭辞は付けない)
export function calculateAgeAtLabel(birthDate: string, asOfDate: string): string {
  const birth = new Date(birthDate);
  const asOf = new Date(asOfDate);

  let years = asOf.getFullYear() - birth.getFullYear();
  let months = asOf.getMonth() - birth.getMonth();
  if (asOf.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return years > 0 ? `${years}歳${months}ヶ月` : `${months}ヶ月`;
}

export function calculateElapsedLabel(fromDate: string): string {
  const from = new Date(fromDate);
  const now = new Date();

  // 時間部分を0クリアしたローカル日付オブジェクトを作成
  const fromDateOnly = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let years = nowDateOnly.getFullYear() - fromDateOnly.getFullYear();
  let months = nowDateOnly.getMonth() - fromDateOnly.getMonth();
  if (nowDateOnly.getDate() < fromDateOnly.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years <= 0 && months < 1) {
    const diffDays = Math.max(
      0,
      Math.round((nowDateOnly.getTime() - fromDateOnly.getTime()) / (1000 * 60 * 60 * 24))
    );
    if (diffDays === 0) return '今日';
    if (diffDays === 1) return 'きのう';
    return `${diffDays}日前`;
  }

  return years > 0 ? `${years}年${months}ヶ月前` : `${months}ヶ月前`;
}

export type FosterAgeBracket = 'UNDER_3_MONTHS' | 'UNDER_6_MONTHS' | 'UNDER_1_YEAR' | 'OVER_1_YEAR';

// 生年月日から、預かりスロットの年齢条件(月齢区分)に対応する区分を算出する
export function calculateAgeBracket(birthDate: string): FosterAgeBracket {
  const birth = new Date(birthDate);
  const now = new Date();

  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;

  if (months < 3) return 'UNDER_3_MONTHS';
  if (months < 6) return 'UNDER_6_MONTHS';
  if (months < 12) return 'UNDER_1_YEAR';
  return 'OVER_1_YEAR';
}

export const genderLabel: Record<DogGender, string> = {
  MALE: 'オス',
  FEMALE: 'メス',
  UNKNOWN: '不明',
};

export const dogSizeLabel: Record<DogSize, string> = {
  SMALL: '小型',
  MEDIUM: '中型',
  LARGE: '大型',
};

export const dogStatusLabel: Record<DogStatus, string> = {
  PROTECTED: '保護中',
  FOSTERED: '預かり中',
  ADOPTED: '譲渡済み',
  RETURNED: '返還済み',
  IN_TRANSIT: '搬送中',
  SUSPENDED: '公開停止中',
};

// 「預かり準備中」はDB上に独立したstatus値として持たず、custodianOwnerSubが
// セットされていてstatusがまだPROTECTEDのままの状態から表示側で導出する
export function effectiveDogStatusLabel(dog: { status: DogStatus; custodianOwnerSub?: string }): string {
  if (dog.status === 'PROTECTED' && dog.custodianOwnerSub) return '預かり準備中';
  return dogStatusLabel[dog.status];
}

export const custodianTypeLabel: Record<CustodianType, string> = {
  ORGANIZATION: '保護団体',
  VOLUNTEER: '預かりボランティア',
};

// 「預かり募集中」バッジを表示してよいかどうか(既に預け先が決まっている間は非表示にする)
export function isDogOpenForFosterOffers(dog: { seekingFoster: boolean; custodianOwnerSub?: string }): boolean {
  return dog.seekingFoster && !dog.custodianOwnerSub;
}
