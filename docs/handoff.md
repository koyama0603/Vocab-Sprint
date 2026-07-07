# Word Rush 引き継ぎ書

最終更新: 2026-07-07

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
- 直近の本番デプロイ Version ID（wrangler出力で最後に記録済み）: `263b4aaa-db38-41be-ad7b-7f9eca3b72a0`
- 2026-07-08時点で、公開中の `cache-manifest.json` version はローカルと同じ `379504c97cdc8adb`。
- 最新アプリ変更コミットは `c186a1a Reuse word audio elements`。
- 最新コードは本番へ反映済み、GitHubにもpush済み（`main` ブランチ）。
- `appgallery-single-html/index.html` はこの一連の通常サイト作業では未変更。
- ユーザーの明示指示がある時だけCloudflareへデプロイする。通常の修正・確認だけで自発的にデプロイしない。

## 最近の主な実装

- 結果画面:
  - 出題済み単語をすべて表示。
  - `OK` / `Wrong` / `Miss` 表示。
  - 各単語の累積 `正：x回　誤：y回` を表示。
  - `detail`、`sample`、`sample-jpn` を表示。
  - リンクボタンは `英辞郎`、`YouGlish`、`Wiktionary` の順。
  - tooltip は独自実装で、英単語と訳語、詳細を大きな文字で表示。
- スタート画面 / 一時停止画面:
  - レベル、レーン、出題方向（英→日 / 日→英）、ゲームモード、サバイバルモードを選択可能。
  - HISTORYには学習済み、正答率、リセット、プレイ回数、ベストスコア、出題済の単語数、未正解数、累積正解数 / 累積出題数、誤答Best10を表示。
  - 誤答Best10と単語一覧には発音ボタンと詳細表示ボタンがある。
  - 初回起動時はゲーム説明画面を自動表示し、以降は自動表示しない。
- ゲームモード:
  - `rush`: ラッシュ。単語カードが上から落ちる現行基本モード。
  - `fade`: 集中。レーン中央に固定表示し、制限時間の30%で完全透明になる。
  - `fixed`: じっくり。レーン中央に固定表示し、単語カード単位の時間制限はない。ゲーム全体の制限時間は維持する。正解・連続正解による時間加算はしない。
  - `survival`: 追加チェック。1問でも誤答またはミスで即終了。
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
  - 単語音声のON/OFFと音量設定があり、デフォルトはON、現在音量の基準は50%。
  - 単語カード表示時に発音する。複数レーン開始時はキュー/タイマーで順番に発音する。
  - 電波不良などで単語音声の読み込みが遅い時はゲーム画面中央上にトーストを出し、読み込み復帰・失敗・ゲーム終了時に消す。
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
- 現在の大枠: A1は `accel: 1.8`、A2は `1.5`、B1は `1.2`、B2は `1.0`、C1は `0.8`、C2は `0.6`。
- 現在の大枠: A1は `bonus` をPartごとに `0` から `14`、A2は `15`、B1は `30`、B2は `50`、C1は `80`、C2は `100`。
- 簡単なレベルで時間が増え続ける状態を抑えつつ、難しいレベルのスコア補正を強める目的。

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

2026-07-07時点で `Word-Rush` に未コミット変更なし。通常サイトのソース・本番・GitHub（`main`）は一致している。

この引き継ぎ書 `docs/handoff.md` はチャット移行用に更新したため、未コミット変更として残っている場合がある。

現在の未追跡ファイル:

- `edgetts.md`（リポジトリルートの未追跡ファイル。通常サイトの動作には未関係。ユーザー由来として扱い、勝手に削除・コミットしない）

直近の変更内容（コミット済み・デプロイ済み・push済み）:

- パフォーマンス改善（`e8be19a`）:
  - 単語カードの消えるエフェクト中に、カード文字のCanvasテキストレイアウトを毎フレーム再計算しないよう修正。文言と基準カード幅ごとにキャッシュし、フェード時はフォントサイズだけスケールする。
  - 誤答/ミス時の正解表示エフェクトも、テキストレイアウトをeffect単位でキャッシュする。
  - 消えかけのカード、パーティクル、shockwave、正解表示、スコア表示エフェクトの `shadowBlur` を透明度に応じて下げ、低透明度フレームの描画負荷を軽減。
  - 単語音声の `trackWordAudio` に cleanup hook を追加し、watchdogでAudio要素を解放する時にも読み込み監視とトースト状態を後片付けする。
  - `finishGame()` で描画ループ停止、spawn timer、ツールチップ長押し、回答ボタンfocus、音設定パネル、カウントダウン状態、エフェクト配列を明示クリア。
  - `fixed`（じっくり）モードでは正解・連続正解の時間加算を行わない。`+0s` 表示も出さない。
  - Score / Best の桁数が増えた時、さらに小さいフォントまで縮小してHUDに収める。
  - `levels.config.js` の速度/ボーナス調整を含む。
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
- 音源: `assets/audio/Music-2.mp3` を差し替え済み。`npm run generate:audio` と `npm run generate:cache` を実行し、本番へデプロイ済み。

## 次チャットで最初に確認すること

1. `git status --short`
2. `Word-Rush\cache-manifest.json` の version
3. 公開中の `https://wordrush.myshortcuts.workers.dev/cache-manifest.json` の version
4. 最新変更を本番へ反映するかどうか（ただし、ユーザーが明示した時だけデプロイ）
5. ユーザーがデプロイ希望なら、`dist` を作り直して `wrangler deploy`

## 注意点

- `appgallery-single-html/index.html` は触らない。
- Cloudflareへのデプロイはユーザーが明示した時だけ実施する。
- Service Workerに通常のキャッシュ処理を戻さない。
- `levels.config.js` の `id` を変更すると保存済みプレイ回数、ハイスコア、単語別学習記録との対応が崩れる。
- CSVの `id` を変更すると単語別学習記録がリセット扱いになる。
- UI変更後はスマホ幅、特に 360px 前後で結果画面と訳語選択肢を確認する。

## パフォーマンス劣化で気を付けるべき点（開発時の必読）

スマホ（特にiPhone）で「プレイを続けると遅くなる・熱くなる」原因になった実績のあるパターン。機能追加時は以下を守ること。

### 毎フレーム実行される場所（gameLoop → updateGame / drawBoard / updateHud）

- `getComputedStyle` / `cssVar()` をフレーム内で呼ばない。テーマ色は `refreshThemeColors()` が `this.colors` にキャッシュ済み。色が必要なら `this.colors.*` を使う（テーマ切替時に自動更新される）。
- `measureText` を伴うテキストレイアウト（`layoutCanvasText` / `layoutCanvasSingleLine`）をフレームごとに呼ばない。カード文言のレイアウトは `lane.textLayout` にキャッシュし、`lane.textLayoutW/H/Lanes`（丸めた寸法）で無効化判定する。フェード中の拡大縮小は描画時の `textSize = layout.size * scale` にだけ反映し、再レイアウトしない。`lane.cleanPrompt` も一度だけ算出して保持し、`promptTextFor().replace()` を毎フレーム走らせない（`spawnLane` が毎回新しい lane オブジェクトを作るので word 変更時に自動で作り直される）。新しい canvas 文字描画を足す場合も同様にキャッシュすること。
- 色文字列の加工（`colorWithAlpha`）は `alpha >= 1` なら元文字列を返し、パース結果は `COLOR_PARSE_CACHE`、`色×alpha` の生成結果は `COLOR_ALPHA_CACHE`（alphaは1/64量子化）にメモ化している。フレーム内で新しい色文字列を作り続けない。
- Canvasグラデーションを毎フレーム `createLinearGradient`/`createRadialGradient` しない。レーン背景の縦グラデ(veil)は `this.veilGradient`（キー=高さ+finish色）で全レーン・全フレーム共有している（垂直グラデはx非依存なので1つで足りる）。新たにグラデを使うときもサイズ/テーマ単位でキャッシュすること。
- レーン背景のうねり帯（`drawLaneFlow`）は分割数 `LANE_FLOW_STEPS`（12）とリボン定義 `LANE_FLOW_RIBBONS`（3本、形状は定数化して毎フレームのオブジェクト生成を回避）で描く。ここを増やすと1フレームの頂点数・塗り面積が増えて発熱するので安易に増やさない。
- ループ内でレーンによらない値（`guideLineY`、`canvasSize()`、`activeLaneCount()`、`activeGameMode()` など）を毎レーン再計算しない。ループ手前で1回算出して使い回す。
- バックバッファ解像度は `deviceRatio()`（`CANVAS_MAX_DPR = 1.5` で頭打ち）で決める。iPhone(dpr=3)などでは全面塗り＋レーン背景の多層オーバードローがフィルレートを圧迫して発熱するため、2.0に戻さない。`resizeCanvas` と `canvasSize` は必ず `deviceRatio()` を使い、倍率をずらさない。
- 全単語の走査（学習統計など）は `computeStats()` のキャッシュを使う。直接ループを足さない。無効化は `invalidateStatsCache()`。
- `ctx.filter`（blurなど）は使用禁止。iOS SafariのCanvas filterは極端に重く、メモリリークの報告もある。うっすらしたブラーは視認できないコストの塊。
- `ctx.shadowBlur` はモバイルで高コスト。既存の使用量（カード・パーティクル）以上に増やさない。低透明度エフェクトでは `shadowBlur * alpha` のように弱める。
- 描画ループはプレイ中のみ回す設計（`startRenderLoop` / `stopRenderLoop`）。メニュー/一時停止/結果画面で動くアニメーションを追加しない。追加するなら状態遷移時の1回描画で表現する。

### 回答ボタンのDOM更新（renderAnswerButtons / updateLaneAnswerButtons）

- 出題差し替え・回答フラッシュのように「1レーンだけ」変わるときは、`updateLaneAnswerButtons(laneIndex)` で該当レーンの3ボタンだけを差分更新する（`answer` / `missLane` の通常終了、`scheduleSpawn` のコールバックで使用）。毎回 `innerHTML=""` して全ボタンを作り直さない（DOM破棄・再生成とリスナー再バインドのチャーンが積み上がる）。
- レーン数・モード・レベル・開始/終了など「構造」が変わるときだけ `renderAnswerButtons()`（フル再構築）を使う。フル再構築は `this.laneButtonRefs`（レーン別のボタン/word参照）を毎回作り直す。
- ボタン1つ分の状態（disabled / correct・wrong フラッシュ / 訳語テキスト・サイズクラス）の適用ロジックは `applyAnswerButtonState()` に一本化してあり、フル再構築と差分更新の両方から呼ぶ。見た目がずれないよう、状態表現を足すときはここに集約する。
- `updateLaneAnswerButtons` は参照の不整合（レーン数不一致・`isConnected===false` 等）を検出したら自動で `refreshAnswerButtons()`（フル）へフォールバックする。新たな部分更新を足すときもこのガードを踏襲する。
- フォント自動縮小 `fitAnswerTextElements(elements?)` は引数で対象要素を絞れる。差分更新では文言が変わった word だけを渡し、全 `.word` に対する `getComputedStyle` ループを避ける。

### Web Audio（audio.js）

- `OscillatorNode` / `GainNode` / `BufferSource` は再生終了後に必ず `disconnect()` する（`onended` で切断）。接続したまま放置すると、SFXを鳴らすたびにオーディオグラフへノードが蓄積し、iOSで進行性の負荷増・発熱になる（今回の主要因の一つ）。
- `AudioBuffer` の生成（ノイズ等）は使い回す。`this.noiseBuffer` 参照。
- `AudioContext` はアプリ全体で1つ。増やさない。

### HTMLAudioElement（単語音声・BGM）

- iOSでは `<audio>` 要素1つごとにOSのデコーダ資源を掴む。同時生存数を増やさないこと。単語音声プールは `WORD_AUDIO_POOL_LIMIT`（24）で追い出し、`ended`/`error` が来ない停滞要素は `trackWordAudio` の watchdog（8秒）で強制解放する。この仕組みを迂回して `new Audio()` を直接使わない。
- **`new Audio()` を毎再生ごとに作らない（進行性の発熱・劣化の主因だった）。** 生成源は2つあり、両方とも再利用で潰してある:
  - (1) プール本体 `ensureWordAudio`: 満杯（`WORD_AUDIO_POOL_LIMIT`=24）になったら作り直さず、アイドル（再生中でなく paused）な要素を `takeReusableWordAudio()` で取り出し `createWordAudioEntry` で `src` を差し替えて再利用する。
  - (2) 同一語が再生中に再度必要なときの一時再生（旧: `new Audio()` のクローン）: `acquireTransientWordAudio()` が再利用リング `wordAudioTransientRing`（上限 `WORD_AUDIO_TRANSIENT_LIMIT`=4）から取り出して使い回し、再生終了時に `recycleTransientWordAudio()` でリングへ戻す。`trackWordAudio` と `playWordAudioQueueItem` の後片付けで transient を `releaseAudioElement` せず recycle する。
  - 結果、1ゲームあたりの Audio 生成は実質「プール24＋一時4＝約28」で頭打ちになり、**充填後は全モードで定常生成0/秒**（計測で確認: fade/fixed/rush いずれも 0/秒）。プール構造・watchdog・失敗クールダウンはそのまま。新しく単語音声の再生経路を足すときも、この2つの取得口（`ensureWordAudio` / `acquireTransientWordAudio`）以外で `new Audio()` しないこと。
- 「ゲームを続けると重くなる」の実測結論（2026-07時点）: JSヒープ・DOMノードは長時間プレイでも安定（リークなし）。犯人は**単語音声の Audio 要素を毎スポーン作り直していた create/destroy churn**（iOSのネイティブ音声資源を消耗）。**集中/じっくりで顕著だったのは、これらのモードは1ゲームが長引きやすく churn の総量が増えるため**（コード自体はモード非依存）。再現・計測は「単語音声ON」で行うこと（`wordAudioEnabled` を localStorage に false 保存したまま計測すると生成0になり誤診する）。
- 一時停止・ゲーム終了・タイトル復帰時は `releaseWordAudioPool()` で全解放する（プール要素と一時再生リングの両方。長時間ポーズ中に資源を掴み続けない）。必要になれば作り直すので機能影響はない。次ゲーム開始時にプールを再充填するため開始直後に約24個生成されるが、その後は再利用で0になる（一時的コストで churn ではない）。
- 先読み（`prefetchUpcomingWordAudio` → `preloadWordAudio`）も `ensureWordAudio` 経由なので、上記の再利用により Audio 生成は頭打ちに含まれる。プリフェッチを fetch ベースのキャッシュ温めに変える案は効果が薄く（生成の主因は再生側）、複雑さに見合わないため採用しない。

### タイマー・状態のライフサイクル

- ゲーム内の `setTimeout` は必ず管理下に置く。カード再出現は `scheduleSpawn()` を使い、`clearSpawnTimers()` が startGame / finishGame / returnToTitle / pauseGame で呼ばれる。生の `setTimeout` を answer/miss 系に書かない（一時停止やリスタートを跨いで発火し、レーン喪失・新ゲームのカード差し替え・音声の誤再生を起こした実績あり）。
- 一時停止からの再開時は `respawnStalledLanes()` が locked のまま止まったレーンを補充する。ポーズ中に消えるリソースを増やしたら、再開時の復旧もセットで実装する。
- ゲームごとにリセットすべき状態（effects / lanes / review / recent / feedback / countdownSecond / spawnTimers / 単語音声）は startGame と returnToTitle の両方で初期化されているか確認する。結果画面に必要な review / score は finishGame で残すが、effects / countdownSecond / spawnTimers / word audio / tooltip press / sound panel は finishGame で落とす。
- localStorage への保存は `scheduleWordStatsSave()`（debounce）を使い、pause/finish/visibilitychange で `flushWordStats()`。回答のたびに同期書き込みしない。

### 起動・ロード

- `init()` では単語音声の revision 取得（`ensureWordAudioRevision`）を await しない。revisionはキャッシュバスト用クエリにしか使わないので、初回レベル表示をブロックすると低速回線で起動が数秒遅れる。単語ロード（`loadWords`）を止めない。

### 動作確認のしかた

- 長めのプレイ（数ゲーム連続）→ 一時停止を挟む → 再開、の流れでフレームレートが落ちないこと。
- Safariの開発メニュー（実機接続）でメモリとオーディオノード数が増え続けないこと。
- 一時停止直後（カードのフェード中にポーズ）→ 再開で、全レーンにカードが戻ること。
- テーマ切替後（メニュー/プレイ中とも）、レーン背景の色が正しく更新されること（veilグラデのキャッシュキーにfinish色を含めているか）。
