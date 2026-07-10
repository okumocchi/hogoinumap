import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { type FormEvent, useEffect, useState } from 'react';
import { DogForm, type DogFormValues } from '../components/DogForm';
import type { MyOrganization } from '../hooks/useMyOrganization';
import { dataClient } from '../lib/dataClient';
import type { Dog, DogGender, DogSize, DogStatus } from '../types/models';
import { calculateAgeLabel, effectiveDogStatusLabel, genderLabel, isDogOpenForFosterOffers } from '../utils/dog';
import { geocodeAddress } from '../utils/geocode';
import { PREFECTURES } from '../utils/prefectures';
import { OrganizationDogDetailScreen } from './OrganizationDogDetailScreen';
import { SecondaryHeader } from '../components/SecondaryHeader';
import './OrganizationDashboardScreen.css';

interface OrganizationDashboardScreenProps {
  organization: MyOrganization;
  onBack: () => void;
  onUpdated: () => void;
}

interface OrgInfoFormState {
  name: string;
  prefecture: string;
  city: string;
  addressLine: string;
  contactEmail: string;
  contactPhone: string;
  wishlistUrl: string;
  websiteUrl: string;
}

function orgToFormState(organization: MyOrganization): OrgInfoFormState {
  return {
    name: organization.name,
    prefecture: organization.prefecture,
    city: organization.city,
    addressLine: organization.addressLine,
    contactEmail: organization.contactEmail ?? '',
    contactPhone: organization.contactPhone ?? '',
    wishlistUrl: organization.wishlistUrl ?? '',
    websiteUrl: organization.websiteUrl ?? '',
  };
}

type Mode =
  | { screen: 'list' }
  | { screen: 'new-dog' }
  | { screen: 'dog-detail'; dogId: string }
  | { screen: 'edit-dog'; dogId: string };

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const INITIAL_FORM_VALUES: DogFormValues = {
  name: '',
  protectedDate: today(),
  gender: 'UNKNOWN',
  size: 'MEDIUM',
  birthDate: '',
  birthDateEstimated: true,
  personality: '',
  story: '',
  status: 'PROTECTED',
  seekingAdopter: true,
  seekingFoster: false,
  sterilizationDate: '',
  rabiesVaccinationDate: '',
  mixedVaccinationDate: '',
};

type AffiliationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface AffiliationRequest {
  id: string;
  requestMessage?: string;
  volunteerHandleName: string;
  volunteerPrefecture: string;
  volunteerCity: string;
}

function dogToFormValues(dog: Dog): DogFormValues {
  return {
    name: dog.name,
    protectedDate: dog.protectedDate,
    gender: dog.gender,
    size: dog.size,
    birthDate: dog.birthDate,
    birthDateEstimated: dog.birthDateEstimated,
    personality: dog.personality,
    story: dog.story,
    status: dog.status,
    seekingAdopter: dog.seekingAdopter,
    seekingFoster: dog.seekingFoster,
    sterilizationDate: dog.sterilizationDate ?? '',
    rabiesVaccinationDate: dog.rabiesVaccinationDate ?? '',
    mixedVaccinationDate: dog.mixedVaccinationDate ?? '',
  };
}

export function OrganizationDashboardScreen({ organization, onBack, onUpdated }: OrganizationDashboardScreenProps) {
  const [mode, setMode] = useState<Mode>({ screen: 'list' });
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingOrgInfo, setEditingOrgInfo] = useState(false);
  const [orgForm, setOrgForm] = useState<OrgInfoFormState>(() => orgToFormState(organization));
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [affiliationRequests, setAffiliationRequests] = useState<AffiliationRequest[]>([]);
  const [loadingAffiliationRequests, setLoadingAffiliationRequests] = useState(true);
  const [respondingAffiliationId, setRespondingAffiliationId] = useState<string | null>(null);
  const [affiliationError, setAffiliationError] = useState<string | null>(null);

  const [registeredMedia, setRegisteredMedia] = useState<
    Record<string, { thumbnailUrl?: string; placeholderColor?: string }>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function loadMedia() {
      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';
        const newMedia: Record<string, { thumbnailUrl?: string; placeholderColor?: string }> = {};

        const promises = dogs.map(async (dog) => {
          try {
            const result = await dataClient.models.DogMedia.listByDogSortedByDate(
              { dogId: dog.id },
              { limit: 1, sortDirection: 'DESC', authMode }
            );
            if (result.data && result.data[0]) {
              const first = result.data[0];
              let url: string | undefined;
              if (first.thumbnailS3Key) {
                const urlResult = await getUrl({ path: first.thumbnailS3Key });
                url = urlResult.url.toString();
              } else if (first.s3Key) {
                const urlResult = await getUrl({ path: first.s3Key });
                url = urlResult.url.toString();
              }
              newMedia[dog.id] = {
                thumbnailUrl: url,
                placeholderColor: '#f3e8d6',
              };
            }
          } catch (err) {
            console.error('Failed to load latest media for dog', dog.id, err);
          }
        });

        await Promise.all(promises);
        if (!cancelled) {
          setRegisteredMedia(newMedia);
        }
      } catch (err) {
        console.error('Error fetching auth session for media loading', err);
      }
    }

    if (dogs.length > 0) {
      loadMedia();
    }
  }, [dogs]);

  async function fetchDogs(): Promise<Dog[]> {
    const result = await dataClient.models.Dog.listByOrganization(
      { organizationId: organization.id },
      { authMode: 'userPool' },
    );
    const mapped = result.data.map((dog) => ({
      id: dog.id,
      organizationId: dog.organizationId,
      name: dog.name ?? '',
      protectedDate: dog.protectedDate ?? '',
      story: dog.story ?? '',
      gender: (dog.gender ?? 'UNKNOWN') as DogGender,
      size: (dog.size ?? 'MEDIUM') as DogSize,
      birthDate: dog.birthDate ?? '',
      birthDateEstimated: dog.birthDateEstimated ?? false,
      personality: dog.personality ?? '',
      status: (dog.status ?? 'PROTECTED') as DogStatus,
      seekingAdopter: dog.seekingAdopter ?? false,
      seekingFoster: dog.seekingFoster ?? false,
      custodianOwnerSub: (dog.custodianOwnerSub as unknown as string | null) ?? undefined,
      sterilizationDate: dog.sterilizationDate ?? undefined,
      rabiesVaccinationDate: dog.rabiesVaccinationDate ?? undefined,
      mixedVaccinationDate: dog.mixedVaccinationDate ?? undefined,
      prefecture: dog.prefecture,
      city: dog.city,
    }));
    return mapped.sort((a, b) => b.protectedDate.localeCompare(a.protectedDate));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchDogs();
      if (!cancelled) {
        setDogs(fetched);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // organization.idはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  async function fetchAffiliationRequests(): Promise<AffiliationRequest[]> {
    const result = await dataClient.models.Affiliation.listByOrganizationAndStatus(
      { organizationId: organization.id, status: { eq: 'PENDING' } },
      { authMode: 'userPool' },
    );
    return Promise.all(
      result.data.map(async (affiliation) => {
        const volunteerResult = await dataClient.models.Volunteer.get(
          { id: affiliation.volunteerId },
          { authMode: 'userPool' },
        );
        return {
          id: affiliation.id,
          requestMessage: affiliation.requestMessage ?? undefined,
          volunteerHandleName: volunteerResult.data?.handleName ?? '(不明なボランティア)',
          volunteerPrefecture: volunteerResult.data?.prefecture ?? '',
          volunteerCity: volunteerResult.data?.city ?? '',
        };
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchAffiliationRequests();
      if (!cancelled) {
        setAffiliationRequests(fetched);
        setLoadingAffiliationRequests(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // organization.idはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  async function handleRespondToAffiliation(affiliationId: string, status: AffiliationStatus) {
    setAffiliationError(null);
    setRespondingAffiliationId(affiliationId);
    try {
      // @aws-amplify/data-schema(1.26.0)には、必須のenum/stringフィールドがupdate()の
      // 引数型でstring[]に誤推論されるバグがある。実行時の動作には影響しないため、
      // この呼び出しのみ型チェックを回避する(Dog登録と同様)。
      const result = await dataClient.models.Affiliation.update(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: affiliationId, status } as any,
        { authMode: 'userPool' },
      );
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      setAffiliationRequests(await fetchAffiliationRequests());
    } catch (err) {
      setAffiliationError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setRespondingAffiliationId(null);
    }
  }

  async function handleCreate(values: DogFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const dogInput = {
        organizationId: organization.id,
        ...values,
        sterilizationDate: values.sterilizationDate || undefined,
        rabiesVaccinationDate: values.rabiesVaccinationDate || undefined,
        mixedVaccinationDate: values.mixedVaccinationDate || undefined,
        // 団体の所在地を非正規化してコピーする(スキーマのコメント参照)
        prefecture: organization.prefecture,
        city: organization.city,
      };
      // @aws-amplify/data-schema(1.26.0)には、必須のstringフィールドがcreate()の
      // 引数型でstring[]に誤推論されるバグがある。実行時の動作には影響しないため、
      // この呼び出しのみ型チェックを回避する(OrganizationSignUpScreenと同様)。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.Dog.create(dogInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      // 預かり履歴の初回エントリ(保護時点の預かり者=団体自身)を記録する
      if (result.data) {
        const custodyInput = {
          dogId: result.data.id,
          custodianType: 'ORGANIZATION',
          custodianId: organization.id,
          custodianName: organization.name,
          startDate: values.protectedDate,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await dataClient.models.CustodyRecord.create(custodyInput as any);
      }

      setMode({ screen: 'list' });
      setDogs(await fetchDogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(dogId: string, values: DogFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const dogInput = {
        id: dogId,
        ...values,
        sterilizationDate: values.sterilizationDate || undefined,
        rabiesVaccinationDate: values.rabiesVaccinationDate || undefined,
        mixedVaccinationDate: values.mixedVaccinationDate || undefined,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.Dog.update(dogInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      setDogs(await fetchDogs());
      setMode({ screen: 'dog-detail', dogId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  function updateOrgField<K extends keyof OrgInfoFormState>(key: K, value: OrgInfoFormState[K]) {
    setOrgForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEditingOrgInfo() {
    setOrgForm(orgToFormState(organization));
    setOrgError(null);
    setEditingOrgInfo(true);
  }

  async function handleOrgInfoSubmit(event: FormEvent) {
    event.preventDefault();
    setOrgError(null);

    if (!orgForm.name || !orgForm.prefecture || !orgForm.city || !orgForm.addressLine) {
      setOrgError('団体名・都道府県・市区町村・番地以降の住所は必須です。');
      return;
    }

    setOrgSubmitting(true);
    try {
      // 所在地が変わった場合に備え、地図表示用の緯度経度も取り直す
      const geocoded = await geocodeAddress(orgForm.prefecture, orgForm.city, orgForm.addressLine);

      const orgInput = {
        id: organization.id,
        name: orgForm.name,
        prefecture: orgForm.prefecture,
        city: orgForm.city,
        addressLine: orgForm.addressLine,
        latitude: geocoded?.latitude,
        longitude: geocoded?.longitude,
        contactEmail: orgForm.contactEmail || undefined,
        contactPhone: orgForm.contactPhone || undefined,
        wishlistUrl: orgForm.wishlistUrl || undefined,
        websiteUrl: orgForm.websiteUrl || undefined,
      };
      // Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.Organization.update(orgInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      onUpdated();
      setEditingOrgInfo(false);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setOrgSubmitting(false);
    }
  }

  const selectedDog =
    mode.screen === 'dog-detail' || mode.screen === 'edit-dog' ? dogs.find((d) => d.id === mode.dogId) : undefined;

  if (mode.screen === 'dog-detail' && selectedDog) {
    return (
      <OrganizationDogDetailScreen
        dog={selectedDog}
        onBack={() => setMode({ screen: 'list' })}
        onEdit={() => setMode({ screen: 'edit-dog', dogId: selectedDog.id })}
        onDogsChanged={async () => setDogs(await fetchDogs())}
      />
    );
  }

  return (
    <div className="org-dashboard">
      <SecondaryHeader
        title={mode.screen === 'edit-dog' ? '保護犬情報を編集' : '保護団体ダッシュボード'}
        onBack={mode.screen === 'edit-dog' ? () => setMode({ screen: 'dog-detail', dogId: mode.dogId }) : onBack}
      />

      <div className="org-dashboard__body">
        {editingOrgInfo ? (
          <form className="org-dashboard__org-form" onSubmit={handleOrgInfoSubmit}>
            <h1>基本情報を編集</h1>
            <label className="org-dashboard__field">
              <span>団体名</span>
              <input
                type="text"
                required
                value={orgForm.name}
                onChange={(e) => updateOrgField('name', e.target.value)}
              />
            </label>
            <div className="org-dashboard__row">
              <label className="org-dashboard__field">
                <span>都道府県</span>
                <select value={orgForm.prefecture} onChange={(e) => updateOrgField('prefecture', e.target.value)}>
                  {PREFECTURES.map((pref) => (
                    <option key={pref} value={pref}>
                      {pref}
                    </option>
                  ))}
                </select>
              </label>
              <label className="org-dashboard__field">
                <span>市区町村</span>
                <input
                  type="text"
                  required
                  value={orgForm.city}
                  onChange={(e) => updateOrgField('city', e.target.value)}
                />
              </label>
            </div>
            <label className="org-dashboard__field">
              <span>番地・建物名など</span>
              <input
                type="text"
                required
                placeholder="例: 1-2-3 ○○ビル4F"
                value={orgForm.addressLine}
                onChange={(e) => updateOrgField('addressLine', e.target.value)}
              />
            </label>
            <div className="org-dashboard__row">
              <label className="org-dashboard__field">
                <span>連絡先メールアドレス(任意)</span>
                <input
                  type="email"
                  value={orgForm.contactEmail}
                  onChange={(e) => updateOrgField('contactEmail', e.target.value)}
                />
              </label>
              <label className="org-dashboard__field">
                <span>連絡先電話番号(任意)</span>
                <input
                  type="tel"
                  value={orgForm.contactPhone}
                  onChange={(e) => updateOrgField('contactPhone', e.target.value)}
                />
              </label>
            </div>
            <label className="org-dashboard__field">
              <span>ほしいものリストURL(任意)</span>
              <input
                type="url"
                value={orgForm.wishlistUrl}
                onChange={(e) => updateOrgField('wishlistUrl', e.target.value)}
              />
            </label>
            <label className="org-dashboard__field">
              <span>ウェブサイトURL(任意)</span>
              <input
                type="url"
                value={orgForm.websiteUrl}
                onChange={(e) => updateOrgField('websiteUrl', e.target.value)}
              />
            </label>

            {orgError && <p className="org-dashboard__error">{orgError}</p>}

            <div className="org-dashboard__form-actions">
              <button type="button" className="org-dashboard__link-button" onClick={() => setEditingOrgInfo(false)}>
                キャンセル
              </button>
              <button type="submit" className="org-dashboard__primary-button" disabled={orgSubmitting}>
                {orgSubmitting ? '保存中…' : '保存する'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="org-dashboard__heading-row">
              <h1>{organization.name}</h1>
              {mode.screen === 'list' && (
                <button
                  type="button"
                  className="org-dashboard__edit-button"
                  onClick={startEditingOrgInfo}
                  title="基本情報を編集"
                >
                  ✏️
                </button>
              )}
            </div>
            <dl className="org-dashboard__facts">
              <div>
                <dt>所在地</dt>
                <dd>
                  {organization.prefecture} {organization.city} {organization.addressLine}
                </dd>
              </div>
              <div>
                <dt>連絡先メールアドレス</dt>
                <dd>{organization.contactEmail || '未設定'}</dd>
              </div>
              <div>
                <dt>連絡先電話番号</dt>
                <dd>{organization.contactPhone || '未設定'}</dd>
              </div>
              <div>
                <dt>ほしいものリストURL</dt>
                <dd>
                  {organization.wishlistUrl ? (
                    <a href={organization.wishlistUrl} target="_blank" rel="noreferrer">
                      {organization.wishlistUrl}
                    </a>
                  ) : (
                    '未設定'
                  )}
                </dd>
              </div>
              <div>
                <dt>ウェブサイトURL</dt>
                <dd>
                  {organization.websiteUrl ? (
                    <a href={organization.websiteUrl} target="_blank" rel="noreferrer">
                      {organization.websiteUrl}
                    </a>
                  ) : (
                    '未設定'
                  )}
                </dd>
              </div>
            </dl>
          </>
        )}

        {!editingOrgInfo && mode.screen === 'list' && (
          <>
            <section className="org-dashboard__section">
              <h2>
                預かりボランティア登録申請
                {affiliationRequests.length > 0 && (
                  <span className="org-dashboard__section-badge">{affiliationRequests.length}</span>
                )}
              </h2>
              {loadingAffiliationRequests ? (
                <p className="org-dashboard__empty">読み込み中…</p>
              ) : affiliationRequests.length === 0 ? (
                <p className="org-dashboard__empty">承認待ちの申請はありません。</p>
              ) : (
                <>
                  {affiliationError && <p className="org-dashboard__error">{affiliationError}</p>}
                  <ul className="org-dashboard__affiliation-list">
                    {affiliationRequests.map((request) => (
                      <li key={request.id} className="org-dashboard__affiliation-card">
                        <div className="org-dashboard__affiliation-heading">
                          <span className="org-dashboard__affiliation-name">{request.volunteerHandleName}</span>
                          <div className="org-dashboard__affiliation-actions">
                            <button
                              type="button"
                              className="org-dashboard__approve-button"
                              disabled={respondingAffiliationId === request.id}
                              onClick={() => handleRespondToAffiliation(request.id, 'APPROVED')}
                            >
                              承認する
                            </button>
                            <button
                              type="button"
                              className="org-dashboard__reject-button"
                              disabled={respondingAffiliationId === request.id}
                              onClick={() => handleRespondToAffiliation(request.id, 'REJECTED')}
                            >
                              却下する
                            </button>
                          </div>
                        </div>
                        <p className="org-dashboard__affiliation-meta">
                          {request.volunteerPrefecture} {request.volunteerCity}
                        </p>
                        {request.requestMessage && (
                          <p className="org-dashboard__affiliation-message">{request.requestMessage}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <div className="org-dashboard__actions">
              <button
                type="button"
                className="org-dashboard__primary-button"
                onClick={() => setMode({ screen: 'new-dog' })}
              >
                + 保護犬を登録する
              </button>
            </div>

            {loading ? (
              <p className="org-dashboard__empty">読み込み中…</p>
            ) : dogs.length === 0 ? (
              <p className="org-dashboard__empty">登録されている保護犬はまだいません。</p>
            ) : (
              <ul className="org-dashboard__dog-list">
                {dogs.map((dog) => (
                  <li key={dog.id}>
                    <button
                      type="button"
                      className="org-dashboard__dog-card"
                      onClick={() => setMode({ screen: 'dog-detail', dogId: dog.id })}
                    >
                      <div
                        className="org-dashboard__dog-thumb"
                        style={
                          registeredMedia[dog.id]?.thumbnailUrl
                            ? { backgroundImage: `url(${registeredMedia[dog.id].thumbnailUrl})` }
                            : undefined
                        }
                      >
                        {!registeredMedia[dog.id]?.thumbnailUrl && (
                          <span className="org-dashboard__dog-thumb-fallback" aria-hidden="true">
                            🐕
                          </span>
                        )}
                      </div>
                      <div className="org-dashboard__dog-info">
                        <div className="org-dashboard__dog-heading">
                          <span className="org-dashboard__dog-name">{dog.name}</span>
                          <span className="org-dashboard__dog-status">{effectiveDogStatusLabel(dog)}</span>
                        </div>
                        <p className="org-dashboard__dog-meta">
                          {genderLabel[dog.gender]} ・ {calculateAgeLabel(dog.birthDate, dog.birthDateEstimated)}
                          {dog.seekingAdopter && ' ・ 里親募集中'}
                          {isDogOpenForFosterOffers(dog) && ' ・ 預かりボランティア募集中'}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {mode.screen === 'new-dog' && (
          <DogForm
            initialValues={INITIAL_FORM_VALUES}
            submitLabel="登録する"
            submitting={submitting}
            submitError={error}
            onSubmit={handleCreate}
            onCancel={() => setMode({ screen: 'list' })}
          />
        )}

        {mode.screen === 'edit-dog' && selectedDog && (
          <DogForm
            initialValues={dogToFormValues(selectedDog)}
            submitLabel="更新する"
            submitting={submitting}
            submitError={error}
            onSubmit={(values) => handleUpdate(selectedDog.id, values)}
            onCancel={() => setMode({ screen: 'dog-detail', dogId: selectedDog.id })}
          />
        )}
      </div>
    </div>
  );
}
