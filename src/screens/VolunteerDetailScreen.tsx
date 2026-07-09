import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useMemo, useState } from 'react';
import { SlotPlaceholderIcon } from '../components/SlotPlaceholderIcon';
import { useDogThumbnails } from '../hooks/useDogThumbnails';
import { useRegisteredVolunteers } from '../hooks/useRegisteredVolunteers';
import { dataClient } from '../lib/dataClient';
import type { ChatParticipant, ChatParticipantKind } from '../lib/chat';
import type { Volunteer } from '../types/models';
import { calculateAgeLabel, effectiveDogStatusLabel, genderLabel } from '../utils/dog';
import './OrganizationDetailScreen.css';
import './VolunteerDetailScreen.css';

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

interface FosteringSlotInfo {
  id: string;
  conditionAges: FosteringSlotAge[];
  conditionGenders: FosteringSlotGender[];
  conditionSizes: FosteringSlotSize[];
  conditionPeriod: FosteringSlotPeriod;
}

interface SlotOccupant {
  dogId: string;
  name: string;
  gender: any;
  size: any;
  birthDate: string;
  birthDateEstimated: boolean;
  status: any;
  custodianOwnerSub?: string;
}

interface VolunteerDetailScreenProps {
  volunteerId: string;
  onBack: () => void;
  backLabel: string;
  onSelectDog: (dogId: string) => void;
  viewerParticipant: { kind: ChatParticipantKind; id: string } | null;
  onStartChat: (other: ChatParticipant) => Promise<void>;
}

export function VolunteerDetailScreen({
  volunteerId,
  onBack,
  backLabel,
  onSelectDog,
  viewerParticipant,
  onStartChat,
}: VolunteerDetailScreenProps) {
  const registeredVolunteers = useRegisteredVolunteers();
  const allVolunteers: Volunteer[] = registeredVolunteers;
  const volunteer = allVolunteers.find((v) => v.id === volunteerId);
  const isRegisteredVolunteer = registeredVolunteers.some((v) => v.id === volunteerId);

  const [slots, setSlots] = useState<FosteringSlotInfo[]>([]);
  const [slotOccupants, setSlotOccupants] = useState<Record<string, SlotOccupant>>({});
  const [loadingSlots, setLoadingSlots] = useState(true);

  const occupantDogIds = useMemo(
    () => Array.from(new Set(Object.values(slotOccupants).map((occupant) => occupant.dogId))),
    [slotOccupants]
  );
  const occupantDogThumbnails = useDogThumbnails(occupantDogIds);

  useEffect(() => {
    let cancelled = false;
    async function loadSlotsData() {
      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';

        const slotResult = await dataClient.models.FosteringSlot.listFosteringSlotsByVolunteer(
          { volunteerId },
          { authMode }
        );

        const mappedSlots: FosteringSlotInfo[] = slotResult.data.map((slot) => ({
          id: slot.id,
          conditionAges: (slot.conditionAges ?? []).filter((v): v is FosteringSlotAge => !!v),
          conditionGenders: (slot.conditionGenders ?? []).filter((v): v is FosteringSlotGender => !!v),
          conditionSizes: (slot.conditionSizes ?? []).filter((v): v is FosteringSlotSize => !!v),
          conditionPeriod: (slot.conditionPeriod as FosteringSlotPeriod | null) ?? 'UNSPECIFIED',
        }));

        const matchResult = await dataClient.models.Match.listMatchesByVolunteer(
          { volunteerId },
          { authMode }
        );
        const activeMatches = matchResult.data.filter(
          (match): match is typeof match & { slotId: string } => match.status !== 'CANCELLED' && !!match.slotId,
        );

        const entries = await Promise.all(
          activeMatches.map(async (match) => {
            const dogResult = await dataClient.models.Dog.get({ id: match.dogId }, { authMode });
            const dog = dogResult.data;
            const occupant: SlotOccupant = {
              dogId: match.dogId,
              name: dog?.name ?? '(不明な保護犬)',
              gender: dog?.gender ?? 'UNKNOWN',
              size: dog?.size ?? 'MEDIUM',
              birthDate: dog?.birthDate ?? '',
              birthDateEstimated: dog?.birthDateEstimated ?? false,
              status: dog?.status ?? 'PROTECTED',
              custodianOwnerSub: dog?.custodianOwnerSub ?? undefined,
            };
            return [match.slotId, occupant] as const;
          })
        );

        if (!cancelled) {
          setSlots(mappedSlots);
          setSlotOccupants(Object.fromEntries(entries));
          setLoadingSlots(false);
        }
      } catch (err) {
        console.error('Failed to load slots data for volunteer detail', err);
        if (!cancelled) setLoadingSlots(false);
      }
    }

    loadSlotsData();
    return () => {
      cancelled = true;
    };
  }, [volunteerId]);

  const canChatWithVolunteer =
    !!viewerParticipant &&
    isRegisteredVolunteer &&
    !(viewerParticipant.kind === 'volunteer' && viewerParticipant.id === volunteerId);
  const [chatStarting, setChatStarting] = useState(false);
  const [chatButtonError, setChatButtonError] = useState<string | null>(null);

  async function handleStartChatButton() {
    if (!volunteer) return;
    setChatStarting(true);
    setChatButtonError(null);
    try {
      const volunteerResult = await dataClient.models.Volunteer.get({ id: volunteerId }, { authMode: 'userPool' });
      const ownerSub = volunteerResult.data?.ownerSub;
      if (!ownerSub) {
        throw new Error('このボランティアとはチャットを開始できません。');
      }
      await onStartChat({ kind: 'volunteer', id: volunteerId, name: volunteer.handleName, ownerSub });
    } catch (err) {
      setChatButtonError(err instanceof Error ? err.message : 'チャットの開始に失敗しました。');
    } finally {
      setChatStarting(false);
    }
  }

  if (!volunteer) {
    return (
      <div className="organization-detail organization-detail--not-found">
        <p>ボランティア情報が見つかりませんでした。</p>
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
        <span className="organization-detail__label volunteer-detail__label">預かりボランティア</span>
        <h1 className="organization-detail__name">{volunteer.handleName}</h1>
        <p className="organization-detail__meta">
          {volunteer.prefecture} {volunteer.city}
        </p>
        {volunteer.profileIntroduction && <p className="volunteer-detail__intro">{volunteer.profileIntroduction}</p>}
        {volunteer.wishlistUrl && (
          <a className="organization-detail__wishlist" href={volunteer.wishlistUrl} target="_blank" rel="noreferrer">
            ほしいものリストを見る ↗
          </a>
        )}
        {canChatWithVolunteer && (
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

        <div className="volunteer-detail__slots-section">
          <h2 className="organization-detail__section-title">預かりスロット</h2>
          {loadingSlots ? (
            <p className="organization-detail__empty">スロット情報を読み込み中…</p>
          ) : slots.length === 0 ? (
            <p className="organization-detail__empty">登録されているスロットはありません。</p>
          ) : (
            <ul className="volunteer-detail__slot-list">
              {slots.map((slot) => {
                const occupant = slotOccupants[slot.id];
                if (occupant && occupant.status === 'SUSPENDED') {
                  return null;
                }
                return (
                  <li key={slot.id}>
                    <div className="volunteer-detail__slot-card">
                      <div className="volunteer-detail__slot-thumb">
                        {occupant && occupantDogThumbnails[occupant.dogId] ? (
                          <img src={occupantDogThumbnails[occupant.dogId]} alt="" />
                        ) : (
                          <SlotPlaceholderIcon />
                        )}
                      </div>
                      <div className="volunteer-detail__slot-info">
                        <h3 className="volunteer-detail__slot-title">
                          {occupant ? (
                            <button
                              type="button"
                              className="volunteer-detail__slot-dog-link"
                              onClick={() => onSelectDog(occupant.dogId)}
                            >
                              {occupant.name}
                            </button>
                          ) : (
                            '未使用'
                          )}
                        </h3>
                        {occupant ? (
                          <dl className="volunteer-detail__slot-fact-list">
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
                          <dl className="volunteer-detail__slot-fact-list">
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
                          </dl>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
