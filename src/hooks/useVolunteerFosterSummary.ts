import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { isSameOwnerSub } from '../utils/dog';

interface VolunteerFosterSummary {
  // 現在実際にスロットを占有して預かり中の犬のID一覧
  fosteredDogIds: string[];
  // 登録されている預かりスロットのうち、マッチが付いていない(＝空いている)ものの数
  availableSlotCount: number;
}

const EMPTY_SUMMARY: VolunteerFosterSummary = { fosteredDogIds: [], availableSlotCount: 0 };

// ボランティアの「現在預かり中の犬」と「空きスロット数」をまとめて取得する。
// VolunteerDetailScreenと同様に、ステータスがADOPTED(譲渡完了)/RETURNED(返還)/PROTECTED(保護中/団体預かり)
// の犬や最新預かり先が別の場所である犬はスロット占有者から除外され、空きスロットとして算出される。
export function useVolunteerFosterSummary(volunteerId: string | undefined): VolunteerFosterSummary {
  const [summary, setSummary] = useState<VolunteerFosterSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!volunteerId) {
        setSummary(EMPTY_SUMMARY);
        return;
      }

      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';

        const [slotsResult, volunteerResult, matchResult] = await Promise.all([
          dataClient.models.FosteringSlot.listFosteringSlotsByVolunteer({ volunteerId }, { authMode }),
          dataClient.models.Volunteer.get({ id: volunteerId }, { authMode }),
          dataClient.models.Match.listMatchesByVolunteer({ volunteerId }, { authMode }),
        ]);
        if (cancelled) return;

        const slots = slotsResult.data;
        if (slots.length === 0) {
          setSummary({ fosteredDogIds: [], availableSlotCount: 0 });
          return;
        }

        const slotIdSet = new Set(slots.map((s) => s.id));
        const volunteer = volunteerResult.data;

        // CANCELLED以外のスロット紐付きマッチ
        const activeMatches = matchResult.data.filter(
          (match): match is typeof match & { slotId: string } =>
            match.status !== 'CANCELLED' && !!match.slotId && slotIdSet.has(match.slotId),
        );

        // 各マッチについて現在のスロット占有実態を判定
        const occupiedEntries = await Promise.all(
          activeMatches.map(async (match) => {
            try {
              const dogResult = await dataClient.models.Dog.get({ id: match.dogId }, { authMode });
              const dog = dogResult.data;

              let isNotOccupant = false;

              if (!dog) {
                isNotOccupant = true;
              } else if (dog.status === 'ADOPTED' || dog.status === 'RETURNED' || dog.status === 'PROTECTED') {
                // 譲渡決定・返還・保護中（団体預かり）の場合はボランティア預かりではない
                isNotOccupant = true;
              } else {
                // 1. 最新の預かり履歴（CustodyRecord）を照合
                try {
                  const custodyRes = await dataClient.models.CustodyRecord.listCustodyRecordsByDog(
                    { dogId: match.dogId },
                    { authMode },
                  );
                  if (custodyRes.data.length > 0) {
                    const sortedRecords = [...custodyRes.data].sort((a, b) => {
                      const dateDiff = (b.startDate || '').localeCompare(a.startDate || '');
                      if (dateDiff !== 0) return dateDiff;
                      return (b.createdAt || '').localeCompare(a.createdAt || '');
                    });
                    const latestRecord = sortedRecords[0];
                    if (
                      latestRecord.custodianType === 'ORGANIZATION' ||
                      (latestRecord.custodianId && latestRecord.custodianId !== volunteerId)
                    ) {
                      isNotOccupant = true;
                    }
                  }
                } catch (cErr) {
                  console.warn('Failed to check custody record in useVolunteerFosterSummary:', cErr);
                }

                // 2. この犬に紐付く別のボランティアのCONFIRMEDなMatchが存在するか照合
                if (!isNotOccupant) {
                  try {
                    const dogMatchesRes = await dataClient.models.Match.listMatchesByDog(
                      { dogId: match.dogId },
                      { authMode },
                    );
                    const otherConfirmedMatch = dogMatchesRes.data.find(
                      (m) => m.volunteerId !== volunteerId && m.status === 'CONFIRMED',
                    );
                    if (otherConfirmedMatch) {
                      isNotOccupant = true;
                    }
                  } catch (mErr) {
                    console.warn('Failed to check dog matches in useVolunteerFosterSummary:', mErr);
                  }
                }

                // 3. custodianOwnerSubの照合
                if (!isNotOccupant && dog.custodianOwnerSub) {
                  const volOwnerSub = volunteer?.ownerSub;
                  if (volOwnerSub && !isSameOwnerSub(dog.custodianOwnerSub, volOwnerSub)) {
                    isNotOccupant = true;
                  }
                }
              }

              if (isNotOccupant) {
                if (authMode === 'userPool') {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  dataClient.models.Match.update(
                    { id: match.id, status: 'CANCELLED', slotId: null } as any,
                    { authMode: 'userPool' },
                  ).catch((e) => console.warn('Failed to auto-clean obsolete match in useVolunteerFosterSummary:', e));
                }
                return null;
              }

              if (dog.status === 'SUSPENDED') {
                return null;
              }

              return { slotId: match.slotId, dogId: match.dogId };
            } catch (err) {
              console.warn('Failed to check occupant for match:', match.id, err);
              return null;
            }
          }),
        );

        if (cancelled) return;

        // スロットごとに1匹の犬を紐付け（同一スロットに複数マッチがあっても1スロット1匹）
        const slotOccupantMap = new Map<string, string>();
        for (const entry of occupiedEntries) {
          if (entry && !slotOccupantMap.has(entry.slotId)) {
            slotOccupantMap.set(entry.slotId, entry.dogId);
          }
        }

        const fosteredDogIds = Array.from(slotOccupantMap.values());
        const availableSlotCount = Math.max(0, slots.length - slotOccupantMap.size);

        setSummary({ fosteredDogIds, availableSlotCount });
      } catch (err) {
        console.error('Failed to load volunteer foster summary:', err);
        if (!cancelled) {
          setSummary(EMPTY_SUMMARY);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [volunteerId]);

  return summary;
}

