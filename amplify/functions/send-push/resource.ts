import { defineFunction, secret } from '@aws-amplify/backend';

export const sendPushFunction = defineFunction({
  name: 'send-push',
  entry: './handler.ts',
  environment: {
    VAPID_PRIVATE_KEY: secret('VAPID_PRIVATE_KEY'),
    VAPID_PUBLIC_KEY: process.env.VITE_VAPID_PUBLIC_KEY || '',
  },
  timeoutSeconds: 30,
});
