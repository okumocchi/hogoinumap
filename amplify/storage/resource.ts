import { defineStorage } from '@aws-amplify/backend';

// 保護犬の写真・動画を保存するバケット。
// アップロードした団体(Identity Pool上のidentityId)のみが書込・削除でき、
// 地図・詳細ページでの閲覧用にゲスト・認証済みユーザーはいずれも読み取りのみ許可する。
export const storage = defineStorage({
  name: 'hogoinumapMedia',
  access: (allow) => ({
    'dog-media/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
    ],
  }),
});
