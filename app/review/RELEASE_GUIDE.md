# 配布ビルド / リリース手順（GitHub配布・macOS）

本ドキュメントは、Quick2Calendar を **Mac App Store ではなく GitHub から配布**するための手順メモです。  
（対象: macOS / GitHub配布。Developer ID 署名 + Notarization は任意）

## 0. 前提（目的別）

- Google OAuth Client（配布版に同梱するため）
- Gemini APIキーはユーザーが設定画面で保存（Keychain）

### 0.1 テスター配布 / 自分用（Apple Developer Program なし）

- 署名・Notarization はしない（= macOS の Gatekeeper に弾かれやすい）
- 受け取り側は初回起動時に以下のいずれかが必要になる
  - Finderでアプリを右クリック → **開く**
  - 設定（プライバシーとセキュリティ）で「このまま開く」を許可
  - もしくは `xattr -dr com.apple.quarantine Quick2Calendar.app` で隔離属性を外す

> 注意: 署名なし配布は「配布はできるが、一般ユーザーには不親切」になりやすいです。  
> 一般公開を想定する場合は **Developer ID 署名 + Notarization** を推奨します。

### 0.2 一般公開（推奨: Developer ID 署名 + Notarization）

- Apple Developer Program 加入（Developer ID 証明書が必要）
- Xcode 13+（Notarizationに必要）

## 1. OAuth（Google）を配布版に同梱する

配布物には `oauth-client.json` を同梱します（**ビルド時に生成**）。

- **推奨（CI/配布）**: 環境変数
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI`（未指定なら既定 `http://127.0.0.1:53682/oauth2callback`）
- **ローカル（開発）**: `oauth-client.local.json` を作成して値を入れる
  - `npm run setup:oauth`

ビルドでは `npm run build:oauth` が `oauth-client.json` を生成します（`.gitignore` 済み）。

## 2. ローカルでの配布ビルド（署名なし/あり）

```bash
npm ci
npm run check
npm run dist:mac
```

成果物: `dist/`（dmg / zip）

> 重要: Google Drive / iCloud など同期フォルダ配下だと、macOSの File Provider が FinderInfo を自動付与し `codesign --verify` が失敗することがあります。  
> `dist:mac` は内部的に **/tmp 配下へ出力してビルド**し、`dist/` には **dmg/zip のみ**コピーするため、この問題を回避できます。  
> デバッグ用に一時出力を残したい場合は `KEEP_ELECTRON_BUILDER_TMP=1` を付けて実行します。

## 3. 署名（Developer ID Application）

### 3.1 証明書を用意

- Keychain Access で **Developer ID Application** を作成/インストール
- p12 に書き出し（パスワードを設定）
- 署名IDの確認（任意）
  ```bash
  security find-identity -p codesigning -v
  ```

### 3.2 electron-builder の署名入力

electron-builder は以下の環境変数で証明書を読み込みます（CI向け）。

- `CSC_LINK`: p12 のパス（またはURL）
- `CSC_KEY_PASSWORD`: p12 のパスワード

## 4. Notarization（推奨: App Store Connect API key）

`scripts/notarize.cjs` は、認証情報が設定されている場合のみ Notarization を実行します。

### 4.1 App Store Connect API key（CI推奨）

- `APPLE_API_KEY`: `.p8` の絶対パス
- `APPLE_API_KEY_ID`: Key ID（例: `T9GPZ92M7K`）
- `APPLE_API_ISSUER`: Issuer ID（Team Keyの場合は必須、Individual keyなら省略）

### 4.2 Apple ID（app-specific password）

- `APPLE_ID`
- `APPLE_ID_PASSWORD`（アプリ用パスワード）
- `APPLE_TEAM_ID`

### 4.3 Keychain profile（ローカル推奨）

事前に `xcrun notarytool store-credentials` で保存しておく方式です。

- `APPLE_NOTARIZE_KEYCHAIN_PROFILE`
- `APPLE_NOTARIZE_KEYCHAIN`（任意）

## 5. GitHub ActionsでReleaseを作る（タグpush）

ワークフロー: `.github/workflows/release-macos.yml`

### 5.1 必須 Secrets

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`（任意）

### 5.2 署名（任意だが本番推奨）

- `MACOS_CERT_P12_BASE64`（p12 をbase64化した文字列）
- `MACOS_CERT_PASSWORD`

base64化の例（macOS）:

```bash
base64 < "/path/to/DeveloperID.p12" | pbcopy
```

### 5.3 Notarization（任意だが本番推奨）

API key方式:
- `APPLE_API_KEY_P8_BASE64`（p8 をbase64化）
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`（Team keyの場合）

base64化の例（macOS）:

```bash
base64 < "/path/to/AuthKey_XXXXXXXXXX.p8" | pbcopy
```

Apple ID方式:
- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`

### 5.4 リリース手順

1. `app/package.json` の `version` を更新
2. タグを打つ（例: `v0.1.0`）
3. GitHubへpush  
   → Actionsが走り、Releaseに `dmg/zip` が添付されます

### 5.5 公開対象チェック（必須）

タグ作成前に、公開対象外ファイルが追跡されていないことを確認します。

```bash
if git ls-files | rg "AGENTS\\.md|学びと気づきログ\\.md|デザインUX\\.md|要件定義\\.md" > /dev/null; then
  echo "NG: 公開対象外ファイルがgit追跡されています"
  exit 1
fi
```

> CI (`.github/workflows/release-macos.yml`) でも同じ検査を実行し、混入時はリリースを失敗させます。

### 5.6 誤リリース時の是正手順

公開対象外ファイルを含むタグ/Releaseを出してしまった場合は、以下を実施します。

```bash
# 1) 該当Releaseを削除
gh release delete <tag> --yes

# 2) ローカル/リモートのタグを削除
git tag -d <tag>
git push origin :refs/tags/<tag>

# 3) 修正後に新しいバージョンで再リリース
#    （同じタグの再利用はしない）
```

## 6. 署名・Notarizationの検証（任意）

（目視/運用の簡易検証）

- `spctl --assess --type execute --verbose <YourApp.app>`
- `xcrun stapler validate <YourApp.app>`

## 7. OAuth審査（Google）

公開配布で Calendar スコープを使うため、OAuth審査が必要になります。  
詳細は `review/OAUTH_VERIFICATION_GUIDE.md` を参照してください。

