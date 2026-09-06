import React, { useEffect, useRef, useState } from 'react';
import './MediaLightboxModal.css';

interface MediaLightboxModalProps {
  mediaType: 'PHOTO' | 'VIDEO';
  url: string;
  onClose: () => void;
  caption?: string;
  canDownload?: boolean;
  dogName?: string;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  mediaType,
  url,
  onClose,
  caption,
  canDownload = false,
  dogName,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatusText, setDownloadStatusText] = useState('');
  const [readyFile, setReadyFile] = useState<{
    file: File;
    fileName: string;
    blobUrl: string;
    canShare: boolean;
  } | null>(null);

  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeDirection, setCloseDirection] = useState<number>(1); // 1: 下方向, -1: 上方向
  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // readyFileのBlob URLをクリーンアップ
  const cleanupReadyFile = () => {
    if (readyFile) {
      URL.revokeObjectURL(readyFile.blobUrl);
      setReadyFile(null);
    }
  };

  // アンマウント時またはモーダルクローズ時のクリーンアップ
  useEffect(() => {
    return () => {
      if (readyFile) {
        URL.revokeObjectURL(readyFile.blobUrl);
      }
    };
  }, [readyFile]);

  // Escキーで閉じる処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanupReadyFile();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, readyFile]);

  // モーダル表示中のスクロールロック
  useEffect(() => {
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const handleStart = (clientY: number) => {
    if (readyFile) return; // 保存シート表示中はドラッグ操作を無効化
    setIsDragging(true);
    startYRef.current = clientY;
    currentYRef.current = clientY;
    startTimeRef.current = Date.now();
  };

  const handleMove = (clientY: number) => {
    if (!isDragging) return;
    currentYRef.current = clientY;
    const diffY = clientY - startYRef.current;
    // 上下どちら方向へも自由移動
    setTranslateY(diffY);
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const diffY = currentYRef.current - startYRef.current;
    const duration = Date.now() - startTimeRef.current;
    const velocityY = diffY / (duration || 1); // px/ms
    const absDiffY = Math.abs(diffY);
    const absVelocityY = Math.abs(velocityY);

    const DISMISS_THRESHOLD = 70; // 70px以上のドラッグで閉じる
    const VELOCITY_THRESHOLD = 0.3; // 高速なフリック操作

    if ((absDiffY > DISMISS_THRESHOLD || (absDiffY > 15 && absVelocityY > VELOCITY_THRESHOLD)) && !isClosing) {
      setIsClosing(true);
      const dir = (diffY !== 0 ? diffY : velocityY) < 0 ? -1 : 1;
      setCloseDirection(dir);
      // スライドアウトアニメーション後に onClose を呼び出し
      setTimeout(() => {
        cleanupReadyFile();
        onClose();
      }, 180);
    } else {
      // 元の位置に戻す
      setTranslateY(0);
    }
  };

  // タッチイベントハンドラ
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientY);
    }
  };

  const handleTouchEnd = () => {
    handleEnd();
  };

  // マウス/ポインターイベントハンドラ
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      handleStart(e.clientY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientY);
  };

  const handleMouseUp = () => {
    handleEnd();
  };

  // ドラッグ時の背景不透明度計算（最大0.9から減算）
  const dragRatio = Math.max(0, Math.min(1, Math.abs(translateY) / 300));
  const backdropOpacity = isClosing ? 0 : Math.max(0.1, 0.9 * (1 - dragRatio));

  // モーダルコンテンツのスタイル
  const contentStyle: React.CSSProperties = {
    transform: isClosing
      ? `translateY(${closeDirection * (Math.max(Math.abs(translateY), 200) + window.innerHeight)}px)`
      : `translateY(${translateY}px)`,
    transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
  };

  const backdropStyle: React.CSSProperties = {
    backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
    transition: isDragging ? 'none' : 'background-color 0.2s ease',
  };

interface MediaElementWithCaptureStream {
  captureStream(): MediaStream;
}

// aタグによるダウンロード実行
function triggerDirectDownload(blobUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 画像BlobをJPEG（image/jpeg）に変換
async function convertImageToJpeg(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/jpeg') {
    return blob;
  }

  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap !== 'undefined') {
    try {
      bitmap = await createImageBitmap(blob);
    } catch (e) {
      console.warn('createImageBitmap failed, falling back to Image element:', e);
    }
  }

  const canvas = document.createElement('canvas');
  if (bitmap) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvasの初期化に失敗しました。');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const objectUrl = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
        img.src = objectUrl;
      });
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvasの初期化に失敗しました。');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const jpegBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  );
  if (!jpegBlob) {
    throw new Error('JPEG形式への変換に失敗しました。');
  }
  return jpegBlob;
}

// 動画BlobをMP4（video/mp4）にトランスコード（WebM等の場合）
async function transcodeVideoToMp4(blob: Blob, mediaUrl: string): Promise<Blob> {
  const isAlreadyMp4 =
    blob.type.toLowerCase().includes('mp4') ||
    mediaUrl.toLowerCase().split('?')[0].endsWith('.mp4');

  if (isAlreadyMp4) {
    return blob;
  }

  const canvas = document.createElement('canvas');
  const hasCaptureStream =
    typeof (canvas as unknown as { captureStream?: () => MediaStream }).captureStream === 'function';

  const mp4MimeCandidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  const supportedMp4Mime =
    typeof MediaRecorder !== 'undefined'
      ? mp4MimeCandidates.find((type) => MediaRecorder.isTypeSupported(type))
      : null;

  // iOS Safariなど captureStream や MediaRecorder('video/mp4') 非対応ブラウザでは元データを安全に返す
  if (!hasCaptureStream || !supportedMp4Mime) {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('動画の読み込みに失敗しました。'));
    });

    const width = video.videoWidth || 720;
    const height = video.videoHeight || 1280;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;

    const stream = (canvas as unknown as { captureStream: (fps: number) => MediaStream }).captureStream(30);
    const tracks = [...stream.getVideoTracks()];

    if ('captureStream' in video) {
      try {
        const audioStream = (video as unknown as MediaElementWithCaptureStream).captureStream();
        tracks.push(...audioStream.getAudioTracks());
      } catch {
        // audioStreamが取得できない場合は無音で続行
      }
    }

    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: supportedMp4Mime,
      videoBitsPerSecond: 2_000_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('動画の変換に失敗しました。'));
    });

    const durationSeconds = Math.min(video.duration || 10, 10);
    const recordMillis = Math.max(0, durationSeconds * 1000 - 200);

    let drawing = true;
    const drawFrame = () => {
      if (!drawing) return;
      ctx.drawImage(video, 0, 0, width, height);
      requestAnimationFrame(drawFrame);
    };

    video.currentTime = 0;
    await video.play();
    recorder.start();
    drawFrame();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, recordMillis);
    });

    drawing = false;
    video.pause();
    recorder.stop();
    await stopped;

    return new Blob(chunks, { type: 'video/mp4' });
  } catch (err) {
    console.warn('MP4 conversion failed, falling back to original blob:', err);
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

  // ダウンロード準備の開始
  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadStatusText(mediaType === 'VIDEO' ? '動画を準備中...' : '写真をJPEGに変換中...');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.statusText}`);
      }
      const rawBlob = await response.blob();

      let finalBlob: Blob;
      let ext: string;
      let mimeType: string;

      if (mediaType === 'PHOTO') {
        finalBlob = await convertImageToJpeg(rawBlob);
        ext = '.jpg';
        mimeType = 'image/jpeg';
      } else {
        finalBlob = await transcodeVideoToMp4(rawBlob, url);
        ext = '.mp4';
        mimeType = 'video/mp4';
      }

      const typeLabel = mediaType === 'VIDEO' ? '動画' : '写真';
      const baseName = dogName ? `${dogName}_${typeLabel}` : `hogoinu_${typeLabel}`;
      const fileName = `${baseName}${ext}`;

      const file = new File([finalBlob], fileName, { type: mimeType });
      const blobUrl = URL.createObjectURL(finalBlob);

      const isTouchDevice =
        typeof window !== 'undefined' &&
        ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      const canShare =
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      // スマートフォン（タッチ端末）環境では、User Activationを有効にした状態で
      // ユーザーが保存ボタンをタップできるように保存アクションシートを表示する
      if (isTouchDevice) {
        setReadyFile({
          file,
          fileName,
          blobUrl,
          canShare: Boolean(canShare),
        });
      } else {
        // PC環境ではそのままダイレクトダウンロードを実行
        triggerDirectDownload(blobUrl, fileName);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      }
    } catch (err: unknown) {
      console.error('Download preparation failed:', err);
      const message = err instanceof Error ? err.message : 'ネットワーク状況をご確認の上、再度お試しください。';
      alert(`保存の準備に失敗しました。\n(${message})`);
    } finally {
      setIsDownloading(false);
      setDownloadStatusText('');
    }
  };

  // スマホでの「写真アプリ・端末に保存」タップ時の処理（直接のUser Activation内で実行）
  const handleShareToCameraRoll = async () => {
    if (!readyFile) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [readyFile.file] })) {
        await navigator.share({
          files: [readyFile.file],
          title: readyFile.fileName,
        });
        cleanupReadyFile();
        return;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // ユーザー自身によるキャンセル操作
        return;
      }
      console.warn('Web Share API failed, falling back to direct download:', err);
    }

    // シェアが利用できない、またはエラー発生時は直接ダウンロードへフォールバック
    handleDirectDownload();
  };

  // 直接ファイルダウンロード
  const handleDirectDownload = () => {
    if (!readyFile) return;
    triggerDirectDownload(readyFile.blobUrl, readyFile.fileName);
    cleanupReadyFile();
  };

  return (
    <div
      className="media-lightbox-backdrop"
      style={backdropStyle}
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="media-lightbox-header" onClick={(e) => e.stopPropagation()}>
        {isDownloading && downloadStatusText && (
          <div className="media-lightbox-status-pill">
            <svg
              className="media-lightbox-spinner"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
            </svg>
            <span>{downloadStatusText}</span>
          </div>
        )}
        {canDownload && (
          <button
            type="button"
            className="media-lightbox-btn media-lightbox-download-btn"
            onClick={handleDownload}
            disabled={isDownloading}
            aria-label={`${mediaType === 'VIDEO' ? '動画' : '写真'}を保存`}
            title={isDownloading ? (downloadStatusText || '保存の準備中...') : `${mediaType === 'VIDEO' ? '動画' : '写真'}を保存`}
          >
            {isDownloading ? (
              <svg
                className="media-lightbox-spinner"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          className="media-lightbox-btn media-lightbox-close-btn"
          onClick={onClose}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>

      <div
        className="media-lightbox-content-wrapper"
        style={contentStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {mediaType === 'VIDEO' ? (
          <video
            className="media-lightbox-video"
            src={url}
            controls
            autoPlay
            playsInline
          />
        ) : (
          <img
            className="media-lightbox-image"
            src={url}
            alt={caption || ''}
            draggable={false}
          />
        )}
        {caption && <p className="media-lightbox-caption">{caption}</p>}
      </div>

      {readyFile && (
        <div
          className="media-lightbox-save-sheet-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            cleanupReadyFile();
          }}
        >
          <div
            className="media-lightbox-save-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="media-lightbox-save-sheet-handle" />
            <div className="media-lightbox-save-sheet-title">
              {mediaType === 'VIDEO' ? '動画' : '写真'}の準備が完了しました
            </div>
            <div className="media-lightbox-save-sheet-filename">
              {readyFile.fileName}
            </div>

            <div className="media-lightbox-save-sheet-actions">
              {readyFile.canShare && (
                <button
                  type="button"
                  className="media-lightbox-save-btn media-lightbox-save-btn--primary"
                  onClick={handleShareToCameraRoll}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                  写真アプリ・端末に保存
                </button>
              )}

              <button
                type="button"
                className={`media-lightbox-save-btn ${readyFile.canShare ? 'media-lightbox-save-btn--secondary' : 'media-lightbox-save-btn--primary'}`}
                onClick={handleDirectDownload}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                ファイルとしてダウンロード
              </button>

              <button
                type="button"
                className="media-lightbox-save-btn media-lightbox-save-btn--cancel"
                onClick={cleanupReadyFile}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

