# 通常サイト版 開発計画

## 目的

MyShortcuts App Gallery 向けの単体HTML版とは別に、通常のWebサイトとして英単語学習アプリを拡張できる構成へ移行します。

## 単体HTML版から分離するもの

- 単語データ
- ゲーム状態管理
- Canvas描画
- UI更新
- Web Audio
- 復習リスト
- スコア保存
- 設定保存

## 単語データ形式

推奨はJSONです。CSVも可能ですが、訳語にカンマ、引用符、複数訳、注釈を入れる可能性があるため、JSONのほうが壊れにくいです。

JSON例:

```json
[
  { "english": "abandon", "japanese": "捨てる" },
  { "english": "accurate", "japanese": "正確な" },
  { "english": "consequence", "japanese": "結果" }
]
```

CSV例:

```csv
english,japanese
abandon,捨てる
accurate,正確な
consequence,結果
```

## レベル別ファイル名案

- `data/junior1.json`
- `data/junior2.json`
- `data/junior3.json`
- `data/high1.json`
- `data/high2.json`
- `data/high3.json`
- `data/college.json`
- `data/business.json`

ユーザー例に合わせるなら `SeniorInHighSchool.csv` のような英語名でもよいですが、コード内のレベルIDと一致する短い名前のほうが保守しやすいです。

## ロード設計

通常サイト版では、難易度選択後に対象ファイルを読み込み、単語リストが読み込めてからゲーム開始します。

```js
const wordFiles = {
  junior1: "data/junior1.json",
  junior2: "data/junior2.json",
  junior3: "data/junior3.json",
  high1: "data/high1.json",
  high2: "data/high2.json",
  high3: "data/high3.json",
  college: "data/college.json",
  business: "data/business.json"
};

async function loadWords(levelId) {
  const response = await fetch(wordFiles[levelId], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load words: ${levelId}`);
  }
  return response.json();
}
```

## 追加したい学習機能案

- 出題済み単語の履歴
- 苦手単語だけ練習
- レベル横断の復習モード
- 正答率ごとの単語フィルタ
- 単語帳ビュー
- 日本語から英語を選ぶ逆モード
- タイピングモード
- 日別学習ログ
- 連続学習日数
- localStorageまたはIndexedDBへの学習進捗保存

## 開発時の検証ポイント

- 360x640、390x844、768x1024、1280x720でレイアウト確認
- 1/2/3レーン切替
- レベル切替後のデータロード
- ネットワークエラー時の表示
- BGMがStart後に鳴ること
- スマホで訳語ボタンが押しやすいこと
- 長い英単語がカード内で切れないこと
- ミス後に正解表示が消えてから次カードが出ること
