# Quick2Calendar（Google Calendar自動登録）

自然文（+画像）から予定を抽出し、Googleカレンダーへ登録する **macOS常駐ランチャー**です。  
狙いは **ChatGPT Desktop（macOS）の Option+Space ランチャー体験**に寄せた、即時入力UXです。

## ドキュメント

- アプリ実装README: `app/README.md`
- OAuth審査ガイド: `app/review/OAUTH_VERIFICATION_GUIDE.md`
- GitHub配布（署名/Notarization）: `app/review/RELEASE_GUIDE.md`

> 補足: 内部向け作業ドキュメント（仕様メモや学習ログ）は公開リポジトリの配布対象外です。

## 開発（ローカル起動）

```bash
cd app
npm install
npm start
```

