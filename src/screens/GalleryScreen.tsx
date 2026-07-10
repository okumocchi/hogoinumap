import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { useEffect, useMemo, useState } from 'react';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { useRegisteredDogs } from '../hooks/useRegisteredDogs';
import { useRegisteredOrganizations } from '../hooks/useRegisteredOrganizations';
import { useRegisteredVolunteers } from '../hooks/useRegisteredVolunteers';
import { dataClient } from '../lib/dataClient';
import { calculateAgeAtLabel, calculateElapsedLabel } from '../utils/dog';
import { getOrCreateAnonToken } from '../utils/likeHelper';
import './GalleryScreen.css';

interface GalleryScreenProps {
  onSelectDog: (dogId: string) => void;
  onBack: () => void;
}

interface GalleryMediaItem {
  id: string;
  dogId: string;
  mediaType: 'PHOTO' | 'VIDEO';
  s3Key: string;
  thumbnailS3Key?: string;
  caption?: string;
  capturedAt?: string;
  createdAt: string;
  likeCount: number;
  url: string;
  thumbnailUrl?: string;
}

export function GalleryScreen({ onSelectDog, onBack }: GalleryScreenProps) {
  const registeredDogs = useRegisteredDogs();
  const registeredOrganizations = useRegisteredOrganizations();
  const registeredVolunteers = useRegisteredVolunteers();
  const [media, setMedia] = useState<GalleryMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'new' | 'likes'>('new');
  const [displayLimit, setDisplayLimit] = useState(30);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [myLikeIds, setMyLikeIds] = useState<Record<string, string>>({}); // dogMediaId -> MediaLike.id
  const [lightboxMedia, setLightboxMedia] = useState<{ mediaType: 'PHOTO' | 'VIDEO'; url: string } | null>(null);

  async function toggleLike(mediaId: string) {
    const token = getOrCreateAnonToken();
    const session = await fetchAuthSession();
    const authMode = session.tokens ? 'userPool' : 'identityPool';

    const isLiked = likedIds.has(mediaId);

    if (isLiked) {
      const likeId = myLikeIds[mediaId];
      if (likeId) {
        // 楽観的UIアップデート (先に表示を切り替える)
        setLikedIds((prev) => {
          const next = new Set(prev);
          next.delete(mediaId);
          return next;
        });
        setMedia((prev) =>
          prev.map((item) =>
            item.id === mediaId ? { ...item, likeCount: Math.max(0, item.likeCount - 1) } : item
          )
        );

        try {
          await dataClient.models.MediaLike.delete({ id: likeId }, { authMode });
          setMyLikeIds((prev) => {
            const next = { ...prev };
            delete next[mediaId];
            return next;
          });
        } catch (err) {
          console.error('Failed to unlike', err);
          // 失敗時のロールバック
          setLikedIds((prev) => {
            const next = new Set(prev);
            next.add(mediaId);
            return next;
          });
          setMedia((prev) =>
            prev.map((item) =>
              item.id === mediaId ? { ...item, likeCount: item.likeCount + 1 } : item
            )
          );
        }
      }
    } else {
      // 楽観的UIアップデート (先に表示を切り替える)
      setLikedIds((prev) => {
        const next = new Set(prev);
        next.add(mediaId);
        return next;
      });
      setMedia((prev) =>
        prev.map((item) =>
          item.id === mediaId ? { ...item, likeCount: item.likeCount + 1 } : item
        )
      );

      try {
        const res = await dataClient.models.MediaLike.create(
          {
            dogMediaId: mediaId,
            anonToken: token,
          } as any,
          { authMode }
        );

        if (res.data) {
          setMyLikeIds((prev) => ({
            ...prev,
            [mediaId]: res.data.id,
          }));
        }
      } catch (err) {
        console.error('Failed to like', err);
        // 失敗時のロールバック
        setLikedIds((prev) => {
          const next = new Set(prev);
          next.delete(mediaId);
          return next;
        });
        setMedia((prev) =>
          prev.map((item) =>
            item.id === mediaId ? { ...item, likeCount: Math.max(0, item.likeCount - 1) } : item
          )
        );
      }
    }
  }

  // 公開中（非公開停止中）の保護犬IDのSetを構築
  const validDogIds = useMemo(() => new Set(registeredDogs.map((d) => d.id)), [registeredDogs]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (registeredDogs.length === 0) {
        // useRegisteredDogsがロード中または0件の場合は処理をスキップ
        return;
      }
      setLoading(true);

      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';

        // いいねとメディアを並列取得
        const [mediaResult, likesResult] = await Promise.all([
          dataClient.models.DogMedia.list({ authMode, limit: 1000 }),
          dataClient.models.MediaLike.list({ authMode, limit: 1000 }),
        ]);

        if (cancelled) return;

        // メディアごとにいいね数を集計し、自分自身のいいねをマッピングする
        const token = getOrCreateAnonToken();
        const likesMap: Record<string, number> = {};
        const myLikedMediaIds = new Set<string>();
        const myLikeIdMap: Record<string, string> = {};

        likesResult.data.forEach((like) => {
          if (like.dogMediaId) {
            likesMap[like.dogMediaId] = (likesMap[like.dogMediaId] || 0) + 1;
            if (like.anonToken === token) {
              myLikedMediaIds.add(like.dogMediaId);
              myLikeIdMap[like.dogMediaId] = like.id;
            }
          }
        });

        // 「公開停止」ではない犬のメディアのみに絞り込む
        const filteredMedia = mediaResult.data.filter((item) => validDogIds.has(item.dogId));

        // S3署名付きURLの解決
        const items = await Promise.all(
          filteredMedia.map(async (item): Promise<GalleryMediaItem | null> => {
            try {
              const { url } = await getUrl({ path: item.s3Key });
              const thumbnailUrl = item.thumbnailS3Key
                ? (await getUrl({ path: item.thumbnailS3Key })).url.toString()
                : undefined;

              return {
                id: item.id,
                dogId: item.dogId,
                mediaType: (item.mediaType ?? 'PHOTO') as 'PHOTO' | 'VIDEO',
                s3Key: item.s3Key,
                thumbnailS3Key: item.thumbnailS3Key ?? undefined,
                caption: item.caption ?? undefined,
                capturedAt: item.capturedAt ?? undefined,
                createdAt: item.createdAt,
                likeCount: likesMap[item.id] || 0,
                url: url.toString(),
                thumbnailUrl,
              };
            } catch (err) {
              console.error('Failed to resolve URL for key', item.s3Key, err);
              return null;
            }
          })
        );

        if (cancelled) return;

        const validItems = items.filter((item): item is GalleryMediaItem => item !== null);
        setMedia(validItems);
        setLikedIds(myLikedMediaIds);
        setMyLikeIds(myLikeIdMap);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load gallery data', err);
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [registeredDogs, validDogIds]);

  // ソートされたメディア
  const sortedMedia = useMemo(() => {
    return [...media].sort((a, b) => {
      if (sortBy === 'likes') {
        if (b.likeCount !== a.likeCount) {
          return b.likeCount - a.likeCount;
        }
        // いいね数が同じなら撮影日の新しい順にする
      }
      const dateA = a.capturedAt || a.createdAt;
      const dateB = b.capturedAt || b.createdAt;
      return dateB.localeCompare(dateA);
    });
  }, [media, sortBy]);

  // 表示するメディア
  const displayedMedia = useMemo(() => {
    return sortedMedia.slice(0, displayLimit);
  }, [sortedMedia, displayLimit]);

  // 無限スクロールイベントハンドラ
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const threshold = 100; // 下端から100px以内に達したら追加ロード
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + threshold) {
      if (displayLimit < sortedMedia.length) {
        setDisplayLimit((prev) => prev + 30);
      }
    }
  }

  return (
    <div className="gallery-screen" onScroll={handleScroll}>
      <SecondaryHeader title="ギャラリー" onBack={onBack} />

      <div className="gallery-screen__body">
        {/* ソート順切り替えタブ */}
        <div className="gallery-screen__sort-tabs">
          <button
            type="button"
            className={`gallery-screen__sort-tab ${sortBy === 'new' ? 'is-active' : ''}`}
            onClick={() => {
              setSortBy('new');
              setDisplayLimit(30);
            }}
          >
            新着順
          </button>
          <button
            type="button"
            className={`gallery-screen__sort-tab ${sortBy === 'likes' ? 'is-active' : ''}`}
            onClick={() => {
              setSortBy('likes');
              setDisplayLimit(30);
            }}
          >
            人気順
          </button>
        </div>

        {loading ? (
          <p className="gallery-screen__message">メディアを読み込み中…</p>
        ) : displayedMedia.length === 0 ? (
          <p className="gallery-screen__message">投稿されたメディアはありません。</p>
        ) : (
          <div className="gallery-screen__media-grid">
            {displayedMedia.map((item) => {
              const dog = registeredDogs.find((d) => d.id === item.dogId);
              if (!dog) return null;

              const liked = likedIds.has(item.id);
              const displayCount = item.likeCount;

              // ほしいものリストURLの特定 (預かりボランティアまたは所属団体)
              const fosterVolunteer = dog.custodianOwnerSub
                ? registeredVolunteers.find((v) => v.ownerSub === dog.custodianOwnerSub)
                : undefined;
              const organization = registeredOrganizations.find((o) => o.id === dog.organizationId);

              const wishlistUrl = (dog.status === 'FOSTERED' && fosterVolunteer?.wishlistUrl)
                ? fosterVolunteer.wishlistUrl
                : organization?.wishlistUrl;

              return (
                <article key={item.id} className="media-card">
                  <span className="media-card__age-badge">
                    {calculateAgeAtLabel(dog.birthDate, item.capturedAt || item.createdAt)}（{calculateElapsedLabel(item.capturedAt || item.createdAt)}）
                  </span>
                  <button
                    type="button"
                    className="media-card__detail-button"
                    onClick={() => onSelectDog(item.dogId)}
                    title={`${dog.name}の詳細を見る`}
                  >
                    ℹ️ {dog.name}
                  </button>
                  <div className="media-card__media-container">
                    {item.mediaType === 'VIDEO' && item.url ? (
                      <video
                        className="media-card__thumb media-card__thumb--clickable"
                        src={item.url}
                        poster={item.thumbnailUrl}
                        muted
                        preload="metadata"
                        onClick={() => setLightboxMedia({ mediaType: 'VIDEO', url: item.url })}
                      />
                    ) : item.thumbnailUrl ? (
                      <img
                        className="media-card__thumb media-card__thumb--clickable"
                        src={item.thumbnailUrl}
                        alt={item.caption ?? dog.name}
                        onClick={() => setLightboxMedia({ mediaType: 'PHOTO', url: item.url ?? item.thumbnailUrl })}
                      />
                    ) : item.url ? (
                      <img
                        className="media-card__thumb media-card__thumb--clickable"
                        src={item.url}
                        alt={item.caption ?? dog.name}
                        onClick={() => setLightboxMedia({ mediaType: 'PHOTO', url: item.url })}
                      />
                    ) : (
                      <div className="media-card__thumb">
                        <span className="media-card__type" aria-hidden="true">
                          🎥
                        </span>
                      </div>
                    )}
                  </div>
                  {item.caption && (
                    <div className="media-card__caption-container">
                      <p className="media-card__caption">{item.caption}</p>
                    </div>
                  )}
                  <div className="media-card__actions-container">
                    {wishlistUrl && (
                      <a
                        href={wishlistUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="media-card__gift-link"
                        title="プレゼントを贈る（ほしいものリスト）"
                      >
                        🎁
                      </a>
                    )}
                    <button
                      type="button"
                      className={`media-card__like ${liked ? 'is-liked' : ''}`}
                      onClick={() => toggleLike(item.id)}
                      aria-pressed={liked}
                    >
                      {liked ? '❤️' : '🤍'} {displayCount}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && displayLimit < sortedMedia.length && (
          <p className="gallery-screen__loading-more">さらに読み込み中…</p>
        )}
      </div>

      {lightboxMedia && (
        <div
          className="dog-detail__lightbox"
          role="button"
          tabIndex={0}
          onClick={() => setLightboxMedia(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setLightboxMedia(null);
          }}
        >
          {lightboxMedia.mediaType === 'VIDEO' ? (
            <video
              className="dog-detail__lightbox-video"
              src={lightboxMedia.url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              className="dog-detail__lightbox-image"
              src={lightboxMedia.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
