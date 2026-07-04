# Word Rush 引き継ぎ書

最終更新: 2026-07-04

## 作業フォルダ

`C:\Users\koyam\Documents\Codex\HTML-English-Word-App`

通常サイト版の作業対象:

`C:\Users\koyam\Documents\Codex\HTML-English-Word-App\Word-Rush`

MyShortcuts App Gallery 配布用の単体HTML:

`C:\Users\koyam\Documents\Codex\HTML-English-Word-App\appgallery-single-html\index.html`

この単体HTML版は安定版として扱い、ユーザーから明示依頼がない限り触らないこと。

## 現在のアプリ

- 通常サイト版のタイトルは `Word Rush`。
- `Word-Rush` は静的HTML + CSS + ES module JavaScript構成。
- 単語データは `Word-Rush\data` 以下のCSV。
- レベル定義は `Word-Rush\js\levels.config.js`。
- ゲームバランスの基本設定は `Word-Rush\js\config.js`。
- 音源MP3は `Word-Rush\assets\audio`。
- 音源リスト `Word-Rush\js\audio-tracks.js` は `npm run generate:audio` で生成。
- キャッシュ manifest `Word-Rush\cache-manifest.json` は `npm run generate:cache` で生成。

## 重要な現状

- 本番URL: `https://wordrush.myshortcuts.workers.dev/`
- Cloudflare Workers Assets 設定: `Word-Rush\wrangler.jsonc`
- 直近の本番デプロイ Version ID: `ee7da341-a461-4bd7-a3f5-d9ae59afc0c6`
- その後、ローカルで結果画面フォント拡大、音設定の閉じるボタン、開始画面のレベル/レーン表示拡大、`levels.config.js` の `accel` 調整を実施済み。
- 上記の最新ローカル変更は、まだ本番へデプロイしていない。
- 最新ローカル `cache-manifest.json` version は `ff06b0a5ea9c8de2`。

## 最近の主な実装

- 結果画面:
  - 出題済み単語をすべて表示。
  - `OK` / `Wrong` / `Miss` 表示。
  - 各単語の累積 `正：x回　誤：y回` を表示。
  - `detail`、`sample`、`sample-jpn` を表示。
  - リンクボタンは `英辞郎`、`YouGlish`、`Wiktionary` の順。
  - tooltip は独自実装で、英単語と訳語、詳細を大きな文字で表示。
- 学習記録:
  - CSVの `id` を使って単語ごとの `correct`、`incorrect`、`seen`、`lastSeen` をlocalStorageに保存。
  - `incorrect` は Wrong と Miss の合計。
  - 学習数が少ない単語を優先する重み付きランダム出題。
- スコアパネル:
  - `Words`、`Learned`、`Unlearned` を表示。
  - スマホ幅では `level-meta` を非表示。
- キーボード:
  - 1レーン: `a`、`s`、`d`
  - 2レーン: `a`、`s`、`d` / `j`、`k`、`l`
  - 3レーン: `a`、`s`、`d` / `f`、`g`、`h` / `j`、`k`、`l`
- 音:
  - `assets\audio` のMP3をBGMとして選択可能。
  - 現在は `Music-1.mp3` から `Music-8.mp3`。
  - ランダム再生あり。
  - BGM/効果音のON/OFFと音量調整あり。
  - 単語音声は `assets\word-audio\en-us-edge-tts\<level>\<word-id>.mp3` に生成済み。
  - 生成音声は `edge-tts` の `en-US-JennyNeural`。
  - 現在は7000語分あり、各CSVの `id` をファイル名にしている。
- キャッシュ:
  - 過去にService Workerキャッシュで2回目起動時のサーバエラーが発生。
  - 現在の `sw.js` は退役用。古い `word-rush-assets-*` と `word-rush-meta` キャッシュを削除し、自身を unregister する。
  - `sw.js` に fetch handler を戻さないこと。
  - `main.js` は既存Service Workerがある場合だけ退役用 `sw.js` を登録する。
  - `_headers` で `/`、`/index.html`、`/sw.js`、`/cache-manifest.json` を `no-store` 系にしている。

## CSVデータ

現在のCSV列:

```csv
id,english,japanese,detail,sample,sample-jpn
```

注意:

- `id` は学習記録のキーなので、既存単語では安易に変更しない。
- CSVを書き換えたら `npm run generate:cache` を実行する。
- MP3を入れ替えたら `npm run generate:audio` と `npm run generate:cache` を実行する。

## レベル設定

`Word-Rush\js\levels.config.js` で管理。

- `order`: 表示順。
- `id`: レベルID。保存データのキーに関係するので変更注意。
- `label`: 表示名。
- `csvFile`: 参照CSV。
- `baseSpeed`: 基本速度。
- `accel`: 時間経過による速度上昇係数。
- `bonus`: レベルごとの速度補正。

直近の調整:

- 低いレベルほど `accel` を大きくした。
- `A1 Part1` は `1.5`。
- `C2 Part1` は `0.8`。
- 簡単なレベルで時間が増え続ける状態を抑える目的。

## よく使うコマンド

`Word-Rush` フォルダで実行する。

```powershell
npm run serve
```

ローカル確認URL:

`http://127.0.0.1:5173/`

構文チェック:

```powershell
node --check .\js\game.js
node --check .\js\main.js
node --check .\js\levels.config.js
```

生成:

```powershell
npm run generate:audio
npm run generate:cache
```

差分チェック:

```powershell
git diff --check
git diff -- .\appgallery-single-html\index.html
```

## デプロイ

デプロイ先:

`https://wordrush.myshortcuts.workers.dev/`

`Word-Rush\dist` を現在の静的ファイルから作り直してから deploy する。

含めるもの:

- `index.html`
- `sw.js`
- `cache-manifest.json`
- `_headers`
- `css`
- `js`
- `data`
- `assets`

除外:

- `dist\data\README.md` が入った場合は削除。

デプロイ:

```powershell
npx --yes wrangler@latest deploy
```

デプロイ後の最低確認:

- `https://wordrush.myshortcuts.workers.dev/` が 200。
- title が `Word Rush`。
- `cache-manifest.json` の version がローカル生成後の version。
- `js/audio-tracks.js` に現在のMP3が載っている。
- `sw.js` に `unregister` があり、fetch handler がない。

## 現在の作業ツリー

2026-07-04時点で未コミット変更あり。

主な未コミット内容:

- Cloudflare deploy 関連: `wrangler.jsonc`、`_headers`、`dist` 除外の `.gitignore`。
- Service Worker退役対応: `sw.js`、`js/main.js`。
- 音源入れ替え: 旧MP3削除、新 `Music-1.mp3` から `Music-8.mp3` 追加、`js/audio-tracks.js` 更新。
- 結果画面、学習記録、tooltip、HUD、レスポンシブ調整。
- 直近のUI調整: 結果画面フォント拡大、音設定の `×` ボタン、開始画面のレベル/レーン表示拡大、360px幅で上部 `Word Rush` が省略されないように調整。
- `levels.config.js` の `accel` 調整。
- `cache-manifest.json` 更新。
- `assets\word-audio\en-us-edge-tts` に7000語分の単語MP3を追加。
- `scripts\generate-cache-manifest.mjs` は `assets\word-audio` も含める。

## 次チャットで最初に確認すること

1. `git status --short`
2. `Word-Rush\cache-manifest.json` の version
3. 最新変更を本番へ反映するかどうか
4. ユーザーがデプロイ希望なら、`dist` を作り直して `wrangler deploy`

## 注意点

- `appgallery-single-html/index.html` は触らない。
- Service Workerに通常のキャッシュ処理を戻さない。
- `levels.config.js` の `id` を変更すると保存済みプレイ回数、ハイスコア、単語別学習記録との対応が崩れる。
- CSVの `id` を変更すると単語別学習記録がリセット扱いになる。
- UI変更後はスマホ幅、特に 360px 前後で結果画面と訳語選択肢を確認する。
