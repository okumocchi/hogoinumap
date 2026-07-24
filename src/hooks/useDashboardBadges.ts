import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { sendWebNotification } from '../utils/webNotification';

const POLL_INTERVAL_MS = 6000;

export interface ChatThreadItem {
  id: string;
  participantAKey: string;
  participantAName: string;
  participantBKey: string;
  participantBName: string;
  owners: string[];
}

export interface DashboardBadges {
  total: number;
  pendingAffiliations: number;
  pendingMatchOffers: number;
  transitDogs: number;
  unreadChats: number;
  chatUnreads: Record<string, number>; // threadId -> 未読数(0 or 1)
  chatThreads: ChatThreadItem[]; // 自分が参加しているスレッドのリスト(表示用)
  unreadGroupChats: number;
  groupChatUnreads: Record<string, number>; // orgId -> 未読数(0 or 1)
}

const INITIAL_STATE: DashboardBadges = {
  total: 0,
  pendingAffiliations: 0,
  pendingMatchOffers: 0,
  transitDogs: 0,
  unreadChats: 0,
  chatUnreads: {},
  chatThreads: [],
  unreadGroupChats: 0,
  groupChatUnreads: {},
};

export function useDashboardBadges(
  organizationId: string | null | undefined,
  volunteerId: string | null | undefined,
  activeChatThreadId: string | null
): [DashboardBadges, () => Promise<void>] {
  const [badges, setBadges] = useState<DashboardBadges>(INITIAL_STATE);
  const prevBadgesRef = useRef<DashboardBadges | null>(null);

  const load = useCallback(async () => {
    const isLoggedIn = !!organizationId || !!volunteerId;
    if (!isLoggedIn) {
      setBadges(INITIAL_STATE);
      prevBadgesRef.current = null;
      return;
    }

    try {
      let pendingAffiliations = 0;
      let pendingMatchOffers = 0;
      let transitDogs = 0;
      let unreadChats = 0;
      const chatUnreads: Record<string, number> = {};
      let chatThreads: ChatThreadItem[] = [];
      let unreadGroupChats = 0;
      const groupChatUnreads: Record<string, number> = {};

      // 1. 団体側のデータ取得
      if (organizationId) {
        // 承認待ちの所属申請
        const affResult = await dataClient.models.Affiliation.listByOrganizationAndStatus(
          { organizationId, status: { eq: 'PENDING' } },
          { authMode: 'userPool' }
        );
        pendingAffiliations = affResult.data.length;

        // 保留中の預かり申し出 (Match.list は自分に関係するものだけを返す認可ルール)
        const matchResult = await dataClient.models.Match.list({ authMode: 'userPool' });
        pendingMatchOffers = matchResult.data.filter(
          (match) => match.status === 'REQUESTED' || match.status === 'NEGOTIATING'
        ).length;
      }

      // 2. ボランティア側のデータ取得
      if (volunteerId) {
        const { userId, username } = await getCurrentUser();
        const myOwnerSub = `${userId}::${username}`;

        // 搬送中の保護犬 (IN_TRANSIT)
        const dogResult = await dataClient.models.Dog.listDogsByCustodian(
          { custodianOwnerSub: myOwnerSub },
          { authMode: 'userPool' }
        );
        transitDogs = dogResult.data.filter((dog) => dog.status === 'IN_TRANSIT').length;
      }

      // 3. チャット未読のデータ取得
      const myKey = organizationId ? `organization#${organizationId}` : `volunteer#${volunteerId}`;
      const [threadsA, threadsB] = await Promise.all([
        dataClient.models.ChatThread.listThreadsByParticipantA({ participantAKey: myKey }, { authMode: 'userPool' }),
        dataClient.models.ChatThread.listThreadsByParticipantB({ participantBKey: myKey }, { authMode: 'userPool' }),
      ]);

      const rawThreads = [...threadsA.data, ...threadsB.data];
      const allThreads: ChatThreadItem[] = rawThreads.map((thread) => ({
        id: thread.id,
        participantAKey: thread.participantAKey,
        participantAName: thread.participantAName,
        participantBKey: thread.participantBKey,
        participantBName: thread.participantBName,
        owners: thread.owners ?? [],
      }));
      chatThreads = allThreads;

      const chatPromises = allThreads.map(async (thread) => {
        const lastReadStr = localStorage.getItem(`chat_last_read_at:${thread.id}`) || '0';
        const lastReadTime = new Date(lastReadStr).getTime();

        if (thread.id === activeChatThreadId) {
          chatUnreads[thread.id] = 0;
          return;
        }

        // 各スレッドの最新メッセージを1件だけ取得
        const msgResult = await dataClient.models.ChatMessage.listMessagesByThread(
          { threadId: thread.id },
          { limit: 1, sortDirection: 'DESC', authMode: 'userPool' }
        );
        const lastMsg = msgResult.data[0];
        if (lastMsg && lastMsg.senderKey !== myKey) {
          const msgTime = new Date(lastMsg.createdAt ?? '').getTime();
          if (msgTime > lastReadTime) {
            chatUnreads[thread.id] = 1;
            unreadChats += 1;
            return;
          }
        }
        chatUnreads[thread.id] = 0;
      });

      await Promise.all(chatPromises);

      // 4. グループチャット未読のデータ取得
      const groupChatOrgIds = new Set<string>();
      if (organizationId) {
        groupChatOrgIds.add(organizationId);
      }
      if (volunteerId) {
        const affResult = await dataClient.models.Affiliation.list({ authMode: 'userPool' });
        affResult.data
          .filter((a) => a.volunteerId === volunteerId && a.status === 'APPROVED')
          .forEach((a) => groupChatOrgIds.add(a.organizationId));
      }

      const groupPromises = Array.from(groupChatOrgIds).map(async (orgId) => {
        const lastReadStr = localStorage.getItem(`group_chat_last_read_at:${orgId}`) || '0';
        const lastReadTime = new Date(lastReadStr).getTime();

        if (orgId === activeChatThreadId) {
          groupChatUnreads[orgId] = 0;
          return;
        }

        const threadRes = await dataClient.models.GroupChatThread.get({ id: orgId }, { authMode: 'userPool' });
        if (!threadRes.data) {
          groupChatUnreads[orgId] = 0;
          return;
        }

        const msgResult = await dataClient.models.GroupChatMessage.listGroupMessagesByThread(
          { threadId: orgId },
          { limit: 1, sortDirection: 'DESC', authMode: 'userPool' }
        );
        const lastMsg = msgResult.data[0];
        if (lastMsg && lastMsg.senderKey !== myKey) {
          const msgTime = new Date(lastMsg.createdAt ?? '').getTime();
          if (msgTime > lastReadTime) {
            groupChatUnreads[orgId] = 1;
            unreadGroupChats += 1;
            return;
          }
        }
        groupChatUnreads[orgId] = 0;
      });

      await Promise.all(groupPromises);

      const total = pendingAffiliations + pendingMatchOffers + transitDogs + unreadChats + unreadGroupChats;

      const newBadges: DashboardBadges = {
        total,
        pendingAffiliations,
        pendingMatchOffers,
        transitDogs,
        unreadChats,
        chatUnreads,
        chatThreads,
        unreadGroupChats,
        groupChatUnreads,
      };

      // WEB通知のトリガー処理
      const prev = prevBadgesRef.current;
      if (prev) {
        // 1. 個別チャット新着通知
        newBadges.chatThreads.forEach((thread) => {
          if (!prev.chatUnreads[thread.id] && newBadges.chatUnreads[thread.id]) {
            const counterpartName =
              thread.participantAKey === myKey ? thread.participantBName : thread.participantAName;
            sendWebNotification('新着メッセージ', {
              body: `${counterpartName}さんからメッセージが届きました`,
              tag: `chat:${thread.id}`,
            });
          }
        });

        // 2. グループチャット新着通知
        Object.keys(newBadges.groupChatUnreads).forEach((orgId) => {
          if (!prev.groupChatUnreads[orgId] && newBadges.groupChatUnreads[orgId]) {
            sendWebNotification('グループチャット', {
              body: 'グループチャットに新着メッセージがあります',
              tag: `group:${orgId}`,
            });
          }
        });

        // 3. 所属申請通知
        if (newBadges.pendingAffiliations > prev.pendingAffiliations) {
          sendWebNotification('所属申請', {
            body: `新しいボランティア所属申請が届いています（${newBadges.pendingAffiliations}件）`,
            tag: 'affiliation',
          });
        }

        // 4. 預かりオファー通知
        if (newBadges.pendingMatchOffers > prev.pendingMatchOffers) {
          sendWebNotification('預かり申請', {
            body: `保護犬の預かり申し出・交渉が更新されました（${newBadges.pendingMatchOffers}件）`,
            tag: 'match',
          });
        }

        // 5. 搬送中保護犬通知
        if (newBadges.transitDogs > prev.transitDogs) {
          sendWebNotification('搬送ステータス変更', {
            body: `担当する保護犬が搬送中になりました（${newBadges.transitDogs}頭）`,
            tag: 'transit',
          });
        }
      }

      prevBadgesRef.current = newBadges;
      setBadges(newBadges);
    } catch (err) {
      console.error('Failed to load dashboard badges', err);
    }
  }, [organizationId, volunteerId, activeChatThreadId]);

  useEffect(() => {
    let cancelled = false;

    async function safeLoad() {
      if (!cancelled) await load();
    }

    safeLoad();
    const interval = setInterval(safeLoad, POLL_INTERVAL_MS);

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') safeLoad();
      if (payload.event === 'signedOut') {
        prevBadgesRef.current = null;
        setBadges(INITIAL_STATE);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [load]);

  return [badges, load];
}
