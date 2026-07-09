import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import type { Dog, DogStatus } from '../types/models';

// 地図画面で「募集中の団体」を判定するために、登録済みの保護犬を全件取得する。
// useRegisteredOrganizationsと同様、ログイン状態に応じてauthModeを切り替える。
export function useRegisteredDogs(): Dog[] {
  const [dogs, setDogs] = useState<Dog[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';
      const result = await dataClient.models.Dog.list({ authMode });
      if (cancelled) return;

      const mapped: Dog[] = result.data.map((dog) => ({
        id: dog.id,
        organizationId: dog.organizationId,
        name: dog.name ?? '',
        protectedDate: dog.protectedDate ?? '',
        story: dog.story ?? '',
        gender: dog.gender ?? 'UNKNOWN',
        size: dog.size ?? 'MEDIUM',
        birthDate: dog.birthDate ?? '',
        birthDateEstimated: dog.birthDateEstimated ?? false,
        personality: dog.personality ?? '',
        status: (dog.status ?? 'PROTECTED') as DogStatus,
        seekingAdopter: dog.seekingAdopter ?? true,
        seekingFoster: dog.seekingFoster ?? false,
        custodianOwnerSub: (dog.custodianOwnerSub as unknown as string | null) ?? undefined,
        sterilizationDate: dog.sterilizationDate ?? undefined,
        rabiesVaccinationDate: dog.rabiesVaccinationDate ?? undefined,
        mixedVaccinationDate: dog.mixedVaccinationDate ?? undefined,
        prefecture: dog.prefecture,
        city: dog.city,
      }));

      const filtered = mapped.filter((dog) => dog.status !== 'SUSPENDED');
      setDogs(filtered);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return dogs;
}
