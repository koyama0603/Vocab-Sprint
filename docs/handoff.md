# Word Rush 引き継ぎ書

最終更新: 2026-07-05

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
- 直近の本番デプロイ Version ID: `f46d0fb7-fb9b-496f-8866-638d7d854ff1`
- PWA化（インストールボタン、`manifest.webmanifest`、縦向き固定/ガード、横向き時自動一時停止）、ピンチズーム・文字選択抑止、ビジュアル刷新（タイトルフォント、レーン背景アニメ、カード/パーティクル演出）、効果音刷新とカウントダウン音、BGM/SFXベース音量調整、HUDリッチデザイン、Result/Paused画面の表示整理、狭幅時の回答ボタン崩れ修正、safe-area対応、スコア行の固定高/自動縮小、プレイ中だけ描画ループを回す軽量化、iPhone PWAトップバー調整、BGMフェードアウト安定化、lookup iframe Closeボタン強調、結果リストの正誤回数/リンク間隔調整、結果ツールチップの長押し/固定表示対応などを含む最新ローカル変更は本番へデプロイ済み、GitHubにもpush済み（`main` ブランチ）。
- 最新ローカル `cache-manifest.json` version は `9a5ad1ec041eccd8`。

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
- `manifest.webmanifest`
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
- `manifest.webmanifest` が 200 で配信され、`"orientation": "portrait"` になっている。
- Chromium系でスタート画面左下に「アプリ化」ボタンが出る（PWA起動時は非表示）。

## 現在の作業ツリー

2026-07-05時点で未コミット変更なし。ソース・`dist`・本番・GitHub（`main`）はすべて一致している。

直近の変更内容（コミット済み・デプロイ済み・push済み）:

- PWA化: `manifest.webmanifest` 新規追加、スタート画面左下にインストールボタン（Chromium系のみ、PWA起動中は非表示）、`orientation: portrait` 指定、横向き時の縦向きガード表示、横向きになったらプレイ中を自動一時停止。
- モバイル操作性: ピンチイン/ピンチアウト抑止（viewport + touch-action + gesture系イベント）、画面全体の文字選択・長押しコールアウト抑止（テキスト入力欄は除く）。
- ビジュアル刷新: タイトルロゴのフォント/グラデーション装飾、落下レーン背景のうねるアニメーション（ダーク/ライト双方の配色に対応）、単語カードのデザイン刷新とフェードイン/フェードアウト、正解/誤答/ミス時のパーティクル・衝撃波エフェクト。
- 効果音刷新: `playNote` ベースの厚みのある音に全面差し替え、残り3・2・1秒のカウントダウン音を追加。
- 音量調整: BGMベース音量を下げ（旧15%相当を新50%に）、効果音ベース音量を上げ（旧80%相当を新50%に）、既定値も50%/50%に変更。
- HUD/スコアパネル: シックなカードデザインに刷新、Played表示位置を固定（残り秒数の桁変動で動かない）、Unlearned下に区切り線+「History」キャプション追加、Time Left横のレベル/レーン表記を削除。
- 結果画面(Result): Close左のScore/Best表示を削除、Closeボタンをゴールドで目立たせ、出題リストの単語横の `x回数` 表示を削除。
- 中断画面(Paused): 右上のScore表示を削除。
- 操作性の細部: 戻るボタンを「Retry」表記に変更（動作はタイトルに戻るまま）、結果画面表示中はRetryを無効化、無効ボタンにマウスを重ねても禁止カーソルにならないよう `cursor: default` に統一、選択肢のキーガイド(a s d...)のフォントサイズを拡大、日本語訳の選択肢はデフォルトで大きく表示しつつ長い訳語は自動縮小、出題リストのツールチップは「詳細解説」の後に改行して例文・日本語訳を表示（`例:` プレフィックス廃止）。
- 不具合修正: 幅520px以下・1レーンで回答ボタンの訳語がキー列に押し込まれクリップする不具合を修正（グリッド定義の詳細度衝突が原因）。幅が狭くHUDが下段に来るときにスコア系パネルの高さが揃うよう修正（HUDが右側にある広幅時は従来どおり）。
- 軽量化/安定化: CSS変数色と学習統計をキャッシュし、HUDは変化する数値だけ更新。描画ループはプレイ中のみ回し、メニュー/一時停止/結果画面では停止。iPhoneのノッチ/Dynamic Island/ホームインジケータを避けるsafe-area paddingを追加。スコア行は固定高にし、長い値はJSでフォントサイズを縮小して収める。
- iPhone PWA調整: standalone起動時は狭幅トップバーのRetryキャプションを隠して矢印のみ表示し、`Word Rush` タイトルが省略されないようにした。BGMのフェードアウトはWeb Audioのゲインスケジュールを使い、フェード完了時に音量を即復帰しないよう修正。結果画面から開くlookup iframeのCloseボタンを結果画面Closeと同じゴールド系デザインにした。
- iPhone PWA再調整: standalone起動時のトップバーをブラウザ表示のコンパクトサイズ（タイトル18px、アイコン34px、Retry表示あり）に揃えた。結果リストの累積正誤回数は小さめにし、`正：x回 誤：x回` の半角スペース表記に変更。リンクボタンは少し右側へ寄せ、正誤回数との間隔を広げた。
- 結果ツールチップ: 詳細、英語例文、日本語訳を別行表示に変更し、日本語訳は小さめフォントで括弧なし。スマホ/タッチ操作では長押し（約0.5秒）で表示し、移動するとキャンセル。スマホ表示時のみResult見出し直下付近に固定表示する。

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
