// スマートフォンでの閲覧を想定し、投稿されたメディアをアップロード前に軽量化する。
// 写真: 長辺が最大1200pxになるよう縮小し、WEBP形式に変換する(拡大はしない)。
// 動画: 長さを10秒以下に切り詰め、幅720pxに合わせて縮小し、
//       ビットレートを約2.0Mbpsまで落として再エンコードする。

const MAX_PHOTO_DIMENSION = 1200;
const PHOTO_QUALITY = 0.85;

const MAX_VIDEO_DURATION_SECONDS = 10;
const VIDEO_WIDTH = 720;
const VIDEO_BITS_PER_SECOND = 2_000_000; // 約2.0Mbps

// 一覧表示用のサムネイル(長辺を300pxに縮小するのみで切り抜きは行わない。
// 正方形表示が必要な箇所は表示側でCSSのobject-fit: coverにより中央を切り抜く)
const THUMBNAIL_MAX_DIMENSION = 300;
const THUMBNAIL_QUALITY = 0.92;

function replaceExtension(fileName: string, extension: string): string {
  return `${fileName.replace(/\.[^./]+$/, '')}.${extension}`;
}

function resizeToThumbnailCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  // 「長辺300px」なので縮小のみ行い、元がそれより小さい場合は拡大しない
  const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('サムネイルの生成に対応していないブラウザです。');
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas;
}

async function canvasToWebpFile(canvas: HTMLCanvasElement, fileName: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', THUMBNAIL_QUALITY));
  if (!blob) throw new Error('サムネイルの生成に失敗しました。');
  return new File([blob], replaceExtension(fileName, 'thumb.webp'), { type: 'image/webp' });
}

async function generateImageThumbnail(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = resizeToThumbnailCanvas(bitmap, bitmap.width, bitmap.height);
    return await canvasToWebpFile(canvas, file.name);
  } finally {
    bitmap.close();
  }
}

async function generateVideoThumbnail(file: File): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
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

    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('動画の読み込みに失敗しました。'));
      video.currentTime = Math.min(0.5, (video.duration || 0) / 2);
    });

    const canvas = resizeToThumbnailCanvas(video, video.videoWidth, video.videoHeight);
    return await canvasToWebpFile(canvas, file.name);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// 長辺300pxに縮小したサムネイルを生成する(一覧表示用)。正方形での表示が必要な
// 箇所は、表示側のCSS(object-fit: cover)で中央を正方形に切り抜く
export async function generateThumbnail(file: File): Promise<File> {
  if (file.type.startsWith('video/')) {
    return generateVideoThumbnail(file);
  }
  return generateImageThumbnail(file);
}

export async function processImageFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    // 「最大1200px」なので縮小のみ行い、元がそれより小さい場合は拡大しない
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像の処理に対応していないブラウザです。');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', PHOTO_QUALITY));
    if (!blob) throw new Error('画像の変換に失敗しました。');

    return new File([blob], replaceExtension(file.name, 'webp'), { type: 'image/webp' });
  } finally {
    bitmap.close();
  }
}

interface MediaElementWithCaptureStream {
  captureStream(): MediaStream;
}

function pickSupportedVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export async function processVideoFile(file: File): Promise<File> {
  const mimeType = pickSupportedVideoMimeType();
  if (!mimeType) {
    // 動画の再エンコードに対応していないブラウザでは、元ファイルをそのままアップロードする
    console.warn('このブラウザは動画の圧縮に対応していないため、元のファイルをそのまま使用します。');
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
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

    const scale = VIDEO_WIDTH / video.videoWidth;
    const width = VIDEO_WIDTH;
    // 一部のコーデックは奇数サイズを扱えないため、偶数に丸める
    const height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('動画の処理に対応していないブラウザです。');

    const tracks = [...canvas.captureStream(30).getVideoTracks()];
    // 元動画の音声トラックを取得できる場合は含める(取得できない場合は無音の動画になる)
    if ('captureStream' in video) {
      const audioStream = (video as unknown as MediaElementWithCaptureStream).captureStream();
      tracks.push(...audioStream.getAudioTracks());
    }

    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('動画の変換に失敗しました。'));
    });

    const durationSeconds = Math.min(video.duration || MAX_VIDEO_DURATION_SECONDS, MAX_VIDEO_DURATION_SECONDS);
    // MediaRecorderの停止処理には数百ms分のバッファが残ることがあるため、
    // 実際の出力が上限を超えないよう少し早めに録画を止める
    const recordMillis = Math.max(0, durationSeconds * 1000 - 500);
    let drawing = true;
    function drawFrame() {
      if (!drawing) return;
      ctx.drawImage(video, 0, 0, width, height);
      requestAnimationFrame(drawFrame);
    }

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

    const outputType = mimeType.split(';')[0];
    const extension = outputType === 'video/mp4' ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: outputType });
    return new File([blob], replaceExtension(file.name, extension), { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processMediaFile(file: File): Promise<File> {
  if (file.type.startsWith('video/')) {
    return processVideoFile(file);
  }
  if (file.type.startsWith('image/')) {
    return processImageFile(file);
  }
  return file;
}
