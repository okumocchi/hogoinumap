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
import {
  calculateAgeBracket,
  calculateAgeLabel,
  effectiveDogStatusLabel,
  genderLabel,
  isDogOpenForFosterOffers,
} from '../utils/dog';
import './OrganizationDetailScreen.css';

interface OrganizationDetailScreenProps {
  organizationId: string;
  onBack: () => void;
  backLabel: string;
  onSelectDog: (dogId: string) => void;
  viewerParticipant: { kind: ChatParticipantKind; id: string } | null;
  onStartChat: (other: ChatParticipant) => Promise<void>;
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
  backLabel,
  onSelectDog,
  viewerParticipant,
  onStartChat,
}: OrganizationDetailScreenProps) {
  const registeredOrganizations = useRegisteredOrganizations();
  const allOrganizations: Organization[] = registeredOrganizations;
  const organization = allOrganizations.find((org) => org.id === organizationId);
  const isRegisteredOrg = registeredOrganizations.some((org) => org.id === organizationId);

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
    () => protectedDogs.map((dog) => ({ ...dog, ...dogOverrides[dog.id] })),
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
  // 「預かり募集中」クリック時、申し出フローに進めない場合に表示する案内ポップアップ
  const [fosterInfoPopup, setFosterInfoPopup] = useState<{ dogName: string; message: string } | null>(null);

  function closeFosterFlow() {
    setFosterFlow({ type: 'none' });
    setFosterError(null);
  }

  function handleFosterBadgeClick(dog: Dog) {
    if (!viewerParticipant) {
      setFosterInfoPopup({
        dogName: dog.name,
        message: '預かりボランティア登録を行い、保護団体からボランティア承認を受けてください。',
      });
      return;
    }
    if (viewerParticipant.kind === 'organization') {
      setFosterInfoPopup({ dogName: dog.name, message: '保護犬の移管手続きを行います。(追って実装)' });
      return;
    }
    if (!findMatchingSlot(dog)) {
      setFosterInfoPopup({ dogName: dog.name, message: '条件が一致する未使用スロットがありません。' });
      return;
    }
    setFosterError(null);
    setFosterFlow({ type: 'confirm', dog });
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
        throw new Error(matchResult.errors.map((e) => e.message).join(' / '));
      }

      // statusは変更せず(PROTECTEDのまま)、custodianOwnerSubだけ自分自身にセットする。
      // 「預かり準備中」表示はこのフィールドの有無から導出される(effectiveDogStatusLabel参照)
      const dogUpdateInput = { id: dog.id, custodianOwnerSub: myOwnerSub };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dogResult = await dataClient.models.Dog.update(dogUpdateInput as any);
      if (dogResult.errors?.length) {
        throw new Error(dogResult.errors.map((e) => e.message).join(' / '));
      }

      setDogOverrides((prev) => ({ ...prev, [dog.id]: { custodianOwnerSub: myOwnerSub } }));
      setPendingChatOrgOwnerSub(orgOwnerSub);
      setFosterFlow({ type: 'info', dog });
    } catch (err) {
      setFosterError(err instanceof Error ? err.message : '処理に失敗しました。時間をおいて再度お試しください。');
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

  // 詳細ページからのチャット開始(預かりの申し出とは独立した導線)
  const canChatWithOrg =
    !!viewerParticipant &&
    isRegisteredOrg &&
    !(viewerParticipant.kind === 'organization' && viewerParticipant.id === organizationId);
  const [chatStarting, setChatStarting] = useState(false);
  const [chatButtonError, setChatButtonError] = useState<string | null>(null);

  async function handleStartChatButton() {
    if (!organization) return;
    setChatStarting(true);
    setChatButtonError(null);
    try {
      const orgResult = await dataClient.models.Organization.get({ id: organizationId }, { authMode: 'userPool' });
      const ownerSub = orgResult.data?.ownerSub;
      if (!ownerSub) {
        throw new Error('この団体とはチャットを開始できません。');
      }
      await onStartChat({ kind: 'organization', id: organizationId, name: organization.name, ownerSub });
    } catch (err) {
      setChatButtonError(err instanceof Error ? err.message : 'チャットの開始に失敗しました。');
    } finally {
      setChatStarting(false);
    }
  }

  if (!organization) {
    return (
      <div className="organization-detail organization-detail--not-found">
        <p>団体情報が見つかりませんでした。</p>
        <button type="button" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="organization-detail">
      <header className="organization-detail__topbar">
        <button type="button" className="organization-detail__back" onClick={onBack}>
          &lt;
        </button>
      </header>

      <div className="organization-detail__body">
        <span className="organization-detail__label">保護団体</span>
        <h1 className="organization-detail__name">{organization.name}</h1>
        <p className="organization-detail__meta">
          {organization.prefecture} {organization.city}
        </p>
        {organization.wishlistUrl && (
          <a className="organization-detail__wishlist" href={organization.wishlistUrl} target="_blank" rel="noreferrer">
            ほしいものリストを見る ↗
          </a>
        )}
        {canChatWithOrg && (
          <div className="organization-detail__chat-action">
            <button
              type="button"
              className="organization-detail__chat-button"
              onClick={handleStartChatButton}
              disabled={chatStarting}
            >
              {chatStarting ? '開始しています…' : 'チャットを始める'}
            </button>
            {chatButtonError && <p className="organization-detail__error">{chatButtonError}</p>}
          </div>
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
                    <Badge tone="neutral">{effectiveDogStatusLabel(dog)}</Badge>
                    {dog.seekingAdopter && <Badge tone="success">里親募集中</Badge>}
                    {isDogOpenForFosterOffers(dog) && (
                      <Badge
                        tone="accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFosterBadgeClick(dog);
                        }}
                      >
                        預かり募集中
                      </Badge>
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

      {fosterInfoPopup && (
        <div className="foster-confirm-backdrop" onClick={() => setFosterInfoPopup(null)}>
          <div className="foster-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="foster-confirm-modal__title">{fosterInfoPopup.dogName}</h3>
            <p className="foster-confirm-modal__message">{fosterInfoPopup.message}</p>
            <div className="foster-confirm-modal__actions">
              <button
                type="button"
                className="foster-confirm-modal__button foster-confirm-modal__button--primary"
                onClick={() => setFosterInfoPopup(null)}
              >
                OK
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
