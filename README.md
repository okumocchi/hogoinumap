# hogoinumap (保護犬マップ)

保護犬の一時預かりや里親募集を支援するためのマップアプリケーションです。

## 保護犬の状態定義

このプロジェクトにおいて、保護犬の状態はデータベース上の基本ステータス、各種フラグ、そしてそれらを組み合わせた画面表示用の「導出ステータス」で管理されています。

### 1. 基本ステータス（ライフサイクル）
データベース上では、`DogStatus` 型（[models.ts](./src/types/models.ts)）として保護犬の基本的なライフサイクル状態が定義されています。

| ステータス値 (`DogStatus`) | 画面表示名（ラベル） | 意味 |
| :--- | :--- | :--- |
| `PROTECTED` | **保護中** | 団体または一時避難所などで保護されている状態 |
| `FOSTERED` | **預かり中** | 預かりボランティアの家庭などで預かり生活を送っている状態 |
| `IN_TRANSIT` | **搬送中** | 施設間や預かり先へ移動・搬送している状態 |
| `ADOPTED` | **譲渡済み** | 里親への譲渡が完了した状態 |
| `RETURNED` | **返還済み** | 元の飼い主に返還された状態 |

---

### 2. 募集状態（フラグ）
里親や預かりボランティアの募集状況を表す boolean 型のフラグです。

- **里親募集中 (`seekingAdopter`)**: 里親（引き取り手）を募集しているかどうか。
- **預かりボランティア募集中 (`seekingFoster`)**: 一時預かりをしてくれるボランティアを募集しているかどうか。

---

### 3. 画面表示上での導出ステータス（ビジネスロジック）
データベースに直接保持されている値ではなく、基本ステータスや募集フラグ、預かり者の設定状況（`custodianOwnerSub`：預かりボランティア等のID）を組み合わせて画面上で表現される状態です。

- **「預かり準備中」**
  - **導出条件**: ステータスが `PROTECTED` (保護中) かつ `custodianOwnerSub` が設定されている場合。
  - **意味**: 預かり先となるボランティアは決定している（または手続き中である）が、まだ実際の預かり生活（`FOSTERED`）は開始されていない状態。
- **「預かり募集中」**
  - **導出条件**: `seekingFoster` が `true` かつ `custodianOwnerSub` が未設定（まだ預かり先が決まっていない）の場合。
  - **意味**: 実際に一時預かりボランティアを募っている状態（預かり先が決定している間はバッジを非表示にします）。

---

### 4. 医療・健康状態（処置日）
保護犬の医療的な状態（実施済みかどうか）は、それぞれの日付フィールドの有無で表されます。

- **去勢・避妊手術実施日 (`sterilizationDate`)**: 手術が実施されているかどうかの状態を表します。
- **狂犬病予防接種実施日 (`rabiesVaccinationDate`)**: 狂犬病ワクチンの接種状態。
- **混合ワクチン接種実施日 (`mixedVaccinationDate`)**: 混合ワクチンの接種状態。

---

### 5. 基本属性（犬自体の状態）
- **性別 (`gender`)**: `MALE`（オス）/ `FEMALE`（メス）/ `UNKNOWN`（不明）
- **大きさ (`size`)**: `SMALL`（小型）/ `MEDIUM`（中型）/ `LARGE`（大型）
- **年齢**: 生年月日（`birthDate`）と、それが推定であるかどうかのフラグ（`birthDateEstimated`）を基に、「推定3歳2ヶ月」などのように年齢状態を算出します。

---

## 開発環境について (Vite + React + TypeScript)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
