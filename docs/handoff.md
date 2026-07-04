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
- 直近の本番デプロイ Version ID: `657eb1b6-7686-492a-a98f-1f281d0e1171`
- 結果画面、音設定、開始画面、HUD、単語音声、単語データ更新などの最新ローカル変更は本番へデプロイ済み。
- 最新ローカル `cache-manifest.json` version は `a67d75579798a51b`。

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
  - 音設定パネルで選択中のBGMを試聴可能。
  - BGMは同じ音量%でも少し小さめ、効果音は少し大きめに聞こえるように出力スケールを調整済み。
  - 単語音声は `assets\word-audio\en-us-edge-tts\<level>\<word-id>.mp3` に生成済み。
  - 生成音声は `edge-tts` の `en-US-JennyNeural`。
  - 現在は7000語分あり、各CSVの `id` をファイル名にしている。
- キャッシュ:
  - 過去にService Workerキャッシュで2回目起動時のサーバエラーが発生。
  - 現在の `sw.js` は退役用。古い `word-rush-assets-*` と `word-rush-meta` キャッシュを削除し、自身を unregister する。
  - `sw.js` に fetch handler を戻さないこと。
  - `main.js` は既存Service Workerがある場合だけ退役用 `sw.js` を登録する。
  - `_headers` で `/`、`/index.html`、`/sw.js`、`/cache-manifest.json` を `no-store` 系にしている。
  - `cache-manifest.json` では単語音声7000件を個別列挙せず、`assets\word-audio` を `assetGroups` の1グループとして件数・総バイト・短いrevisionだけ記録する。
  - 単語音声グループは通常のmanifest version計算から除外しているため、音声だけの軽微な変更ではアプリ本体のversionが変わりにくい。

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
- `scripts\generate-cache-manifest.mjs` は `assets\word-audio` を個別assetではなく `assetGroups` として要約する。
- 直近のUI調整: ボタンデザイン、ロード中の中央エフェクト、結果リストでWrong/Missを上に表示、レーン背景の微ぼかし、残り3秒以下の中央カウントダウン、BGMフェードアウト延長、タイトルパネルのデザイン調整、BGM試聴。
- 直近のUI調整: 音設定パネルがレーン裏に隠れないよう重なり順を修正。開始画面はタイトル、レベル/レーン選択、統計カード/グラフ、Start、キャッシュ注意文の順に整理。結果画面は右上閉じるボタン、出題一覧だけスクロール、Restart下固定に変更。HUD数値に控えめな発光を追加。
- 直近のUI調整: プレイ中は音設定ボタンを無効化し、一時停止中は有効。開始画面では戻るボタンを無効化。開始画面の余白、Accuracy表記、レーン選択のダーク表示、結果画面Closeボタン周辺の余白、HUDラベルの発光を調整。
- 直近のUI調整: 回答後、正解の緑色選択肢だけ文字色を黒のまま維持し、不正解選択肢は従来どおり灰色寄りに表示。
- 直近のデータ更新: `Word-Rush\data_rc` の修正版CSV 35件を `Word-Rush\data` に反映。全CSVは各200行、列は `id,english,japanese,detail,sample,sample-jpn`。重複IDなし、CSV上の全IDに対応する単語MP3あり。
- 直近のデプロイ準備: `Word-Rush\dist` を現在の静的ファイルから作り直し済み。`dist\data` はCSV 35件のみで、`README.md` と `manifest.json` は含めていない。
- 直近のデプロイ: `Word-Rush\dist\data\a1-part1.csv` のみ差し替え後、Wranglerで差分デプロイ済み。本番CSVはローカル `dist` とSHA-256一致。
- 直近のUI調整: 結果画面の辞書リンク表示をスマホ向けに `英辞`、`YouG`、`Wikt` へ短縮。lookup iframe モーダルをタイトルパネルより前面にし、スマホ時は上部ボタンが隠れない位置へ調整。lookup表示中は音設定、テーマ切替、戻るボタンを無効化。
- 直近のUI調整: lookup iframe 右上の別タブボタンを `Open in new tab`、閉じるボタンを `Close` 表記に変更。
- 直近のデプロイ: lookup iframe UI調整を `dist` へ反映し、Wranglerで差分デプロイ済み。アップロード対象は `/cache-manifest.json`、`/js/game.js`、`/index.html`、`/css/styles.css` の4件。

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
