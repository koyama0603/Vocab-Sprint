# HTML English Word App

英単語落下ゲーム「Word Fall」の作業フォルダです。

## 現在の構成

- `appgallery-single-html/index.html`
  - MyShortcuts App Gallery 配布用の単体HTML版です。
  - CSS、JavaScript、単語データ、BGM/効果音生成をすべて1ファイルに内包しています。
  - 外部ファイルを読み込まないため、単体HTMLとして配布できます。
- `docs/handoff.md`
  - 別チャットで通常サイト版の開発を続けるための引継ぎ書です。
- `docs/site-version-plan.md`
  - 通常サイト版で外だし単語データ、複数ページ化、学習機能を進めるための初期計画です。

## 次の作業方針

App Gallery 配布版は `appgallery-single-html/index.html` を安定版として扱います。
通常サイト版の開発では、この単体HTMLを参考にしつつ、単語データをCSVまたはJSONへ外だしする構成に移行します。
