// データ取得元アダプタ。
//
// すべての取得元は次のインターフェースを実装する（取得元の交換はここだけで完結する）:
//
//   {
//     id: string,                      // 'csv-dir' など
//     label: string,                   // 画面・ログ表示用
//     isDemo: boolean,                 // デモデータなら true（全画面に「デモ」を表示）
//     async fetchSeason(season): Promise<Record<string, string>>
//       // ファイル名（schema.js の FILES[*].file）→ CSV テキスト
//       // 取得できなかった任意ファイルはキーを含めない
//   }
//
// 取得結果は validate.js で検証してから保存する。取得元が JSON や API を返す場合も、
// アダプタ内でこの CSV 形式（または同じ列構成）に変換すれば、以降の処理は共通になる。

import { csvDirSource } from './csv-dir.js';
import { csvUrlSource } from './csv-url.js';
import { wikipediaSource } from './wikipedia.js';
import { LEAGUE } from '../league.js';

export function createSource(config, env = process.env) {
  const id = env.PLLAB_SOURCE || config.source;
  switch (id) {
    case 'csv-dir':
      return csvDirSource({ dir: config.inputDir, label: 'CSV取り込み（リポジトリ内）', isDemo: false });
    case 'demo':
      return csvDirSource({ dir: config.demoDir, label: 'デモデータ（架空）', isDemo: true });
    case 'csv-url':
      return csvUrlSource({
        baseUrl: env.PLLAB_CSV_BASE_URL,
        token: env.PLLAB_CSV_TOKEN, // 任意。ログには出力しない
        cacheDir: config.cacheDir,
      });
    case 'wikipedia':
      return wikipediaSource({ userAgent: `${LEAGUE.updaterName}/1.0 (unofficial baseball fan site${env.PLLAB_UA_CONTACT ? `; ${env.PLLAB_UA_CONTACT}` : ''})` });
    default:
      throw new Error(`未知のデータ取得元です: ${id}（wikipedia / csv-dir / csv-url / demo）`);
  }
}
