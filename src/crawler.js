const axios = require('axios');
const fs = require('fs');
const path = require('path');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';

const TOPICS = [
  { topic: '今日国际原油市场最新动态，包括WTI和布伦特价格走势、OPEC+产量决策', source: 'oil_price', display: '原油价格', score: 10 },
  { topic: '今日天然气和LNG市场最新动态，包括价格走势和供需变化', source: 'lng_market', display: '天然气/LNG', score: 10 },
  { topic: '影响能源市场的最新地缘政治事件，包括中东局势、俄乌冲突、制裁政策', source: 'geopolitics', display: '地缘政治', score: 9 },
  { topic: '最新石化炼厂检修计划、新装置投产、产能变化', source: 'plant_news', display: '装置动态', score: 8 },
  { topic: 'latest international crude oil and natural gas market news, supply disruptions, inventory data', source: 'intl_energy', display: 'International', score: 9 },
];

function generateId(source, title) {
  const hash = Buffer.from(title || '').toString('base64').slice(0, 12);
  return `${source}_${hash}_${Date.now()}`;
}

async function fetchTopic(t) {
  try {
    console.log(`Fetching: ${t.display}...`);

    const response = await axios.post(KIMI_API_URL, {
      model: 'moonshot-v1-128k',
      messages: [
        {
          role: 'system',
          content: `你是专业能源市场分析师。请根据你的知识，给出当前能源市场的重要新闻和分析。
只返回JSON数组，不要返回任何其他文字，不要用markdown代码块包裹：
[{"title":"标题","summary":"摘要100-200字","url":"","publishTime":"","category":["price"],"importance":8}]
分类：geopolitics, price, supply, demand, policy, inventory, trading, analysis, new_plant, maintenance
重要性1-10分。只返回JSON数组。`
        },
        {
          role: 'user',
          content: `请列出5-8条关于"${t.topic}"的最新重要新闻或分析，返回JSON数组。`
        }
      ],
      max_tokens: 4096,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    const content = response.data.choices[0].message.content;
    if (!content) {
      console.warn(`No content from ${t.source}`);
      return { source: t.source, items: [], success: false };
    }

    let newsItems;
    try {
      newsItems = JSON.parse(content);
    } catch {
      const m = content.match(/\[[\s\S]*\]/);
      if (m) newsItems = JSON.parse(m[0]);
      else {
        console.warn(`Parse fail ${t.source}:`, content.slice(0, 300));
        return { source: t.source, items: [], success: false };
      }
    }

    if (!Array.isArray(newsItems)) {
      newsItems = newsItems.news || newsItems.items || newsItems.data || [];
    }

    for (const item of newsItems) {
      item.id = generateId(t.source, item.title);
      item.source = { name: t.source, displayName: t.display, authorityScore: t.score };
      item.authority = t.score;
      item.fetchTime = new Date().toISOString();
      if (!Array.isArray(item.category)) item.category = item.category ? [item.category] : ['analysis'];
    }

    console.log(`Got ${newsItems.length} items from ${t.display}`);
    return { source: t.source, items: newsItems, success: true };

  } catch (error) {
    const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`Error ${t.source}:`, errMsg);
    return { source: t.source, items: [], success: false };
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting...`);
  if (!KIMI_API_KEY) { console.error('No KIMI_API_KEY'); process.exit(1); }

  const results = [];
  for (const t of TOPICS) {
    results.push(await fetchTopic(t));
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`Success: ${results.filter(r=>r.success).length}/${results.length}`);

  let allNews = [];
  for (const r of results) if (r.success) allNews = allNews.concat(r.items);

  const seen = new Set();
  allNews = allNews.filter(item => {
    const k = (item.title||'').toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  allNews.sort((a, b) => ((b.importance||5)*(b.authority||5)) - ((a.importance||5)*(a.authority||5)));
  allNews = allNews.slice(0, 30);

  const stats = { total: allNews.length, byCategory: {}, bySource: {} };
  for (const item of allNews) {
    for (const c of (item.category||[])) stats.byCategory[c] = (stats.byCategory[c]||0) + 1;
    const sn = item.source?.displayName || ''; 
    if (sn) stats.bySource[sn] = (stats.bySource[sn]||0) + 1;
  }

  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const data = { date: new Date().toISOString().split('T')[0], items: allNews, summary: stats, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(data, null, 2));

  console.log(`Done. ${allNews.length} news saved.`);
}

main().catch(e => { console.error(e); process.exit(1); });
