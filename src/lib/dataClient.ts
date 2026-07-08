import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

type DataClient = ReturnType<typeof generateClient<Schema>>;

let client: DataClient | undefined;

function getClient(): DataClient {
  // Amplify.configure()が実行される前にgenerateClient()が走ると
  // "Amplify has not been configured" 警告が出るため、実際に使われる
  // タイミング(初回アクセス時)まで生成を遅らせる
  client ??= generateClient<Schema>();
  return client;
}

export const dataClient: DataClient = new Proxy({} as DataClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
