import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { preSignUp } from './auth/pre-sign-up/resource';
import { sendPushFunction } from './functions/send-push/resource';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  preSignUp,
  sendPushFunction,
});

// PreSignUp Lambdaに対してCognitoのListUsers権限とAdminDeleteUser権限を付与する
backend.preSignUp.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminDeleteUser'],
    resources: ['*'], // UserPoolArnを直接参照すると循環依存が発生するため'*'を指定
  })
);

// NIST SP 800-63Bの推奨に合わせ、文字種混在の強制ではなく長さを重視したパスワードポリシーにする
// (defineAuthのloginWith経由では設定できないため、CDKのL1リソースを直接上書きする)
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 15,
    requireLowercase: false,
    requireUppercase: false,
    requireNumbers: false,
    requireSymbols: false,
  },
};

// ChatMessage テーブルの DynamoDB Stream を有効化し Lambda 関数にアタッチ
const chatMessageTable = backend.data.resources.tables['ChatMessage'];
const cfnChatMessageTable = chatMessageTable.node.defaultChild as dynamodb.CfnTable;
if (cfnChatMessageTable) {
  cfnChatMessageTable.streamSpecification = {
    streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
  };
}

backend.sendPushFunction.resources.lambda.addEventSource(
  new lambdaEventSources.DynamoEventSource(chatMessageTable, {
    startingPosition: lambda.StartingPosition.LATEST,
  })
);

// PushSubscription テーブルに対する読み書き権限と環境変数をアタッチ
const pushSubTable = backend.data.resources.tables['PushSubscription'];
pushSubTable.grantReadWriteData(backend.sendPushFunction.resources.lambda);
(backend.sendPushFunction.resources.lambda as lambda.Function).addEnvironment(
  'PUSH_SUBSCRIPTION_TABLE_NAME',
  pushSubTable.tableName
);



