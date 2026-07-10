import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import type { Organization } from '../types/models';

// 地図はゲスト(未ログイン)でも閲覧できる必要があるが、Organizationのallow.authenticated()は
// userPool認証のみを対象としているため、ログイン中ユーザーがidentityPool(IAM)経由で
// 呼び出すとUnauthorizedになる。ログイン状態を見てauthModeを切り替える。
export function useRegisteredOrganizations(): Organization[] {
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';
      const result = await dataClient.models.Organization.list({ authMode });
      if (cancelled) return;

      const withCoordinates: Organization[] = result.data
        .filter((org) => typeof org.latitude === 'number' && typeof org.longitude === 'number')
        .map((org) => ({
          id: org.id,
          name: org.name,
          prefecture: org.prefecture,
          city: org.city,
          addressLine: org.addressLine,
          latitude: org.latitude as number,
          longitude: org.longitude as number,
          contactEmail: org.contactEmail ?? undefined,
          contactPhone: org.contactPhone ?? undefined,
          wishlistUrl: org.wishlistUrl ?? undefined,
          websiteUrl: org.websiteUrl ?? undefined,
        }));

      setOrganizations(withCoordinates);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return organizations;
}
