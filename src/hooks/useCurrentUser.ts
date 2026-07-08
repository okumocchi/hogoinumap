import { fetchUserAttributes } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useEffect, useState } from 'react';

// undefined = 判定中, null = 未ログイン, string = ログイン中ユーザーのメールアドレス
export function useCurrentUser(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // メールをエイリアスとして使うCognito設定のため、usernameはsub(UUID)になる。
        // 表示用のメールアドレスは属性から取得する。
        const attributes = await fetchUserAttributes();
        if (!cancelled) setEmail(attributes.email ?? null);
      } catch {
        if (!cancelled) setEmail(null);
      }
    }

    load();

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') load();
      if (payload.event === 'signedOut') setEmail(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return email;
}
