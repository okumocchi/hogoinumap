import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { getUrl, remove } from 'aws-amplify/storage';
import { type FormEvent, useEffect, useState } from 'react';
import { Badge } from '../components/Badge';
import { useRegisteredVolunteers } from '../hooks/useRegisteredVolunteers';
import { dataClient } from '../lib/dataClient';
import type { CustodianType, MediaType, Dog, Organization, DogStatus } from '../types/models';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { getOrCreateAnonToken } from '../utils/likeHelper';
import {
  calculateAgeAtLabel,
  calculateAgeLabel,
  calculateElapsedLabel,
  custodianTypeLabel,
  effectiveDogStatusLabel,
  genderLabel,
  isDogOpenForFosterOffers,
} from '../utils/dog';
import { uploadMediaFile } from '../utils/uploadDogMedia';
import './DogDetailScreen.css';

interface DogDetailScreenProps {
  dogId: string;
  onBack: () => void;
  onSelectOrganization: (organizationId: string) => void;
}

interface MediaItem {
  id: string;
  mediaType: MediaType;
  caption?: string;
  createdAt: string;
  likeCount: number;
  url?: string;
  thumbnailUrl?: string;
  placeholderColor?: string;
  owner?: string;
  s3Key?: string;
  thumbnailS3Key?: string;
}

interface CustodyHistoryItem {
  id: string;
  custodianType: CustodianType;
  custodianName: string;
  startDate: string;
}

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 日付(YYYY-MM-DD)をUTC基準でISO日時に変換する(タイムゾーンによる日付のずれを防ぐ)
function dateInputToIso(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

export function DogDetailScreen({ dogId, onBack, onSelectOrganization }: DogDetailScreenProps) {
  const registeredVolunteers = useRegisteredVolunteers();
  const [dog, setDog] = useState<Dog | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  // ほしいものリストURLの特定 (預かりボランティアまたは所属団体)
  const fosterVolunteer = dog?.custodianOwnerSub
    ? registeredVolunteers.find((v) => v.ownerSub === dog.custodianOwnerSub)
    : undefined;

  const dogWishlistUrl = dog?.status === 'FOSTERED'
    ? (fosterVolunteer?.wishlistUrl || undefined)
    : (organization?.wishlistUrl || undefined);

  const displayPref = (dog?.status === 'FOSTERED' && fosterVolunteer)
    ? fosterVolunteer.prefecture
    : dog?.prefecture;
  const displayCity = (dog?.status === 'FOSTERED' && fosterVolunteer)
    ? fosterVolunteer.city
    : dog?.city;

  useEffect(() => {
    let cancelled = false;

    async function loadDog() {
      setLoading(true);
      try {
        const session = await fetchAuthSession();
        const authMode = session.tokens ? 'userPool' : 'identityPool';

        // 1. 保護犬情報の取得
        const dogRes = await dataClient.models.Dog.get({ id: dogId }, { authMode });
        if (cancelled) return;

        if (!dogRes.data || dogRes.data.status === 'SUSPENDED') {
          setDog(null);
          setLoading(false);
          return;
        }

        const mappedDog: Dog = {
          id: dogRes.data.id,
          organizationId: dogRes.data.organizationId,
          name: dogRes.data.name ?? '',
          protectedDate: dogRes.data.protectedDate ?? '',
          story: dogRes.data.story ?? '',
          gender: dogRes.data.gender ?? 'UNKNOWN',
          size: dogRes.data.size ?? 'MEDIUM',
          birthDate: dogRes.data.birthDate ?? '',
          birthDateEstimated: dogRes.data.birthDateEstimated ?? false,
          personality: dogRes.data.personality ?? '',
          status: (dogRes.data.status ?? 'PROTECTED') as DogStatus,
          seekingAdopter: dogRes.data.seekingAdopter ?? true,
          seekingFoster: dogRes.data.seekingFoster ?? false,
          custodianOwnerSub: (dogRes.data.custodianOwnerSub as unknown as string | null) ?? undefined,
          sterilizationDate: dogRes.data.sterilizationDate ?? undefined,
          rabiesVaccinationDate: dogRes.data.rabiesVaccinationDate ?? undefined,
          mixedVaccinationDate: dogRes.data.mixedVaccinationDate ?? undefined,
          prefecture: dogRes.data.prefecture,
          city: dogRes.data.city,
        };

        setDog(mappedDog);

        // 2. 所属団体情報の取得
        const orgRes = await dataClient.models.Organization.get({ id: mappedDog.organizationId }, { authMode });
        if (cancelled) return;

        if (orgRes.data) {
          setOrganization({
            id: orgRes.data.id,
            name: orgRes.data.name,
            prefecture: orgRes.data.prefecture,
            city: orgRes.data.city,
            addressLine: orgRes.data.addressLine,
            latitude: orgRes.data.latitude as number,
            longitude: orgRes.data.longitude as number,
            contactEmail: orgRes.data.contactEmail ?? undefined,
            contactPhone: orgRes.data.contactPhone ?? undefined,
            wishlistUrl: orgRes.data.wishlistUrl ?? undefined,
            websiteUrl: orgRes.data.websiteUrl ?? undefined,
          });
        }
      } catch (err) {
        console.error('Failed to load dog details', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDog();
    return () => {
      cancelled = true;
    };
  }, [dogId]);

  const [media, setMedia] = useState<MediaItem[]>([]);

  async function fetchMedia(): Promise<MediaItem[]> {
    const session = await fetchAuthSession();
    const authMode = session.tokens ? 'userPool' : 'identityPool';

    // メディアと全いいねを並列取得
    const [result, likesResult] = await Promise.all([
      dataClient.models.DogMedia.listByDogSortedByDate({ dogId }, { sortDirection: 'DESC', authMode }),
      dataClient.models.MediaLike.list({ authMode, limit: 1000 }),
    ]);

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

    setLikedIds(myLikedMediaIds);
    setMyLikeIds(myLikeIdMap);

    return Promise.all(
      result.data.map(async (item) => {
        const { url } = await getUrl({ path: item.s3Key });
        const thumbnailUrl = item.thumbnailS3Key
          ? (await getUrl({ path: item.thumbnailS3Key })).url.toString()
          : undefined;
        return {
          id: item.id,
          mediaType: (item.mediaType ?? 'PHOTO') as MediaType,
          caption: item.caption ?? undefined,
          createdAt: item.capturedAt ?? item.createdAt ?? new Date().toISOString(),
          likeCount: likesMap[item.id] || 0,
          url: url.toString(),
          thumbnailUrl,
          owner: item.owner ?? undefined,
          s3Key: item.s3Key,
          thumbnailS3Key: item.thumbnailS3Key ?? undefined,
        };
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchMedia();
      if (!cancelled) setMedia(fetched);
    }

    load();

    return () => {
      cancelled = true;
    };
    // dogIdはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogId]);

  const [custodyHistory, setCustodyHistory] = useState<CustodyHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';
      const result = await dataClient.models.CustodyRecord.listCustodyRecordsByDog(
        { dogId },
        { sortDirection: 'ASC', authMode },
      );
      if (cancelled) return;
      setCustodyHistory(
        result.data.map((item) => ({
          id: item.id,
          custodianType: (item.custodianType ?? 'ORGANIZATION') as CustodianType,
          custodianName: item.custodianName,
          startDate: item.startDate,
        })),
      );
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [dogId]);

  // 現在ログイン中のユーザーが、この犬を今まさに預かっているボランティア本人かどうか
  // (custodianOwnerSubは預かり中の間もクリアせず保持し続ける。VolunteerDashboardScreen参照)
  const dogStatus = dog?.status;
  const dogCustodianOwnerSub = dog?.custodianOwnerSub;
  const [isCurrentFosterVolunteer, setIsCurrentFosterVolunteer] = useState(false);

  const [currentUserSub, setCurrentUserSub] = useState<string | null>(null);
  const [currentUserUsername, setCurrentUserUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function getAuth() {
      try {
        const { userId, username } = await getCurrentUser();
        if (!cancelled) {
          setCurrentUserSub(userId);
          setCurrentUserUsername(username);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserSub(null);
          setCurrentUserUsername(null);
        }
      }
    }
    getAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      console.log('DogDetailScreen debug:', { dogStatus, dogCustodianOwnerSub });
      if (dogStatus !== 'FOSTERED' || !dogCustodianOwnerSub) {
        if (!cancelled) setIsCurrentFosterVolunteer(false);
        return;
      }
      try {
        const { userId, username } = await getCurrentUser();
        const isMatch =
          dogCustodianOwnerSub === userId ||
          dogCustodianOwnerSub === username ||
          dogCustodianOwnerSub === `${userId}::${username}`;
        console.log('DogDetailScreen debug comparison:', { dogCustodianOwnerSub, userId, username, isMatch });
        if (!cancelled) setIsCurrentFosterVolunteer(isMatch);
      } catch (err) {
        console.error('DogDetailScreen debug error:', err);
        // ゲスト(未ログイン)
        if (!cancelled) setIsCurrentFosterVolunteer(false);
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, [dogStatus, dogCustodianOwnerSub]);

  const [personalityOverride, setPersonalityOverride] = useState<string | null>(null);
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [personalityDraft, setPersonalityDraft] = useState('');
  const [personalitySubmitting, setPersonalitySubmitting] = useState(false);
  const [personalityError, setPersonalityError] = useState<string | null>(null);

  function startEditingPersonality(currentPersonality: string) {
    setPersonalityDraft(personalityOverride ?? currentPersonality);
    setPersonalityError(null);
    setEditingPersonality(true);
  }

  async function handlePersonalitySubmit(event: FormEvent) {
    event.preventDefault();
    setPersonalitySubmitting(true);
    setPersonalityError(null);
    try {
      const result = await dataClient.models.Dog.update(
        { id: dogId, personality: personalityDraft },
        { authMode: 'userPool' },
      );
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      setPersonalityOverride(personalityDraft);
      setEditingPersonality(false);
    } catch (err) {
      setPersonalityError(err instanceof Error ? err.message : '更新に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setPersonalitySubmitting(false);
    }
  }

  const [editingMedia, setEditingMedia] = useState<MediaItem | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editResendFile, setEditResendFile] = useState<File | null>(null);
  const [editCapturedDate, setEditCapturedDate] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function handleOpenEditMediaPanel(item: MediaItem) {
    setEditingMedia(item);
    setEditCaption(item.caption ?? '');
    setEditResendFile(null);
    setEditCapturedDate(item.createdAt ? item.createdAt.slice(0, 10) : today());
    setConfirmingDelete(false);
    setEditError(null);
  }

  function handleCloseEditMediaPanel() {
    setEditingMedia(null);
    setEditCaption('');
    setEditResendFile(null);
    setEditCapturedDate('');
    setConfirmingDelete(false);
    setEditError(null);
  }

  async function handleEditMediaSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingMedia) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      let newS3Key: string | undefined;
      let newThumbnailS3Key: string | undefined;
      let newCapturedAt: string | undefined;

      if (editResendFile) {
        const { path, thumbnailPath, capturedAt } = await uploadMediaFile(dogId, editResendFile);
        newS3Key = path;
        newThumbnailS3Key = thumbnailPath;
        if (capturedAt) newCapturedAt = capturedAt.toISOString();

        if (editingMedia.s3Key) {
          await remove({ path: editingMedia.s3Key }).catch(() => undefined);
        }
        if (editingMedia.thumbnailS3Key) {
          await remove({ path: editingMedia.thumbnailS3Key }).catch(() => undefined);
        }
      }

      const updateInput = {
        id: editingMedia.id,
        caption: editCaption || null,
        capturedAt: newCapturedAt ?? dateInputToIso(editCapturedDate),
        ...(newS3Key ? { s3Key: newS3Key } : {}),
        ...(newThumbnailS3Key ? { thumbnailS3Key: newThumbnailS3Key } : {}),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.DogMedia.update(updateInput as any, {
        authMode: 'userPool',
      });
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      setMedia(await fetchMedia());
      handleCloseEditMediaPanel();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '更新に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteMedia() {
    if (!editingMedia) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const result = await dataClient.models.DogMedia.delete(
        { id: editingMedia.id },
        { authMode: 'userPool' }
      );
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      if (editingMedia.s3Key) {
        await remove({ path: editingMedia.s3Key }).catch(() => undefined);
      }
      if (editingMedia.thumbnailS3Key) {
        await remove({ path: editingMedia.thumbnailS3Key }).catch(() => undefined);
      }

      setMedia(await fetchMedia());
      handleCloseEditMediaPanel();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '削除に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEditSubmitting(false);
    }
  }

  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function openMediaPanel() {
    setUploadFile(null);
    setUploadCaption('');
    setUploadError(null);
    setMediaPanelOpen(true);
  }

  async function handleUploadSubmit(event: FormEvent) {
    event.preventDefault();
    setUploadError(null);

    if (!uploadFile) {
      setUploadError('ファイルを選択してください。');
      return;
    }

    setUploading(true);
    try {
      const { path, thumbnailPath, capturedAt } = await uploadMediaFile(dogId, uploadFile);
      const mediaType: MediaType = uploadFile.type.startsWith('video/') ? 'VIDEO' : 'PHOTO';
      const mediaInput = {
        dogId,
        mediaType,
        s3Key: path,
        thumbnailS3Key: thumbnailPath,
        caption: uploadCaption || undefined,
        // EXIFから撮影日時が取得できない場合は投稿日時を撮影日時とする
        capturedAt: (capturedAt ?? new Date()).toISOString(),
      };
      // data-schemaの型推論バグを回避するためas anyを使用(OrganizationDogDetailScreenと同様)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.DogMedia.create(mediaInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      setMediaPanelOpen(false);
      setMedia(await fetchMedia());
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました。時間をおいて再度お試しください。');
    } finally {
      setUploading(false);
    }
  }

  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [myLikeIds, setMyLikeIds] = useState<Record<string, string>>({}); // dogMediaId -> MediaLike.id
  const [lightboxMedia, setLightboxMedia] = useState<{ mediaType: MediaType; url: string } | null>(null);

  useEffect(() => {
    if (lightboxMedia) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [lightboxMedia]);

  async function toggleLike(mediaId: string) {
    const token = getOrCreateAnonToken();
    const session = await fetchAuthSession();
    const authMode = session.tokens ? 'userPool' : 'identityPool';

    const isLiked = likedIds.has(mediaId);

    if (isLiked) {
      const likeId = myLikeIds[mediaId];
      if (likeId) {
        // 楽観的UIアップデート
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
      // 楽観的UIアップデート
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

  if (loading) {
    return (
      <div className="dog-detail dog-detail--loading">
        <SecondaryHeader title="保護犬詳細" onBack={onBack} />
        <div className="dog-detail__body" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <p>読み込み中…</p>
        </div>
      </div>
    );
  }

  if (!dog) {
    return (
      <div className="dog-detail dog-detail--not-found">
        <SecondaryHeader title="保護犬詳細" onBack={onBack} />
        <div className="dog-detail__body" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <p>保護犬情報が見つかりませんでした。</p>
          <button type="button" className="dog-detail__small-button" onClick={onBack}>
            戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dog-detail">
      <SecondaryHeader title="保護犬詳細" onBack={onBack} />

      <div className="dog-detail__body">
        <section className="dog-detail__header">
          <h1 className="dog-detail__name">{dog.name}</h1>
          <div className="dog-detail__badges">
            <Badge tone="neutral">{effectiveDogStatusLabel(dog)}</Badge>
            {dog.seekingAdopter && <Badge tone="success">里親募集中</Badge>}
            {isDogOpenForFosterOffers(dog) && <Badge tone="accent">預かりボランティア募集中</Badge>}
          </div>
          <dl className="dog-detail__facts">
            <div>
              <dt>性別</dt>
              <dd>{genderLabel[dog.gender]}</dd>
            </div>
            <div>
              <dt>年齢</dt>
              <dd>{calculateAgeLabel(dog.birthDate, dog.birthDateEstimated)}</dd>
            </div>
            <div>
              <dt>保護日</dt>
              <dd>{dog.protectedDate}</dd>
            </div>
            <div>
              <dt>現在の保護場所</dt>
              <dd>
                {displayPref} {displayCity}
              </dd>
            </div>
            {organization && (
              <div>
                <dt>保護団体</dt>
                <dd>
                  <button
                    type="button"
                    onClick={() => onSelectOrganization(organization.id)}
                    className="dog-detail__org-link"
                  >
                    {organization.name}
                  </button>
                </dd>
                <div className='dog-detail__block__org_link'>里親希望の方、預かりボランティアを希望される方は保護団体のWEBサイトをご確認ください</div>
              </div>
            )}


          </dl>
          <div className="dog-detail__block">
            <h2>保護の経緯</h2>
            <p>{dog.story}</p>
          </div>
          <div className="dog-detail__block">
            <div className="dog-detail__block-heading">
              <h2>性格・状況</h2>
              {isCurrentFosterVolunteer && !editingPersonality && (
                <button
                  type="button"
                  className="dog-detail__icon-edit-button"
                  onClick={() => startEditingPersonality(personalityOverride ?? dog.personality)}
                  title="性格・状況を編集"
                >
                  ✏️
                </button>
              )}
            </div>
            {editingPersonality ? (
              <form className="dog-detail__inline-form" onSubmit={handlePersonalitySubmit}>
                <textarea
                  rows={3}
                  value={personalityDraft}
                  onChange={(e) => setPersonalityDraft(e.target.value)}
                />
                {personalityError && <p className="dog-detail__error">{personalityError}</p>}
                <div className="dog-detail__inline-form-actions">
                  <button
                    type="button"
                    className="dog-detail__link-button"
                    onClick={() => setEditingPersonality(false)}
                  >
                    キャンセル
                  </button>
                  <button type="submit" className="dog-detail__small-button" disabled={personalitySubmitting}>
                    {personalitySubmitting ? '保存中…' : '保存する'}
                  </button>
                </div>
              </form>
            ) : (
              <p>{personalityOverride ?? dog.personality}</p>
            )}
          </div>
        </section>

        <section className="dog-detail__media">
          <div className="dog-detail__block-heading">
            <h2>写真・動画</h2>
            {isCurrentFosterVolunteer && (
              <button
                type="button"
                className="dog-detail__inline-edit-button"
                onClick={() => (mediaPanelOpen ? setMediaPanelOpen(false) : openMediaPanel())}
              >
                {mediaPanelOpen ? 'キャンセル' : '+ メディアを追加'}
              </button>
            )}
          </div>

          {mediaPanelOpen && (
            <form className="dog-detail__upload-form" onSubmit={handleUploadSubmit}>
              <label className="dog-detail__upload-field">
                <span>ファイル(画像・動画)</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="dog-detail__upload-field">
                <span>コメント(任意)</span>
                <input type="text" value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} />
              </label>
              {uploadError && <p className="dog-detail__error">{uploadError}</p>}
              <button type="submit" className="dog-detail__small-button" disabled={uploading}>
                {uploading ? 'アップロード中…' : '追加する'}
              </button>
            </form>
          )}

          <div className="dog-detail__media-grid">
            {media.map((item) => {
              const liked = likedIds.has(item.id);
              const displayCount = item.likeCount;
              const isOwner =
                item.owner &&
                (item.owner === currentUserSub ||
                  item.owner === currentUserUsername ||
                  item.owner === `${currentUserSub}::${currentUserUsername}`);
              return (
                <article key={item.id} className="media-card">
                  <span className="media-card__age-badge">
                    {calculateAgeAtLabel(dog.birthDate, item.createdAt)}（{calculateElapsedLabel(item.createdAt)}）
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      className="media-card__edit-button"
                      onClick={() => handleOpenEditMediaPanel(item)}
                      title="投稿を編集"
                    >
                      ✏️
                    </button>
                  )}
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
                      // 一覧表示には長辺300pxのサムネイルを使う(本体画像は最大1200pxで一覧用途には過大)。
                      // クリック時の拡大表示(ライトボックス)は本体画像の方を開く
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
                      <div className="media-card__thumb" style={{ background: 'item.placeholderColor' }}>
                        <span className="media-card__type" aria-hidden="true">
                          {item.mediaType === 'VIDEO' ? '🎥' : '📷'}
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
                    {dogWishlistUrl && (
                      <a
                        href={dogWishlistUrl}
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
            {media.length === 0 && <p className="dog-detail__media-empty">まだ写真・動画が投稿されていません</p>}
          </div>
        </section>

        <section className="dog-detail__history">
          <h2>預かり履歴</h2>
          {custodyHistory.length === 0 ? (
            <p className="dog-detail__history-empty">履歴情報がありません</p>
          ) : (
            <ul className="dog-detail__history-list">
              {custodyHistory.map((item) => (
                <li key={item.id} className="dog-detail__history-item">
                  <span className="dog-detail__history-date">{item.startDate}</span>
                  <span className="dog-detail__history-name">
                    {custodianTypeLabel[item.custodianType]}「{item.custodianName}」
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* 
        {organization && (
          <section className="dog-detail__org">
            <h2>保護団体</h2>
            <div className="org-card">
              <p className="org-card__name">{organization.name}</p>
              <p className="org-card__meta">
                {organization.prefecture} {organization.city}
              </p>
              {organization.wishlistUrl && (
                <a className="org-card__wishlist" href={organization.wishlistUrl} target="_blank" rel="noreferrer">
                  ほしいものリストを見る ↗
                </a>
              )}
            </div>
          </section>
        )} */}

        {/* <section className="dog-detail__contact">
          {inquirySent ? (
            <p className="dog-detail__contact-sent">
              問い合わせ導線（S4 問い合わせフォーム）へ遷移します。※本モックアップでは未実装
            </p>
          ) : (
            <button type="button" className="dog-detail__contact-button" onClick={() => setInquirySent(true)}>
              この保護犬について問い合わせる
            </button>
          )}
        </section> */}
      </div>

      {editingMedia && (
        <div className="dog-detail__modal-overlay" onClick={handleCloseEditMediaPanel}>
          <div className="dog-detail__modal" onClick={(e) => e.stopPropagation()}>
            <h3>メディアを編集</h3>
            <form onSubmit={handleEditMediaSubmit}>
              <label className="dog-detail__modal-field">
                <span>ファイルを再送信(任意、選択時のみ差し替え)</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => setEditResendFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="dog-detail__modal-field">
                <span>撮影日(EXIFから取得できない場合に設定)</span>
                <input
                  type="date"
                  max={today()}
                  value={editCapturedDate}
                  onChange={(e) => setEditCapturedDate(e.target.value)}
                />
              </label>
              <label className="dog-detail__modal-field">
                <span>コメント</span>
                <input
                  type="text"
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                />
              </label>
              {editError && <p className="dog-detail__error">{editError}</p>}
              <div className="dog-detail__modal-actions">
                <div className="dog-detail__modal-left-actions">
                  {confirmingDelete ? (
                    <span className="dog-detail__delete-confirm">
                      本当に削除しますか？
                      <button
                        type="button"
                        className="dog-detail__danger-button"
                        disabled={editSubmitting}
                        onClick={handleDeleteMedia}
                        style={{ marginLeft: '8px' }}
                      >
                        削除する
                      </button>
                      <button
                        type="button"
                        className="dog-detail__link-button"
                        onClick={() => setConfirmingDelete(false)}
                        style={{ marginLeft: '8px' }}
                      >
                        やめる
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="dog-detail__danger-button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      削除する
                    </button>
                  )}
                </div>
                <div className="dog-detail__modal-right-actions">
                  <button
                    type="button"
                    className="dog-detail__link-button"
                    onClick={handleCloseEditMediaPanel}
                    disabled={editSubmitting}
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="dog-detail__small-button"
                    disabled={editSubmitting}
                  >
                    {editSubmitting ? '更新中…' : '更新する'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {lightboxMedia && (
        <div className="dog-detail__lightbox" onClick={() => setLightboxMedia(null)}>
          {lightboxMedia.mediaType === 'VIDEO' ? (
            <video
              className="dog-detail__lightbox-video"
              src={lightboxMedia.url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img className="dog-detail__lightbox-image" src={lightboxMedia.url} alt="" />
          )}
        </div>
      )}
    </div>
  );
}
