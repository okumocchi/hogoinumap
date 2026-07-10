import { useCallback, useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';

// 団体ダッシュボードへの導線(ヘッダーのボタン)にバッジ表示するための、
// 承認待ちのボランティア登録件数。organizationIdが無い(団体アカウントでない)場合は常に0。
export function usePendingAffiliationCount(organizationId: string | null | undefined): [number, () => void] {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!organizationId) {
      setCount(0);
      return;
    }

    const result = await dataClient.models.Affiliation.listByOrganizationAndStatus(
      { organizationId, status: { eq: 'PENDING' } },
      { authMode: 'userPool' },
    );
    setCount(result.data.length);
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;

    async function safeLoad() {
      if (!cancelled) await load();
    }

    safeLoad();

    return () => {
      cancelled = true;
    };
  }, [load]);

  return [count, load];
}
