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
  if (!tableName) return;

  for (const recipientSub of recipientSubs) {
    try {
      const subsResult = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'userSub = :sub',
          ExpressionAttributeValues: { ':sub': recipientSub },
        })
      );

      const subscriptions = subsResult.Items || [];
      if (subscriptions.length === 0) continue;

      // endpoint ごとにグループ化し、同一 endpoint の重複アイテムを特定
      const uniqueSubMap = new Map<string, any>();
      const duplicateSubIds: string[] = [];

      for (const sub of subscriptions) {
        if (!sub.endpoint) continue;
        if (!uniqueSubMap.has(sub.endpoint)) {
          uniqueSubMap.set(sub.endpoint, sub);
        } else if (sub.id) {
          duplicateSubIds.push(sub.id);
        }
      }

      // 重複レコードの自動クリーンアップ
      for (const dupId of duplicateSubIds) {
        try {
          const delResult = await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: { id: dupId },
              ReturnValues: 'ALL_OLD',
            })
          );
          if (delResult.Attributes) {
            console.log(
              `Cleaned up duplicate push subscription record: ${dupId}`
            );
          } else {
            console.warn(
              `DeleteCommand for duplicate id ${dupId} matched 0 items in DynamoDB.`
            );
          }
        } catch (dupDelErr) {
          console.error(
            `Failed to clean up duplicate subscription ${dupId}:`,
            dupDelErr
          );
        }
      }

      // ユニークな各 endpoint に対してプッシュ通知を送信
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
            `Push notification sent to ${recipientSub} (endpoint: ${sub.endpoint.slice(-10)})`
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
              `Push subscription is invalid or expired (statusCode: ${statusCode}). Deleting subscription ID: ${sub.id}`
            );
            try {
              const delResult = await docClient.send(
                new DeleteCommand({
                  TableName: tableName,
                  Key: { id: sub.id },
                  ReturnValues: 'ALL_OLD',
                })
              );
              if (delResult.Attributes) {
                console.log(
                  `Successfully deleted invalid push subscription: ${sub.id}`
                );
              } else {
                console.warn(
                  `DeleteCommand for invalid sub id ${sub.id} matched 0 items in DynamoDB.`
                );
              }
            } catch (deleteErr) {
              console.error(
                `Failed to delete subscription ${sub.id}:`,
                deleteErr
              );
            }
          } else {
            console.error('Failed to send push notification', err);
          }
        }
      }
    } catch (err) {
      console.error(
        `Error processing push subscriptions for ${recipientSub}:`,
        err
      );
    }
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
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
