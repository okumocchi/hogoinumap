import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import type { Volunteer } from '../types/models';

// 地図画面で「受入可能なボランティア」を表示するために、登録済みのボランティアと
// 預かりスロットを全件取得する。スロットは「存在すること自体が空きあり」を意味するため、
// スロットを1件以上持つボランティアのIDを集計してhasAvailableSlotを算出する。
export function useRegisteredVolunteers(): Volunteer[] {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';
      const [volunteerResult, slotResult, matchResult] = await Promise.all([
        dataClient.models.Volunteer.list({ authMode }),
        dataClient.models.FosteringSlot.list({ authMode }),
        dataClient.models.Match.list({ authMode }),
      ]);
      if (cancelled) return;

      // 使用中のスロット(CANCELLED以外の状態のMatchが紐づいているスロット)
      const busySlotIds = new Set(
        matchResult.data
          .filter((m) => m.status !== 'CANCELLED')
          .map((m) => m.slotId)
          .filter(Boolean),
      );

      // 空きのあるスロットを1件以上持っているボランティアのID
      const volunteerIdsWithAvailableSlot = new Set(
        slotResult.data
          .filter((slot) => !busySlotIds.has(slot.id))
          .map((slot) => slot.volunteerId),
      );

      const withCoordinates: Volunteer[] = volunteerResult.data
        .filter((vol) => typeof vol.latitude === 'number' && typeof vol.longitude === 'number')
        .map((vol) => ({
          id: vol.id,
          handleName: vol.handleName,
          prefecture: vol.prefecture,
          city: vol.city,
          latitude: vol.latitude as number,
          longitude: vol.longitude as number,
          wishlistUrl: vol.wishlistUrl ?? undefined,
          profileIntroduction: vol.profileIntroduction ?? undefined,
          hasAvailableSlot: volunteerIdsWithAvailableSlot.has(vol.id),
        }));

      setVolunteers(withCoordinates);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return volunteers;
}
