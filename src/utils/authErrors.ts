export function translateAuthError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  switch (name) {
    case 'UsernameExistsException':
      return 'このメールアドレスは既に登録されています。ログインをお試しください。';
    case 'InvalidPasswordException':
      return 'パスワードは15文字以上で入力してください。';
    case 'InvalidParameterException':
      return '入力内容をご確認ください。';
    case 'CodeMismatchException':
      return '確認コードが正しくありません。';
    case 'ExpiredCodeException':
      return '確認コードの有効期限が切れています。再送信してください。';
    case 'LimitExceededException':
      return '試行回数が上限に達しました。しばらくしてから再度お試しください。';
    default:
      return message || 'エラーが発生しました。時間をおいて再度お試しください。';
  }
}
