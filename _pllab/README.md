# パ・リーグ成績ラボ（非公式）— ソースと運用手順

パ・リーグ6球団のチーム成績・選手成績・分析を表示する静的サイトです。
公開URL（GitHub Pages、main ブランチへ反映後）: `https://tsuidenishirabeta2026-hue.github.io/pl-lab/`

```
_pllab/            ← ソース（先頭が "_" なので GitHub Pages(Jekyll) では公開されない）
  config/site.json   設定（取得元・しきい値など）
  src/
    sources/         ① 取得（取得元アダプタ。差し替え可能）
    validate.js      ② 検証
    store.js         ③ 保存（原子的書き込み・ロック・ログ）
    update.js        ①〜③ をまとめた更新処理
    metrics.js       指標計算（純粋関数）
    model.js         集計・順位・比較母集団
    analysis.js      ルールベースの分析文
    render/, assets/ ④ 画面表示（HTML 生成）
    build.js         ④ をまとめたサイト生成
  data/
    input/<年>/      本番用 CSV（利用権限のあるデータを置く）
    input/_template/ CSV のひな形
    demo/<年>/       デモデータ（架空）
    store/           検証済みデータ（current.json）・更新状態（status.json）・スナップショット
    logs/            更新ログ（update-log.jsonl）
  docs/CSV_FORMAT.md CSV の項目定義と入力例
  test/              テスト
pl-lab/            ← 生成されたサイト（公開される。手で編集しない）
.github/workflows/pllab-update.yml  毎日 7:00 JST の自動更新
```

外部ライブラリは使っていません（Node.js 20 以上のみ）。

## ローカルでの起動

```bash
cd _pllab
node src/update.js      # 取得 → 検証 → 保存（config の source。初期値は demo）
node src/update-moves.js  # 移籍・契約（Wikipedia）。プロキシ環境では NODE_USE_ENV_PROXY=1 を付ける
node src/build.js       # ../pl-lab/ にサイトを生成
node scripts/serve.js   # http://localhost:8080/pl-lab/ で確認
node --test test/*.test.js   # テスト
```

デモデータを作り直す: `node scripts/generate-demo.js`
（シーズン途中の状態で確認したい場合: `node scripts/generate-demo.js --as-of 2026-07-20 --phase regular`）

## データ取得元について（調査結果）

| 取得元 | 閲覧 | 自動取得・再配布 | 料金 | 結論 |
|---|---|---|---|---|
| NPB公式サイト（npb.jp） | 可 | サイトのフッターに「掲載の情報、画像、映像等の二次利用および無断転載を固く禁じます」。公開APIなし | 無料 | 使用しない |
| パ・リーグ.com（pacificleague.com） | 可 | 利用規約 第10条で「本サービスを通じて入手したすべてのデータ…を複製、送信可能化、配信すること」を禁止。robots.txt で /api/ 等を disallow | 無料（動画は有料） | 使用しない |
| NPB の法人向けデータ提供・民間データ会社 | — | 契約により可能 | 有料（個別見積もり。公開価格は確認できず） | 必要なら運営者が問い合わせ |

公開閲覧できることと、自動取得・再配布できることは別のため、公式サイトからのスクレイピングは実装していません。
実データは **CSV 取り込み**で反映します（運営者が自分で入力したデータ、または利用許諾を得たデータ）。

## 実データへの切り替え

1. `data/input/<年>/` に CSV を置く（形式は `docs/CSV_FORMAT.md`、ひな形は `data/input/_template/`）。
2. `config/site.json` の `"source"` を `"demo"` から `"csv-dir"` に変更（または GitHub の Repository variables に `PLLAB_SOURCE=csv-dir`）。
3. `node src/update.js && node src/build.js` で確認し、コミット・プッシュ。

CSV を Web 上（自分のスプレッドシートの CSV 公開 URL、契約先の配布 URL など）から取得する場合は、
`PLLAB_SOURCE=csv-url` とし、`PLLAB_CSV_BASE_URL`（必要なら `PLLAB_CSV_TOKEN`）を GitHub の Secrets に設定します。
`<BASE_URL>/<年>/<ファイル名>.csv` を順番に取得し、ETag/Last-Modified によるキャッシュと最大3回の再試行を行います。

新しい取得元を追加する場合は `src/sources/` にアダプタを作り、`fetchSeason(season)` が
`{ 'meta.csv': '...', ... }`（CSV 形式のテキスト）を返すようにすれば、検証以降は共通です。

## 移籍・契約ページ（実データ）

`/pl-lab/moves.html` と、トップ・球団ページの「最近の動き」は実際の出来事を表示します。

- 取得元: Wikipedia 日本語版「<年>年の日本プロ野球」の「できごと」節（MediaWiki API、1日1回）。
  本文は CC BY-SA 4.0。ページに記事リンク（版番号つき）・ライセンス・改変の旨を表示しています。
- 処理: `node src/update-moves.js`（取得 → パ・リーグ球団を含む出来事の抽出・分類 → 検証 → `data/store/moves.json`）。
  成績の更新とは独立しており、失敗しても前回の内容を表示し続けます。
- 任意: Repository variables に `PLLAB_UA_CONTACT`（連絡先 URL かメールアドレス）を設定すると、Wikimedia の User-Agent 方針に沿った形でアクセスします。
- 手動追加: `data/input/moves.csv`（契約更改など Wikipedia に無い情報）

```csv
date,team_id,category,text,source_name,source_url
2026-12-05,H,契約更改,○○選手が契約を更改したと球団が発表。,球団公式サイト,https://...
```
  `team_id` は F/E/L/M/B/H（複数は `/` 区切り）、`category` は トレード / FA / ポスティング・海外 / 戦力外・退団 / 現役引退 / 獲得・入団・契約 / 契約更改 / 首脳陣 / ドラフト / 背番号 / その他。
  文章は自分の言葉で事実のみを書き、報道記事の文章を転載しないでください。

## 自動更新（GitHub Actions）

`.github/workflows/pllab-update.yml` が以下を行います。

- 毎日 UTC 22:00（日本時間 7:00）、手動実行、`data/input` の更新時に実行
- テスト → 取得・検証・保存 → サイト生成 → 変更があればコミット・プッシュ
- 同時実行は `concurrency` で直列化。さらにロックファイルで重複処理を防止
- 取得・検証に失敗した場合: 前回の正常データを維持してサイトを再生成（画面に「取得失敗」と表示）し、ジョブを失敗にして通知

**予約実行はこのワークフローが main ブランチにあるときだけ動きます。** ブランチを main にマージし、
リポジトリの Actions が有効になっていることを確認してください。初回は Actions タブから「Run workflow」で手動実行できます。
なお、GitHub の予約実行は混雑時に開始が遅れることがあり、60日間リポジトリに動きがないと自動で無効化されることがあります（毎日データ更新のコミットがある間は該当しません）。

## 障害時の確認方法

1. サイトの「データと分析の方法」ページ（`/pl-lab/about.html#update`）で最終取得成功日時・エラー・最近のログを確認
2. `pl-lab/data/status.json`（公開）または `_pllab/data/store/status.json` の `last_result` / `last_error` / `last_error_details`
3. `_pllab/data/logs/update-log.jsonl`（1行1回の実行記録）
4. GitHub の Actions タブで該当ジョブのログを確認（認証情報はログに出力しません）

よくある原因と対処:

| 表示されたエラー | 対処 |
|---|---|
| `○○.csv N行目: …` | 該当CSVの行を修正してプッシュ（push で自動再実行） |
| `基準日が前回より古くなっています` / `件数が大きく減少` | 取得元の不具合でなければ、訂正として Actions の手動実行で `allow_rollback` をオンにする（ローカルなら `node src/update.js --allow-rollback`） |
| `… の取得に失敗しました: HTTP 4xx/5xx` | 取得元 URL・トークン（Secrets）を確認。一時的なら翌日自動で回復 |
| `別の更新処理が実行中のためスキップ` | 正常（重複起動の防止）。30分以上残ったロックは自動削除 |

## シーズンの切り替え・訂正・移籍

- 新シーズン: `data/input/<新しい年>/` を追加すると自動で最新シーズンになります（開幕前は `phase=preseason` で成績CSVはヘッダーのみで可）。
- 訂正: CSV を修正すれば次回更新で上書きされます（同じ基準日のスナップショットは上書き保存）。
- 移籍・改名: 選手IDを変えずに、球団ごとの行・新しい登録名を入力します。
