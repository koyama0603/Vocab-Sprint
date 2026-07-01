# Word Fall 引継ぎ書

## 作業フォルダ

`C:\Users\koyam\Documents\Codex\HTML-English-Word-App`

別チャットでは、まずこのファイルと `README.md` を読んでから作業を開始してください。

## 現行配布版

配布用ファイル:

`C:\Users\koyam\Documents\Codex\HTML-English-Word-App\appgallery-single-html\index.html`

これは MyShortcuts App Gallery 向けの単体HTML版です。外部CSV、外部JSON、画像、音声ファイルを使わず、1ファイルで動作します。

## 現行機能

- 1分間の英単語ゲーム
- 英単語カードが上から落下
- 各レーンに3択の訳語
- 1レーン、2レーン、3レーンを選択可能
- キーボード操作:
  - 1レーン目: `1`, `2`, `3`
  - 2レーン目: `4`, `5`, `6`
  - 3レーン目: `7`, `8`, `9`
- マウス、タップ操作対応
- 難易度:
  - 中学1年
  - 中学2年
  - 中学3年
  - 高校1年
  - 高校2年
  - 高校3年
  - 大学レベル
  - ビジネス英語
- 各レベル最大150語まで内蔵
- レーン数が少ない場合は単語カードと訳語の表示を大きくする
- 画面サイズ、特に高さに応じて落下時間を調整
- スマホ幅でもスクロールを極力出さないレスポンシブUI
- 正解、不正解、ミス、終了の効果音
- Web Audio APIによる軽快なBGM
- サウンドON/OFF
- リセット
- 一時停止
- ミス、不正解時に正解訳語をズーム表示
- ミス時は正解表示が消えてから次の単語を出す
- ゲーム終了後に間違えた単語の復習リストを表示
- ベストスコアは難易度とレーン数ごとにlocalStorage保存

## 最近の検証

2026-07-01 時点で確認済み:

- JavaScript構文チェックOK
- 360x640スマホ幅で1/2/3レーン切替OK
- スマホ幅で訳語ボタンの文字あふれなし
- 1レーン時は訳語ボタンがフル幅になり、文字が大きく表示される
- ミス後に約1秒ロックされ、正解表示後に次カードへ切替
- ブラウザコンソールエラーなし

## 注意点

- `appgallery-single-html/index.html` は配布用の安定版として扱ってください。
- 通常サイト版の開発では、配布版を直接壊さず、新しい `src` や `public` などの構成を作るのが安全です。
- BGMはWeb Audio APIで生成しています。ブラウザの自動再生制限により、ユーザーのStartクリック後に鳴る設計です。
- 自動テストでは音そのものは聴けないため、音量や音色の最終確認は実機で行ってください。
- CSV外だしは通常のHTTP/HTTPS配信または拡張機能内リソースとしてなら可能です。`file://` 直開きでは `fetch()` が制限される場合があります。

## 次チャットで最初にやるとよいこと

1. `docs/site-version-plan.md` を読む。
2. 通常サイト版の技術構成を決める。
3. 単語データ形式をCSVかJSONに決める。推奨はJSON。
4. `appgallery-single-html/index.html` からゲームロジック、描画、単語データ、UIを分離する。
5. 単語データをレベル別ファイルへ移す。

## 推奨する最初の通常サイト版構成

最小構成:

```text
index.html
src/
  main.js
  game.js
  words.js
  audio.js
  styles.css
data/
  junior1.json
  junior2.json
  junior3.json
  high1.json
  high2.json
  high3.json
  college.json
  business.json
```

より本格化するなら、Viteなどを使ってもよいですが、まずは静的HTML+JS+CSSで十分です。
