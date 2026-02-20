# Quick2Calendar（MVP）

Quick2Calendar の公開配布向け Electron 実装です。  
macOSでの常駐利用を前提に、グローバルショートカット起動・自然文入力・Gemini解釈・Google Calendar登録・聞き返しを提供します。

## 実装済み機能（要件対応）
- グローバルショートカットで最前面クイック入力表示
- グローバルショートカットはRaycast風トグル（再押下で非表示）
- フォーカス外れ時は遅延判定付きで自動非表示（トラックパッド三本指スワイプ時の誤非表示を抑制）/ `Escape` でも非表示
- マウスカーソル所在ディスプレイへの表示
- ガラス板（クイック入力ウィンドウ）は背景のどこでもドラッグ移動（操作要素は除外）
- 黒曜石ベースのガラス調UI（Quick/Settings）
- 送信履歴をチャット形式で保持（入力欄は内部スクロール）
- 会話内容に応じてクイック入力ウィンドウが縦方向へ自動拡張（最大600px）
- `Cmd+Enter`送信 / `Enter`改行（`Shift+Enter`でも改行）
- `Cmd+Shift+O` で新しいチャット（履歴/状態をリセットして折りたたみへ）
- 画像添付（ファイル選択 / クリップボード貼り付け）からの予定抽出
- 入力は常に Gemini で解釈してから登録
- 曖昧時の聞き返しフロー（継続）
- Google OAuth接続と `events.insert`
- Google連携解除時のトークン失効（ベストエフォート）
- 重複候補（同一タイトル + 開始時刻±30分）確認
- `Cmd + ,` で設定画面
- Keychain保存（Gemini APIキー / Googleトークン）
- `Application Support`配下の設定保存

## 前提
- macOS
- Node.js 20+
- Google Cloud で OAuth Client ID/Secret を取得済み
- Gemini APIキー

## OAuth設定（アプリ内蔵方式）
通常ユーザーはOAuth情報を入力しません。`Googleを接続` ボタンだけで認証します。  
開発時は以下のどちらかでOAuth情報をアプリに組み込みます。

1. `oauth-client.example.json` を `oauth-client.local.json` にコピーして値を設定
2. 環境変数 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` を設定

## セットアップ
1. 依存関係インストール
```bash
npm install
```

2. アプリ起動
```bash
npm start
```

3. 設定画面（`Cmd + ,`）で以下を設定
- 起動ショートカット（「ショートカットを記録」ボタンで任意キーを直接登録）
- Gemini APIキー
- モデルは複数プリセット（3.0 Preview/2.0/2.5/1.5系）から選択、またはカスタム入力
- Geminiに渡すカスタム指示

4. `Googleを接続` を押してブラウザ認証

## 画像添付入力
- クイック入力左側の「クリップ（添付）」ボタンから画像を添付できます（最大3件、各6MB）。
- `Cmd+V` で画像を貼り付けても添付できます。
- 画像内の文字情報を Gemini が読み取り、入力文と統合して予定化します。

## 開発時の最低確認
```bash
npm run check
```


## Linuxコンテナでの実行検証（CI/QA向け）
Linuxコンテナで Electron を実行する場合は、依存ライブラリ・D-Bus・Secret Service・仮想ディスプレイが必要です。

```bash
npm run setup:linux-deps
npm run smoke:linux
```

- `setup:linux-deps`: aptベース環境向けに必要パッケージをインストール
- `smoke:linux`: `dbus-run-session` + `gnome-keyring-daemon` + `xvfb-run` でヘッドレス起動スモークテスト

> 補足: `smoke:linux` は既定で20秒後に `timeout` で終了します。
> 必要なら `SMOKE_TIMEOUT_SECONDS=40 npm run smoke:linux` のように延長してください。

## 配布ビルド（macOS .app/.dmg/.zip）
GitHub配布向けに **electron-builder** で成果物を生成できます（署名/Notarizationは後述ガイド参照）。

```bash
# 現在のCPUアーキテクチャ向けにビルド（dmg + zip）
npm run dist:mac
```

成果物は `dist/` に出力されます。

> 補足: このリポジトリが Google Drive / iCloud などの同期フォルダ配下にある場合、Finder情報（xattr）が自動付与されて `codesign` が失敗しやすいです。  
> `npm run dist:mac` は内部的に **一時出力を /tmp 側に逃がしてビルド**し、`dist/` には **dmg/zip だけ**コピーする方式で回避します。

### OAuth同梱について
配布物には `oauth-client.json` を同梱します（ビルド時に生成）。

- **推奨（配布/CI）**: 環境変数 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`
- **ローカル**: `oauth-client.local.json`（開発用）を元に生成

詳細: `review/RELEASE_GUIDE.md`

## 診断ログ（成功表示なのに予定が見えない場合）
- 設定画面の `診断ログ` から、ログパス確認・再読み込み・ファイルを直接開くことができます。
- ログファイル: `~/Library/Application Support/Quick2Calendar/logs/app.log`（JSON Lines）
- 主要イベント:
  - `schedule.create.start` / `schedule.result`: 入力から最終結果まで
  - `gemini.request.*`: Gemini APIの開始・応答・タイムアウト・HTTPエラー
  - `calendar.insert.request` / `calendar.insert.response`: Google Calendar登録リクエスト/レスポンス
- `Googleカレンダーに登録しました。` が表示されたのに見えない場合、まず `calendar.insert.response` の `htmlLink` と `organizer` を確認してください。登録先カレンダーや表示対象の切り分けができます。

## OAuth審査準備チェック
1. `review/release-metadata.example.json` を `review/release-metadata.local.json` にコピーして実値を入力
2. 以下を実行
```bash
npm run check:review
```
審査提出直前は厳格チェックも実行
```bash
npm run check:review:strict
```
3. 詳細ガイド: `review/OAUTH_VERIFICATION_GUIDE.md`
4. 提出用文書の下書き: `review/legal/*.md`

## ファイル構成
- `src/main/main.js`: Electronメインプロセス、ショートカット、IPC
- `src/main/scheduler-service.js`: 入力解釈、聞き返し、重複判定、登録フロー
- `src/main/gemini-client.js`: Gemini連携
- `src/main/google-calendar-client.js`: Google Calendar連携
- `src/main/oauth-config.js`: OAuth設定（環境変数/同梱ファイル）解決
- `src/main/settings-store.js`: 設定ファイル永続化
- `src/main/secure-store.js`: Keychain保存
- `src/renderer/quick.*`: クイック入力UI
- `src/renderer/settings.*`: 設定UI
- `scripts/check-oauth-readiness.mjs`: OAuth審査前チェック

## 注意
- 開発時は `oauth-client.local.json`（または環境変数）が無いとGoogle連携できません。
- Keychain利用不可環境では秘密情報保存が失敗する可能性があります。
- 日時解釈は Gemini 応答を基準に行います。解釈が曖昧な場合は確認質問を返します。
- macOS の「アクセシビリティ > ディスプレイ > 透明度を下げる」がONだと、ガラス調ではなくグレー表示になります。
- OAuth認証中に `Googleを接続` を連打すると検証失敗（state不一致）になるため、認証タブは1つだけ開いて完了してください。
