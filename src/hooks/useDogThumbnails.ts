import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';

// マップのポップアップ・詳細ページで、犬ごとに最新のサムネイル画像(なければ本体画像)を1枚取得する。
// 対象の犬が変わるたびに呼び直す想定のため、dogIdsは呼び出し側でメモ化すること。
export function useDogThumbnails(dogIds: string[]): Record<string, string | undefined> {
  const key = dogIds.join(',');
  const [thumbnails, setThumbnails] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];

    async function load() {
      if (ids.length === 0) {
        setThumbnails({});
        return;
      }

      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';

      const entries = await Promise.all(
        ids.map(async (dogId) => {
          const result = await dataClient.models.DogMedia.listByDogSortedByDate(
            { dogId },
            { sortDirection: 'DESC', authMode, limit: 1 },
          );
          const latest = result.data[0];
          if (!latest) return [dogId, undefined] as const;

          const path = latest.thumbnailS3Key ?? latest.s3Key;
          const { url } = await getUrl({ path });
          return [dogId, url.toString()] as const;
        }),
      );

      if (!cancelled) {
        setThumbnails(Object.fromEntries(entries));
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return thumbnails;
}
