import { PreSignUpTriggerHandler } from 'aws-lambda';
import { CognitoIdentityProviderClient, ListUsersCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({});

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email;
  if (!email) {
    return event;
  }

  const userPoolId = event.userPoolId;

  try {
    // 既存の同じメールアドレスを持つユーザーを検索
    const listUsersResponse = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
      })
    );

    if (listUsersResponse.Users && listUsersResponse.Users.length > 0) {
      for (const user of listUsersResponse.Users) {
        // ステータスが UNCONFIRMED の場合のみ削除する
        if (user.UserStatus === 'UNCONFIRMED' && user.Username) {
          console.log(`Deleting unconfirmed user: ${user.Username} with email: ${email}`);
          await client.send(
            new AdminDeleteUserCommand({
              UserPoolId: userPoolId,
              Username: user.Username,
            })
          );
        }
      }
    }
  } catch (error) {
    console.error('Error checking or deleting unconfirmed user:', error);
    // 予期しないエラーが発生した場合はスローして、安全のためにサインアップ自体を一度失敗させる
    throw error;
  }

  return event;
};
