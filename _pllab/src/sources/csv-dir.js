// ローカルディレクトリの CSV を読む取得元: <dir>/<season>/*.csv
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FILES } from '../schema.js';

export function csvDirSource({ dir, label, isDemo }) {
  return {
    id: isDemo ? 'demo' : 'csv-dir',
    label,
    isDemo,
    async listSeasons() {
      let names = [];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      return names.filter((n) => /^\d{4}$/.test(n)).map(Number).sort();
    },
    async fetchSeason(season) {
      const out = {};
      for (const def of Object.values(FILES)) {
        try {
          out[def.file] = await readFile(join(dir, String(season), def.file), 'utf8');
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      return out;
    },
  };
}
