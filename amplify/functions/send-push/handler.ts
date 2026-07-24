import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import webpush from 'web-push';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: DynamoDBStreamHandler = async (event) => {
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
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) {
      continue;
    }

    const newImage = record.dynamodb.NewImage;
    const senderName = newImage.senderName?.S || '新しいメッセージ';
    const bodyText = newImage.body?.S || 'メッセージが届きました';
    const owners = newImage.owners?.L?.map((item) => item.S) || [];

    const recipientSubs = owners.map((ownerStr) => ownerStr?.split('::')[0]);

    for (const recipientSub of recipientSubs) {
      if (!recipientSub) continue;

      const tableName = process.env.PUSH_SUBSCRIPTION_TABLE_NAME;
      if (!tableName) continue;

      try {
        const subsResult = await docClient.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'userSub = :sub',
            ExpressionAttributeValues: { ':sub': recipientSub },
          })
        );

        const subscriptions = subsResult.Items || [];

        for (const sub of subscriptions) {
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
            console.log(`Push notification sent to ${recipientSub}`);
          } catch (err) {
            console.error('Failed to send push notification', err);
          }
        }
      } catch (err) {
        console.error('Error fetching push subscriptions', err);
      }
    }
  }
};
