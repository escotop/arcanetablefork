// Regenerates src/lib/hearthstoneCardBacks.json from the Hearthstone wiki (wiki.gg).
// Spanish names come from hearthgg.com when available. Run: node scripts/fetch-hearthstone-cardbacks.mjs
// hearthstone-cardbacks-hq.json maps some ids to sharper copies (~660-1030px wide vs ~400 on
// the wiki) from pinterest.com/hearthstoneart/hearthstone-card-backs, matched by image
// similarity against the wiki thumbnails and checked by eye.
import { readFile, writeFile } from 'node:fs/promises';

const WIKI_API = 'https://hearthstone.wiki.gg/api.php';
const HEARTHGG_API = 'https://hearthgg-api.qudtn0295.workers.dev/api/cardbacks';
const OUTPUT = new URL('../src/lib/hearthstoneCardBacks.json', import.meta.url);
const HEADERS = { 'User-Agent': 'arcanetable-cardbacks/1.0' };

async function getJson(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function cargo(table, fields) {
  const params = new URLSearchParams({
    action: 'cargoquery',
    tables: table,
    fields,
    limit: '500',
    format: 'json',
  });
  const data = await getJson(`${WIKI_API}?${params}`);
  return data.cargoquery.map(row => row.title);
}

/** Card backs whose image file exists on the wiki. */
async function existingImages(ids) {
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const params = new URLSearchParams({
      action: 'query',
      titles: ids.slice(i, i + 50).map(id => `File:CardBack${id}.png`).join('|'),
      prop: 'imageinfo',
      format: 'json',
    });
    const data = await getJson(`${WIKI_API}?${params}`);
    for (const page of Object.values(data.query.pages)) {
      if (!page.imageinfo) continue;
      existing.add(Number(page.title.match(/CardBack(\d+)\.png/)[1]));
    }
  }
  return existing;
}

async function spanishNames() {
  const names = new Map();
  try {
    for (let page = 1; ; page++) {
      const data = await getJson(`${HEARTHGG_API}?locale=es&page=${page}&pageSize=48`);
      for (const back of data.cardBacks ?? []) names.set(back.id, back.name);
      if (page >= (data.pageCount ?? 0)) break;
    }
  } catch (error) {
    console.warn('Spanish names unavailable:', error.message);
  }
  return names;
}

const backs = await cargo('CardBack', 'id,name,sortCategory');
const categories = new Map(
  (await cargo('CustomCardBackCategory', 'name,sortCategory')).map(row => [
    Number(row.sortCategory),
    row.name,
  ]),
);
const existing = await existingImages(backs.map(back => Number(back.id)));
const namesEs = await spanishNames();
const highQuality = JSON.parse(
  await readFile(new URL('./hearthstone-cardbacks-hq.json', import.meta.url), 'utf8'),
);

const result = backs
  .map(back => ({
    id: Number(back.id),
    name: back.name,
    nameEs: namesEs.get(Number(back.id)),
    sortCategory: Number(back.sortCategory),
  }))
  .filter(back => existing.has(back.id))
  // Category 0 is "Other": list it last.
  .sort((a, b) => (a.sortCategory || 99) - (b.sortCategory || 99) || a.id - b.id)
  .map(({ sortCategory, nameEs, ...back }) => ({
    ...back,
    ...(nameEs && nameEs !== back.name ? { nameEs } : {}),
    category: categories.get(sortCategory) ?? 'Other',
    ...(highQuality[back.id] ? { hqUrl: highQuality[back.id].url } : {}),
  }));

await writeFile(OUTPUT, `${JSON.stringify(result, null, 1)}\n`);
console.log(`Wrote ${result.length} card backs`);
