// リーグごとの情報（球団・名前・Wikipedia の記事名など）: config/leagues/<id>.json
//
// 処理中のリーグ（LEAGUE）は、処理対象のサイト設定（PLLAB_SITE → config/site*.json の "league"）で決まる。
// 純粋な解析関数は league を引数でも受け取れるため、テストや将来の親サイト（セ・パまとめ）から両リーグを扱える。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadConfig } from './config.js';

const cache = new Map();

export function loadLeague(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id || '')) throw new Error(`リーグIDが不正です: ${id}`);
  if (!cache.has(id)) {
    const L = JSON.parse(readFileSync(resolve(ROOT, `config/leagues/${id}.json`), 'utf8'));
    L.teamIds = L.teams.map((t) => t.team_id);
    L.teamIdsText = L.teamIds.join('/');
    // 順位表・タイトル表・選手記事の球団セルとの完全一致に使う名前
    L.byName = new Map(L.teams.flatMap((t) => [t.name, t.short_name, ...(t.aliases || [])].map((n) => [n, t.team_id])));
    // 出来事の文章から球団を探す（部分一致）ときの名前（正式名・略称のみ）
    L.movesTeams = L.teams.map((t) => ({ id: t.team_id, names: [t.name, t.short_name] }));
    cache.set(id, L);
  }
  return cache.get(id);
}

export const LEAGUE = loadLeague(loadConfig().league);
