# OAuth Verification 対応ガイド（Quick2Calendar）

## 目的
- 公開配布で `Google Calendar API` を安定運用するため、OAuth審査に必要な情報を事前に揃える。
- 審査で落ちやすいポイント（情報不足、スコープ過多、説明不足）を提出前に潰す。

## 現在の設計方針
- スコープは最小化し、`https://www.googleapis.com/auth/calendar.events` のみ要求する。
- 連携解除時はローカル削除だけでなく、Google側のトークン失効も試行する。
- OAuth情報は設定画面入力ではなく、運用設定（環境変数または同梱設定）として管理する。

## 事前準備チェック
1. `review/release-metadata.example.json` を `review/release-metadata.local.json` にコピーする。
2. 実運用値を埋める。
3. `npm run check:review` を実行し、`Error` をゼロにする。
4. `scopeJustification` の文章を審査提出文へ転記する。
5. 審査用デモ動画URLを準備する。

## 提出時に必要な主要情報
1. アプリ名、サポートメール、開発者連絡先
2. ホームページURL、プライバシーポリシーURL、利用規約URL
3. データ削除手順URL（またはアプリ内削除導線説明）
4. 要求スコープと用途説明
5. 実際のOAuth同意フローと利用機能を示す動画

## 文書雛形
- `review/legal/privacy-policy.md`
- `review/legal/terms-of-service.md`
- `review/legal/data-deletion.md`

## 審査落ちしやすいポイント
1. プライバシーポリシーと同意画面情報の不一致
2. 実機能で使っていないスコープ要求
3. データ利用目的が抽象的で、ユーザー操作との対応が不明確
4. デモ動画で同意フローと実機能の対応が確認できない

## 運用メモ
- `release-metadata.local.json` は機密・運用情報を含むためGit管理しない。
- 仕様変更（スコープや認証フロー変更）時は、このガイドと `学びと気づきログ.md` を同時更新する。
