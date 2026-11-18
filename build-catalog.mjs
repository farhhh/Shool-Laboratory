import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SIMULATIONS_DIR = path.join(ROOT, 'Simulations');
const OUTPUT = path.join(ROOT, 'catalog.json');
const INDEX = path.join(ROOT, 'index.html');

// Known subjects are pre-created so the navigation can show planned subjects
// (Informatics, Biology, Geography) even before their first simulation exists.
const CATEGORY_DEFINITIONS = [
  { id: 'astronomy', name: 'Астрономия', folder: 'Astonomia', icon: '🪐', aliases: ['astonomia', 'astronomia', 'astronomy'] },
  { id: 'chemistry', name: 'Химия', folder: 'Himia', icon: '⚗️', aliases: ['himia', 'chemistry'] },
  { id: 'physics', name: 'Физика', folder: 'Physics', icon: '⚛️', aliases: ['physics'] },
  { id: 'informatics', name: 'Информатика', folder: 'Informatics', icon: '💻', aliases: ['информатика', 'informatika', 'informatics', 'computer science', 'computer_science'] },
  { id: 'biology', name: 'Биология', folder: 'Biology', icon: '🧬', aliases: ['биология', 'biologia', 'biology'] },
  { id: 'geography', name: 'География', folder: 'Geography', icon: '🌍', aliases: ['география', 'geografia', 'geography'] }
];

const KNOWN_TITLES = {
  solar_system: 'Солнечная система',
  atomnaya_laboratoriya: 'Атомная лаборатория',
  elektricheskaya_laboratoriya: 'Электрическая лаборатория',
  opticheskaya_laboratoriya: 'Оптическая лаборатория'
};
const KNOWN_FIELDS = new Set(['название', 'описание', 'теги', 'уровень', 'время', 'длительность']);

const normalize = value => String(value).trim().toLocaleLowerCase('ru').replace(/[\s-]+/g, '_');
const ALIAS_TO_CATEGORY = new Map();
for (const definition of CATEGORY_DEFINITIONS) {
  for (const alias of definition.aliases) ALIAS_TO_CATEGORY.set(normalize(alias), definition);
  ALIAS_TO_CATEGORY.set(normalize(definition.folder), definition);
}

function safeUrl(relativePath) {
  return String(relativePath).replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
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
    return {
      title: lines[first].trim() || fallbackTitle,
      description: lines.slice(first + 1).join('\n').trim()
    };
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

  // Seed the known categories, including empty planned subjects.
  const categoryMap = new Map(CATEGORY_DEFINITIONS.map(definition => [definition.id, {
    id: definition.id,
    name: definition.name,
    folder: definition.folder,
    icon: definition.icon,
    items: []
  }]));
  const unknownCategories = new Map();

  for (const folder of categoryFolders) {
    const folderPath = path.join(SIMULATIONS_DIR, folder.name);
    const normalizedFolder = normalize(folder.name);
    const definition = ALIAS_TO_CATEGORY.get(normalizedFolder);
    let category;

    if (definition) {
      category = categoryMap.get(definition.id);
    } else {
      if (!unknownCategories.has(folder.name)) {
        unknownCategories.set(folder.name, {
          id: `custom:${folder.name}`,
          name: folder.name,
          folder: folder.name,
          icon: '🔬',
          items: []
        });
      }
      category = unknownCategories.get(folder.name);
    }

    const files = (await fs.readdir(folderPath, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html') && entry.name.toLowerCase() !== 'index.html')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    for (const entry of files) {
      const htmlName = entry.name;
      const baseName = htmlName.slice(0, -5);
      const txtPath = path.join(folderPath, `${baseName}.txt`);
      const pngPath = path.join(folderPath, `${baseName}.png`);
      const fallbackTitle = KNOWN_TITLES[baseName.toLocaleLowerCase('ru')] || baseName.replace(/[_-]+/g, ' ').replace(/^./, ch => ch.toLocaleUpperCase('ru'));
      let metadata = { title: fallbackTitle, description: `Добавь описание в файл ${baseName}.txt рядом с этой симуляцией.` };

      if (await isFile(txtPath)) {
        const parsed = parseMetadata(await fs.readFile(txtPath, 'utf8'), fallbackTitle);
        metadata = { ...metadata, ...parsed, description: parsed.description || metadata.description };
      }

      const relativeHtml = path.relative(ROOT, path.join(folderPath, htmlName));
      // Лёгкое превью .webp (если есть) грузится в разы быстрее исходного .png.
      const webpPath = path.join(folderPath, `${baseName}.webp`);
      const thumbPath = (await isFile(webpPath)) ? webpPath : pngPath;
      const relativePng = path.relative(ROOT, thumbPath);
      const item = {
        title: metadata.title,
        description: metadata.description,
        url: safeUrl(relativeHtml)
      };
      if (await isFile(thumbPath)) item.image = safeUrl(relativePng);
      if (metadata.tags?.length) item.tags = metadata.tags;
      if (metadata.level) item.level = metadata.level;
      if (metadata.duration) item.duration = metadata.duration;
      category.items.push(item);
    }
  }

  const categories = [
    ...CATEGORY_DEFINITIONS.map(definition => categoryMap.get(definition.id)),
    ...[...unknownCategories.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  ];

  const catalog = { generatedAt: new Date().toISOString(), categories };
  await fs.writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  // Встраиваем каталог прямо в index.html: страница больше не зависит от второго сетевого запроса.
  const indexHtml = await fs.readFile(INDEX, 'utf8');
  const json = JSON.stringify(catalog).replace(/</g, '\\u003c');
  const embedded = `<!--CATALOG:START--><script type="application/json" id="catalog-data">${json}</script><!--CATALOG:END-->`;
  const updated = indexHtml.replace(/<!--CATALOG:START-->[\s\S]*?<!--CATALOG:END-->/, () => embedded);
  if (updated === indexHtml && !indexHtml.includes(embedded)) throw new Error('В index.html не найден блок <!--CATALOG:START-->…<!--CATALOG:END-->.');
  await fs.writeFile(INDEX, updated, 'utf8');
  const count = categories.reduce((sum, category) => sum + category.items.length, 0);
  console.log(`Каталог обновлён: ${count} симуляций в ${categories.length} предметах → catalog.json`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
