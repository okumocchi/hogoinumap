import { parse } from 'exifr';

// 画像のEXIFから撮影日時(DateTimeOriginal優先、次点でCreateDate)を取得する。
// 動画や、EXIFに撮影日時が含まれない画像の場合はnullを返す。
export async function readCapturedAt(file: File): Promise<Date | null> {
  if (!file.type.startsWith('image/')) return null;

  try {
    const tags = await parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const value = tags?.DateTimeOriginal ?? tags?.CreateDate;
    return value instanceof Date ? value : null;
  } catch {
    return null;
  }
}
