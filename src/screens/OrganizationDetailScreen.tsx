import { getCurrentUser } from 'aws-amplify/auth';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { useDogThumbnails } from '../hooks/useDogThumbnails';
import { useMyVolunteer } from '../hooks/useMyVolunteer';
import { useRegisteredDogs } from '../hooks/useRegisteredDogs';
import { useRegisteredOrganizations } from '../hooks/useRegisteredOrganizations';
import { dataClient } from '../lib/dataClient';
import type { ChatParticipant, ChatParticipantKind } from '../lib/chat';
import type { Dog, DogGender, DogSize, Organization } from '../types/models';
import { SecondaryHeader } from '../components/SecondaryHeader';
import {
  calculateAgeBracket,
  calculateAgeLabel,
  genderLabel,
  isDogOpenForFosterOffers,
} from '../utils/dog';
import { formatApiError } from '../utils/apiErrors';
import { type ChatThreadItem } from '../hooks/useDashboardBadges';
import './OrganizationDetailScreen.css';
import './OrganizationDashboardScreen.css';

interface OrganizationDetailScreenProps {
  organizationId: string;
  onBack: () => void;
  onSelectDog: (dogId: string) => void;
  viewerParticipant?: { kind: ChatParticipantKind; id: string } | null;
  onStartChat: (other: ChatParticipant) => Promise<void>;
  onStartGroupChat: (orgId: string, orgName: string) => Promise<void>;
  chatThreads?: ChatThreadItem[];
  chatUnreads?: Record<string, number>;
  groupChatUnreads?: Record<string, number>;
}

interface FosteringSlotCondition {
  id: string;
  conditionAges: string[];
  conditionGenders: string[];
  conditionSizes: string[];
}

type FosterFlow =
  | { type: 'none' }
  | { type: 'confirm'; dog: Dog }
  | { type: 'processing'; dog: Dog }
  | { type: 'info'; dog: Dog };

export function OrganizationDetailScreen({
  organizationId,
  onBack,
  onSelectDog,
  onStartChat,
  onStartGroupChat,
  chatThreads = [],
  chatUnreads = {},
  groupChatUnreads = {},
}: OrganizationDetailScreenProps) {
  const registeredOrganizations = useRegisteredOrganizations();
  const allOrganizations: Organization[] = registeredOrganizations;
  const organization = allOrganizations.find((org) => org.id === organizationId);

  const registeredDogs = useRegisteredDogs();
  const allDogs: Dog[] = registeredDogs;

  const protectedDogs = useMemo(
    () => allDogs.filter((dog) => dog.organizationId === organizationId && dog.status === 'PROTECTED'),
    [allDogs, organizationId],
  );
  const dogThumbnails = useDogThumbnails(useMemo(() => protectedDogs.map((dog) => dog.id), [protectedDogs]));

  // 預け先IDの楽観的な上書き(預かりの申し出直後、再取得なしで表示に反映するため)
  const [dogOverrides, setDogOverrides] = useState<Record<string, Partial<Dog>>>({});
  const displayDogs = useMemo(
    () => protectedDogs
      .map((dog) => ({ ...dog, ...dogOverrides[dog.id] }))
      .sort((a, b) => b.protectedDate.localeCompare(a.protectedDate)),
    [protectedDogs, dogOverrides],
  );

  // 「預かり募集中」ラベルをクリック可能にするかどうかの判定に使う、
  // ログイン中ボランティア自身の所属承認状況と、空いている預かりスロットの条件
  const [myVolunteer] = useMyVolunteer();
  const [isApprovedVolunteer, setIsApprovedVolunteer] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<FosteringSlotCondition[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!myVolunteer) {
        setIsApprovedVolunteer(false);
        setAvailableSlots([]);
        return;
      }

      const [affiliationResult, slotResult, matchResult] = await Promise.all([
        dataClient.models.Affiliation.listAffiliationsByVolunteer(
          { volunteerId: myVolunteer.id },
          { authMode: 'userPool' },
        ),
        dataClient.models.FosteringSlot.listFosteringSlotsByVolunteer(
          { volunteerId: myVolunteer.id },
          { authMode: 'userPool' },
        ),
        dataClient.models.Match.listMatchesByVolunteer({ volunteerId: myVolunteer.id }, { authMode: 'userPool' }),
      ]);
      if (cancelled) return;

  const approved = affiliationResult.data.some(
        (affiliation) => affiliation.organizationId === organizationId && affiliation.status === 'APPROVED',
      );
      setIsApprovedVolunteer(approved);

      // スロットは「存在すること自体が空きあり」を意味するが、キャンセル以外の
      // マッチが既に付いているスロットは他の保護犬で使用中のため対象から除外する
      const occupiedSlotIds = new Set(
        matchResult.data.filter((match) => match.status !== 'CANCELLED' && match.slotId).map((match) => match.slotId),
      );
      const slots = slotResult.data
        .filter((slot) => !occupiedSlotIds.has(slot.id))
        .map((slot) => ({
          id: slot.id,
          conditionAges: (slot.conditionAges ?? []).filter((v): v is string => !!v),
          conditionGenders: (slot.conditionGenders ?? []).filter((v): v is string => !!v),
          conditionSizes: (slot.conditionSizes ?? []).filter((v): v is string => !!v),
        }));
      setAvailableSlots(slots);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [myVolunteer, organizationId]);

  // 承認済み所属ボランティアの場合に表示する「登録ボランティア一覧」
  const [approvedVolunteers, setApprovedVolunteers] = useState<{
    id: string;
    affiliationId: string;
    handleName: string;
    prefecture: string;
    city: string;
    ownerSub: string;
    isModerator: boolean;
  }[]>([]);
  const [loadingApprovedVolunteers, setLoadingApprovedVolunteers] = useState(true);
  const [isVolunteersOpen, setIsVolunteersOpen] = useState(false);
  const [openingChatVolunteerId, setOpeningChatVolunteerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadApprovedVolunteers() {
      if (!isApprovedVolunteer) {
        setApprovedVolunteers([]);
        setLoadingApprovedVolunteers(false);
        return;
      }

      try {
        const result = await dataClient.models.Affiliation.listByOrganizationAndStatus(
          { organizationId, status: { eq: 'APPROVED' } },
          { authMode: 'userPool' },
        );
        const volunteers = await Promise.all(
          result.data.map(async (affiliation) => {
            const volRes = await dataClient.models.Volunteer.get(
              { id: affiliation.volunteerId },
              { authMode: 'userPool' },
            );
            if (!volRes.data) return null;
            return {
              id: volRes.data.id,
              affiliationId: affiliation.id,
              handleName: volRes.data.handleName,
              prefecture: volRes.data.prefecture,
              city: volRes.data.city,
              ownerSub: volRes.data.ownerSub ?? '',
              isModerator: affiliation.isModerator ?? false,
            };
          }),
        );
        if (!cancelled) {
          setApprovedVolunteers(volunteers.filter((v): v is NonNullable<typeof v> => v !== null));
        }
      } catch (err) {
        console.error('Failed to fetch approved volunteers for org detail:', err);
      } finally {
        if (!cancelled) {
          setLoadingApprovedVolunteers(false);
        }
      }
    }

    loadApprovedVolunteers();

    return () => {
      cancelled = true;
    };
  }, [organizationId, isApprovedVolunteer]);

  async function handleOpenVolunteerChat(volunteer: { id: string; handleName: string; ownerSub: string }) {
    if (!organization) return;
    setOpeningChatVolunteerId(volunteer.id);
    try {
      await onStartChat({
        kind: 'volunteer',
        id: volunteer.id,
        name: volunteer.handleName,
        ownerSub: volunteer.ownerSub,
      });
    } catch (err) {
      console.error('Failed to open chat with volunteer:', err);
    } finally {
      setOpeningChatVolunteerId(null);
    }
  }

  function findMatchingSlot(dog: {
    gender: DogGender;
    size: DogSize;
    birthDate: string;
  }): FosteringSlotCondition | undefined {
    if (!isApprovedVolunteer) return undefined;
    const ageBracket = calculateAgeBracket(dog.birthDate);
    return availableSlots.find(
      (slot) =>
        slot.conditionGenders.includes(dog.gender) &&
        slot.conditionSizes.includes(dog.size) &&
        slot.conditionAges.includes(ageBracket),
    );
  }

  // 預かりボランティアの申し出フロー(確認 → 処理中 → 案内)
  const [fosterFlow, setFosterFlow] = useState<FosterFlow>({ type: 'none' });
  const [fosterError, setFosterError] = useState<string | null>(null);
  const [pendingChatOrgOwnerSub, setPendingChatOrgOwnerSub] = useState<string | null>(null);
  function closeFosterFlow() {
    setFosterFlow({ type: 'none' });
    setFosterError(null);
  }

  async function handleFosterConfirmYes() {
    if (fosterFlow.type !== 'confirm' || !myVolunteer) return;
    const dog = fosterFlow.dog;
    const slot = findMatchingSlot(dog);
    if (!slot) {
      setFosterError('預かり条件に一致するスロットが見つかりませんでした。');
      return;
    }

    setFosterFlow({ type: 'processing', dog });
    setFosterError(null);
    try {
      const orgResult = await dataClient.models.Organization.get({ id: organizationId }, { authMode: 'userPool' });
      const orgOwnerSub = orgResult.data?.ownerSub;
      if (!orgOwnerSub) {
        throw new Error('この団体とはやり取りできません。');
      }

      const { userId, username } = await getCurrentUser();
      const myOwnerSub = `${userId}::${username}`;
      const matchInput = {
        dogId: dog.id,
        volunteerId: myVolunteer.id,
        slotId: slot.id,
        status: 'REQUESTED',
        owners: [myOwnerSub, orgOwnerSub],
      };
      // Organization/Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchResult = await dataClient.models.Match.create(matchInput as any);
      if (matchResult.errors?.length) {
        throw new Error(formatApiError(matchResult.errors));
      }

      // statusは変更せず(PROTECTEDのまま)、custodianOwnerSubだけ自分自身にセットする。
      // 「預かり準備中」表示はこのフィールドの有無から導出される(effectiveDogStatusLabel参照)
      const dogUpdateInput = { id: dog.id, custodianOwnerSub: myOwnerSub };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dogResult = await dataClient.models.Dog.update(dogUpdateInput as any);
      if (dogResult.errors?.length) {
        throw new Error(formatApiError(dogResult.errors));
      }

      setDogOverrides((prev) => ({ ...prev, [dog.id]: { custodianOwnerSub: myOwnerSub } }));
      setPendingChatOrgOwnerSub(orgOwnerSub);
      setFosterFlow({ type: 'info', dog });
    } catch (err) {
      setFosterError(formatApiError(err, '処理に失敗しました。時間をおいて再度お試しください。'));
      setFosterFlow({ type: 'confirm', dog });
    }
  }

  async function handleFosterInfoClose() {
    const orgOwnerSub = pendingChatOrgOwnerSub;
    closeFosterFlow();
    setPendingChatOrgOwnerSub(null);
    if (orgOwnerSub && organization) {
      try {
        await onStartChat({ kind: 'organization', id: organizationId, name: organization.name, ownerSub: orgOwnerSub });
      } catch {
        // チャット開始に失敗しても預かり準備自体は完了しているため、致命的なエラーとしては扱わない
      }
    }
  }

  const [groupChatStarting, setGroupChatStarting] = useState(false);

  async function handleStartGroupChatButton() {
    if (!organization) return;
    setGroupChatStarting(true);
    try {
      await onStartGroupChat(organizationId, organization.name);
    } catch (err) {
      console.error('Failed to start group chat:', err);
    } finally {
      setGroupChatStarting(false);
    }
  }

  if (!organization) {
    return (
      <div className="organization-detail organization-detail--not-found">
        <p>団体情報が見つかりませんでした。</p>
        <button type="button" onClick={onBack}>
          戻る
        </button>
      </div>
    );
  }

  return (
    <div className="organization-detail">
      <SecondaryHeader title="保護団体詳細" onBack={onBack} />

      <div className="organization-detail__body">
        {/* <span className="organization-detail__label">保護団体</span> */}
        <div className="organization-detail__title-row">
          <h1 className="organization-detail__name">{organization.name}</h1>
          <div className="organization-detail__links">
            {organization.websiteUrl && (
              <a
                href={organization.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="organization-detail__icon-link"
                title="ウェブサイトを開く"
              >
                🏠
              </a>
            )}
            {organization.wishlistUrl && (
              <a
                href={organization.wishlistUrl}
                target="_blank"
                rel="noreferrer"
                className="organization-detail__icon-link"
                title="ほしいものリストを開く"
              >
                🎁
              </a>
            )}
          </div>
        </div>

        <dl className="organization-detail__facts">
          <div>
            <dt>住所</dt>
            <dd>
              {organization.prefecture}
              {organization.city}
              {organization.addressLine}
            </dd>
          </div>
          {organization.contactEmail && (
            <div>
              <dt>メールアドレス</dt>
              <dd>{organization.contactEmail}</dd>
            </div>
          )}
          {organization.contactPhone && (
            <div>
              <dt>電話番号</dt>
              <dd>{organization.contactPhone}</dd>
            </div>
          )}
        </dl>

        {/* 承認済み預かりボランティアの場合、登録ボランティア一覧UIを表示 */}
        {isApprovedVolunteer && (
          <section className="org-dashboard__section" style={{ marginTop: '24px', marginBottom: '24px' }}>
            {(() => {
              const hasGroupUnread = (groupChatUnreads[organizationId] ?? 0) > 0;
              const hasVolunteerUnread = approvedVolunteers.some((vol) => {
                const volKey = `volunteer#${vol.id}`;
                const matchingThread = chatThreads.find(
                  (t) => t.participantAKey === volKey || t.participantBKey === volKey,
                );
                return matchingThread ? (chatUnreads[matchingThread.id] ?? 0) > 0 : false;
              });
              const hasAnyUnreadInSection = hasGroupUnread || hasVolunteerUnread;

              return (
                <div className="org-dashboard__accordion">
                  <button
                    type="button"
                    className="org-dashboard__accordion-header"
                    onClick={() => setIsVolunteersOpen((prev) => !prev)}
                  >
                    <div className="org-dashboard__accordion-title">
                      <span>👥 登録ボランティア一覧 ({approvedVolunteers.length}名)</span>
                      {hasAnyUnreadInSection && (
                        <span className="org-dashboard__unread-indicator">🔴 未読あり</span>
                      )}
                    </div>
                    <span className="org-dashboard__accordion-icon">
                      {isVolunteersOpen ? '▲ 閉じる' : '▼ 表示する'}
                    </span>
                  </button>

                  {isVolunteersOpen && (
                    <div className="org-dashboard__accordion-content">
                      <ul className="org-dashboard__compact-list">
                        {/* 全員グループチャット */}
                        <li className="org-dashboard__compact-item org-dashboard__compact-item--group">
                          <div className="org-dashboard__compact-info">
                            <span className="org-dashboard__compact-name">📢 全員グループチャット</span>
                            {hasGroupUnread && <span className="org-dashboard__unread-indicator">🔴 未読あり</span>}
                          </div>
                          <button
                            type="button"
                            className="org-dashboard__chat-button org-dashboard__chat-button--sm"
                            onClick={handleStartGroupChatButton}
                            disabled={groupChatStarting}
                          >
                            {groupChatStarting ? '開始中…' : 'グループチャット'}
                          </button>
                        </li>

                        {/* 承認済み個別の登録ボランティア */}
                        {loadingApprovedVolunteers ? (
                          <li className="org-dashboard__empty" style={{ padding: '8px 0' }}>読み込み中…</li>
                        ) : approvedVolunteers.length === 0 ? (
                          <li className="org-dashboard__empty" style={{ padding: '8px 0' }}>承認済みの登録ボランティアはまだいません。</li>
                        ) : (
                          approvedVolunteers.map((vol) => {
                            const volKey = `volunteer#${vol.id}`;
                            const matchingThread = chatThreads.find(
                              (t) => t.participantAKey === volKey || t.participantBKey === volKey,
                            );
                            const hasUnread = matchingThread ? (chatUnreads[matchingThread.id] ?? 0) > 0 : false;

                            return (
                              <li key={vol.id} className="org-dashboard__compact-item">
                                <div className="org-dashboard__compact-info">
                                  {vol.isModerator && (
                                    <span
                                      title="モデレータ権限"
                                      style={{
                                        fontSize: '14px',
                                        lineHeight: 1,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        cursor: 'help',
                                      }}
                                    >
                                      🎖️
                                    </span>
                                  )}
                                  <span className="org-dashboard__compact-name">{vol.handleName}</span>
                                  <span className="org-dashboard__compact-meta">
                                    ({vol.prefecture} {vol.city})
                                  </span>
                                  {hasUnread && <span className="org-dashboard__unread-indicator">🔴 未読あり</span>}
                                </div>
                                {myVolunteer && vol.id !== myVolunteer.id && (
                                  <button
                                    type="button"
                                    className="org-dashboard__chat-button org-dashboard__chat-button--sm"
                                    disabled={openingChatVolunteerId === vol.id}
                                    onClick={() => handleOpenVolunteerChat(vol)}
                                  >
                                    {openingChatVolunteerId === vol.id ? '…' : 'チャット'}
                                  </button>
                                )}
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
        )}

        <h2 className="organization-detail__section-title">現在保護中の保護犬</h2>
        <div className="organization-detail__dogs">
          {displayDogs.map((dog) => (
            <div
              key={dog.id}
              className="dog-summary-card"
              role="button"
              tabIndex={0}
              onClick={() => onSelectDog(dog.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectDog(dog.id);
              }}
            >
              <div className="dog-summary-card__thumb">
                {dogThumbnails[dog.id] ? (
                  <img src={dogThumbnails[dog.id]} alt="" />
                ) : (
                  <span className="dog-summary-card__thumb-fallback" aria-hidden="true">
                    🐕
                  </span>
                )}
              </div>
              <div className="dog-summary-card__info">
                <div className="dog-summary-card__heading">
                  <span className="dog-summary-card__name">{dog.name}</span>
                  <span className="dog-summary-card__badges">
                    {/* <Badge tone="neutral">{effectiveDogStatusLabel(dog)}</Badge> */}
                    {dog.seekingAdopter && <Badge tone="success">里親募集中</Badge>}
                    {isDogOpenForFosterOffers(dog) && (
                      <Badge tone="accent">預かり募集中</Badge>
                    )}
                  </span>
                </div>
                <p className="dog-summary-card__meta">
                  {genderLabel[dog.gender]} ・ {calculateAgeLabel(dog.birthDate, dog.birthDateEstimated)}
                </p>
              </div>
            </div>
          ))}
          {displayDogs.length === 0 && (
            <p className="organization-detail__empty">現在保護中の保護犬はいません</p>
          )}
        </div>
      </div>

      {(fosterFlow.type === 'confirm' || fosterFlow.type === 'processing') && (
        <div className="foster-confirm-backdrop" onClick={closeFosterFlow}>
          <div className="foster-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="foster-confirm-modal__title">{fosterFlow.dog.name}</h3>
            <p className="foster-confirm-modal__message">預かりボランティアに申し出ますか？</p>
            {fosterError && <p className="foster-confirm-modal__error">{fosterError}</p>}
            <div className="foster-confirm-modal__actions">
              <button
                type="button"
                className="foster-confirm-modal__button foster-confirm-modal__button--secondary"
                onClick={closeFosterFlow}
                disabled={fosterFlow.type === 'processing'}
              >
                いいえ
              </button>
              <button
                type="button"
                className="foster-confirm-modal__button foster-confirm-modal__button--primary"
                onClick={handleFosterConfirmYes}
                disabled={fosterFlow.type === 'processing'}
              >
                {fosterFlow.type === 'processing' ? '処理中…' : 'はい'}
              </button>
            </div>
          </div>
        </div>
      )}



      {fosterFlow.type === 'info' && (
        <div className="foster-confirm-backdrop" onClick={handleFosterInfoClose}>
          <div className="foster-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="foster-confirm-modal__title">{fosterFlow.dog.name}</h3>
            <p className="foster-confirm-modal__message">
              預かりの準備を始めます。保護団体とやり取りを行い、搬送方法などの打ち合わせを行なってください。チャット画面を開きます。
            </p>
            <div className="foster-confirm-modal__actions">
              <button
                type="button"
                className="foster-confirm-modal__button foster-confirm-modal__button--primary"
                onClick={handleFosterInfoClose}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
