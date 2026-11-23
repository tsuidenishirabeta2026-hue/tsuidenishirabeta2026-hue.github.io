# このリポジトリで作業するときのルール

## 言葉
- **ユーザーへの返答・説明・手順は、必ずすべて日本語で書く。** 英語で書かない（見出し・表・ボタン名の説明も含む）。
- 画面のボタン名などが英語のときだけ、その英語をかぎかっこで添える（例:「Run workflow」を押す）。
- コミットメッセージ・プルリクエストの説明も日本語で書く。

## サイト
- サイトのソースと運用手順は `_pllab/README.md`、利用条件は `_pllab/docs/DATA_RIGHTS.md`、SNS の方針は `_pllab/docs/SNS.md`（セ・リーグ版は `_pllab/docs/central/SNS.md`）。
- 同じ生成の仕組みから、リーグごとの設定で2つのサイトを作る（`PLLAB_SITE` で切り替え。リーグの情報は `_pllab/config/leagues/`）。
  - パ・リーグ成績ラボ: https://pacific-labo.com （Cloudflare Pages）。設定 `_pllab/config/site.json`、生成物 `pl-lab/`。URL と動きは変えない。
  - セ・リーグ成績ラボ: https://centrallabo.com （Cloudflare Pages の別プロジェクト）。設定 `_pllab/config/site-central.json`、生成物 `cl-lab/`、データ `_pllab/data/central/`。
  - ドメイン・Google アナリティクス・note・X はリーグごとに別。AdSense の運営者IDだけ共通。
- ルートの `index.html`・`privacy.html`・`terms.html` は別プロジェクト（kidsvid）のページなので変更しない。

## 下書き
- note 記事の下書き（有料部分を含む）は、非公開リポジトリ `pacific-labo-analytics` の `drafts/` に置く（セ・リーグ版は同じリポジトリの `drafts-central/`）。このリポジトリは公開なので、ここには置かない。
