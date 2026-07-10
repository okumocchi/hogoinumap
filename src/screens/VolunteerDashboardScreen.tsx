import { getCurrentUser } from 'aws-amplify/auth';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { SlotPlaceholderIcon } from '../components/SlotPlaceholderIcon';
import { useDogThumbnails } from '../hooks/useDogThumbnails';
import type { MyVolunteer } from '../hooks/useMyVolunteer';
import { useRegisteredOrganizations } from '../hooks/useRegisteredOrganizations';
import { dataClient } from '../lib/dataClient';
import type { DogGender, DogSize, DogStatus } from '../types/models';
import { calculateAgeLabel, effectiveDogStatusLabel, genderLabel } from '../utils/dog';
import { PREFECTURES } from '../utils/prefectures';
import { SecondaryHeader } from '../components/SecondaryHeader';
import './VolunteerDashboardScreen.css';

interface VolunteerDashboardScreenProps {
  volunteer: MyVolunteer;
  onBack: () => void;
  onUpdated: () => void;
  onSelectDog: (dogId: string) => void;
}

type Mode = 'view' | 'edit';

interface FormState {
  handleName: string;
  prefecture: string;
  city: string;
  profileIntroduction: string;
  wishlistUrl: string;
}

type AffiliationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface AffiliationInfo {
  id: string;
  organizationId: string;
  status: AffiliationStatus;
  requestMessage?: string;
}

const affiliationStatusLabel: Record<AffiliationStatus, string> = {
  PENDING: '承認待ち',
  APPROVED: '承認済み',
  REJECTED: '却下',
};

const MAX_FOSTERING_SLOTS = 10;

type FosteringSlotAge = 'UNDER_3_MONTHS' | 'UNDER_6_MONTHS' | 'UNDER_1_YEAR' | 'OVER_1_YEAR';
type FosteringSlotGender = 'MALE' | 'FEMALE';
type FosteringSlotSize = 'SMALL' | 'MEDIUM' | 'LARGE';
type FosteringSlotPeriod = 'TWO_WEEKS' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'UNSPECIFIED';

const fosteringSlotAgeLabel: Record<FosteringSlotAge, string> = {
  UNDER_3_MONTHS: '3ヶ月未満',
  UNDER_6_MONTHS: '6ヶ月未満',
  UNDER_1_YEAR: '1歳未満',
  OVER_1_YEAR: '1歳以上',
};

const fosteringSlotGenderLabel: Record<FosteringSlotGender, string> = {
  MALE: 'オス',
  FEMALE: 'メス',
};

const fosteringSlotSizeLabel: Record<FosteringSlotSize, string> = {
  SMALL: '小型',
  MEDIUM: '中型',
  LARGE: '大型',
};

const fosteringSlotPeriodLabel: Record<FosteringSlotPeriod, string> = {
  TWO_WEEKS: '2週間',
  ONE_MONTH: '1ヶ月',
  TWO_MONTHS: '2ヶ月',
  THREE_MONTHS: '3ヶ月',
  SIX_MONTHS: '6ヶ月',
  UNSPECIFIED: '指定なし',
};

interface FosteringSlotInfo {
  id: string;
  conditionAges: FosteringSlotAge[];
  conditionGenders: FosteringSlotGender[];
  conditionSizes: FosteringSlotSize[];
  conditionPeriod: FosteringSlotPeriod;
}

// スロットと、そのスロット経由でマッチしている保護犬との紐付け(キャンセル以外のマッチがあれば「使用中」)。
// 使用中のスロットはスロット自体の条件ではなく、この保護犬の情報を表示する
interface SlotOccupant {
  dogId: string;
  name: string;
  gender: DogGender;
  size: DogSize;
  birthDate: string;
  birthDateEstimated: boolean;
  status: DogStatus;
  custodianOwnerSub?: string;
  protectedDate: string;
}

interface SlotFormState {
  conditionAges: FosteringSlotAge[];
  conditionGenders: FosteringSlotGender[];
  conditionSizes: FosteringSlotSize[];
  conditionPeriod: FosteringSlotPeriod;
}

const INITIAL_SLOT_FORM: SlotFormState = {
  conditionAges: [],
  conditionGenders: [],
  conditionSizes: [],
  conditionPeriod: 'UNSPECIFIED',
};

type SlotFormMode = { type: 'closed' } | { type: 'add' } | { type: 'edit'; slotId: string };

type CustodyDogStatus = 'PROTECTED' | 'IN_TRANSIT' | 'SUSPENDED';

interface CustodyDogInfo {
  id: string;
  name: string;
  status: CustodyDogStatus;
  protectedDate: string;
}

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toggleArrayValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function slotToFormState(slot: FosteringSlotInfo): SlotFormState {
  return {
    conditionAges: slot.conditionAges,
    conditionGenders: slot.conditionGenders,
    conditionSizes: slot.conditionSizes,
    conditionPeriod: slot.conditionPeriod,
  };
}

function volunteerToFormState(volunteer: MyVolunteer): FormState {
  return {
    handleName: volunteer.handleName,
    prefecture: volunteer.prefecture,
    city: volunteer.city,
    profileIntroduction: volunteer.profileIntroduction,
    wishlistUrl: volunteer.wishlistUrl ?? '',
  };
}

export function VolunteerDashboardScreen({ volunteer, onBack, onUpdated, onSelectDog }: VolunteerDashboardScreenProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [form, setForm] = useState<FormState>(volunteerToFormState(volunteer));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registeredOrganizations = useRegisteredOrganizations();
  const [affiliations, setAffiliations] = useState<AffiliationInfo[]>([]);
  const [loadingAffiliations, setLoadingAffiliations] = useState(true);
  const [openRequestOrgId, setOpenRequestOrgId] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [slots, setSlots] = useState<FosteringSlotInfo[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotFormMode, setSlotFormMode] = useState<SlotFormMode>({ type: 'closed' });
  const [slotForm, setSlotForm] = useState<SlotFormState>(INITIAL_SLOT_FORM);
  const [slotSubmitting, setSlotSubmitting] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [confirmingDeleteSlot, setConfirmingDeleteSlot] = useState(false);
  // slotId -> そのスロットで現在マッチしている保護犬(キャンセル以外のマッチがなければ未登録=未使用)
  const [slotOccupants, setSlotOccupants] = useState<Record<string, SlotOccupant>>({});
  const occupantDogIds = useMemo(
    () => Array.from(new Set(Object.values(slotOccupants).map((occupant) => occupant.dogId))),
    [slotOccupants],
  );
  const occupantDogThumbnails = useDogThumbnails(occupantDogIds);

  const [custodyDogs, setCustodyDogs] = useState<CustodyDogInfo[]>([]);
  const [loadingCustodyDogs, setLoadingCustodyDogs] = useState(true);
  const [receivingDogId, setReceivingDogId] = useState<string | null>(null);
  const [custodyError, setCustodyError] = useState<string | null>(null);

  async function fetchCustodyDogs(): Promise<CustodyDogInfo[]> {
    const { userId, username } = await getCurrentUser();
    const myOwnerSub = `${userId}::${username}`;
    const result = await dataClient.models.Dog.listDogsByCustodian(
      { custodianOwnerSub: myOwnerSub },
      { authMode: 'userPool' },
    );
    const mapped = result.data
      .filter((dog): dog is typeof dog & { status: CustodyDogStatus } => dog.status === 'PROTECTED' || dog.status === 'IN_TRANSIT' || dog.status === 'SUSPENDED')
      .map((dog) => ({ id: dog.id, name: dog.name ?? '', status: dog.status, protectedDate: dog.protectedDate ?? '' }));
    return mapped.sort((a, b) => b.protectedDate.localeCompare(a.protectedDate));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchCustodyDogs();
      if (!cancelled) {
        setCustodyDogs(fetched);
        setLoadingCustodyDogs(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [volunteer.id]);

  async function handleReceiveDog(dogId: string) {
    setCustodyError(null);
    setReceivingDogId(dogId);
    try {
      // custodianOwnerSubが自分自身と一致する場合のみ許可される(amplify/data/resource.ts参照)。
      // custodianOwnerSubはここではクリアしない。預かり中の間も「現在この犬を
      // 実際に預かっている本人」を示す値として保持し続け、保護犬詳細ページでの
      // 性格編集・メディア追加の権限判定に使う。
      const result = await dataClient.models.Dog.update(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: dogId, status: 'FOSTERED', seekingFoster: false } as any,
        { authMode: 'userPool' },
      );
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      // 預かり履歴に「預かり者が自分に変わった」エントリを追加する
      const custodyInput = {
        dogId,
        custodianType: 'VOLUNTEER',
        custodianId: volunteer.id,
        custodianName: volunteer.handleName,
        startDate: today(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await dataClient.models.CustodyRecord.create(custodyInput as any);

      setCustodyDogs(await fetchCustodyDogs());
    } catch (err) {
      setCustodyError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setReceivingDogId(null);
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEditing() {
    setForm(volunteerToFormState(volunteer));
    setError(null);
    setMode('edit');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.handleName || !form.prefecture || !form.city || !form.profileIntroduction) {
      setError('必須項目をすべて入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      const volunteerInput = {
        id: volunteer.id,
        handleName: form.handleName,
        prefecture: form.prefecture,
        city: form.city,
        profileIntroduction: form.profileIntroduction,
        wishlistUrl: form.wishlistUrl || undefined,
      };
      // Organization/Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.Volunteer.update(volunteerInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      onUpdated();
      setMode('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  async function fetchAffiliations(): Promise<AffiliationInfo[]> {
    const result = await dataClient.models.Affiliation.listAffiliationsByVolunteer(
      { volunteerId: volunteer.id },
      { authMode: 'userPool' },
    );
    return result.data.map((affiliation) => ({
      id: affiliation.id,
      organizationId: affiliation.organizationId,
      status: (affiliation.status ?? 'PENDING') as AffiliationStatus,
      requestMessage: affiliation.requestMessage ?? undefined,
    }));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchAffiliations();
      if (!cancelled) {
        setAffiliations(fetched);
        setLoadingAffiliations(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // volunteer.idはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteer.id]);

  function toggleRequestForm(organizationId: string) {
    setRequestError(null);
    setRequestMessage('');
    setOpenRequestOrgId((prev) => (prev === organizationId ? null : organizationId));
  }

  async function handleRequestSubmit(event: FormEvent, organizationId: string) {
    event.preventDefault();
    setRequestError(null);
    setRequesting(true);
    try {
      // allow.owner()の内部フィールドはAPI経由で読めないため、登録時に複製した
      // ownerSubを参照してAffiliationのowners配列(申請者・団体の両方)を組み立てる。
      // この画面はログイン中のボランティアしか到達しないため、userPool認証で呼び出す
      // (Organization.allow.authenticated()はuserPool限定でidentityPoolだとUnauthorizedになる)
      const orgResult = await dataClient.models.Organization.get(
        { id: organizationId },
        { authMode: 'userPool' },
      );
      const orgOwnerSub = orgResult.data?.ownerSub;
      if (!orgOwnerSub) {
        throw new Error('この団体は現在、申請を受け付けられません。');
      }

      const { userId, username } = await getCurrentUser();
      const affiliationInput = {
        volunteerId: volunteer.id,
        organizationId,
        status: 'PENDING',
        requestMessage: requestMessage || undefined,
        owners: [`${userId}::${username}`, orgOwnerSub],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.Affiliation.create(affiliationInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      setOpenRequestOrgId(null);
      setRequestMessage('');
      setAffiliations(await fetchAffiliations());
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setRequesting(false);
    }
  }

  async function fetchSlots(): Promise<FosteringSlotInfo[]> {
    const result = await dataClient.models.FosteringSlot.listFosteringSlotsByVolunteer(
      { volunteerId: volunteer.id },
      { authMode: 'userPool' },
    );
    return result.data.map((slot) => ({
      id: slot.id,
      conditionAges: (slot.conditionAges ?? []).filter((v): v is FosteringSlotAge => !!v),
      conditionGenders: (slot.conditionGenders ?? []).filter((v): v is FosteringSlotGender => !!v),
      conditionSizes: (slot.conditionSizes ?? []).filter((v): v is FosteringSlotSize => !!v),
      conditionPeriod: (slot.conditionPeriod as FosteringSlotPeriod | null) ?? 'UNSPECIFIED',
    }));
  }

  // スロットごとに、キャンセル以外のマッチが付いていればその保護犬の情報を紐付けて返す
  async function fetchSlotOccupants(): Promise<Record<string, SlotOccupant>> {
    const matchResult = await dataClient.models.Match.listMatchesByVolunteer(
      { volunteerId: volunteer.id },
      { authMode: 'userPool' },
    );
    const activeMatches = matchResult.data.filter(
      (match): match is typeof match & { slotId: string } => match.status !== 'CANCELLED' && !!match.slotId,
    );

    const entries = await Promise.all(
      activeMatches.map(async (match) => {
        const dogResult = await dataClient.models.Dog.get({ id: match.dogId }, { authMode: 'userPool' });
        const dog = dogResult.data;
        const occupant: SlotOccupant = {
          dogId: match.dogId,
          name: dog?.name ?? '(不明な保護犬)',
          gender: (dog?.gender ?? 'UNKNOWN') as DogGender,
          size: (dog?.size ?? 'MEDIUM') as DogSize,
          birthDate: dog?.birthDate ?? '',
          birthDateEstimated: dog?.birthDateEstimated ?? false,
          status: (dog?.status ?? 'PROTECTED') as DogStatus,
          custodianOwnerSub: dog?.custodianOwnerSub ?? undefined,
          protectedDate: dog?.protectedDate ?? '',
        };
        return [match.slotId, occupant] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async function refreshSlots() {
    const [fetchedSlots, fetchedOccupants] = await Promise.all([fetchSlots(), fetchSlotOccupants()]);
    setSlots(fetchedSlots);
    setSlotOccupants(fetchedOccupants);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [fetchedSlots, fetchedOccupants] = await Promise.all([fetchSlots(), fetchSlotOccupants()]);
      if (!cancelled) {
        setSlots(fetchedSlots);
        setSlotOccupants(fetchedOccupants);
        setLoadingSlots(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // volunteer.idはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteer.id]);

  function updateSlotField<K extends keyof SlotFormState>(key: K, value: SlotFormState[K]) {
    setSlotForm((prev) => ({ ...prev, [key]: value }));
  }

  function openAddSlotForm() {
    setSlotForm(INITIAL_SLOT_FORM);
    setSlotError(null);
    setConfirmingDeleteSlot(false);
    setSlotFormMode({ type: 'add' });
  }

  function openEditSlotForm(slot: FosteringSlotInfo) {
    setSlotForm(slotToFormState(slot));
    setSlotError(null);
    setConfirmingDeleteSlot(false);
    setSlotFormMode({ type: 'edit', slotId: slot.id });
  }

  function closeSlotForm() {
    setSlotFormMode({ type: 'closed' });
    setConfirmingDeleteSlot(false);
  }

  function toggleSlotAge(age: FosteringSlotAge) {
    setSlotForm((prev) => ({ ...prev, conditionAges: toggleArrayValue(prev.conditionAges, age) }));
  }

  function toggleSlotGender(gender: FosteringSlotGender) {
    setSlotForm((prev) => ({ ...prev, conditionGenders: toggleArrayValue(prev.conditionGenders, gender) }));
  }

  function toggleSlotSize(size: FosteringSlotSize) {
    setSlotForm((prev) => ({ ...prev, conditionSizes: toggleArrayValue(prev.conditionSizes, size) }));
  }

  async function handleSlotFormSubmit(event: FormEvent) {
    event.preventDefault();
    setSlotError(null);

    if (slotFormMode.type === 'add' && slots.length >= MAX_FOSTERING_SLOTS) {
      setSlotError(`スロットは最大${MAX_FOSTERING_SLOTS}個までしか登録できません。`);
      return;
    }

    if (
      slotForm.conditionAges.length === 0 ||
      slotForm.conditionGenders.length === 0 ||
      slotForm.conditionSizes.length === 0
    ) {
      setSlotError('年齢・性別・大きさはそれぞれ1つ以上選択してください。');
      return;
    }

    setSlotSubmitting(true);
    try {
      if (slotFormMode.type === 'edit') {
        const slotInput = {
          id: slotFormMode.slotId,
          conditionAges: slotForm.conditionAges,
          conditionGenders: slotForm.conditionGenders,
          conditionSizes: slotForm.conditionSizes,
          conditionPeriod: slotForm.conditionPeriod,
        };
        // Organization/Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await dataClient.models.FosteringSlot.update(slotInput as any);
        if (result.errors?.length) {
          throw new Error(result.errors.map((e) => e.message).join(' / '));
        }
      } else {
        const slotInput = {
          volunteerId: volunteer.id,
          conditionAges: slotForm.conditionAges,
          conditionGenders: slotForm.conditionGenders,
          conditionSizes: slotForm.conditionSizes,
          conditionPeriod: slotForm.conditionPeriod,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await dataClient.models.FosteringSlot.create(slotInput as any);
        if (result.errors?.length) {
          throw new Error(result.errors.map((e) => e.message).join(' / '));
        }
      }

      closeSlotForm();
      await refreshSlots();
    } catch (err) {
      setSlotError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSlotSubmitting(false);
    }
  }

  async function handleDeleteSlot(slotId: string) {
    setSlotError(null);
    setSlotSubmitting(true);
    try {
      const result = await dataClient.models.FosteringSlot.delete({ id: slotId });
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      closeSlotForm();
      await refreshSlots();
    } catch (err) {
      setSlotError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSlotSubmitting(false);
    }
  }

  return (
    <div className="volunteer-dashboard">
      <SecondaryHeader
        title={mode === 'edit' ? 'プロフィールを編集' : 'ボランティアダッシュボード'}
        onBack={mode === 'edit' ? () => setMode('view') : onBack}
      />

      <div className="volunteer-dashboard__body">
        {mode === 'view' && (
          <>
            <div className="volunteer-dashboard__heading-row">
              <h2>プロフィール情報</h2>
              <button
                type="button"
                className="volunteer-dashboard__icon-edit-button"
                onClick={startEditing}
                title="プロフィールを編集"
              >
                ✏️
              </button>
            </div>
            <dl className="volunteer-dashboard__facts">
              <div>
                <dt>ハンドルネーム</dt>
                <dd>{volunteer.handleName}</dd>
              </div>
              <div>
                <dt>所在地</dt>
                <dd>
                  {volunteer.prefecture} {volunteer.city}
                </dd>
              </div>
              <div>
                <dt>自己紹介文</dt>
                <dd className="volunteer-dashboard__intro">{volunteer.profileIntroduction}</dd>
              </div>
              <div>
                <dt>ほしいものリストURL</dt>
                <dd>
                  {volunteer.wishlistUrl ? (
                    <a href={volunteer.wishlistUrl} target="_blank" rel="noreferrer">
                      {volunteer.wishlistUrl}
                    </a>
                  ) : (
                    '未設定'
                  )}
                </dd>
              </div>
            </dl>

            {!loadingCustodyDogs && custodyDogs.length > 0 && (
              <section className="volunteer-dashboard__section">
                <h2>預かり手続き中の保護犬</h2>
                {custodyError && <p className="volunteer-dashboard__error">{custodyError}</p>}
                <ul className="volunteer-dashboard__org-list">
                  {custodyDogs.map((dog) => (
                    <li key={dog.id} className="volunteer-dashboard__org-card">
                      <div className="volunteer-dashboard__org-heading">
                        <span className="volunteer-dashboard__org-name">{dog.name}</span>
                        {dog.status === 'IN_TRANSIT' ? (
                          <button
                            type="button"
                            className="volunteer-dashboard__request-toggle"
                            disabled={receivingDogId === dog.id}
                            onClick={() => handleReceiveDog(dog.id)}
                          >
                            {receivingDogId === dog.id ? '処理中…' : '引き取り完了'}
                          </button>
                        ) : (
                          <span className="volunteer-dashboard__affiliation-status">団体の搬送準備待ち</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="volunteer-dashboard__section">
              <div className="volunteer-dashboard__section-heading">
                <h2>預かりスロット</h2>
                <span className="volunteer-dashboard__slot-count">
                  {slots.length}/{MAX_FOSTERING_SLOTS}
                </span>
              </div>
              <p className="volunteer-dashboard__section-hint">
                未使用スロットが1つでも登録されていると、地図上で「受入可能」として表示されます。
              </p>

              {loadingSlots ? (
                <p className="volunteer-dashboard__empty">読み込み中…</p>
              ) : (
                <>
                  {slots.length === 0 && <p className="volunteer-dashboard__empty">登録されているスロットはありません。</p>}
                  {slots.length > 0 && (
                    <ul className="volunteer-dashboard__slot-list">
                      {[...slots]
                        .sort((a, b) => {
                          const occA = slotOccupants[a.id];
                          const occB = slotOccupants[b.id];
                          if (occA && occB) {
                            return occB.protectedDate.localeCompare(occA.protectedDate);
                          }
                          if (occA) return -1;
                          if (occB) return 1;
                          return 0;
                        })
                        .map((slot) => {
                          const occupant = slotOccupants[slot.id];
                          return (
                            <li key={slot.id}>
                              <button
                                type="button"
                                className="volunteer-dashboard__slot-card"
                                onClick={() => (occupant ? onSelectDog(occupant.dogId) : openEditSlotForm(slot))}
                              >
                                <div className="volunteer-dashboard__slot-thumb">
                                  {occupant && occupantDogThumbnails[occupant.dogId] ? (
                                    <img src={occupantDogThumbnails[occupant.dogId]} alt="" />
                                  ) : (
                                    <SlotPlaceholderIcon />
                                  )}
                                </div>
                                <div className="volunteer-dashboard__slot-info">
                                  <h3 className="volunteer-dashboard__slot-title">{occupant ? occupant.name : '未使用'}</h3>
                                  {occupant ? (
                                    <dl className="volunteer-dashboard__slot-fact-list">
                                      <div>
                                        <dt>性別</dt>
                                        <dd>{genderLabel[occupant.gender]}</dd>
                                      </div>
                                      <div>
                                        <dt>年齢</dt>
                                        <dd>{calculateAgeLabel(occupant.birthDate, occupant.birthDateEstimated)}</dd>
                                      </div>
                                      <div>
                                        <dt>状態</dt>
                                        <dd>{effectiveDogStatusLabel(occupant)}</dd>
                                      </div>
                                    </dl>
                                  ) : (
                                    <dl className="volunteer-dashboard__slot-fact-list">
                                      <div>
                                        <dt>性別</dt>
                                        <dd>{slot.conditionGenders.map((g) => fosteringSlotGenderLabel[g]).join('・')}</dd>
                                      </div>
                                      <div>
                                        <dt>年齢</dt>
                                        <dd>{slot.conditionAges.map((a) => fosteringSlotAgeLabel[a]).join('・')}</dd>
                                      </div>
                                      <div>
                                        <dt>大きさ</dt>
                                        <dd>{slot.conditionSizes.map((s) => fosteringSlotSizeLabel[s]).join('・')}</dd>
                                      </div>
                                      <div>
                                        <dt>期間</dt>
                                        <dd>{fosteringSlotPeriodLabel[slot.conditionPeriod]}</dd>
                                      </div>
                                    </dl>
                                  )}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </>
              )}

              {slotFormMode.type === 'closed' && slotError && <p className="volunteer-dashboard__error">{slotError}</p>}

              {slotFormMode.type !== 'closed' ? (
                <form className="volunteer-dashboard__slot-form" onSubmit={handleSlotFormSubmit}>
                  <h3>{slotFormMode.type === 'edit' ? 'スロットを編集' : 'スロットを追加'}</h3>
                  <div className="volunteer-dashboard__field">
                    <span>年齢(複数選択可)</span>
                    <div className="volunteer-dashboard__checkbox-group">
                      {(Object.keys(fosteringSlotAgeLabel) as FosteringSlotAge[]).map((age) => (
                        <label key={age} className="volunteer-dashboard__checkbox-option">
                          <input
                            type="checkbox"
                            checked={slotForm.conditionAges.includes(age)}
                            onChange={() => toggleSlotAge(age)}
                          />
                          <span>{fosteringSlotAgeLabel[age]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="volunteer-dashboard__field">
                    <span>性別(複数選択可)</span>
                    <div className="volunteer-dashboard__checkbox-group">
                      {(Object.keys(fosteringSlotGenderLabel) as FosteringSlotGender[]).map((gender) => (
                        <label key={gender} className="volunteer-dashboard__checkbox-option">
                          <input
                            type="checkbox"
                            checked={slotForm.conditionGenders.includes(gender)}
                            onChange={() => toggleSlotGender(gender)}
                          />
                          <span>{fosteringSlotGenderLabel[gender]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="volunteer-dashboard__field">
                    <span>大きさ(複数選択可)</span>
                    <div className="volunteer-dashboard__checkbox-group">
                      {(Object.keys(fosteringSlotSizeLabel) as FosteringSlotSize[]).map((size) => (
                        <label key={size} className="volunteer-dashboard__checkbox-option">
                          <input
                            type="checkbox"
                            checked={slotForm.conditionSizes.includes(size)}
                            onChange={() => toggleSlotSize(size)}
                          />
                          <span>{fosteringSlotSizeLabel[size]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="volunteer-dashboard__field">
                    <span>期間</span>
                    <select
                      value={slotForm.conditionPeriod}
                      onChange={(e) => updateSlotField('conditionPeriod', e.target.value as FosteringSlotPeriod)}
                    >
                      {(Object.keys(fosteringSlotPeriodLabel) as FosteringSlotPeriod[]).map((period) => (
                        <option key={period} value={period}>
                          {fosteringSlotPeriodLabel[period]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {slotError && <p className="volunteer-dashboard__error">{slotError}</p>}

                  <div className="volunteer-dashboard__form-actions">
                    <button type="button" className="volunteer-dashboard__link-button" onClick={closeSlotForm}>
                      キャンセル
                    </button>
                    {slotFormMode.type === 'edit' &&
                      (confirmingDeleteSlot ? (
                        <span className="volunteer-dashboard__delete-confirm">
                          本当に削除しますか？
                          <button
                            type="button"
                            className="volunteer-dashboard__delete-button"
                            disabled={slotSubmitting}
                            onClick={() => handleDeleteSlot(slotFormMode.slotId)}
                          >
                            削除する
                          </button>
                          <button
                            type="button"
                            className="volunteer-dashboard__link-button"
                            onClick={() => setConfirmingDeleteSlot(false)}
                          >
                            やめる
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="volunteer-dashboard__delete-button"
                          onClick={() => setConfirmingDeleteSlot(true)}
                        >
                          削除する
                        </button>
                      ))}
                    <button type="submit" className="volunteer-dashboard__primary-button" disabled={slotSubmitting}>
                      {slotSubmitting ? '保存中…' : slotFormMode.type === 'edit' ? '更新する' : '登録する'}
                    </button>
                  </div>
                </form>
              ) : (
                slots.length < MAX_FOSTERING_SLOTS && (
                  <button type="button" className="volunteer-dashboard__request-toggle" onClick={openAddSlotForm}>
                    + スロットを追加
                  </button>
                )
              )}
            </section>

            <section className="volunteer-dashboard__section">
              <h2>預かりボランティア登録</h2>
              {loadingAffiliations ? (
                <p className="volunteer-dashboard__empty">読み込み中…</p>
              ) : registeredOrganizations.length === 0 ? (
                <p className="volunteer-dashboard__empty">登録されている団体がまだありません。</p>
              ) : (
                <ul className="volunteer-dashboard__org-list">
                  {registeredOrganizations.map((org) => {
                    const affiliation = affiliations.find((a) => a.organizationId === org.id);
                    return (
                      <li key={org.id} className="volunteer-dashboard__org-card">
                        <div className="volunteer-dashboard__org-heading">
                          <span className="volunteer-dashboard__org-name">{org.name}</span>
                          {affiliation ? (
                            <span className="volunteer-dashboard__affiliation-status">
                              {affiliationStatusLabel[affiliation.status]}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="volunteer-dashboard__request-toggle"
                              onClick={() => toggleRequestForm(org.id)}
                            >
                              {openRequestOrgId === org.id ? 'キャンセル' : '申請する'}
                            </button>
                          )}
                        </div>
                        <p className="volunteer-dashboard__org-meta">
                          {org.prefecture} {org.city}
                        </p>

                        {openRequestOrgId === org.id && (
                          <form
                            className="volunteer-dashboard__request-form"
                            onSubmit={(e) => handleRequestSubmit(e, org.id)}
                          >
                            <label className="volunteer-dashboard__field">
                              <span>メッセージ(任意)</span>
                              <textarea
                                rows={2}
                                value={requestMessage}
                                onChange={(e) => setRequestMessage(e.target.value)}
                                placeholder="例: 札幌在住の◯◯です。よろしくお願いします。"
                              />
                            </label>
                            {requestError && <p className="volunteer-dashboard__error">{requestError}</p>}
                            <button type="submit" className="volunteer-dashboard__primary-button" disabled={requesting}>
                              {requesting ? '送信中…' : '送信する'}
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {mode === 'edit' && (
          <form className="volunteer-dashboard__form" onSubmit={handleSubmit}>
            <label className="volunteer-dashboard__field">
              <span>ハンドルネーム</span>
              <input
                type="text"
                required
                value={form.handleName}
                onChange={(e) => updateField('handleName', e.target.value)}
              />
            </label>
            <div className="volunteer-dashboard__row">
              <label className="volunteer-dashboard__field">
                <span>都道府県</span>
                <select value={form.prefecture} onChange={(e) => updateField('prefecture', e.target.value)}>
                  {PREFECTURES.map((pref) => (
                    <option key={pref} value={pref}>
                      {pref}
                    </option>
                  ))}
                </select>
              </label>
              <label className="volunteer-dashboard__field">
                <span>市区町村</span>
                <input type="text" required value={form.city} onChange={(e) => updateField('city', e.target.value)} />
              </label>
            </div>
            <label className="volunteer-dashboard__field">
              <span>自己紹介文</span>
              <textarea
                required
                rows={4}
                value={form.profileIntroduction}
                onChange={(e) => updateField('profileIntroduction', e.target.value)}
              />
              <small>団体・ボランティア登録済みのユーザーのみ閲覧できます</small>
            </label>
            <label className="volunteer-dashboard__field">
              <span>ほしいものリストURL(任意)</span>
              <input
                type="url"
                value={form.wishlistUrl}
                onChange={(e) => updateField('wishlistUrl', e.target.value)}
              />
            </label>

            {error && <p className="volunteer-dashboard__error">{error}</p>}

            <div className="volunteer-dashboard__form-actions">
              <button type="button" className="volunteer-dashboard__link-button" onClick={() => setMode('view')}>
                キャンセル
              </button>
              <button type="submit" className="volunteer-dashboard__primary-button" disabled={submitting}>
                {submitting ? '保存中…' : '保存する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
