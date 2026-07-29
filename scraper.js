#!/usr/bin/env node
/*
 * Board Game Price Tracker - scraper (v2)
 * Updates data.json: international prices (5 countries) + India price + FX.
 * Never touches the game list, discounts, notes or status.
 * Run: node scraper.js     CI: .github/workflows/update-prices.yml
 */
const fs = require('fs');
const PATH = process.env.DATA_PATH || './data.json';
const LOCALE = { USA:'', UK:'/en-GB', Canada:'/en-CA', Australia:'/en-AU', NZ:'/en-NZ' };
const CURCODE = { USA:'USD', UK:'GBP', Canada:'CAD', Australia:'AUD', NZ:'NZD' };
const UA = { 'User-Agent':'Mozilla/5.0 (compatible; bgpt-scraper/2.0)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries){
  tries = tries || 2;
  for (let i=0;i<tries;i++){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 20000);
      const r = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return await r.text();
      if (r.status===404) return null;
    }catch(e){}
    await sleep(1500);
  }
  return null;
}

// ---- Board Game Oracle ----
// Primary: read the Next.js __NEXT_DATA__ JSON blob and find offer prices.
function nextData(html){
  const m = html && html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch(e){ return null; }
}
// Offers are BGO's trpc "items" (~10 levels deep): {price, currency, availability:'in_stock'|'out_of_stock', merchant}
function findOffers(root, cur){
  const out = [];
  (function walk(n){
    if (!n || typeof n!=='object') return;
    if (Array.isArray(n)){ n.forEach(walk); return; }
    if (typeof n.price==='number' && n.price>0 && ('availability' in n || 'merchant' in n)){
      // Only accept offers actually priced in this country's currency (BGO embeds US offers on every locale page).
      if (!cur || String(n.currency||'').toUpperCase()===cur){
        let price = n.price;
        if (price>3000 && Number.isInteger(price)) price = price/100; // cents guard
        const av = String(n.availability||'').toLowerCase();
        out.push({ price:price, inStock: av.indexOf('in_stock')>=0 && av.indexOf('out')<0 });
      }
    }
    Object.keys(n).forEach(function(k){ walk(n[k]); });
  })(root);
  return out;
}
// Precomputed lowest_price in price_stats, as a fallback.
function findLowest(root){
  let best=null;
  (function walk(n){
    if (!n || typeof n!=='object') return;
    if (typeof n.lowest_price==='number' && n.lowest_price>0){ if (best==null || n.lowest_price<best) best=n.lowest_price; }
    if (Array.isArray(n)) n.forEach(walk); else Object.keys(n).forEach(function(k){ walk(n[k]); });
  })(root);
  return best;
}
function parseBGO(html, cur){
  if (!html) return { price:null, stock:null };
  const nd = nextData(html);
  if (nd){
    const offers = findOffers(nd, cur);
    if (offers.length){
      const inS = offers.filter(function(o){return o.inStock;}).map(function(o){return o.price;});
      if (inS.length) return { price: Math.min.apply(null,inS), stock:'In stock' };
      return { price: Math.min.apply(null,offers.map(function(o){return o.price;})), stock:'Out of stock' };
    }
  }
  // Fallback: currency-prefixed numbers within the prices section (lenient)
  const a = html.search(/All prices in/i);
  const b = html.search(/affiliate/i);
  if (a>=0){
    const sec = html.slice(a, b>a?b:html.length);
    const re = /([$£€]|C\$|A\$|NZ\$)\s?([0-9][0-9,]*\.[0-9]{2})/g;
    let m, vals=[];
    while ((m = re.exec(sec))){ const v=parseFloat(m[2].replace(/,/g,'')); if (isFinite(v)&&v>3&&v<2000) vals.push(v); }
    if (vals.length) return { price: Math.min.apply(null,vals), stock:'' };
  }
  return { price:null, stock:null };
}
// The primary game carries type 'boardgame'|'boardgameexpansion' with a detail/price_stats block (its expansions don't).
function findGameType(root){
  let res=null;
  (function walk(n){
    if (res || !n || typeof n!=='object') return;
    if (!Array.isArray(n) && typeof n.type==='string' && (n.type==='boardgame'||n.type==='boardgameexpansion') && ('detail' in n || 'price_stats' in n)){
      res = n.type==='boardgameexpansion' ? 'Expansion' : 'Boardgame'; return;
    }
    if (Array.isArray(n)) n.forEach(walk); else Object.keys(n).forEach(function(k){ walk(n[k]); });
  })(root);
  return res;
}
// One locale page: currency-matched offers (in/out stock, mainly USA) + the site's own price_stats.lowest_price (already in that locale's currency).
function parseLocale(html, cur){
  if (!html) return { price:null, stock:null, stat:null, nd:null };
  const nd = nextData(html);
  if (!nd) return { price:null, stock:null, stat:null, nd:null };
  const offers = findOffers(nd, cur);
  let price=null, stock=null;
  if (offers.length){
    const inS = offers.filter(function(o){return o.inStock;}).map(function(o){return o.price;});
    if (inS.length){ price=Math.min.apply(null,inS); stock='In stock'; }
    else { price=Math.min.apply(null,offers.map(function(o){return o.price;})); stock='Out of stock'; }
  }
  return { price:price, stock:stock, stat:findLowest(nd), nd:nd };
}
async function scrapeBGO(bgoId, slug){
  const out = { prices:{}, stock:{}, type:null };
  const sl = slug || 'x';
  let usStat = null;
  for (const [country, locp] of Object.entries(LOCALE)){   // USA is first
    const html = await get('https://www.boardgameoracle.com'+locp+'/boardgame/price/'+bgoId+'/'+sl);
    const r = parseLocale(html, CURCODE[country]);
    if (country==='USA'){ if (r.nd) out.type = findGameType(r.nd); usStat = r.stat; }
    let price=null, stock=null;
    if (r.price!=null){ price=r.price; stock=r.stock; }                                         // real currency-matched offers (mainly USA)
    else if (r.stat!=null && (country==='USA' || r.stat!==usStat)){ price=r.stat; stock=''; }   // BGO's local lowest; skip when it just echoes the US number
    out.prices[country]=price; out.stock[country]=stock;
    await sleep(1000);
  }
  return out;
}
// Resolve a BGO id from a name - STRICT: only accept an exact slug match.
async function resolveBgoId(name){
  const html = await get('https://www.boardgameoracle.com/boardgame/search?q='+encodeURIComponent(name));
  if (!html) return null;
  const want = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const re = /\/boardgame\/price\/([A-Za-z0-9_-]{6,})\/([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(html))){ if (m[2]===want) return m[1]; }
  return null;
}

// ---- India (Board Games India + others) ----
function meta(html, prop){
  if (!html) return null;
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']'+prop+'["\'][^>]+content=["\']([^"\']+)["\']','i');
  const m = html.match(re); return m ? m[1] : null;
}
function firstNum(s){ if(!s) return null; const m=String(s).replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)/); return m?parseFloat(m[1]):null; }
async function scrapeIndia(url){
  const html = await get(url);
  if (!html) return null;
  let price = firstNum(meta(html,'product:sale_price:amount') || meta(html,'product:price:amount') || meta(html,'og:price:amount'));
  // og:title carries the current display price, e.g. "Blood Rage: Valhalla, ₹ 12,500.00, ..."
  if (price==null){ const t = meta(html,'og:title') || ''; const r = t.match(/₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)/); if (r) price = firstNum(r[1]); }
  if (price==null){ price = firstNum(meta(html,'product:original_price:amount')); }
  if (price==null){ const j = html.match(/"price"\s*:\s*"?([0-9][0-9.,]*)"?/); if (j) price = firstNum(j[1]); }
  if (price==null || !isFinite(price) || price<=0) return null;
  // Stock: BGI flags request-only items as og:availability "oos"; pre-orders still report "instock" but live in a pre-order breadcrumb category.
  const avail = (meta(html,'og:availability') || meta(html,'product:availability') || '').toLowerCase();
  const bc = (html.match(/BreadcrumbList[\s\S]{0,1500}/i) || [''])[0];
  const isOOS = /oos|out.?of.?stock|unavail|sold/.test(avail);
  const isPre = !isOOS && /pre-?order/i.test(bc);
  const stock = isOOS ? 'Out of stock' : (isPre ? 'Pre-order' : 'In stock');
  const orig = firstNum(meta(html,'product:original_price:amount'));
  const discounted = (orig!=null && price!=null && orig>price);   // the listed price is already below MRP
  return { price: price, source:'Board Games India', stock: stock, discounted: discounted };
}

// Shopify storefronts that expose a clean search-suggest JSON endpoint.
const INDIA_SHOPIFY = [
  { name:'Boardway', base:'https://boardway.in' },
  { name:'Board Games Bazaar', base:'https://boardgamesbazaar.com' },
  { name:'Tabletop Universe', base:'https://www.tabletopuniverse.com' }
];
function nrm(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
// Pick the product whose title best matches the game name; avoid expansions/extras.
function bestMatch(products, name){
  const t = nrm(name); const tw = t.split(' ').filter(Boolean); let best=null, bestScore=1;
  for (const p of products){
    const ti = nrm(p.title||''); if (!ti) continue;
    const tiw = ti.split(' ');
    let s;
    if (ti===t) s=100;
    else if (tw.length && tw.every(function(w){ return tiw.indexOf(w)>=0; })){   // every game-name word must appear as a whole word (kills "Ra" -> "railways")
      s = ti.indexOf(t)===0 ? 80 : (ti.indexOf(t)>=0 ? 70 : 55);
    } else continue;
    if (/expansion|promo|sleeve|upgrade|insert|organi[sz]er|playmat|neoprene|nesting|accessor|miniature/.test(ti) && !/expansion|promo|pack|kit|miniature/.test(t)) s-=60;
    s -= Math.max(0, ti.length - t.length)*0.3;
    if (s>bestScore){ bestScore=s; best=p; }
  }
  return best;
}
async function searchShopify(base, name){
  const html = await get(base+'/search/suggest.json?q='+encodeURIComponent(name)+'&resources[type]=product&resources[limit]=10');
  if (!html) return null;
  let j; try { j = JSON.parse(html); } catch(e){ return null; }
  const products = (((j.resources||{}).results||{}).products) || [];
  const p = bestMatch(products, name);
  if (!p) return null;
  const price = parseFloat(String(p.price).replace(/[^0-9.]/g,''));
  if (!isFinite(price) || price<=0) return null;
  const cmp = parseFloat(String(p.compare_at_price_min || p.compare_at_price || '').replace(/[^0-9.]/g,''));
  const discounted = isFinite(cmp) && cmp>price;
  const purl = p.url ? base+String(p.url).split('?')[0] : (p.handle ? base+'/products/'+p.handle : '');
  return { price:price, inStock: p.available===true, discounted: discounted, url: purl };
}
// Board Games India (OpenCart) name search -> best-matching product URL. Fuzzy, so results are UNCONFIRMED suggestions.
async function searchBGI(name){
  const html = await get('https://www.boardgamesindia.com/index.php?route=product/search&search='+encodeURIComponent(name));
  if (!html) return null;
  const re = /<div class="name">\s*<a\s+href="([^"?#]+)[^"]*"\s+title="([^"]*)"/gi;
  const products = []; let m;
  while ((m = re.exec(html))){ products.push({ url:m[1], title:(m[2]||'').replace(/&amp;/g,'&') }); }
  const p = bestMatch(products, name);
  return p ? p.url : null;
}
// Friendly site name from a URL host.
function siteName(url){ try{ const h=new URL(url).hostname.replace(/^www\./,''); if(/boardgamesindia/.test(h))return 'Board Games India'; if(/boardway/.test(h))return 'Boardway'; if(/boardgamesbazaar/.test(h))return 'Board Games Bazaar'; if(/tabletopuniverse/.test(h))return 'Tabletop Universe'; if(/gameistry/.test(h))return 'Gameistry'; if(/boredgamecompany/.test(h))return 'Bored Game Company'; return h; }catch(e){ return 'India'; } }
// Every India source for a game: {site,url,price,stock,discounted,verified}.
// User-supplied URLs (indiaUrl / indiaUrls) are CONFIRMED (verified:true). Fuzzy Shopify matches are UNCONFIRMED suggestions (verified:false) until the user approves them.
async function scrapeIndiaSources(g, prev){
  const prevVer = {}; (prev||[]).forEach(function(s){ if (s.url) prevVer[s.url]=!!s.verified; });
  const sources = []; const seen = {};
  const direct = []; if (g.indiaUrl) direct.push(g.indiaUrl); (g.indiaUrls||[]).forEach(function(u){ direct.push(u); });
  for (const url of direct){ if (!url || seen[url]) continue; seen[url]=1; const r = await scrapeAnyIndia(url); if (r) sources.push({ site:siteName(url), url:url, price:r.price, stock:r.stock||'', discounted:r.discounted, verified:true }); await sleep(400); }
  // Discover a Board Games India match by name (covers pre-orders / in-store items). Unconfirmed until the user approves it.
  const bgiUrl = await searchBGI(g.name);
  if (bgiUrl && !seen[bgiUrl]){ seen[bgiUrl]=1; const b = await scrapeIndia(bgiUrl); if (b) sources.push({ site:'Board Games India', url:bgiUrl, price:b.price, stock:b.stock||'', discounted:b.discounted, verified:(bgiUrl in prevVer)?prevVer[bgiUrl]:false }); }
  await sleep(400);
  for (const s of INDIA_SHOPIFY){
    const r = await searchShopify(s.base, g.name);
    if (r && r.url && !seen[r.url]){ seen[r.url]=1; sources.push({ site:s.name, url:r.url, price:r.price, stock:r.inStock?'In stock':'Out of stock', discounted:r.discounted, verified: (r.url in prevVer)?prevVer[r.url]:false }); }
    await sleep(400);
  }
  return sources;
}
// Fetch a single arbitrary India product URL (meta tags first, then the Shopify /products/handle.js JSON).
async function scrapeAnyIndia(url){
  const b = await scrapeIndia(url); if (b) return { price:b.price, stock:b.stock||'', discounted:b.discounted };
  const j = await get(url.split('?')[0].replace(/\/$/,'')+'.js');
  try { const p = JSON.parse(j); return { price:p.price/100, stock:p.available?'In stock':'Out of stock', discounted:(p.compare_at_price||0)>p.price }; } catch(e){}
  return null;
}
// The India price used in analysis: cheapest in-stock among CONFIRMED sources only (else cheapest confirmed).
// Unconfirmed fuzzy suggestions are never priced until the user approves them in the app.
function chooseIndia(sources){
  const v = (sources||[]).filter(function(s){ return s.verified; });
  if (!v.length) return null;
  const avail = v.filter(function(s){ return /in stock|pre-?order/i.test(s.stock); });   // in-stock and pre-order count as obtainable
  const pool = (avail.length ? avail : v).slice().sort(function(a,b){ return a.price-b.price; });
  const win = pool[0];
  const discount = (/board games india/i.test(win.site) && !win.discounted) ? 0.10 : 0;
  return { price: win.price, source: win.site, url: win.url||'', stock: win.stock||'', discount: discount, verified: true };   // keep the real stock label (In stock / Pre-order / Out of stock)
}

// ---- FX to INR ----
async function fetchFX(existing){
  const html = await get('https://api.frankfurter.app/latest?from=INR&to=USD,GBP,CAD,AUD,NZD');
  try{
    const j = JSON.parse(html); const r = j.rates; const inv = x => Math.round((1/x)*100)/100;
    const fx = { USD:inv(r.USD), GBP:inv(r.GBP), CAD:inv(r.CAD), AUD:inv(r.AUD), NZD:inv(r.NZD) };
    for (const k of Object.keys(fx)) if (!isFinite(fx[k]) || fx[k]<=0) return existing;
    return fx;
  }catch(e){ return existing; }
}

(async function main(){
  const data = JSON.parse(fs.readFileSync(PATH,'utf8'));
  data.meta.fx = await fetchFX(data.meta.fx);
  data.meta.updated = new Date().toISOString().slice(0,10);

  // Apply per-game overrides + deletions set in the app (state.json in the repo, if present)
  let ovMap = {}, removedSet = new Set(), stAdded = [];
  try { const st = JSON.parse(fs.readFileSync('./state.json','utf8')); ovMap = (st && st.overrides) || {}; (st.removed||[]).forEach(function(n){ removedSet.add(n); }); stAdded = st.added || []; console.log('Loaded state.json overrides.'); } catch(e){}
  if (removedSet.size){ data.games = data.games.filter(function(g){ return !removedSet.has(g.name); }); }
  // Games the user added in the app (state.json) so they get priced too.
  stAdded.forEach(function(a){ if (!a || !a.name || removedSet.has(a.name)) return; if (data.games.some(function(g){ return g.name===a.name; })) return; data.games.push({ name:a.name, type:a.type||'Boardgame', bgoId:a.bgoId||'', indiaUrls:a.indiaUrls||[], prices:{}, stock:{}, indiaSources:[] }); });

  let processed=0, intlPriced=0, indiaPriced=0, idsResolved=0, stillNoId=0;
  for (const g of data.games){
    const ovr = ovMap[g.name]; if (ovr && ovr.bgoId) g.bgoId = ovr.bgoId; if (ovr && ovr.indiaUrl) g.indiaUrl = ovr.indiaUrl;   // app-supplied ID / India URL win
    // Auto-resolve is OFF by default (slow + risky). Set RESOLVE_IDS=1 to enable.
    if (!g.bgoId && process.env.RESOLVE_IDS==='1'){ const id = await resolveBgoId(g.name); if (id){ g.bgoId=id; idsResolved++; await sleep(700); } }
    if (g.bgoId){
      const slug = (g.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const r = await scrapeBGO(g.bgoId, slug);
      const prevP = g.prices || {};
      const np = {}, ns = {};
      for (const c of Object.keys(LOCALE)){
        if (r.prices[c] != null){ np[c] = r.prices[c]; ns[c] = r.stock[c] || 'In stock'; }   // tier 1/2: in-stock, else out-of-stock offer (both come from parseBGO)
        else if (prevP[c] != null){ np[c] = prevP[c]; ns[c] = 'Out of stock'; }               // tier 3: no listing now -> keep last-known, flag out of stock
        else { np[c] = null; ns[c] = ''; }
      }
      g.prices = np; g.stock = ns;
      if (r.type) g.type = r.type;   // auto-detect Boardgame vs Expansion
      if (Object.values(np).some(function(v){return v!=null;})) intlPriced++;
    } else { stillNoId++; }
    {
      let sources = await scrapeIndiaSources(g, g.indiaSources);
      const iov = (ovr && ovr.india) || {};                                        // user's India edits from the app
      if (iov.remove){ sources = sources.filter(function(s){ return iov.remove.indexOf(s.url)<0; }); }
      if (iov.verify){ sources.forEach(function(s){ if (iov.verify.indexOf(s.url)>=0) s.verified=true; }); }
      if (iov.add){ for (const a of iov.add){ if (sources.some(function(s){return s.url===a.url;})) continue; const r=await scrapeAnyIndia(a.url); if (r) sources.push({ site:a.site||'Custom', url:a.url, price:r.price, stock:r.stock, discounted:r.discounted, verified:true }); } }
      g.indiaSources = sources;
      const chosen = chooseIndia(sources);
      if (chosen){ g.india = chosen; indiaPriced++; }
      else { delete g.india; }        // no CONFIRMED India source -> no India price (unconfirmed suggestions are never used)
    }
    processed++;
    if (processed % 10 === 0) console.log('  ...'+processed+'/'+data.games.length);
  }
  fs.writeFileSync(PATH, JSON.stringify(data, null, 1));
  console.log('Done. Processed '+processed+' games.');
  console.log('  International prices found : '+intlPriced);
  console.log('  India prices found        : '+indiaPriced);
  console.log('  BGO IDs auto-resolved      : '+idsResolved+' (strict slug match)');
  console.log('  Still missing a BGO ID     : '+stillNoId);
  if (intlPriced===0) console.log('  NOTE: 0 international - dumping one raw price page would let the parser be fixed exactly.');
})();
