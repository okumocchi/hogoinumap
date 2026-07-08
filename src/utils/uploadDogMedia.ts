import { fetchAuthSession } from 'aws-amplify/auth';
import { uploadData } from 'aws-amplify/storage';
import { readCapturedAt } from './exif';
import { generateThumbnail, processMediaFile } from './mediaProcessing';

export interface UploadedDogMediaFile {
  path: string;
  thumbnailPath: string;
  capturedAt: Date | null;
}

// 保護犬の写真・動画をS3にアップロードする(団体・預かりボランティアどちらの投稿でも共通の処理)
export async function uploadMediaFile(dogId: string, file: File): Promise<UploadedDogMediaFile> {
  const { identityId } = await fetchAuthSession();
  if (!identityId) {
    throw new Error('認証情報の取得に失敗しました。再度ログインしてお試しください。');
  }

  // 圧縮処理でEXIFが失われるため、加工前の元ファイルから撮影日時を読み取っておく
  const capturedAt = await readCapturedAt(file);
  // スマートフォンでの閲覧を想定し、写真はWEBP・長辺1200px以下に、
  // 動画は10秒以下・幅720px・ビットレート約2.0Mbpsに変換してから保存する
  // 一覧表示用に、長辺300pxに縮小したサムネイルも別途生成する
  const [processedFile, thumbnailFile] = await Promise.all([processMediaFile(file), generateThumbnail(file)]);

  const uuid = crypto.randomUUID();
  const extension = processedFile.name.includes('.') ? `.${processedFile.name.split('.').pop()}` : '';
  const path = `dog-media/${identityId}/${dogId}/${uuid}${extension}`;
  const thumbnailPath = `dog-media/${identityId}/${dogId}/${uuid}-thumb.webp`;

  await Promise.all([
    uploadData({ path, data: processedFile, options: { contentType: processedFile.type } }).result,
    uploadData({ path: thumbnailPath, data: thumbnailFile, options: { contentType: thumbnailFile.type } }).result,
  ]);

  return { path, thumbnailPath, capturedAt };
}
