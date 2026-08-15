import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import webpush from 'web-push';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

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
        const senderName = newImage.senderName?.S || '新しいメッセージ';
        const bodyText = newImage.body?.S || 'メッセージが届きました';
        const owners = newImage.owners?.L?.map((item) => item.S) || [];

        // 宛先 userSub を抽出して重複排除
        const recipientSubs = Array.from(
          new Set(
            owners
              .map((ownerStr) => ownerStr?.split('::')[0])
              .filter((sub): sub is string => Boolean(sub))
          )
        );

        const tableName = process.env.PUSH_SUBSCRIPTION_TABLE_NAME;
        if (!tableName) continue;

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
                // 重複して登録されていたサブスクリプションIDを記録
                duplicateSubIds.push(sub.id);
              }
            }

            // テーブル内に同一 endpoint の重複レコードがあれば自動クリーンアップ
            for (const dupId of duplicateSubIds) {
              try {
                await docClient.send(
                  new DeleteCommand({
                    TableName: tableName,
                    Key: { id: dupId },
                  })
                );
                console.log(
                  `Cleaned up duplicate push subscription record: ${dupId}`
                );
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
                  title: `新着メッセージ (${senderName})`,
                  body: bodyText,
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
                  typeof err?.message === 'string'
                    ? err.message.toLowerCase()
                    : '';

                // 410 (Gone), 404 (Not Found), 400 (Bad Request / FCM NotRegistered 等)
                const isInvalidOrExpired =
                  statusCode === 410 ||
                  statusCode === 404 ||
                  statusCode === 400 ||
                  errBody.includes('notregistered') ||
                  errBody.includes('invalidregistration') ||
                  errMessage.includes('expired') ||
                  errMessage.includes('invalid');

                if (isInvalidOrExpired) {
                  console.warn(
                    `Push subscription is invalid or expired (statusCode: ${statusCode}). Deleting subscription ID: ${sub.id}`
                  );
                  if (sub.id) {
                    try {
                      await docClient.send(
                        new DeleteCommand({
                          TableName: tableName,
                          Key: { id: sub.id },
                        })
                      );
                      console.log(
                        `Successfully deleted invalid push subscription: ${sub.id}`
                      );
                    } catch (deleteErr) {
                      console.error(
                        `Failed to delete subscription ${sub.id}:`,
                        deleteErr
                      );
                    }
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
      } catch (recordErr) {
        console.error('Error processing stream record:', recordErr);
      }
    }
  } catch (topLevelErr) {
    // ハンドラー全体がスローして DynamoDB Stream の無限リトライが発生するのを防ぐ
    console.error(
      'Unhandled top-level error in send-push handler:',
      topLevelErr
    );
  }
};
