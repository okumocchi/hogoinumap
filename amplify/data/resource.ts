import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * 保護犬マップ データスキーマ (Amplify Gen2 / DynamoDB)
 *
 * 設計方針:
 * - DynamoDBはテーブル結合ができないため、頻繁に一緒に表示する情報は
 *   非正規化(コピー)して持たせている(例: Dogのprefecture/city)。
 * - 地図表示・一覧検索に必要なアクセスパターンは secondaryIndexes で用意する。
 * - 団体/ボランティアの個人データはowner認可、地図表示に必要な情報は
 *   ゲスト(未登録ユーザー)にも read を許可する。
 * - 年齢・月齢は保存せず、Dogのbirthdateから表示時に都度計算する想定。
 * - 写真・動画はDogとは別モデル(DogMedia)として管理する。実データ(バイナリ)は
 *   Amplify Storage(S3)に保存し、DogMediaにはS3キーとキャプションのみ持たせる。
 *   「いいね」は保護犬ではなく個々のDogMediaに対して付与する。
 */

const schema = a.schema({
  // ── 保護団体 ────────────────────────────────────────
  Organization: a
    .model({
      name: a.string().required(),
      prefecture: a.string().required(),
      city: a.string().required(),
      addressLine: a.string().required(), // 丁目・番地・建物名等(市区町村より後ろの詳細住所)
      latitude: a.float(),
      longitude: a.float(),
      contactEmail: a.string(),
      contactPhone: a.string(),
      wishlistUrl: a.string(), // 団体のAmazonほしいものリスト
      websiteUrl: a.string(), // 団体のウェブサイトURL

      // allow.owner()が内部的に持つownerフィールドはAPI経由で読み取れないため、
      // ボランティアが所属申請(Affiliation)のowners配列を組み立てる際に参照できるよう
      // 同じ形式(sub::username)の値を登録時に明示的なフィールドとして複製しておく
      ownerSub: a.string(),

      dogs: a.hasMany('Dog', 'organizationId'),
      affiliations: a.hasMany('Affiliation', 'organizationId'),
    })
    .authorization((allow) => [
      allow.owner(), // 団体アカウント本人が編集
      allow.guest().to(['read']), // 地図表示・譲渡希望者の閲覧用
      allow.authenticated().to(['read']),
    ]),

  // ── 預かりボランティア ──────────────────────────────
  Volunteer: a
    .model({
      handleName: a.string().required(),
      prefecture: a.string().required(),
      city: a.string().required(),
      latitude: a.float(),
      longitude: a.float(),
      wishlistUrl: a.string(), // ボランティア個人のほしいものリスト

      // allow.owner()が内部的に持つownerフィールドはAPI経由で読み取れないため、
      // 団体側がチャットスレッド(ChatThread)のowners配列を組み立てる際に参照できるよう
      // 同じ形式(sub::username)の値を登録時に明示的なフィールドとして複製しておく
      ownerSub: a.string(),

      // 自己紹介文(年齢・家族構成など)と飼養環境画像は、地図で誰でも見える
      // handleName/所在地とは性質が異なるプライバシー情報のため、
      // フィールド単位で公開範囲を絞り、登録ユーザー(団体・ボランティア)のみ閲覧可能にする
      profileIntroduction: a.string().authorization((allow) => [
        allow.owner(),
        allow.authenticated().to(['read']),
      ]),
      housingPhotoKeys: a.string().array().authorization((allow) => [
        allow.owner(),
        allow.authenticated().to(['read']),
      ]), // 飼養環境が伝わる写真(複数枚、S3キーの配列)

      affiliations: a.hasMany('Affiliation', 'volunteerId'),
      fosteringSlots: a.hasMany('FosteringSlot', 'volunteerId'),
      matches: a.hasMany('Match', 'volunteerId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
    ]),

  // ── 所属承認申請(ボランティア⇔団体) ────────────────
  Affiliation: a
    .model({
      volunteerId: a.id().required(),
      volunteer: a.belongsTo('Volunteer', 'volunteerId'),
      organizationId: a.id().required(),
      organization: a.belongsTo('Organization', 'organizationId'),

      status: a.enum(['PENDING', 'APPROVED', 'REJECTED']),
      requestMessage: a.string(), // 例:「札幌の山田です。承認お願いします。」

      // 団体側ユーザーのsubとボランティア側ユーザーのsubを両方格納し、
      // 両者だけが read/update できるようにする(マルチオーナー)
      owners: a.string().array(),
    })
    .authorization((allow) => [allow.ownersDefinedIn('owners')])
    .secondaryIndexes((index) => [
      // 団体側:「承認待ち一覧」を素早く取得
      index('organizationId')
        .sortKeys(['status'])
        .queryField('listByOrganizationAndStatus'),
      // ボランティア側:「自分の申請状況一覧」
      index('volunteerId').queryField('listAffiliationsByVolunteer'),
    ]),

  // ── 保護犬 ──────────────────────────────────────────
  Dog: a
    .model({
      organizationId: a.id().required(),
      organization: a.belongsTo('Organization', 'organizationId'),

      name: a.string(),
      protectedDate: a.date(), // 保護日
      story: a.string(), // 保護の経緯
      gender: a.enum(['MALE', 'FEMALE', 'UNKNOWN']),
      size: a.enum(['SMALL', 'MEDIUM', 'LARGE']), // 大きさ
      birthDate: a.date(), // 生年月日(年齢・月齢は表示時に現在日から算出する)
      birthDateEstimated: a.boolean().default(false), // 生年月日が推定かどうか
      // 性格。団体(owner)に加え、現在この犬を実際に預かっている本人
      // (custodianOwnerSubが一致するボランティア)も編集できる
      personality: a.string().authorization((allow) => [
        allow.owner(),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.ownerDefinedIn('custodianOwnerSub').to(['read', 'update']),
      ]),
      // IN_TRANSIT: 団体→ボランティア、またはボランティア→別のボランティアへの移送中
      //
      // 「預かり準備中」は独立したstatus値としてDBに保存せず、custodianOwnerSubが
      // セットされていてstatusがまだPROTECTEDのままの状態から表示側で導出する(下記参照)。
      // そうすることで、申し出た本人(ボランティア)がstatus自体を書き換える必要がなくなり、
      // statusは「団体(owner)」または「現在の預け先(custodianOwnerSubが一致する本人)」
      // のみが書き込める、という厳密な認可のままにできる。
      //
      // フィールド単位のauthorization()はa.enum()では未対応のため、a.string()で保持し
      // 値の妥当性はクライアント側の型(DogStatus)で担保する
      // (PROTECTED | FOSTERED | ADOPTED | RETURNED | IN_TRANSIT)。
      //
      // custodianOwnerSubは単一の文字列(a.string())なので、複数所有者用の
      // ownersDefinedIn(内部的にstring().array()を要求し型が競合してデプロイエラーになる)
      // ではなく、単一所有者用のownerDefinedInを使う。
      status: a.string().authorization((allow) => [
        allow.owner(),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.ownerDefinedIn('custodianOwnerSub').to(['read', 'update']),
      ]),
      seekingAdopter: a.boolean().default(true), // 里親募集中フラグ
      seekingFoster: a.boolean().default(false).authorization((allow) => [
        allow.owner(),
        allow.guest().to(['read']),
        allow.authenticated().to(['read']),
        allow.ownerDefinedIn('custodianOwnerSub').to(['read', 'update']),
      ]), // 預かりボランティア募集中フラグ

      // 預かり手続き中の「預け先ID」(sub::username形式)。ボランティアが申し出た瞬間に
      // 自分自身をセットする必要があるため、このフィールドのみ認証済みユーザーなら誰でも
      // 書き込めるようにする(自己申告)。悪用されても書き換えられるのはこのIDだけで、
      // 表示上「預かり準備中」に見えてしまう程度の実害に留まり、団体側でいつでもクリアできる。
      custodianOwnerSub: a.string().authorization((allow) => [
        allow.owner(),
        allow.guest().to(['read']),
        allow.authenticated().to(['read', 'update']),
      ]),

      // 未実施の場合もあるため、いずれも任意項目
      sterilizationDate: a.date(), // 去勢/避妊手術日
      rabiesVaccinationDate: a.date(), // 狂犬病ワクチン接種日
      mixedVaccinationDate: a.date(), // 混合ワクチン接種日

      // 団体の所在地を非正規化してコピー(地図フィルタ・GSI用)
      prefecture: a.string().required(),
      city: a.string().required(),

      media: a.hasMany('DogMedia', 'dogId'), // 写真・動画は別モデルで管理(下部参照)
      matches: a.hasMany('Match', 'dogId'),
    })
    .authorization((allow) => [
      allow.owner(), // 登録した団体が編集
      allow.guest().to(['read']), // 譲渡希望者・支援者が閲覧
      allow.authenticated().to(['read']),
    ])
    // 地図側の「募集中の犬を地域で絞り込み」は、seekingFosterがboolean型のため
    // GSIのキーにできない(Amplify DataはPK/SKにstring・number・enumのみ許可)。
    // MVPでは listByOrganization 等で取得した一覧をクライアント側でフィルタする。
    .secondaryIndexes((index) => [
      // 団体側:「自団体の保護犬一覧」
      index('organizationId').queryField('listByOrganization'),
      // ボランティア側:「現在自分が預け先になっている保護犬一覧」(custodianOwnerSubが
      // 未設定の犬はスパースインデックスのため含まれない)
      index('custodianOwnerSub').queryField('listDogsByCustodian'),
    ]),

  // ── 預かり履歴(保護犬の保護者・預かり者の変遷) ─────────
  // Dogモデル本体には手を加えず(hasMany/belongsToによる関連付けも行わず)、
  // 完全に独立したテーブルとして追加する。dogIdは単なる文字列フィールドとして持ち、
  // 検索はこのテーブル自身のセカンダリインデックスのみで行う。
  CustodyRecord: a
    .model({
      dogId: a.id().required(),

      custodianType: a.enum(['ORGANIZATION', 'VOLUNTEER']),
      custodianId: a.id().required(), // organizationId または volunteerId
      custodianName: a.string().required(), // 表示用に非正規化してコピー

      startDate: a.date().required(), // 保護時、または預かり者が変わった日

      // 記録した本人(団体/ボランティア)が誤登録時に修正できるようownerのみ編集可
      // 閲覧は保護犬詳細ページで表示するためguestにも許可(将来閲覧制限をかける可能性あり)
    })
    .authorization((allow) => [
      allow.owner(),
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
    ])
    .secondaryIndexes((index) => [
      index('dogId').sortKeys(['startDate']).queryField('listCustodyRecordsByDog'),
    ]),

  // ── 保護犬の写真・動画 ────────────────────────────────
  // 実データ(バイナリ)はS3(Amplify Storage)に保存し、ここではメタ情報のみ管理する。
  // createdAt(Amplify標準の自動フィールド)を使い、新着順(降順)で一覧取得する。
  DogMedia: a
    .model({
      dogId: a.id().required(),
      dog: a.belongsTo('Dog', 'dogId'),

      mediaType: a.enum(['PHOTO', 'VIDEO']),
      s3Key: a.string().required(), // S3上のオブジェクトキー
      // 一覧表示用のサムネイル(中央を正方形に切り抜いた100px角のWEBP画像)のS3キー
      thumbnailS3Key: a.string(),
      caption: a.string(), // 投稿時の一言説明文
      // 撮影日時。EXIFのDateTimeOriginalから取得し、取得できない場合は投稿日時を設定する
      // (EXIFが無い動画や、後から手動で設定する場合もあるため任意項目)
      capturedAt: a.datetime(),
      // secondaryIndexesのsortKeyとして参照するため明示的に宣言する
      // (値自体はAmplifyが自動設定する標準フィールド)
      createdAt: a.datetime(),

      likes: a.hasMany('MediaLike', 'dogMediaId'),
    })
    .authorization((allow) => [
      allow.owner(), // 投稿した団体が編集・削除
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
    ])
    .secondaryIndexes((index) => [
      // 「この犬の写真・動画を新着順で」→ クエリ時に sortDirection: 'DESC' を指定
      index('dogId').sortKeys(['createdAt']).queryField('listByDogSortedByDate'),
    ]),

  // ── 預かりスロット(ボランティアが登録) ──────────────
  FosteringSlot: a
    .model({
      volunteerId: a.id().required(),
      volunteer: a.belongsTo('Volunteer', 'volunteerId'),

      // スロット1つにつき1頭の預かりを表す(頭数フィールドは持たない)。
      // 年齢・性別・大きさは複数選択可能なため文字列配列で保持する
      // (a.enum()はarray化に対応していないため、値は下記の固定コード値のみを許可する運用とする)。
      conditionAges: a.string().array(), // 'UNDER_3_MONTHS' | 'UNDER_6_MONTHS' | 'UNDER_1_YEAR' | 'OVER_1_YEAR'
      conditionGenders: a.string().array(), // 'MALE' | 'FEMALE'
      conditionSizes: a.string().array(), // 'SMALL' | 'MEDIUM' | 'LARGE'
      conditionPeriod: a.enum([
        'TWO_WEEKS',
        'ONE_MONTH',
        'TWO_MONTHS',
        'THREE_MONTHS',
        'SIX_MONTHS',
        'UNSPECIFIED',
      ]),

      matches: a.hasMany('Match', 'slotId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.guest().to(['read']), // 地図表示用
      allow.authenticated().to(['read']),
    ])
    // スロットは「存在すること自体が空きあり」を意味するため、空き状況を表す
    // 独立したフィールドは持たない(受入不可を表したい場合はスロット自体を削除する)。
    .secondaryIndexes((index) => [index('volunteerId').queryField('listFosteringSlotsByVolunteer')]),

  // ── マッチング(団体⇔ボランティア⇔保護犬) ───────────
  Match: a
    .model({
      dogId: a.id().required(),
      dog: a.belongsTo('Dog', 'dogId'),
      volunteerId: a.id().required(),
      volunteer: a.belongsTo('Volunteer', 'volunteerId'),
      slotId: a.id(),
      slot: a.belongsTo('FosteringSlot', 'slotId'),

      status: a.enum(['REQUESTED', 'NEGOTIATING', 'CONFIRMED', 'CANCELLED']),

      // 団体側ユーザーとボランティア側ユーザーの両方
      owners: a.string().array(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('owners'), // 作成・編集は当事者のみ
      // 地図・詳細ページで「ボランティアが現在預かり中の犬」を表示するため、
      // 読み取りのみ広く許可する(交渉中の内容自体はrequestMessage等を持たないため実害は小さい)
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
    ])
    .secondaryIndexes((index) => [
      index('dogId').queryField('listMatchesByDog'),
      index('volunteerId').queryField('listMatchesByVolunteer'),
    ]),

  // ── 1対1チャット(登録済みユーザー同士、団体⇔ボランティア問わず) ──
  // 相手の種別が団体/ボランティアのどちらでも成立するよう、各参加者を
  // 「種別#ID」形式の文字列キーとして保持する(belongsToによる正規化はしない)。
  ChatThread: a
    .model({
      participantAKey: a.string().required(), // 例: "organization#xxxx" | "volunteer#xxxx"
      participantAName: a.string().required(),
      participantBKey: a.string().required(),
      participantBName: a.string().required(),

      // 両参加者のsub(sub::username形式)。この2者のみ読み書き可能にする
      owners: a.string().array().required(),

      messages: a.hasMany('ChatMessage', 'threadId'),
    })
    .authorization((allow) => [allow.ownersDefinedIn('owners')])
    .secondaryIndexes((index) => [
      // 自分がA側/B側どちらの場合もあるため、両方向のインデックスを用意し
      // クライアント側で合算して「自分が参加しているスレッド一覧」を求める
      index('participantAKey').queryField('listThreadsByParticipantA'),
      index('participantBKey').queryField('listThreadsByParticipantB'),
    ]),

  ChatMessage: a
    .model({
      threadId: a.id().required(),
      thread: a.belongsTo('ChatThread', 'threadId'),

      senderKey: a.string().required(), // 例: "organization#xxxx" | "volunteer#xxxx"
      senderName: a.string().required(),
      body: a.string().required(),

      // ChatThread.ownersをそのまま複製し、スレッド参加者のみ読み書き可能にする
      owners: a.string().array().required(),
      // secondaryIndexesのsortKeyとして参照するため明示的に宣言する
      createdAt: a.datetime(),
    })
    .authorization((allow) => [allow.ownersDefinedIn('owners')])
    .secondaryIndexes((index) => [
      index('threadId').sortKeys(['createdAt']).queryField('listMessagesByThread'),
    ]),

  // ── いいね(登録不要の支援者向け、写真・動画単位) ──────
  MediaLike: a
    .model({
      dogMediaId: a.id().required(),
      dogMedia: a.belongsTo('DogMedia', 'dogMediaId'),
      anonToken: a.string().required(), // Cookie等で発行する匿名ID(二重いいね防止)
    })
    .authorization((allow) => [
      allow.guest().to(['create', 'read', 'delete']),
      allow.authenticated().to(['create', 'read', 'delete']),
    ])
    .secondaryIndexes((index) => [
      index('dogMediaId').queryField('listByMedia'),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // 団体・ボランティアはCognitoユーザーとして認証
    defaultAuthorizationMode: 'userPool',
    // 譲渡希望者・支援者(登録不要ユーザー)はAPIキー経由でread/一部createのみ許可
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});
