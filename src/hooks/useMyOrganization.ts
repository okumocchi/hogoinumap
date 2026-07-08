import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useCallback, useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';

export interface MyOrganization {
  id: string;
  name: string;
  prefecture: string;
  city: string;
  addressLine: string;
  latitude?: number;
  longitude?: number;
  contactEmail?: string;
  contactPhone?: string;
  wishlistUrl?: string;
  websiteUrl?: string;
}

// undefined = 判定中, null = 団体アカウントではない(未ログイン含む), MyOrganization = 自団体の情報
export function useMyOrganization(): [MyOrganization | null | undefined, () => void] {
  const [organization, setOrganization] = useState<MyOrganization | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      // owner認可のフィールドはCognitoの`sub::username`形式で保存されるため、
      // それに一致するOrganizationを自団体のレコードとして取得する
      const { userId, username } = await getCurrentUser();
      const result = await dataClient.models.Organization.list({
        filter: { owner: { eq: `${userId}::${username}` } },
        authMode: 'userPool',
      });

      const org = result.data[0];
      setOrganization(
        org
          ? {
              id: org.id,
              name: org.name,
              prefecture: org.prefecture,
              city: org.city,
              addressLine: org.addressLine,
              latitude: org.latitude ?? undefined,
              longitude: org.longitude ?? undefined,
              contactEmail: org.contactEmail ?? undefined,
              contactPhone: org.contactPhone ?? undefined,
              wishlistUrl: org.wishlistUrl ?? undefined,
              websiteUrl: org.websiteUrl ?? undefined,
            }
          : null,
      );
    } catch {
      setOrganization(null);
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
      if (payload.event === 'signedOut' && !cancelled) setOrganization(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load]);

  return [organization, load];
}
