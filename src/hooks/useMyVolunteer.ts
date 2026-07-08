import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useCallback, useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';

export interface MyVolunteer {
  id: string;
  handleName: string;
  prefecture: string;
  city: string;
  latitude?: number;
  longitude?: number;
  profileIntroduction: string;
  wishlistUrl?: string;
}

// undefined = 判定中, null = ボランティアアカウントではない(未ログイン含む), MyVolunteer = 自分の情報
export function useMyVolunteer(): [MyVolunteer | null | undefined, () => void] {
  const [volunteer, setVolunteer] = useState<MyVolunteer | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      // owner認可のフィールドはCognitoの`sub::username`形式で保存されるため、
      // それに一致するVolunteerを自分のレコードとして取得する
      const { userId, username } = await getCurrentUser();
      const result = await dataClient.models.Volunteer.list({
        filter: { owner: { eq: `${userId}::${username}` } },
        authMode: 'userPool',
      });

      const volunteerRecord = result.data[0];
      setVolunteer(
        volunteerRecord
          ? {
              id: volunteerRecord.id,
              handleName: volunteerRecord.handleName,
              prefecture: volunteerRecord.prefecture,
              city: volunteerRecord.city,
              latitude: volunteerRecord.latitude ?? undefined,
              longitude: volunteerRecord.longitude ?? undefined,
              profileIntroduction: volunteerRecord.profileIntroduction ?? '',
              wishlistUrl: volunteerRecord.wishlistUrl ?? undefined,
            }
          : null,
      );
    } catch {
      setVolunteer(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function safeLoad() {
      await load();
    }

    safeLoad();

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') safeLoad();
      if (payload.event === 'signedOut' && !cancelled) setVolunteer(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load]);

  return [volunteer, load];
}
