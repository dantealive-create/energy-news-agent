const axios = require('axios');
const fs = require('fs');
const path = require('path');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';

const TOPICS = [
  { topic: '今日国际原油价格走势 WTI布伦特 OPEC+最新消息', display: '原油价格', score: 10 },
  { topic: '今日天然气LNG价格走势 供需变化', display: '天然气/LNG', score: 10 },
  { topic: '影响能源市场的地缘政治事件 中东 俄乌 制裁', display: '地缘政治', score: 9 },
  { topic: '石化炼厂检修 新装置投产 产能变化', display: '装置动态', score: 8 },
  { topic: 'crude oil natural gas market news today', display: 'International', score: 9 },
];

function generateId(source, title) {
  return `${source}_${Buffer.from(title||'').toString('base64').slice(0,12)}_${Date.now()}`;
}

async function fetchTopic(t, index) {
  const source = `topic_${index}`;
  try {
    console.log(`Fetching: ${t.display}...`);

    const response = await axios.post(KIMI_API_URL, {
      model: 'kimi-k2.5',
      messages: [
        {
          role: 'system',
          content: `你是专业能源市场分析师。请搜索并分析最新能源新闻。
只返回JSON数组，不要返回任何其他文字：
[{"title":"标题","summary":"摘要100-200字","url":"原文链接","publishTime":"发布时间","category":["price"],"importance":8}]
分类：geopolitics, price, supply, demand, policy, inventory, trading, analysis, new_plant, maintenance
重要性1-10。只返回JSON数组，不要用代码块包裹。`
        },
        {
          role: 'user',
          content: `搜索"${t.topic}"，列出5-8条最新最重要的新闻，返回JSON数组。`
        }
      ],
      max_tokens: 4096,
      temperature: 0.6,
      tools: [
        {
          type: 'builtin_function',
          function: { name: '$web_search' }
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    });

    const msg = response.data.choices[0].message;
    const finish = response.data.choices[0].finish_reason;
    console.log(`${t.display} finish_reason: ${finish}, has content: ${!!msg.content}, has tool_calls: ${!!msg.tool_calls}`);

    if (!msg.content) {
      console.log(`Response keys:`, Object.keys(msg));
      if (msg.tool_calls) console.log(`tool_calls:`, JSON.stringify(msg.tool_calls).slice(0, 500));
      return { source, items: [], success: false };
    }

    let newsItems;
    try {
      newsItems = JSON.parse(msg.content);
    } catch {
      const m = msg.content.match(/\[[\s\S]*\]/);
      if (m) newsItems = JSON.parse(m[0]);
      else {
        console.warn(`Parse fail:`, msg.content.slice(0, 300));
        return { source, items: [], success: false };
      }
    }
    if (!Array.isArray(newsItems)) newsItems = newsItems.news || newsItems.items || newsItems.data || [];

    for (const item of newsItems) {
      item.id = generateId(source, item.title);
      item.source = { name: source, displayName: t.display, authorityScore: t.score };
      item.authority = t.score;
      item.fetchTime = new Date().toISOString();
      if (!Array.isArray(item.category)) item.category = item.category ? [item.category] : ['analysis'];
    }

    console.log(`Got ${newsItems.length} items from ${t.display}`);
    return { source, items: newsItems, success: true };

  } catch (error) {
    const errData = error.response?.data;
    console.error(`Error ${t.display}:`, errData ? JSON.stringify(errData).slice(0, 500) : error.message);
    return { source, items: [], success: false };
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting with kimi-k2.5 + web_search...`);
  if (!KIMI_API_KEY) { console.error('No KIMI_API_KEY'); process.exit(1); }

  const results = [];
  for (let i = 0; i < TOPICS.length; i++) {
    results.push(await fetchTopic(TOPICS[i], i));
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`Success: ${results.filter(r=>r.success).length}/${results.length}`);

  let allNews = [];
  for (const r of results) if (r.success) allNews = allNews.concat(r.items);

  const seen = new Set();
  allNews = allNews.filter(item => {
    const k = (item.title||'').toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  allNews.sort((a,b) => ((b.importance||5)*(b.authority||5)) - ((a.importance||5)*(a.authority||5)));
  allNews = allNews.slice(0, 30);

  const stats = { total: allNews.length, byCategory: {}, bySource: {} };
  for (const item of allNews) {
    for (const c of (item.category||[])) stats.byCategory[c] = (stats.byCategory[c]||0)+1;
    const sn = item.source?.displayName||'';
    if (sn) stats.bySource[sn] = (stats.bySource[sn]||0)+1;
  }

  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, {recursive:true});
  const data = { date: new Date().toISOString().split('T')[0], items: allNews, summary: stats, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(data, null, 2));
  console.log(`Done. ${allNews.length} news saved.`);
}

main().catch(e => { console.error(e); process.exit(1); });
