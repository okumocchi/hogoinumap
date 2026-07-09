// amplify/data/resource.ts のスキーマに対応するフロント表示用の型。
// モックアップ段階のため、Amplifyの生成型(Schema)は使わず表示に必要な形に簡略化している。

export type DogGender = 'MALE' | 'FEMALE' | 'UNKNOWN';
export type DogSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type DogStatus = 'PROTECTED' | 'FOSTERED' | 'ADOPTED' | 'RETURNED' | 'IN_TRANSIT' | 'SUSPENDED';
export type MediaType = 'PHOTO' | 'VIDEO';

export interface Organization {
  id: string;
  name: string;
  prefecture: string;
  city: string;
  latitude: number;
  longitude: number;
  contactEmail?: string;
  contactPhone?: string;
  wishlistUrl?: string;
  websiteUrl?: string;
}

export interface Volunteer {
  id: string;
  handleName: string;
  prefecture: string;
  city: string;
  latitude: number;
  longitude: number;
  wishlistUrl?: string;
  profileIntroduction?: string;
  // 受入可能なスロットが1件でもあるかどうか(地図のピン色分けに使用)
  hasAvailableSlot: boolean;
}

export interface Dog {
  id: string;
  organizationId: string;
  name: string;
  protectedDate: string;
  story: string;
  gender: DogGender;
  size: DogSize;
  birthDate: string;
  birthDateEstimated: boolean;
  personality: string;
  status: DogStatus;
  seekingAdopter: boolean;
  seekingFoster: boolean;
  // 預かり手続き中の預け先ID(sub::username形式)。未設定なら預かり手続き中ではない
  custodianOwnerSub?: string;
  sterilizationDate?: string;
  rabiesVaccinationDate?: string;
  mixedVaccinationDate?: string;
  prefecture: string;
  city: string;
}

export type CustodianType = 'ORGANIZATION' | 'VOLUNTEER';

export interface CustodyRecord {
  id: string;
  dogId: string;
  custodianType: CustodianType;
  custodianId: string;
  custodianName: string;
  // 保護時、または預かり者が変わった日
  startDate: string;
}

export interface DogMedia {
  id: string;
  dogId: string;
  mediaType: MediaType;
  caption?: string;
  createdAt: string;
  likeCount: number;
  // モックアップ用のプレースホルダー識別子(実装時はS3Keyから署名付きURLを生成)
  placeholderColor: string;
}

export type MapPinKind = 'organization-seeking' | 'organization' | 'volunteer-available' | 'volunteer';

export interface MapPinData {
  id: string;
  kind: MapPinKind;
  label: string;
  prefecture: string;
  city: string;
  latitude: number;
  longitude: number;
}
