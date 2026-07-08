import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-sign-up/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: '【保護犬マップ】アカウント登録の確認コード',
      verificationEmailBody: (createCode) => `
        <p>保護犬マップにご登録いただきありがとうございます。</p>
        <p>登録手続きを完了するために、以下の確認コードを入力してください。</p>
        <p><strong>確認コード： ${createCode()}</strong></p>
        <br />
        <p>※このコードの有効期限は24時間です。<br />
        ※本メールに心当たりがない場合は、お手数ですがこのメールを破棄してください。</p>
      `,
    },
  },
  triggers: {
    preSignUp,
  },
});
