/**
 * データベース操作やAPI通信時のエラーメッセージを分かりやすい日本語表示に統一変換するユーティリティ
 */

export function formatApiError(
  error: unknown,
  fallback = '処理に失敗しました。時間をおいて再度お試しください。'
): string {
  if (!error) return fallback;

  let message = '';

  if (typeof error === 'string') {
    message = error;
  } else if (Array.isArray(error)) {
    message = error
      .map((e) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && 'message' in e) {
          return String((e as { message: unknown }).message);
        }
        return String(e);
      })
      .filter(Boolean)
      .join(' / ');
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    message = String((error as { message: unknown }).message);
  }

  if (!message) return fallback;

  const lower = message.toLowerCase();

  // 1. 権限・認証関連のエラー
  if (
    lower.includes('unauthorized') ||
    lower.includes('not authorized') ||
    lower.includes('accessdenied') ||
    lower.includes('access denied') ||
    lower.includes('forbidden')
  ) {
    return '操作の権限がありません。ログイン状態またはアカウントの権限をご確認ください。';
  }

  // 2. ネットワーク・通信関連のエラー
  if (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('timeout')
  ) {
    return '通信に失敗しました。ネットワーク接続状況をご確認の上、再度お試しください。';
  }

  // 3. 入力バリデーション・パラメタ関連のエラー
  if (
    lower.includes('validation') ||
    lower.includes('invalid') ||
    lower.includes('bad request') ||
    lower.includes('cannot be null')
  ) {
    return '入力内容が正しくありません。確認の上再度お試しください。';
  }

  // 4. データ未存在エラー
  if (lower.includes('not found') || lower.includes('itemnotfound')) {
    return '対象のデータが見つかりませんでした。';
  }

  // 5. 競合・排他エラー (DynamoDB ConditionalCheck, Conflict等)
  if (
    lower.includes('conditionalcheckfailed') ||
    lower.includes('conflict') ||
    lower.includes('already exists')
  ) {
    return 'データがすでに更新されているか、最新の状態ではありません。画面を更新してお試しください。';
  }

  // 6. 一般的な GraphQL / データベースエラー
  if (lower.includes('graphql error') || lower.includes('dynamodb')) {
    return 'データベース処理エラーが発生しました。時間をおいて再度お試しください。';
  }

  // 7. メッセージ内にすでに日本語（和文文字）が含まれている場合はそれを尊重
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(message)) {
    return message;
  }

  // それ以外の不明な英語エラー等の場合
  return fallback;
}
