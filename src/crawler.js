const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { NEWS_SOURCES } = require('./sources');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';

function generateId(source, title) {
  const hash = Buffer.from(title || '').toString('base64').slice(0, 12);
  return `${source}_${hash}_${Date.now()}`;
}

async function crawlSource(source) {
  try {
    console.log(`[${new Date().toISOString()}] Crawling ${source.name}...`);

    const response = await axios.post(KIMI_API_URL, {
      model: 'kimi-k2-0711',
      messages: [
        {
          role: 'system',
          content: `你是一个专业的能源市场新闻分析师。请访问给定的URL，提取最新的原油、天然气相关新闻。

返回纯JSON数组，不要包含任何其他文字：
[
  {
    "title": "新闻标题",
    "summary": "摘要（100-300字）",
    "url": "原文链接",
    "publishTime": "发布时间",
    "category": ["geopolitics"],
    "importance": 8
  }
]

分类选项：geopolitics, price, supply, demand, policy, inventory, trading, analysis, new_plant, maintenance

重要性：地缘政治冲突/价格剧烈波动/供应中断 8-10分，一般分析 5-7分。`
        },
        {
          role: 'user',
          content: `请访问 ${source.url}，提取5-10条最新的原油、天然气相关新闻，只返回JSON数组。`
        }
      ],
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    const content = response.data.choices[0].message.content;

    let newsItems;
    try {
      newsItems = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        newsItems = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          newsItems = JSON.parse(arrayMatch[0]);
        } else {
          console.warn(`Could not parse response from ${source.name}`);
          return { source: source.name, items: [], success: false, error: 'Parse error' };
        }
      }
    }

    if (!Array.isArray(newsItems)) {
      newsItems = newsItems.news || newsItems.items || newsItems.data || [];
    }

    for (const item of newsItems) {
      item.id = generateId(source.name, item.title);
      item.source = {
        name: source.name,
        displayName: source.displayName,
        authorityScore: source.authorityScore
      };
      item.authority = source.authorityScore;
      item.fetchTime = new Date().toISOString();
      if (!Array.isArray(item.category)) {
        item.category = item.category ? [item.category] : ['analysis'];
      }
    }

    console.log(`[${new Date().toISOString()}] Got ${newsItems.length} items from ${source.name}`);
    return { source: source.name, items: newsItems, success: true };

  } catch (error) {
    console.error(`Error crawling ${source.name}:`, error.message);
    return { source: source.name, items: [], success: false, error: error.message };
  }
}

async function crawlAllSources() {
  const results = [];
  const enabledSources = NEWS_SOURCES.filter(s => s.enabled);

  for (const source of enabledSources) {
    const result = await crawlSource(source);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return results;
}

function mergeAndSortNews(results) {
  let allNews = [];

  for (const result of results) {
    if (result.success && result.items) {
      allNews = allNews.concat(result.items);
    }
  }

  const seen = new Set();
  allNews = allNews.filter(item => {
    const key = (item.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  allNews.sort((a, b) => {
    const scoreA = (a.importance || 5) * (a.authority || 5);
    const scoreB = (b.importance || 5) * (b.authority || 5);
    return scoreB - scoreA;
  });

  return allNews.slice(0, 30);
}

function generateStats(newsItems) {
  const stats = { total: newsItems.length, byCategory: {}, bySource: {} };

  for (const item of newsItems) {
    if (item.category) {
      for (const cat of item.category) {
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      }
    }
    if (item.source) {
      const name = item.source.displayName || item.source.name;
      stats.bySource[name] = (stats.bySource[name] || 0) + 1;
    }
  }

  return stats;
}

function saveData(newsItems) {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const data = {
    date: new Date().toISOString().split('T')[0],
    items: newsItems,
    summary: generateStats(newsItems),
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(dataDir, 'news.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );

  return data;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting crawl...`);

  if (!KIMI_API_KEY) {
    console.error('ERROR: KIMI_API_KEY environment variable is not set');
    process.exit(1);
  }

  const results = await crawlAllSources();
  const successCount = results.filter(r => r.success).length;
  console.log(`Sources: ${successCount}/${results.length} succeeded`);

  const topNews = mergeAndSortNews(results);
  const data = saveData(topNews);

  console.log(`[${new Date().toISOString()}] Done. Saved ${topNews.length} news items.`);
  console.log('Stats:', JSON.stringify(data.summary, null, 2));

  return data;
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, crawlAllSources, mergeAndSortNews };
