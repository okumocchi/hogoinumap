import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';

interface VolunteerFosterSummary {
  // 現在CONFIRMEDなマッチが付いている(＝実際に預かり中の)犬のID
  fosteredDogIds: string[];
  // 登録されている預かりスロットのうち、マッチが付いていない(＝空いている)ものの数
  availableSlotCount: number;
}

const EMPTY_SUMMARY: VolunteerFosterSummary = { fosteredDogIds: [], availableSlotCount: 0 };

// ボランティアの「現在預かり中の犬」と「空きスロット数」をまとめて取得する。
// スロットの空き状況は「スロットの存在＝空きあり」という前提のもと、
// 登録スロット数からCONFIRMEDマッチの数を差し引いて算出する。
export function useVolunteerFosterSummary(volunteerId: string | undefined): VolunteerFosterSummary {
  const [summary, setSummary] = useState<VolunteerFosterSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!volunteerId) {
        setSummary(EMPTY_SUMMARY);
        return;
      }

      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';

      const [matchResult, slotResult] = await Promise.all([
        dataClient.models.Match.listMatchesByVolunteer({ volunteerId }, { authMode }),
        dataClient.models.FosteringSlot.listFosteringSlotsByVolunteer({ volunteerId }, { authMode }),
      ]);
      if (cancelled) return;

      const confirmedMatches = matchResult.data.filter((match) => match.status === 'CONFIRMED');
      const fosteredDogIds = confirmedMatches.map((match) => match.dogId);
      const availableSlotCount = Math.max(0, slotResult.data.length - confirmedMatches.length);

      setSummary({ fosteredDogIds, availableSlotCount });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [volunteerId]);

  return summary;
}
