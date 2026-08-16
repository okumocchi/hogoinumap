import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import webpush from 'web-push';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * 対象の userSub 配列に対してプッシュ通知を一括送信するヘルパー関数
 */
async function sendPushNotificationToUsers(
  recipientSubs: string[],
  title: string,
  body: string
) {
  const tableName = process.env.PUSH_SUBSCRIPTION_TABLE_NAME;
  if (!tableName || recipientSubs.length === 0) return;

  // 重複を除外したユニークな recipientSub の集合
  const targetUserSubSet = new Set(
    recipientSubs.filter((sub): sub is string => Boolean(sub))
  );
  if (targetUserSubSet.size === 0) return;

  console.log(
    `[sendPush] Target userSubs (${targetUserSubSet.size}):`,
    Array.from(targetUserSubSet)
  );

  try {
    // 1回の ScanCommand でテーブル内の全 PushSubscription を取得してメモリ上でマッチング
    const subsResult = await docClient.send(
      new ScanCommand({
        TableName: tableName,
      })
    );

    const allItems = subsResult.Items || [];
    const matchedSubs = allItems.filter(
      (item) => item.userSub && targetUserSubSet.has(item.userSub)
    );

    console.log(
      `[sendPush] Matched subscriptions count in DB: ${matchedSubs.length}`
    );
    if (matchedSubs.length === 0) return;

    console.log(
      `[sendPush] Sample subscription items in DB (first 3):`,
      JSON.stringify(
        matchedSubs.slice(0, 3).map((item) => ({
          id: item.id,
          userSub: item.userSub,
          endpoint: item.endpoint?.slice(-25),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        null,
        2
      )
    );

    // ユーザーごとにサブスクリプションをグループ化し、最新の2件（PC・スマホ等）のみ保持
    const userSubGroups = new Map<string, any[]>();
    for (const sub of matchedSubs) {
      if (!sub.userSub) continue;
      if (!userSubGroups.has(sub.userSub)) {
        userSubGroups.set(sub.userSub, []);
      }
      userSubGroups.get(sub.userSub)!.push(sub);
    }

    const uniqueSubMap = new Map<string, any>();
    const obsoleteItems: any[] = [];

    for (const subs of userSubGroups.values()) {
      // 作成日時/更新日時で降順ソート（最新アイテムを先頭に）
      subs.sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      const KEEP_LIMIT = 2; // 1ユーザーあたり保持する最新端末数
      subs.forEach((sub, index) => {
        if (index < KEEP_LIMIT) {
          if (sub.endpoint && !uniqueSubMap.has(sub.endpoint)) {
            uniqueSubMap.set(sub.endpoint, sub);
          }
        } else {
          obsoleteItems.push(sub);
        }
      });
    }

    // 過去の古い大量ゴミレコードの一括自動クリーンアップ
    if (obsoleteItems.length > 0) {
      console.log(
        `[sendPush] Attempting to purge ${obsoleteItems.length} obsolete records...`
      );
      const results = await Promise.allSettled(
        obsoleteItems.map(async (item) => {
          let keyObj: Record<string, any> = { id: item.id };
          let res = await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: keyObj,
              ReturnValues: 'ALL_OLD',
            })
          );

          // もし id 単体で物理削除属性が返らなかった場合、id + userSub 複合キーで削除試行
          if (!res.Attributes && item.userSub) {
            keyObj = { id: item.id, userSub: item.userSub };
            res = await docClient.send(
              new DeleteCommand({
                TableName: tableName,
                Key: keyObj,
                ReturnValues: 'ALL_OLD',
              })
            );
          }
          return { id: item.id, attributes: res.Attributes };
        })
      );

      const deletedCount = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as any).attributes
      ).length;
      const unmatchedCount = obsoleteItems.length - deletedCount;

      console.log(
        `[sendPush] Purged ${deletedCount}/${obsoleteItems.length} obsolete records (Unmatched/Failed: ${unmatchedCount}).`
      );
    }

    // ユニーク端末へ送信
    console.log(
      `[sendPush] Sending notification to ${uniqueSubMap.size} unique endpoints...`
    );

    for (const sub of uniqueSubMap.values()) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        const payload = JSON.stringify({
          title,
          body,
          badgeCount: 1,
          url: '/',
        });

        await webpush.sendNotification(pushSubscription, payload);
        console.log(
          `[sendPush] Success sent to userSub: ${sub.userSub} (id: ${sub.id})`
        );
      } catch (err: any) {
        const statusCode = err?.statusCode || err?.status;
        const errBody =
          typeof err?.body === 'string' ? err.body.toLowerCase() : '';
        const errMessage =
          typeof err?.message === 'string' ? err.message.toLowerCase() : '';

        const isInvalidOrExpired =
          statusCode === 410 ||
          statusCode === 404 ||
          statusCode === 400 ||
          errBody.includes('notregistered') ||
          errBody.includes('invalidregistration') ||
          errMessage.includes('expired') ||
          errMessage.includes('invalid');

        if (isInvalidOrExpired && sub.id) {
          console.warn(
            `[sendPush] Invalid/Expired subscription (status ${statusCode}), deleting ID: ${sub.id}`
          );
          try {
            const delRes = await docClient.send(
              new DeleteCommand({
                TableName: tableName,
                Key: { id: sub.id },
                ReturnValues: 'ALL_OLD',
              })
            );
            if (delRes.Attributes) {
              console.log(
                `[sendPush] Successfully deleted expired subscription ID: ${sub.id}`
              );
            } else {
              console.warn(
                `[sendPush] DeleteCommand matched 0 items for expired ID: ${sub.id}`
              );
            }
          } catch (delErr) {
            console.error(
              `[sendPush] Failed to delete expired ID ${sub.id}:`,
              delErr
            );
          }
        } else {
          console.error(`[sendPush] Failed to send push to ID ${sub.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[sendPush] Error in sendPushNotificationToUsers:', err);
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  console.log(
    `[sendPush] Handler invoked with ${event.Records?.length || 0} stream records.`
  );
  try {
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const publicKey = process.env.VAPID_PUBLIC_KEY;

    if (!privateKey) {
      console.error('VAPID_PRIVATE_KEY is missing');
      return;
    }

    webpush.setVapidDetails(
      'mailto:admin@example.com',
      publicKey || '',
      privateKey
    );

    for (const record of event.Records) {
      try {
        console.log(
          `[sendPush] Stream record eventName: ${record.eventName}, eventSourceARN: ${record.eventSourceARN}`
        );

        if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) {
          continue;
        }

        const newImage = record.dynamodb.NewImage;

        // 1. 個別チャットメッセージ (ChatMessage) 新規作成イベント
        if (newImage.threadId?.S && newImage.body?.S) {
          const senderName = newImage.senderName?.S || '新しいメッセージ';
          const bodyText = newImage.body?.S || 'メッセージが届きました';
          const owners = newImage.owners?.L?.map((item) => item.S) || [];

          const recipientSubs = Array.from(
            new Set(
              owners
                .map((ownerStr) => ownerStr?.split('::')[0])
                .filter((sub): sub is string => Boolean(sub))
            )
          );

          await sendPushNotificationToUsers(
            recipientSubs,
            `新着メッセージ (${senderName})`,
            bodyText
          );
        }
        // 2. 保護犬 (Dog) 新規登録イベント
        else if (newImage.organizationId?.S) {
          const dogName = newImage.name?.S || '新しい保護犬';
          const orgId = newImage.organizationId.S;

          // 団体名を取得
          let orgName = '保護団体';
          const orgTableName = process.env.ORGANIZATION_TABLE_NAME;
          if (orgTableName && orgId) {
            try {
              const orgResult = await docClient.send(
                new GetCommand({
                  TableName: orgTableName,
                  Key: { id: orgId },
                })
              );
              if (orgResult.Item?.name) {
                orgName = orgResult.Item.name;
              }
            } catch (orgErr) {
              console.error('Failed to fetch Organization name:', orgErr);
            }
          }

          // 団体に所属承認されているボランティアを取得
          const affTableName = process.env.AFFILIATION_TABLE_NAME;
          if (affTableName) {
            try {
              const affResult = await docClient.send(
                new ScanCommand({
                  TableName: affTableName,
                  FilterExpression:
                    'organizationId = :orgId AND #st = :approved',
                  ExpressionAttributeNames: { '#st': 'status' },
                  ExpressionAttributeValues: {
                    ':orgId': orgId,
                    ':approved': 'APPROVED',
                  },
                })
              );

              const affiliations = affResult.Items || [];
              const recipientUserSubs = new Set<string>();

              for (const aff of affiliations) {
                const owners = aff.owners || [];
                if (Array.isArray(owners)) {
                  for (const ownerStr of owners) {
                    if (typeof ownerStr === 'string') {
                      const userSub = ownerStr.split('::')[0];
                      if (userSub) recipientUserSubs.add(userSub);
                    }
                  }
                }
              }

              if (recipientUserSubs.size > 0) {
                await sendPushNotificationToUsers(
                  Array.from(recipientUserSubs),
                  `【保護犬登録】${dogName}`,
                  `${orgName}に新しい保護犬「${dogName}」が登録されました`
                );
              }
            } catch (affErr) {
              console.error(
                'Failed to fetch Affiliations for dog notification:',
                affErr
              );
            }
          }
        }
      } catch (recordErr) {
        console.error('Error processing stream record:', recordErr);
      }
    }
  } catch (topLevelErr) {
    console.error(
      'Unhandled top-level error in send-push handler:',
      topLevelErr
    );
  }
};
