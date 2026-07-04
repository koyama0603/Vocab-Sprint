# HTML English Word App

英単語落下ゲームの作業フォルダです。

## 現在の構成

- `Word-Rush/`
  - 通常サイト版のメイン開発フォルダです。
  - アプリ名は `Word Rush`。
  - 静的HTML + CSS + ES module JavaScriptで構成しています。
  - 単語データは `data/` 以下のCSV、レベル設定は `js/levels.config.js` です。
  - Cloudflare Workers Assets へのデプロイ設定は `wrangler.jsonc` です。
- `appgallery-single-html/index.html`
  - MyShortcuts App Gallery 配布用の単体HTML版です。
  - 通常サイト版の作業では、ユーザーから明示依頼がない限り触りません。
- `docs/handoff.md`
  - 別チャットで開発を続けるための最新引き継ぎ書です。
- `docs/site-version-plan.md`
  - 通常サイト版へ移行する初期計画の記録です。

## 通常サイト版でよく使うコマンド

`Word-Rush` フォルダで実行します。

```powershell
npm run serve
node --check .\js\game.js
node --check .\js\main.js
npm run generate:audio
npm run generate:cache
```

ローカル確認URL:

`http://127.0.0.1:5173/`

## デプロイ先

`https://wordrush.myshortcuts.workers.dev/`

詳しい現在状況、注意点、未コミット変更は `docs/handoff.md` を確認してください。
