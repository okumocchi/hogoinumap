import { dataClient } from './dataClient';

export type ChatParticipantKind = 'organization' | 'volunteer';

export interface ChatParticipant {
  kind: ChatParticipantKind;
  id: string;
  name: string;
  // owner認可の内部フィールドと同じ形式(sub::username)の値(Organization/Volunteerの
  // ownerSubフィールドや、ログイン中ユーザー自身についてはgetCurrentUser()から取得する)
  ownerSub: string;
}

export function chatParticipantKey(kind: ChatParticipantKind, id: string): string {
  return `${kind}#${id}`;
}

export interface ChatThreadRef {
  id: string;
  owners: string[];
}

// 2者間の既存チャットスレッドを探し、無ければ新規作成する。
// 自分がparticipantA/B どちらとして保存されているか分からないため、両方向のインデックスを検索する。
export async function findOrCreateChatThread(me: ChatParticipant, other: ChatParticipant): Promise<ChatThreadRef> {
  const myKey = chatParticipantKey(me.kind, me.id);
  const otherKey = chatParticipantKey(other.kind, other.id);

  const [asA, asB] = await Promise.all([
    dataClient.models.ChatThread.listThreadsByParticipantA({ participantAKey: myKey }, { authMode: 'userPool' }),
    dataClient.models.ChatThread.listThreadsByParticipantB({ participantBKey: myKey }, { authMode: 'userPool' }),
  ]);

  const existing = [...asA.data, ...asB.data].find(
    (thread) =>
      (thread.participantAKey === myKey && thread.participantBKey === otherKey) ||
      (thread.participantBKey === myKey && thread.participantAKey === otherKey),
  );
  if (existing) {
    return { id: existing.id, owners: (existing.owners ?? []).filter((v): v is string => !!v) };
  }

  const threadInput = {
    participantAKey: myKey,
    participantAName: me.name,
    participantBKey: otherKey,
    participantBName: other.name,
    owners: [me.ownerSub, other.ownerSub],
  };
  // Organization/Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await dataClient.models.ChatThread.create(threadInput as any);
  if (result.errors?.length || !result.data) {
    throw new Error(result.errors?.map((e) => e.message).join(' / ') ?? 'チャットの開始に失敗しました。');
  }

  return { id: result.data.id, owners: threadInput.owners };
}

export interface GroupChatThreadRef {
  id: string;
  organizationName: string;
}

export async function findOrCreateGroupChatThread(
  organizationId: string,
  organizationName: string,
): Promise<GroupChatThreadRef> {
  const result = await dataClient.models.GroupChatThread.get({ id: organizationId }, { authMode: 'userPool' });
  if (result.data) {
    return { id: result.data.id, organizationName: result.data.organizationName };
  }

  // なければ作成
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadInput: any = {
    id: organizationId,
    organizationId,
    organizationName,
  };
  const createResult = await dataClient.models.GroupChatThread.create(threadInput, { authMode: 'userPool' });

  if (createResult.errors?.length || !createResult.data) {
    throw new Error(createResult.errors?.map((e) => e.message).join(' / ') ?? 'グループチャットの開始に失敗しました。');
  }

  return { id: createResult.data.id, organizationName: createResult.data.organizationName };
}
