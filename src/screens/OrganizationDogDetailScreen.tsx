import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl, remove } from 'aws-amplify/storage';
import { type FormEvent, useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import type { CustodianType, Dog, MediaType } from '../types/models';
import {
  calculateAgeAtLabel,
  calculateAgeLabel,
  calculateElapsedLabel,
  custodianTypeLabel,
  effectiveDogStatusLabel,
  genderLabel,
} from '../utils/dog';
import { uploadMediaFile } from '../utils/uploadDogMedia';
import './OrganizationDogDetailScreen.css';

interface OrganizationDogDetailScreenProps {
  dog: Dog;
  onBack: () => void;
  onEdit: () => void;
  onDogsChanged: () => Promise<void>;
}

interface CustodyHistoryItem {
  id: string;
  custodianType: CustodianType;
  custodianName: string;
  startDate: string;
}

interface PendingFosterRequest {
  matchId: string;
  volunteerName: string;
}

interface MediaItem {
  id: string;
  mediaType: MediaType;
  caption?: string;
  capturedAt: string;
  s3Key: string;
  url: string;
  thumbnailS3Key?: string;
  thumbnailUrl?: string;
}

type Panel = { type: 'none' } | { type: 'add' } | { type: 'edit'; mediaId: string };

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

export function OrganizationDogDetailScreen({ dog, onBack, onEdit, onDogsChanged }: OrganizationDogDetailScreenProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [panel, setPanel] = useState<Panel>({ type: 'none' });
  const [lightboxMedia, setLightboxMedia] = useState<{ mediaType: MediaType; url: string } | null>(null);

  const [custodyHistory, setCustodyHistory] = useState<CustodyHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<string>('');
  const [historySaving, setHistorySaving] = useState<string | null>(null);

  async function fetchCustodyHistory() {
    try {
      const session = await fetchAuthSession();
      const authMode = session.tokens ? 'userPool' : 'identityPool';
      const result = await dataClient.models.CustodyRecord.listCustodyRecordsByDog(
        { dogId: dog.id },
        { sortDirection: 'ASC', authMode }
      );
      setCustodyHistory(
        result.data.map((item) => ({
          id: item.id,
          custodianType: (item.custodianType ?? 'ORGANIZATION') as CustodianType,
          custodianName: item.custodianName,
          startDate: item.startDate,
        }))
      );
    } catch (err) {
      console.error('Failed to fetch custody history', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    fetchCustodyHistory();
  }, [dog.id]);

  async function handleSaveHistoryDate(id: string) {
    if (!editingDateValue) return;
    setHistorySaving(id);
    try {
      const result = await dataClient.models.CustodyRecord.update(
        {
          id,
          startDate: editingDateValue,
        } as any,
        { authMode: 'userPool' }
      );
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      await fetchCustodyHistory();
      setEditingHistoryId(null);
    } catch (err) {
      console.error('Failed to update custody history date', err);
      alert('日付の更新に失敗しました。');
    } finally {
      setHistorySaving(null);
    }
  }

  const [pendingFosterRequest, setPendingFosterRequest] = useState<PendingFosterRequest | null>(null);
  const [fosterActionSubmitting, setFosterActionSubmitting] = useState(false);
  const [fosterActionError, setFosterActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!dog.custodianOwnerSub) {
        setPendingFosterRequest(null);
        return;
      }

      const matchResult = await dataClient.models.Match.listMatchesByDog({ dogId: dog.id }, { authMode: 'userPool' });
      const activeMatch = matchResult.data.find((match) => match.status === 'REQUESTED' || match.status === 'NEGOTIATING');
      if (!activeMatch) {
        if (!cancelled) setPendingFosterRequest(null);
        return;
      }

      const volunteerResult = await dataClient.models.Volunteer.get(
        { id: activeMatch.volunteerId },
        { authMode: 'userPool' },
      );
      if (cancelled) return;
      setPendingFosterRequest({
        matchId: activeMatch.id,
        volunteerName: volunteerResult.data?.handleName ?? '(不明なボランティア)',
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [dog.id, dog.custodianOwnerSub]);

  async function handleAcceptFosterRequest() {
    if (!pendingFosterRequest) return;
    setFosterActionSubmitting(true);
    setFosterActionError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dogResult = await dataClient.models.Dog.update({ id: dog.id, status: 'IN_TRANSIT' } as any, {
        authMode: 'userPool',
      });
      if (dogResult.errors?.length) {
        throw new Error(dogResult.errors.map((e) => e.message).join(' / '));
      }
      const matchResult = await dataClient.models.Match.update(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: pendingFosterRequest.matchId, status: 'CONFIRMED' } as any,
        { authMode: 'userPool' },
      );
      if (matchResult.errors?.length) {
        throw new Error(matchResult.errors.map((e) => e.message).join(' / '));
      }
      await onDogsChanged();
    } catch (err) {
      setFosterActionError(err instanceof Error ? err.message : '処理に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setFosterActionSubmitting(false);
    }
  }

  async function handleDeclineFosterRequest() {
    if (!pendingFosterRequest) return;
    setFosterActionSubmitting(true);
    setFosterActionError(null);
    try {
      // custodianOwnerSubをクリアする際はnullではなく空文字列を使う
      // (VolunteerDashboardScreen.tsxのhandleReceiveDogのコメント参照)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dogResult = await dataClient.models.Dog.update({ id: dog.id, custodianOwnerSub: '' } as any, {
        authMode: 'userPool',
      });
      if (dogResult.errors?.length) {
        throw new Error(dogResult.errors.map((e) => e.message).join(' / '));
      }
      const matchResult = await dataClient.models.Match.update(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: pendingFosterRequest.matchId, status: 'CANCELLED' } as any,
        { authMode: 'userPool' },
      );
      if (matchResult.errors?.length) {
        throw new Error(matchResult.errors.map((e) => e.message).join(' / '));
      }
      await onDogsChanged();
    } catch (err) {
      setFosterActionError(err instanceof Error ? err.message : '処理に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setFosterActionSubmitting(false);
    }
  }

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [editCaption, setEditCaption] = useState('');
  const [editCapturedDate, setEditCapturedDate] = useState('');
  const [editResendFile, setEditResendFile] = useState<File | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function fetchMedia(): Promise<MediaItem[]> {
    const result = await dataClient.models.DogMedia.listByDogSortedByDate(
      { dogId: dog.id },
      { sortDirection: 'DESC', authMode: 'userPool' },
    );
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
          capturedAt: item.capturedAt ?? item.createdAt ?? new Date().toISOString(),
          s3Key: item.s3Key,
          url: url.toString(),
          thumbnailS3Key: item.thumbnailS3Key ?? undefined,
          thumbnailUrl,
        };
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchMedia();
      if (!cancelled) {
        setMedia(fetched);
        setLoadingMedia(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // dog.idはprops経由で決まっており、マウント後に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dog.id]);

  function openAddPanel() {
    setUploadFile(null);
    setUploadCaption('');
    setUploadError(null);
    setPanel({ type: 'add' });
  }

  function openEditPanel(item: MediaItem) {
    setEditCaption(item.caption ?? '');
    setEditCapturedDate(item.capturedAt.slice(0, 10));
    setEditResendFile(null);
    setEditError(null);
    setConfirmingDelete(false);
    setPanel({ type: 'edit', mediaId: item.id });
  }

  function closePanel() {
    setPanel({ type: 'none' });
    setConfirmingDelete(false);
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
      const { path, thumbnailPath, capturedAt } = await uploadMediaFile(dog.id, uploadFile);
      const mediaType: MediaType = uploadFile.type.startsWith('video/') ? 'VIDEO' : 'PHOTO';
      const mediaInput = {
        dogId: dog.id,
        mediaType,
        s3Key: path,
        thumbnailS3Key: thumbnailPath,
        caption: uploadCaption || undefined,
        // EXIFから撮影日時が取得できない場合は投稿日時を撮影日時とする
        capturedAt: (capturedAt ?? new Date()).toISOString(),
      };
      // Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.DogMedia.create(mediaInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      closePanel();
      setMedia(await fetchMedia());
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました。時間をおいて再度お試しください。');
    } finally {
      setUploading(false);
    }
  }

  async function handleEditSubmit(event: FormEvent, mediaId: string) {
    event.preventDefault();
    setEditError(null);

    const target = media.find((m) => m.id === mediaId);
    if (!target) return;

    setEditSubmitting(true);
    try {
      let newS3Key: string | undefined;
      let newThumbnailS3Key: string | undefined;
      let newCapturedAt: string | undefined;

      if (editResendFile) {
        const { path, thumbnailPath, capturedAt } = await uploadMediaFile(dog.id, editResendFile);
        newS3Key = path;
        newThumbnailS3Key = thumbnailPath;
        if (capturedAt) newCapturedAt = capturedAt.toISOString();
        await remove({ path: target.s3Key }).catch(() => undefined);
        if (target.thumbnailS3Key) {
          await remove({ path: target.thumbnailS3Key }).catch(() => undefined);
        }
      }

      const updateInput = {
        id: mediaId,
        caption: editCaption || undefined,
        capturedAt: newCapturedAt ?? dateInputToIso(editCapturedDate),
        ...(newS3Key ? { s3Key: newS3Key } : {}),
        ...(newThumbnailS3Key ? { thumbnailS3Key: newThumbnailS3Key } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.DogMedia.update(updateInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }

      closePanel();
      setMedia(await fetchMedia());
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '更新に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(mediaId: string) {
    const target = media.find((m) => m.id === mediaId);
    if (!target) return;

    setEditSubmitting(true);
    setEditError(null);
    try {
      const result = await dataClient.models.DogMedia.delete({ id: mediaId });
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      await remove({ path: target.s3Key }).catch(() => undefined);
      if (target.thumbnailS3Key) {
        await remove({ path: target.thumbnailS3Key }).catch(() => undefined);
      }

      closePanel();
      setMedia(await fetchMedia());
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '削除に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="org-dog-detail">
      <header className="org-dog-detail__topbar">
        <button type="button" className="org-dog-detail__back" onClick={onBack}>
          &lt;
        </button>
      </header>

      <div className="org-dog-detail__body">
        <section className="org-dog-detail__section">
          <div className="org-dog-detail__heading-row">
            <h1>{dog.name}</h1>
            <button
              type="button"
              className="org-dog-detail__edit-button"
              onClick={onEdit}
              title="保護犬情報を編集"
            >
              ✏️
            </button>
          </div>
          <dl className="org-dog-detail__facts">
            <div>
              <dt>性別</dt>
              <dd>{genderLabel[dog.gender]}</dd>
            </div>
            <div>
              <dt>年齢</dt>
              <dd>{calculateAgeLabel(dog.birthDate, dog.birthDateEstimated)}</dd>
            </div>
            <div>
              <dt>ステータス</dt>
              <dd>{effectiveDogStatusLabel(dog)}</dd>
            </div>
          </dl>
        </section>

        {dog.custodianOwnerSub && dog.status === 'PROTECTED' && (
          <section className="org-dog-detail__section">
            <h2>預かりの申し出</h2>
            {pendingFosterRequest ? (
              <div className="org-dog-detail__foster-request">
                <p>
                  <strong>{pendingFosterRequest.volunteerName}</strong> さんから預かりの申し出があります。
                </p>
                {fosterActionError && <p className="org-dog-detail__error">{fosterActionError}</p>}
                <div className="org-dog-detail__foster-request-actions">
                  <button
                    type="button"
                    className="org-dog-detail__delete-button"
                    disabled={fosterActionSubmitting}
                    onClick={handleDeclineFosterRequest}
                  >
                    断る
                  </button>
                  <button
                    type="button"
                    className="org-dog-detail__primary-button"
                    disabled={fosterActionSubmitting}
                    onClick={handleAcceptFosterRequest}
                  >
                    {fosterActionSubmitting ? '処理中…' : '搬送を開始する'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="org-dog-detail__empty">読み込み中…</p>
            )}
          </section>
        )}

        <section className="org-dog-detail__section org-dog-detail__history">
          <h2>預かり履歴</h2>
          {loadingHistory ? (
            <p className="org-dog-detail__empty">履歴情報を読み込み中…</p>
          ) : custodyHistory.length === 0 ? (
            <p className="org-dog-detail__empty">履歴情報がありません</p>
          ) : (
            <ul className="org-dog-detail__history-list">
              {custodyHistory.map((item) => (
                <li key={item.id} className="org-dog-detail__history-item">
                  {editingHistoryId === item.id ? (
                    <div className="org-dog-detail__history-edit-row">
                      <input
                        type="date"
                        required
                        className="org-dog-detail__history-date-input"
                        value={editingDateValue}
                        onChange={(e) => setEditingDateValue(e.target.value)}
                        disabled={historySaving === item.id}
                      />
                      <button
                        type="button"
                        className="org-dog-detail__history-save-button"
                        disabled={historySaving === item.id}
                        onClick={() => handleSaveHistoryDate(item.id)}
                      >
                        {historySaving === item.id ? '保存中…' : '保存'}
                      </button>
                      <button
                        type="button"
                        className="org-dog-detail__history-cancel-button"
                        disabled={historySaving === item.id}
                        onClick={() => setEditingHistoryId(null)}
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="org-dog-detail__history-view-row">
                      <span className="org-dog-detail__history-date">
                        {item.startDate}
                        <button
                          type="button"
                          className="org-dog-detail__history-edit-trigger"
                          onClick={() => {
                            setEditingHistoryId(item.id);
                            setEditingDateValue(item.startDate);
                          }}
                          aria-label="日付を編集する"
                        >
                          ✏️
                        </button>
                      </span>
                      <span className="org-dog-detail__history-name">
                        {custodianTypeLabel[item.custodianType]}「{item.custodianName}」
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="org-dog-detail__section">
          <div className="org-dog-detail__heading-row">
            <h2>写真・動画(新着順)</h2>
            <button
              type="button"
              className="org-dog-detail__add-media-button"
              onClick={() => (panel.type === 'add' ? closePanel() : openAddPanel())}
            >
              {panel.type === 'add' ? 'キャンセル' : '+ メディアを追加'}
            </button>
          </div>

          {panel.type === 'add' && (
            <form className="org-dog-detail__upload-form" onSubmit={handleUploadSubmit}>
              <label className="org-dog-detail__upload-field">
                <span>ファイル(画像・動画) ※動画は長さ10秒以内のデータがアップロード可能</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="org-dog-detail__upload-field">
                <span>キャプション(任意)</span>
                <input type="text" value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} />
              </label>
              {uploadError && <p className="org-dog-detail__error">{uploadError}</p>}
              <button type="submit" className="org-dog-detail__primary-button" disabled={uploading}>
                {uploading ? 'アップロード中…' : '追加する'}
              </button>
            </form>
          )}

          {panel.type === 'edit' &&
            (() => {
              const target = media.find((m) => m.id === panel.mediaId);
              if (!target) return null;
              return (
                <div className="org-dog-detail__modal-overlay" onClick={closePanel}>
                  <div className="org-dog-detail__modal" onClick={(e) => e.stopPropagation()}>
                    <h3>メディアを編集</h3>
                    <form
                      onSubmit={(e) => handleEditSubmit(e, target.id)}
                    >
                      <label className="org-dog-detail__modal-field">
                        <span>ファイルを再送信(任意、選択時のみ差し替え)</span>
                        <input
                          type="file"
                          accept="image/*,video/*"
                          onChange={(e) => setEditResendFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <label className="org-dog-detail__modal-field">
                        <span>撮影日(EXIFから取得できない場合に設定)</span>
                        <input
                          type="date"
                          max={today()}
                          value={editCapturedDate}
                          onChange={(e) => setEditCapturedDate(e.target.value)}
                        />
                      </label>
                      <label className="org-dog-detail__modal-field">
                        <span>コメント</span>
                        <input type="text" value={editCaption} onChange={(e) => setEditCaption(e.target.value)} />
                      </label>
                      {editError && <p className="org-dog-detail__error">{editError}</p>}
                      <div className="org-dog-detail__modal-actions">
                        <div className="org-dog-detail__modal-left-actions">
                          {confirmingDelete ? (
                            <span className="org-dog-detail__delete-confirm">
                              本当に削除しますか？
                              <button
                                type="button"
                                className="org-dog-detail__danger-button"
                                disabled={editSubmitting}
                                onClick={() => handleDelete(target.id)}
                                style={{ marginLeft: '8px' }}
                              >
                                削除する
                              </button>
                              <button type="button" className="org-dog-detail__link-button" onClick={() => setConfirmingDelete(false)} style={{ marginLeft: '8px' }}>
                                やめる
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="org-dog-detail__danger-button"
                              onClick={() => setConfirmingDelete(true)}
                            >
                              削除する
                            </button>
                          )}
                        </div>
                        <div className="org-dog-detail__modal-right-actions">
                          <button type="button" className="org-dog-detail__link-button" onClick={closePanel} disabled={editSubmitting}>
                            キャンセル
                          </button>
                          <button type="submit" className="org-dog-detail__small-button" disabled={editSubmitting}>
                            {editSubmitting ? '更新中…' : '更新する'}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              );
            })()}

          {loadingMedia ? (
            <p className="org-dog-detail__empty">読み込み中…</p>
          ) : media.length === 0 ? (
            <p className="org-dog-detail__empty">まだ写真・動画が投稿されていません</p>
          ) : (
            <div className="org-dog-detail__media-grid">
              {media.map((item) => (
                <article
                  key={item.id}
                  className="org-dog-detail__media-card"
                >
                  <span className="org-dog-detail__media-age-badge">
                    {calculateAgeAtLabel(dog.birthDate, item.capturedAt)}（{calculateElapsedLabel(item.capturedAt)}）
                  </span>
                  <button
                    type="button"
                    className="org-dog-detail__media-edit-button"
                    onClick={() => openEditPanel(item)}
                    title="投稿を編集"
                  >
                    ✏️
                  </button>
                  <div className="org-dog-detail__media-container">
                    {item.mediaType === 'VIDEO' ? (
                      <video
                        className="org-dog-detail__media-thumb org-dog-detail__media-thumb--clickable"
                        src={item.url}
                        poster={item.thumbnailUrl}
                        muted
                        preload="metadata"
                        onClick={() => setLightboxMedia({ mediaType: 'VIDEO', url: item.url })}
                      />
                    ) : item.thumbnailUrl ? (
                      <img
                        className="org-dog-detail__media-thumb org-dog-detail__media-thumb--clickable"
                        src={item.thumbnailUrl}
                        alt={item.caption ?? dog.name}
                        onClick={() => setLightboxMedia({ mediaType: 'PHOTO', url: item.url ?? item.thumbnailUrl })}
                      />
                    ) : (
                      <img
                        className="org-dog-detail__media-thumb org-dog-detail__media-thumb--clickable"
                        src={item.url}
                        alt={item.caption ?? dog.name}
                        onClick={() => setLightboxMedia({ mediaType: 'PHOTO', url: item.url })}
                      />
                    )}
                  </div>
                  {item.caption && (
                    <div className="org-dog-detail__media-caption-container">
                      <span className="org-dog-detail__media-caption">{item.caption}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {lightboxMedia && (
        <div className="org-dog-detail__lightbox" onClick={() => setLightboxMedia(null)}>
          {lightboxMedia.mediaType === 'VIDEO' ? (
            <video
              className="org-dog-detail__lightbox-video"
              src={lightboxMedia.url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img className="org-dog-detail__lightbox-image" src={lightboxMedia.url} alt="" />
          )}
        </div>
      )}
    </div>
  );
}
