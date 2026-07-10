import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { useEffect, useMemo, useState } from 'react';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { Badge } from '../components/Badge';
import { useRegisteredDogs } from '../hooks/useRegisteredDogs';
import { useRegisteredOrganizations } from '../hooks/useRegisteredOrganizations';
import { dataClient } from '../lib/dataClient';
import type { Dog } from '../types/models';
import { calculateAgeLabel, genderLabel, isDogOpenForFosterOffers } from '../utils/dog';
import './DogListScreen.css';

interface DogListScreenProps {
  onSelectDog: (dogId: string) => void;
  onBack: () => void;
}

export function DogListScreen({
  onSelectDog,
  onBack,
}: DogListScreenProps) {
  const registeredDogs = useRegisteredDogs();
  const registeredOrganizations = useRegisteredOrganizations();

  const allDogs = registeredDogs;
  const allOrganizations = registeredOrganizations;

  const prefectureFilter = 'all';
  const [seekingOnly, setSeekingOnly] = useState(false);

  const [registeredMedia, setRegisteredMedia] = useState<
    Record<string, { thumbnailUrl?: string; placeholderColor?: string }>
  >({});

  // 登録された犬の最新サムネイル写真を非同期で取得する
  useEffect(() => {
    let cancelled = false;
    async function loadMedia() {
      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';
        const newMedia: Record<string, { thumbnailUrl?: string; placeholderColor?: string }> = {};

        const promises = registeredDogs.map(async (dog) => {
          try {
            const result = await dataClient.models.DogMedia.listByDogSortedByDate(
              { dogId: dog.id },
              { limit: 1, sortDirection: 'DESC', authMode }
            );
            if (result.data && result.data[0]) {
              const first = result.data[0];
              let url: string | undefined;
              if (first.thumbnailS3Key) {
                const urlResult = await getUrl({ path: first.thumbnailS3Key });
                url = urlResult.url.toString();
              } else if (first.s3Key) {
                const urlResult = await getUrl({ path: first.s3Key });
                url = urlResult.url.toString();
              }
              newMedia[dog.id] = {
                thumbnailUrl: url,
                placeholderColor: '#f3e8d6',
              };
            }
          } catch (err) {
            console.error('Failed to load latest media for dog', dog.id, err);
          }
        });

        await Promise.all(promises);
        if (!cancelled) {
          setRegisteredMedia(newMedia);
        }
      } catch (err) {
        console.error('Error fetching auth session for media loading', err);
      }
    }

    if (registeredDogs.length > 0) {
      loadMedia();
    }
  }, [registeredDogs]);

  // const prefectureOptions = useMemo(() => {
  //   return Array.from(new Set(allDogs.map((dog) => dog.prefecture).filter(Boolean))) as string[];
  // }, [allDogs]);

  const dogs: Dog[] = useMemo(
    () =>
      allDogs
        .filter((dog) => prefectureFilter === 'all' || dog.prefecture === prefectureFilter)
        .filter((dog) => !seekingOnly || dog.seekingFoster)
        .sort((a, b) => b.protectedDate.localeCompare(a.protectedDate)),
    [allDogs, prefectureFilter, seekingOnly],
  );

  return (
    <div className="dog-list-screen">
      <SecondaryHeader title="保護犬一覧" onBack={onBack} />

      <div className="dog-list-screen__filters">
        {/* <label className="dog-list-screen__filter-field">
          <span>地域</span>
          <select value={prefectureFilter} onChange={(e) => setPrefectureFilter(e.target.value)}>
            <option value="all">すべて</option>
            {prefectureOptions.map((pref) => (
              <option key={pref} value={pref}>
                {pref}
              </option>
            ))}
          </select>
        </label> */}
        <label className="dog-list-screen__filter-checkbox">
          <input type="checkbox" checked={seekingOnly} onChange={(e) => setSeekingOnly(e.target.checked)} />
          預かりボランティア募集中のみ
        </label>
      </div>

      <div className="dog-list-screen__body">
        {dogs.map((dog) => {
          const organization = allOrganizations.find((org) => org.id === dog.organizationId);

          const latestMedia = registeredMedia[dog.id];

          return (
            <button key={dog.id} type="button" className="dog-list-card" onClick={() => onSelectDog(dog.id)}>
              <div
                className="dog-list-card__thumb"
                style={
                  latestMedia?.thumbnailUrl
                    ? { backgroundImage: `url(${latestMedia.thumbnailUrl})` }
                    : latestMedia?.placeholderColor
                      ? { background: latestMedia.placeholderColor }
                      : undefined
                }
              >
                {!latestMedia?.thumbnailUrl && !latestMedia?.placeholderColor && (
                  <span className="dog-list-card__thumb-fallback" aria-hidden="true">
                    🐕
                  </span>
                )}
              </div>
              <div className="dog-list-card__info">
                <div className="dog-list-card__heading">
                  <span className="dog-list-card__name">{dog.name}</span>
                  <span className="dog-list-card__badges">
                    {/* <Badge tone="neutral">{effectiveDogStatusLabel(dog)}</Badge> */}
                    {dog.seekingAdopter && <Badge tone="success">里親募集中</Badge>}
                    {isDogOpenForFosterOffers(dog) && <Badge tone="accent">預かり募集中</Badge>}
                  </span>
                </div>
                <p className="dog-list-card__meta">
                  {genderLabel[dog.gender]} ・ {calculateAgeLabel(dog.birthDate, dog.birthDateEstimated)} ・{' '}
                  {dog.prefecture} {dog.city}
                </p>
                <p className="dog-list-card__personality">{dog.personality}</p>
                {organization && <p className="dog-list-card__org">{organization.name}</p>}
              </div>
            </button>
          );
        })}
        {dogs.length === 0 && <p className="dog-list-screen__empty">条件に一致する保護犬が見つかりませんでした</p>}
      </div>
    </div>
  );
}
