const axios = require('axios');
const fs = require('fs');
const path = require('path');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';

const TOPICS = [
  { topic: '今日国际原油价格走势 WTI布伦特 OPEC', display: '原油价格', score: 10 },
  { topic: '今日天然气LNG价格走势 供需变化', display: '天然气/LNG', score: 10 },
  { topic: '能源市场地缘政治 中东局势 制裁', display: '地缘政治', score: 9 },
  { topic: '炼厂检修 新装置投产 石化产能', display: '装置动态', score: 8 },
  { topic: 'crude oil natural gas market news today', display: 'International', score: 9 },
];

function generateId(source, title) {
  return `${source}_${Buffer.from(title||'').toString('base64').slice(0,12)}_${Date.now()}`;
}

async function callKimi(messages) {
  const resp = await axios.post(KIMI_API_URL, {
    model: 'kimi-k2.5',
    messages,
    max_tokens: 8192,
    temperature: 1,
    tools: [{ type: 'builtin_function', function: { name: '$web_search' } }]
  }, {
    headers: { 'Authorization': `Bearer ${KIMI_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 180000
  });
  return resp.data.choices[0];
}

async function fetchTopic(t) {
  try {
    console.log(`Fetching: ${t.display}...`);

    const messages = [
      {
        role: 'system',
        content: `你是专业能源市场新闻分析师。请使用搜索工具查找最新新闻，然后返回JSON数组。
最终回复只返回JSON数组，不要其他文字：
[{"title":"标题","summary":"100-200字摘要","url":"原文链接","publishTime":"发布时间","category":["price"],"importance":8}]
分类：geopolitics, price, supply, demand, policy, inventory, trading, analysis, new_plant, maintenance
重要性1-10。只返回JSON数组，不要markdown代码块。`
      },
      {
        role: 'user',
        content: `搜索并列出5-8条关于"${t.topic}"的最新新闻，返回JSON数组。`
      }
    ];

    // 多轮处理：最多5轮tool_calls
    for (let round = 0; round < 5; round++) {
      const choice = await callKimi(messages);
      const msg = choice.message;

      // 如果有内容且结束，提取结果
      if (msg.content && choice.finish_reason === 'stop') {
        return parseResult(msg.content, t);
      }

      // 如果有tool_calls，处理并继续
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // 把assistant的回复加入messages
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls
        });

        // 对每个tool_call返回结果（builtin的搜索结果由Kimi内部处理）
        for (const tc of msg.tool_calls) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: tc.function.arguments || '{}'
          });
        }

        console.log(`  ${t.display} round ${round+1}: ${msg.tool_calls.length} tool calls`);
        continue;
      }

      // 有内容但不是stop
      if (msg.content) {
        return parseResult(msg.content, t);
      }

      break;
    }

    console.warn(`No result from ${t.display} after rounds`);
    return { source: t.display, items: [], success: false };

  } catch (error) {
    const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`Error ${t.display}:`, errMsg);
    return { source: t.display, items: [], success: false };
  }
}

function parseResult(content, t) {
  let newsItems;
  try {
    newsItems = JSON.parse(content);
  } catch {
    const m = content.match(/\[[\s\S]*\]/);
    if (m) {
      try { newsItems = JSON.parse(m[0]); } catch { }
    }
  }

  if (!newsItems) {
    console.warn(`Parse fail ${t.display}:`, content.slice(0, 200));
    return { source: t.display, items: [], success: false };
  }

  if (!Array.isArray(newsItems)) {
    newsItems = newsItems.news || newsItems.items || newsItems.data || [];
  }

  for (const item of newsItems) {
    item.id = generateId(t.display, item.title);
    item.source = { name: t.display, displayName: t.display, authorityScore: t.score };
    item.authority = t.score;
    item.fetchTime = new Date().toISOString();
    if (!Array.isArray(item.category)) item.category = item.category ? [item.category] : ['analysis'];
  }

  console.log(`Got ${newsItems.length} items from ${t.display}`);
  return { source: t.display, items: newsItems, success: true };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting with kimi-k2.5 + web_search (multi-turn)...`);
  if (!KIMI_API_KEY) { console.error('No KIMI_API_KEY'); process.exit(1); }

  const results = [];
  for (const t of TOPICS) {
    results.push(await fetchTopic(t));
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
