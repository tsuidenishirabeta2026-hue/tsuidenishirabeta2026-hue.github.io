# 成績ラボ（非公式）— ソースと運用手順

同じ生成の仕組みから、リーグごとの設定ファイルで2つのサイトを作っています。

| サイト | 公開URL | 設定 | 生成物 | 自動更新 |
|---|---|---|---|---|
| パ・リーグ成績ラボ | `https://pacific-labo.com/` | `config/site.json`（リーグ: `config/leagues/pacific.json`） | `pl-lab/` | `.github/workflows/pllab-update.yml` |
| セ・リーグ成績ラボ | `https://central-labo.com/` | `config/site-central.json`（リーグ: `config/leagues/central.json`） | `cl-lab/` | `.github/workflows/cl-update.yml` |

公開は Cloudflare Pages（サイトごとに別プロジェクト）。パ・リーグ版の旧URL `https://tsuidenishirabeta2026-hue.github.io/pl-lab/` からは自動で転送（セ・リーグ版の `…/cl-lab/` も同様）。
以下の説明は、特に断りがなければ両方に共通です（パ・リーグ版を例にしています）。

```
_pllab/            ← ソース（先頭が "_" なので GitHub Pages(Jekyll) では公開されない）
  config/
    site.json          パ・リーグ版の設定（取得元・しきい値・計測・広告など）
    site-central.json  セ・リーグ版の設定
    leagues/<id>.json  リーグごとの情報（6球団の名前・略称・色、Wikipedia の記事名、画面の文言）
  src/
    league.js        処理中のリーグ（PLLAB_SITE で選んだサイト設定の "league"）
    sources/         ① 取得（取得元アダプタ。差し替え可能）
    validate.js      ② 検証
    store.js         ③ 保存（原子的書き込み・ロック・ログ）
    update.js        ①〜③ をまとめた更新処理
    metrics.js       指標計算（純粋関数）
    model.js         集計・順位・比較母集団
    analysis.js      ルールベースの分析文
    render/, assets/ ④ 画面表示（HTML 生成）
    build.js         ④ をまとめたサイト生成
  data/              パ・リーグ版のデータ
    input/<年>/      本番用 CSV（利用権限のあるデータを置く）
    input/_template/ CSV のひな形
    demo/<年>/       デモデータ（架空。パ・リーグ版のみ）
    store/           検証済みデータ（current.json）・更新状態（status.json）・スナップショット
    logs/            更新ログ（update-log.jsonl）
    central/         セ・リーグ版のデータ（input/・store/・logs/ の構成は同じ）
  content/columns/          パ・リーグ版のコラム
  content/central/columns/  セ・リーグ版のコラム
  docs/CSV_FORMAT.md CSV の項目定義と入力例
  docs/central/      セ・リーグ版の SNS 方針・画像
  test/              テスト
pl-lab/            ← パ・リーグ版の生成物（公開される。手で編集しない）
cl-lab/            ← セ・リーグ版の生成物（同上）
.github/workflows/pllab-update.yml  パ・リーグ版 毎日 7:00 JST の自動更新
.github/workflows/cl-update.yml     セ・リーグ版 毎日 7:00 JST の自動更新
```

外部ライブラリは使っていません（Node.js 20 以上のみ）。

## リーグの切り替え（セ・リーグ版）と将来の親サイト

- どのサイトを処理するかは環境変数 `PLLAB_SITE` で選ぶ。未設定なら `pacific`（パ・リーグ版。これまでと同じ動き）、`central` ならセ・リーグ版。
  ```bash
  PLLAB_SITE=central node src/update.js
  PLLAB_SITE=central node src/update-player-stats.js
  PLLAB_SITE=central node src/update-moves.js
  PLLAB_SITE=central node src/build.js      # ../cl-lab/ に生成
  ```
- リーグに依存するもの（6球団の名前・略称・色・旧称、Wikipedia の順位表テンプレート名、個人タイトル表の列、画面の「パ・リーグ」「セ・リーグ」の文言、
  フッターの「関係ありません」の団体名、note のリンクに付ける `utm_source`、User-Agent の名前）は `config/leagues/<id>.json` にまとめている。コードには書かない。
- サイトごとに分けるもの（サイト名、ドメイン、GA4 の測定ID、note の URL、データ・コラム・生成物の置き場所）は `config/site*.json`。AdSense の運営者IDは両方とも同じ。
- 球団ID: パ・リーグ版 F/E/L/M/B/H、セ・リーグ版 G=巨人・T=阪神・DB=DeNA・C=広島・S=ヤクルト・D=中日（重ならないようにしてある）。
- セ・リーグ版の入力ファイル: `data/central/input/notes.csv`（note 記事）・`today.csv`（今日の数字）・`moves.csv`（任意）、コラムは `content/central/columns/*.md`（`teams` は G/T/DB/C/S/D）。
- 取得のときの解析関数（順位表・個人タイトル・選手記事・移籍の出来事）は、リーグを引数でも受け取れる。

### 将来の親サイト（セ・パまとめ）を作るとき
- 親サイトは、両方の保存データ（`data/store/current.json` と `data/central/store/current.json`）を読んで、両リーグの順位表・新着記事などを並べるページを作る想定。
  `config/site-<親サイトID>.json` を足し、`src/` に親サイト用の生成処理（`build-portal.js` など）を追加すれば、既存の2サイトの生成には影響しない。
- 両リーグのデータを1つの処理で読むときは、`loadLeague('pacific')`・`loadLeague('central')` と `loadConfig({}, 'central')` を使う（`PLLAB_SITE` に頼らない）。
- 公開の形（親サイトのドメインの下にセ・パを置くか、別ドメインのままリンクで結ぶか）は、作るときに決める。いまの2サイトの URL は変えない前提。

## 収益化の目標（2026年11月19日 設定）

無料の成績サイトとコラムで読者を集め、**広告（Google AdSense）** と **有料 note** で収益を得る。
数字は一般的な目安から置いた仮説で、実績が出たら見直す。

### 前提
- AdSense: 閲覧1,000回あたり約100〜300円（スポーツ系・スマートフォン中心の目安）
- 有料 note: 1本300円、手数料を引いて約250円が手元に残る
- note への誘導: サイト閲覧の1〜2%が note へのリンクを押し、そのうち数%が購入
- 費用: ドメイン代 年約1,700円（pacific-labo.com）。ホスティング・計測・データ取得は無料

### 段階ごとの目標

| 時期 | 閲覧数（月） | 広告 | note | 月の収益の目安 |
|---|---|---|---|---|
| ① オフシーズン（〜2027年2月） | 5,000〜1万回 | 500〜3,000円 | 月5〜10本 | 数千円（ドメイン代を回収） |
| ② 開幕〜シーズン中（2027年3〜9月） | 3〜5万回 | 3,000〜15,000円 | 月20〜30本 | 月1〜2万円 |
| ③ 1年後（2027年オフ） | 10万回 | 1〜3万円 | 月30本以上 | 月2〜4万円 |

最初の目標は ①「ドメイン代を回収し、有料 note が1本でも売れる」こと（お金を払って読みたい人がいるかの検証）。

### 長期目標: 月15万円（2028年シーズン頃）

| 収益源 | 必要な規模 | 月の収益の目安 |
|---|---|---|
| note の定期購読（月額500円のメンバーシップ・マガジン） | 読者200人 | 約8.5万円（手数料を引いた後） |
| 広告（AdSense） | 月30万回の閲覧 | 約4〜6万円 |
| 単発の有料 note | 月80本 | 約2万円 |

広告だけで15万円には月75万回ほどの閲覧が必要なため、毎月払ってくれる読者（定期購読）を最大の柱にする。

| 段階 | 目標 | 時期の目安 |
|---|---|---|
| ① 検証 | note が売れる、月の閲覧数5,000回 | 〜2027年2月 |
| ② 定着 | 月の閲覧数5万回、定期購読30人、月2〜3万円 | 2027年シーズン中 |
| ③ 拡大 | 月の閲覧数15万回、定期購読100人、月7〜8万円 | 2027年オフ〜2028年 |
| ④ 到達 | 月の閲覧数30万回、定期購読200人、月15万円 | 2028年シーズン頃 |

- 月の収益が5万円を超えたら、有料データ（月3万円〜）の契約を検討する（シーズン中の成績を出せるようにする）
- 定期購読は、単発の note が売れ始めてから始める（②の段階が目安）
- SNS の運用方針と投稿の下書きは `docs/SNS.md`

### やること
- コラムを週1本（オフの3か月で12本）。検索からの集客の柱
- FA・移籍・開幕前の予想など、検索が増える時期に合わせて書く
- 有料 note を月1〜2本。無料コラムの「続きを詳しく」という位置づけにする
- SNS（X など）でコラム・選手ページを紹介する
- Google Search Console にサイトマップ（`https://pacific-labo.com/sitemap.xml`）を登録する

### 見る数字（Google アナリティクス `G-WSNC046WSL`）
- 月の閲覧数（表示回数）
- よく見られている選手ページ（`/players/` を含むページ、イベント `player_view`）
- note へのクリック数（イベント `note_click`）と、note の販売数
- AdSense の閲覧1,000回あたりの収益（審査通過後）

### 弱点と方針
- シーズン中の最新成績（試合ごとの成績）は、規約上使える形で取得できないため出せない。
  Wikipedia の選手記事は主にシーズン後に更新される
- そのため速報では競わず、「前年比」「数字の読み解き」「移籍・契約の動き」を強みにする
- 収益が月数万円を超えたら、有料データ（NPB BIP など月3万円〜）を契約してシーズン中の成績を載せることを検討する

### 判断の目安
- 2027年2月（3か月後）に月の閲覧数が5,000回に届かなければ、記事の内容と集客方法を見直す
- 届いていれば、②に向けて同じ方針で続ける

## ローカルでの起動

```bash
cd _pllab
node src/update.js      # 取得 → 検証 → 保存（config の source。現在は wikipedia。プロキシ環境では NODE_USE_ENV_PROXY=1）
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
| NPB BIP（NPB の法人向けデータ提供） | — | 契約により可能 | 月3万円〜（研究・試用向け。商用は別契約） | 予算（月1,000円）超過のため不採用 |
| 海外の NPB 対応 API（Entitysport、Goalserve など） | — | 契約により可能 | 月250ドル前後 | 予算超過のため不採用 |
| **Wikipedia 日本語版** | 可 | **可**（CC BY-SA 4.0。出典・ライセンス表示、改変の明示が条件。API 利用可） | 無料 | **採用**（順位表・所属選手・個人タイトル・移籍などの動き） |

公開閲覧できることと、自動取得・再配布できることは別のため、公式サイトからのスクレイピングは実装していません。

**現在の取得元は Wikipedia（`"source": "wikipedia"`）**です。順位表（勝敗・引分・順位・優勝）、6球団の所属選手（背番号・守備位置・支配下/育成）、
個人タイトルを毎日 1 リクエストで取得します。全選手の個人成績（打率・防御率など）・得点/失点・試合日程は取得元に無いため、
画面では「掲載していません」と表示し、推測で埋めません（`meta.csv` の `stats_level=none`）。
所属選手は Wikipedia の各球団「選手・スタッフ」テンプレートの記載のため、公式発表からの反映に遅れがありえます。

個人成績を載せたい場合は、利用許諾を得たデータを **CSV 取り込み**（`csv-dir` / `csv-url`）で反映できます。
動作確認用の架空データは `"source": "demo"` で表示できます。

## 実データへの切り替え

1. `data/input/<年>/` に CSV を置く（形式は `docs/CSV_FORMAT.md`、ひな形は `data/input/_template/`）。
2. `config/site.json` の `"source"` を `"csv-dir"` に変更（または GitHub の Repository variables に `PLLAB_SOURCE=csv-dir`）。
3. `node src/update.js && node src/build.js` で確認し、コミット・プッシュ。

CSV を Web 上（自分のスプレッドシートの CSV 公開 URL、契約先の配布 URL など）から取得する場合は、
`PLLAB_SOURCE=csv-url` とし、`PLLAB_CSV_BASE_URL`（必要なら `PLLAB_CSV_TOKEN`）を GitHub の Secrets に設定します。
`<BASE_URL>/<年>/<ファイル名>.csv` を順番に取得し、ETag/Last-Modified によるキャッシュと最大3回の再試行を行います。

新しい取得元を追加する場合は `src/sources/` にアダプタを作り、`fetchSeason(season)` が
`{ 'meta.csv': '...', ... }`（CSV 形式のテキスト）を返すようにすれば、検証以降は共通です。

## 選手ページの前年比・平均との差・短評

- 取得: `node src/update-player-stats.js`（所属選手の Wikipedia 記事の「年度別打撃成績／年度別投手成績」表。初回は全件、以降は版番号が変わった記事だけ。50件/リクエスト）
- 保存: `data/store/player-stats.json`。検算（打席数・塁打・防御率）が合わない行は使わない
- 比較の決まり（`src/history.js`）: 前年比は両年とも100打席／30投球回以上で判定。リーグ平均は「現所属のパ・リーグ選手で、その年まで記事が更新されているもの」の合計。更新率70%未満の年は計算しない
- 記事用の数値の書き出し: `node scripts/article-data.js 選手名 …`

## note への導線と計測

- `data/input/notes.csv` に記事を登録（`status=published` の行だけ表示）。選手 → 球団 → 全体の順に関連記事を出す。リンクには `utm_source=pl-lab` などを付ける
- `config/site.json` の `note.profileUrl` を入れると、関連記事が無いページにもプロフィールへの導線を出す
- 計測: `config/site.json` の `analytics` に `"provider": "ga4", "id": "G-XXXXXXX"`（Google アナリティクス 4）を入れると、全ページのページビューと、
  `player_view`（選手ページの閲覧。player_id・player_name 付き）、`note_click`（note へのクリック。note_id・page_type・player_id 付き）を送信する。
  Umami を使う場合は `"provider": "umami", "id": "<Website ID>"`。設定が無ければ何も送信しない
- 記事の下書き: 非公開リポジトリ `pacific-labo-analytics` の `drafts/`（有料部分を含むため、このリポジトリには置かない）。利用条件: `docs/DATA_RIGHTS.md`

## トップの「今日の数字」と「新着の記事」

- `data/input/today.csv`（`date,player_id,label,from,to,comment`）に1日1行。今日（日本時間）以前で最も新しい行を、トップの「今日の数字」に出す。3日以上前の行しかなければ、最新の記事の選手から前年比で最も伸びた指標を自動で選ぶ
- 「新着の記事」は、コラムと公開済みの note 記事を日付順に3件（同じ題名ならコラムを優先）
- 計測: 「今日の数字」のクリックは `top_today_click`、「新着の記事」のクリックは `top_new_click` を送る

## コラム（独自記事）

- `content/columns/*.md` に1記事1ファイルで書く。先頭に `slug`（URL 用の半角英数字とハイフン）・`title`・`date`・`description`・`teams`（F/E/L/M/B/H を / 区切り）・`players`（選手ID を / 区切り）を書く
- `draft: true` にすると公開しない。公開すると `/columns/<slug>.html`、一覧、トップの新着、関係する選手ページに表示される
- 使える書式: 見出し（#）、段落、箇条書き（-）、表、**太字**、[リンク](URL)、区切り線（---）
- Wikipedia の文章・表は貼らず、数値（事実）を自分の表と言葉でまとめ、出典を明記する（`docs/DATA_RIGHTS.md`）

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

## 独自ドメイン・Cloudflare Pages・広告（AdSense）

- 公開先を Cloudflare Pages（無料・商用利用可）に移すと、独自ドメインのルートで公開でき、AdSense に必要な `ads.txt` を置ける
- Cloudflare Pages の設定: リポジトリを接続し、本番ブランチ `main`、ビルドコマンドなし、出力ディレクトリ `pl-lab`
  （サイトは GitHub Actions が生成してコミットするため、Cloudflare 側でのビルドは不要）
- セ・リーグ版は、同じリポジトリを接続した**別のプロジェクト**にし、出力ディレクトリを `cl-lab` にする（独自ドメインは central-labo.com）。
  両プロジェクトとも、すべてのコミットで再デプロイされる。無料プランのビルド回数（月500回）に余裕はあるが、気になる場合は各プロジェクトの
  「Build watch paths」でパ・リーグ版は `pl-lab/*`、セ・リーグ版は `cl-lab/*` だけを対象にする
- `config/site.json`
  - `siteUrl`: 例 `https://example.com`。入れると、全ページに正規URL（canonical）、`sitemap.xml`・`robots.txt` を出力し、
    旧URL（github.io/pl-lab/…）を開いた人を新しいURLへ転送する
  - `adsense.client`: `ca-pub-` で始まる運営者ID。`siteUrl` と両方そろったときだけ、自動広告のコードと `ads.txt` を出力し、
    プライバシーポリシーに広告の項を表示する（デモ表示中は出さない）

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
