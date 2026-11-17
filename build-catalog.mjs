import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SIMULATIONS_DIR = path.join(ROOT, 'Simulations');
const OUTPUT = path.join(ROOT, 'catalog.json');

const CATEGORY_NAMES = {
  astonomia: 'Астрономия',
  astronomia: 'Астрономия',
  astronomy: 'Астрономия',
  himia: 'Химия',
  chemistry: 'Химия',
  physics: 'Физика',
  информатика: 'Информатика',
  informatika: 'Информатика',
  informatics: 'Информатика',
  'computer science': 'Информатика',
  computer_science: 'Информатика',
  биология: 'Биология',
  biologia: 'Биология',
  biology: 'Биология',
  география: 'География',
  geografia: 'География',
  geography: 'География'
};
const CATEGORY_ICONS = {
  astonomia: '🪐', astronomia: '🪐', astronomy: '🪐',
  himia: '⚗️', chemistry: '⚗️', physics: '⚛️',
  информатика: '💻', informatika: '💻', informatics: '💻', 'computer science': '💻', computer_science: '💻',
  биология: '🧬', biologia: '🧬', biology: '🧬',
  география: '🌍', geografia: '🌍', geography: '🌍'
};
const KNOWN_TITLES = {
  solar_system: 'Солнечная система',
  atomnaya_laboratoriya: 'Атомная лаборатория',
  elektricheskaya_laboratoriya: 'Электрическая лаборатория',
  opticheskaya_laboratoriya: 'Оптическая лаборатория'
};
const KNOWN_FIELDS = new Set(['название', 'описание', 'теги', 'уровень', 'время', 'длительность']);

function safeUrl(relativePath) {
  return relativePath.split(path.sep).map(encodeURIComponent).join('/');
}

function parseMetadata(text, fallbackTitle) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const first = lines.findIndex(line => line.trim());
  if (first < 0) return { title: fallbackTitle, description: '' };

  const hasLabels = lines.some(line => {
    const match = line.match(/^\s*([^:=]+)\s*[:=]/);
    return match && KNOWN_FIELDS.has(match[1].trim().toLocaleLowerCase('ru'));
  });

  if (!hasLabels) {
    const title = lines[first].trim();
    const description = lines.slice(first + 1).join('\n').trim();
    return { title: title || fallbackTitle, description };
  }

  const fields = {};
  let current = '';
  for (const line of lines) {
    const match = line.match(/^\s*([^:=]+)\s*[:=]\s*(.*)$/);
    if (match && KNOWN_FIELDS.has(match[1].trim().toLocaleLowerCase('ru'))) {
      current = match[1].trim().toLocaleLowerCase('ru');
      fields[current] = match[2].trim();
    } else if (current && line.trim()) {
      fields[current] = `${fields[current] || ''}\n${line.trim()}`.trim();
    }
  }
  return {
    title: fields['название'] || fallbackTitle,
    description: fields['описание'] || '',
    tags: (fields['теги'] || '').split(',').map(value => value.trim()).filter(Boolean),
    level: fields['уровень'] || '',
    duration: fields['время'] || fields['длительность'] || ''
  };
}

async function isFile(filePath) {
  try { return (await fs.stat(filePath)).isFile(); }
  catch { return false; }
}

async function main() {
  const simulationsStat = await fs.stat(SIMULATIONS_DIR).catch(() => null);
  if (!simulationsStat?.isDirectory()) {
    throw new Error('Не найдена папка Simulations рядом с build-catalog.mjs.');
  }

  const categoryFolders = (await fs.readdir(SIMULATIONS_DIR, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const categories = [];
  for (const folder of categoryFolders) {
    const folderPath = path.join(SIMULATIONS_DIR, folder.name);
    const files = (await fs.readdir(folderPath, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html') && entry.name.toLowerCase() !== 'index.html')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    const items = [];
    for (const entry of files) {
      const htmlName = entry.name;
      const baseName = htmlName.slice(0, -5);
      const txtPath = path.join(folderPath, `${baseName}.txt`);
      const pngPath = path.join(folderPath, `${baseName}.png`);
      const fallbackTitle = KNOWN_TITLES[baseName.toLocaleLowerCase('ru')] || baseName.replace(/[_-]+/g, ' ').replace(/^./, ch => ch.toLocaleUpperCase('ru'));
      let metadata = { title: fallbackTitle, description: `Добавь описание в файл ${baseName}.txt рядом с этой симуляцией.` };

      if (await isFile(txtPath)) {
        const contents = await fs.readFile(txtPath, 'utf8');
        const parsed = parseMetadata(contents, fallbackTitle);
        metadata = {
          ...metadata,
          ...parsed,
          description: parsed.description || metadata.description
        };
      }

      const relativeHtml = path.relative(ROOT, path.join(folderPath, htmlName));
      const relativePng = path.relative(ROOT, pngPath);
      const key = folder.name.toLocaleLowerCase('ru');
      const item = {
        title: metadata.title,
        description: metadata.description,
        url: safeUrl(relativeHtml)
      };
      if (await isFile(pngPath)) item.image = safeUrl(relativePng);
      if (metadata.tags?.length) item.tags = metadata.tags;
      if (metadata.level) item.level = metadata.level;
      if (metadata.duration) item.duration = metadata.duration;
      items.push(item);
    }

    if (items.length) {
      const key = folder.name.toLocaleLowerCase('ru');
      categories.push({
        name: CATEGORY_NAMES[key] || folder.name,
        folder: folder.name,
        icon: CATEGORY_ICONS[key] || '🔬',
        items
      });
    }
  }

  const catalog = { generatedAt: new Date().toISOString(), categories };
  await fs.writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const count = categories.reduce((sum, category) => sum + category.items.length, 0);
  console.log(`Каталог обновлён: ${count} симуляций в ${categories.length} категориях → catalog.json`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
