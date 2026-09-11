import fs from "node:fs";
import path from "node:path";

/**
 * jsonStore
 * Armazenamento simples em arquivos .json (um por "coleção").
 * Sem dependências nativas — evita problemas de compilação (node-gyp/Python)
 * comuns com bibliotecas de banco nativas no Windows.
 *
 * Quando o projeto precisar de mais robustez (múltiplos usuários, muitos
 * anúncios, backups automáticos), troque este arquivo por uma conexão real
 * a Postgres/SQLite — as funções `readCollection`/`writeCollection` são o
 * único lugar que precisa mudar; os repositórios continuam iguais.
 */

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function readCollection(name) {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return [];
  }
}

export function writeCollection(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}
