"use strict";
var LS_STATE='bgpt_state', LS_TOKEN='bgpt_token';
var COUNTRIES=['USA','UK','Canada','Australia','NZ'];
var LOCALEP={USA:'',UK:'/en-GB',Canada:'/en-CA',Australia:'/en-AU',NZ:'/en-NZ'};
var CUR={USA:'USD',UK:'GBP',Canada:'CAD',Australia:'AUD',NZ:'NZD'};
var DATA=null, STATE=null, VIEW='india', saveTimer=null;
var flt={search:'',priceCap:'',lossCap:'',type:'All'};
var ofl={search:'',type:'All',location:'All',mech:'All'};
var plan={players:'',maxTime:'',location:'All',type:'All',sort:'name'};
var spendBreak='country';
var country='USA';
var sortState={india:{k:'verdictLoss',d:1},country:{k:'loss',d:1}};
var lastFocus=null;

function blankState(){return {overrides:{}, added:[], stores:[], removed:[], quickAdd:'', quickNotes:'', ownedEdits:{}, ownedAdded:[], ownedRemoved:[], soldAdded:[], session:[], sync:{owner:'',repo:'',branch:'main',path:'state.json'}};}
function loadState(){try{return Object.assign(blankState(),JSON.parse(localStorage.getItem(LS_STATE)||'{}'));}catch(e){return blankState();}}
function persistLocal(){localStorage.setItem(LS_STATE,JSON.stringify(STATE));}
function token(){return localStorage.getItem(LS_TOKEN)||'';}
function setToken(t){if(t)localStorage.setItem(LS_TOKEN,t);else localStorage.removeItem(LS_TOKEN);}
function cfg(k){return (STATE.config&&k in STATE.config)?STATE.config[k]:DATA.config[k];}
function fxRate(c){if(c==='INR')return 1;return (STATE.config&&STATE.config.fx&&STATE.config.fx[c]!=null)?STATE.config.fx[c]:DATA.meta.fx[c];}
function nkey(s){return (s||'').toLowerCase().trim();}
function allGames(){var rem=(STATE.removed||[]).map(nkey);var seen={};var out=[];DATA.games.concat(STATE.added||[]).forEach(function(g){var k=nkey(g.name);if(rem.indexOf(k)>=0)return;if(seen[k])return;seen[k]=1;out.push(g);});return out;}
// Once the scraper has merged an added game into data.json, drop the local STATE.added copy so it doesn't show twice (case-insensitive).
function reconcileAdded(){if(!DATA||!STATE)return;var names={};DATA.games.forEach(function(g){names[nkey(g.name)]=1;});var a=STATE.added||[];var kept=a.filter(function(x){return !names[nkey(x.name)];});if(kept.length!==a.length){STATE.added=kept;persistLocal();}}
function gameByName(n){return allGames().filter(function(x){return x.name===n;})[0];}
function ov(name){return STATE.overrides[name]||{};}
function displayName(g){var o=STATE.overrides[g.name];return (o&&o.name)?o.name:g.name;}
function oos(stock){var s=stock||'';var k=/pre-?order/i.test(s)?'pre':(/in stock/i.test(s)?'in':(/out of stock|unavail|sold|see store|oos/i.test(s)?'out':''));if(!k)return '';var lbl=k==='in'?'In stock':k==='pre'?'Pre-order':'Out of stock';return '<span class="av av-'+k+'"><i></i>'+lbl+'</span>';}
function inr(n){if(n==null||n===''||!isFinite(n))return '';return '₹'+Math.round(n).toLocaleString('en-IN');}
function loc(n){if(n==null||n===''||!isFinite(n))return '';return Number(n).toLocaleString('en-US',{maximumFractionDigits:2});}
function pct(n){if(n==null||n===''||!isFinite(n))return '';return (n*100).toFixed(1)+'%';}
function val(id){var e=document.getElementById(id);return e?e.value.trim():'';}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function norm(s){return (s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function num(v){var n=parseFloat(v);return isFinite(n)?n:null;}
function verdictFromLoss(l){if(l==null)return 'No Data';if(l<=cfg('buyWithin'))return 'Buy';if(l<=cfg('maybeWithin'))return 'Maybe';return "Don't Buy";}
function vclass(v){return v==='Buy'?'v-Buy':v==='Maybe'?'v-Maybe':v==="Don't Buy"?'v-Dont':'v-No';}
function ordinal(r){if(r==null)return '';return r===1?'Cheapest':r===2?'2nd cheapest':r===3?'3rd cheapest':r+'th cheapest';}
function sgn(amount,base,posGood){if(amount==null||!isFinite(amount))return '';var good=amount===0?null:(posGood?amount>0:amount<0);var col=good===null?'':(good?'pos':'neg');var p=(base&&base!=0)?(amount/base*100):null;return '<span class="'+col+'">'+(amount>0?'+':amount<0?'−':'')+inr(Math.abs(amount))+'</span>'+(p!=null?'<span class="sub">'+Math.abs(p).toFixed(1)+'%</span>':'');}

function indiaNet(g){var o=ov(g.name);var ind=(g.india&&g.india.verified)?g.india:null;var src=ind&&ind.source?ind.source:'';var disc=(o.discount!=null?o.discount:(ind&&ind.discount!=null?ind.discount:(g.discount!=null?g.discount:null)));if(disc==null)disc=/board games india/i.test(src)?cfg('bgiDefaultDiscount'):0;var ip=ind&&ind.price?ind.price:null;return {net:ip!=null?ip*(1-disc):null,disc:disc,listed:ip,src:src,stock:(ind&&ind.stock)||''};}
function rawINR(g,c){var p=g.prices?g.prices[c]:null;return (p!=null&&p>0)?p*fxRate(CUR[c]):null;}
function cheapestCountry(g){var best=null,bc=null;COUNTRIES.forEach(function(c){var v=rawINR(g,c);if(v!=null&&(best==null||v<best)){best=v;bc=c;}});return {inr:best,c:bc};}

function computeIndia(g){
  var iv=indiaNet(g);var cc=cheapestCountry(g);
  var opts=[];if(iv.net!=null)opts.push(iv.net);if(cc.inr!=null)opts.push(cc.inr);
  var cheapest=opts.length?Math.min.apply(null,opts):null;
  var vloss=(iv.net!=null&&cheapest!=null&&cheapest>0)?(iv.net-cheapest)/cheapest:null;
  var save=(iv.net!=null&&cc.inr!=null)?iv.net-cc.inr:null;
  return {name:g.name,disp:displayName(g),type:g.type||'',net:iv.net,disc:iv.disc,listed:iv.listed,avail:iv.stock,bestC:cc.c,bestINR:cc.inr,bestStock:(cc.c&&g.stock)?(g.stock[cc.c]||''):'',importSave:save,importPct:(save!=null&&iv.net)?save/iv.net:null,verdictLoss:vloss,verdict:verdictFromLoss(vloss),iurl:(g.india&&g.india.verified&&g.india.url)||'',isrc:(g.india&&g.india.verified&&g.india.source)||''};
}
function computeCountry(g,c){
  var iv=indiaNet(g);var priceLocal=g.prices?g.prices[c]:null;var priceINR=rawINR(g,c);var cc=cheapestCountry(g);
  var loss=(priceINR!=null&&cc.inr!=null&&cc.inr>0)?(priceINR-cc.inr)/cc.inr:null;
  var vsIndia=(iv.net!=null&&priceINR!=null)?iv.net-priceINR:null;
  var vals=COUNTRIES.map(function(cc2){return rawINR(g,cc2);}).filter(function(v){return v!=null;}).sort(function(a,b){return a-b;});
  var rank=(priceINR!=null)?(vals.indexOf(priceINR)+1):null;
  return {name:g.name,disp:displayName(g),type:g.type||'',local:priceLocal,priceINR:priceINR,india:iv.net,bestC:cc.c,bestINR:cc.inr,loss:loss,verdict:verdictFromLoss(loss),vsIndia:vsIndia,vsIndiaPct:(vsIndia!=null&&iv.net)?vsIndia/iv.net:null,avail:(g.stock&&g.stock[c])||'',rank:rank,rankN:(rank==null?99:rank),bgoLink:((ov(g.name).bgoId||g.bgoId)?'https://www.boardgameoracle.com'+(LOCALEP[c]||'')+'/boardgame/price/'+(ov(g.name).bgoId||g.bgoId)+'/x':'')};
}

var app;
var COLLECTION=null;
function ensureCollection(cb){if(COLLECTION){cb();return;}fetch('collection.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():{owned:[],sold:[]};}).then(function(c){COLLECTION={owned:(c.owned||[]),sold:(c.sold||[])};cb();}).catch(function(){COLLECTION={owned:[],sold:[]};cb();});}
function needCollection(){if(COLLECTION)return false;app.innerHTML='<div class="small muted" style="padding:24px 2px">Loading collection…</div>';ensureCollection(render);return true;}
var SECTIONS=[
  {id:'buy',label:'Buy',views:[['india','India'],['country','Country'],['analysis','Analysis'],['games','Games']]},
  {id:'collection',label:'Collection',views:[['owned','Games I own'],['plan','Plan & select'],['sold','Sold'],['spend','Spend & stats']]},
  {id:'settings',label:'Settings',views:[['settings','Settings']]}
];
function sectionOf(v){for(var i=0;i<SECTIONS.length;i++)for(var j=0;j<SECTIONS[i].views.length;j++)if(SECTIONS[i].views[j][0]===v)return SECTIONS[i];return SECTIONS[0];}
function renderNav(){
  var nav=document.getElementById('nav');if(!nav)return;var sec=sectionOf(VIEW);
  var h='<div class="nav-top">'+SECTIONS.map(function(s){return '<button data-sec="'+s.id+'" class="'+(s.id===sec.id?'active':'')+'">'+s.label+'</button>';}).join('')+'</div>';
  if(sec.views.length>1){h+='<div class="nav-sub">'+sec.views.map(function(v){return '<button data-v="'+v[0]+'" class="'+(v[0]===VIEW?'active':'')+'">'+v[1]+'</button>';}).join('')+'</div>';}
  nav.innerHTML=h;
  var tb=nav.querySelectorAll('[data-sec]');for(var i=0;i<tb.length;i++)tb[i].onclick=function(){var id=this.getAttribute('data-sec');var s=SECTIONS.filter(function(x){return x.id===id;})[0];VIEW=s.views[0][0];render();};
  var sb=nav.querySelectorAll('[data-v]');for(var k=0;k<sb.length;k++)sb[k].onclick=function(){VIEW=this.getAttribute('data-v');render();};
}
function render(){
  document.getElementById('updated').textContent=DATA?('data updated '+DATA.meta.updated):'';
  renderNav();
  if(VIEW==='india')renderIndia();else if(VIEW==='country')renderCountry();else if(VIEW==='analysis')renderAnalysis();else if(VIEW==='games')renderGames();
  else if(VIEW==='owned')renderOwned();else if(VIEW==='plan')renderPlan();else if(VIEW==='sold')renderSold();else if(VIEW==='spend')renderSpend();
  else renderSettings();
  updateBadge();
}
function filterBar(extra){
  return '<div class="controls">'+(extra||'')+'<input type="search" id="q" placeholder="Search…" value="'+esc(flt.search)+'"/>'
    +'<input type="number" class="cap" id="pcap" placeholder="Price cap ₹" value="'+esc(flt.priceCap)+'"/>'
    +'<input type="number" class="cap" id="lcap" placeholder="Loss cap %" value="'+esc(flt.lossCap)+'"/>'
    +'<select id="tf">'+['All','Boardgame','Expansion'].map(function(t){return '<option '+(flt.type===t?'selected':'')+'>'+t+'</option>';}).join('')+'</select></div>';
}
function wireFilters(rerender){
  document.getElementById('q').oninput=function(e){lastFocus={id:'q',pos:e.target.selectionStart};flt.search=e.target.value;rerender();};
  document.getElementById('pcap').oninput=function(e){lastFocus={id:'pcap',pos:null};flt.priceCap=e.target.value;rerender();};
  document.getElementById('lcap').oninput=function(e){lastFocus={id:'lcap',pos:null};flt.lossCap=e.target.value;rerender();};
  document.getElementById('tf').onchange=function(e){lastFocus=null;flt.type=e.target.value;rerender();};
  if(lastFocus){var el=document.getElementById(lastFocus.id);if(el){el.focus();if(lastFocus.pos!=null){try{el.setSelectionRange(lastFocus.pos,lastFocus.pos);}catch(e){}}}}
}
function passFilters(r,price,lossPct){
  if(flt.type!=='All'&&r.type!==flt.type)return false;
  if(flt.search&&(r.disp||r.name).toLowerCase().indexOf(flt.search.toLowerCase())<0)return false;
  var pc=num(flt.priceCap);if(pc!=null&&price!=null&&price>pc)return false;
  var lc=num(flt.lossCap);if(lc!=null&&lossPct!=null&&(lossPct*100)>lc)return false;
  return true;
}
function sortRows(rows,st){var k=st.k,d=st.d;rows.sort(function(a,b){var x=a[k],y=b[k];if(typeof x==='string'||typeof y==='string'){return d*String(x==null?'':x).localeCompare(String(y==null?'':y));}if(x==null)x=9e15;if(y==null)y=9e15;return d*(x-y);});return rows;}
function hdr(view,cols){var st=sortState[view];return '<tr>'+cols.map(function(c){var arrow=(st.k===c[0])?(st.d<0?' ▾':' ▴'):'';return '<th class="sk '+(c[2]||'')+'" data-sk="'+c[0]+'">'+c[1]+arrow+'</th>';}).join('')+'</tr>';}
function wireHdr(view,rerender){var ths=app.querySelectorAll('th[data-sk]');for(var i=0;i<ths.length;i++)ths[i].onclick=function(){var k=this.getAttribute('data-sk');var st=sortState[view];if(st.k===k)st.d*=-1;else{st.k=k;st.d=1;}rerender();};}

function renderIndia(){
  var rows=allGames().map(computeIndia).filter(function(r){return passFilters(r,r.net,r.verdictLoss);});
  sortRows(rows,sortState.india);
  var cols=[['name','Game',''],['net','India (net)','num'],['bestC','Best country','opt'],['bestINR','Best price','num'],['importSave','Import saves','num'],['verdictLoss','India vs cheapest','num'],['verdict','Buy in India?','']];
  var h=filterBar('')+'<div class="small muted" style="margin-bottom:6px">'+rows.length+' games · tap a row to edit</div>';
  h+='<div class="tbl-wrap cardify"><table><thead>'+hdr('india',cols)+'</thead><tbody>';
  rows.forEach(function(r){h+='<tr class="game" data-n="'+esc(r.name)+'"><td>'+esc(r.disp||r.name)+(r.iurl?' <a class="golink" href="'+esc(r.iurl)+'" target="_blank" rel="noopener" title="'+esc(r.isrc||'Open listing')+'" onclick="event.stopPropagation()">↗</a>':'')
    +'</td><td class="num" data-label="India (net)">'+inr(r.net)+oos(r.avail)+(r.disc?'<div class="small muted">'+pct(r.disc)+' off</div>':'')+'</td><td class="opt" data-label="Best country">'+(r.bestC||'')+'</td><td class="num" data-label="Best price">'+inr(r.bestINR)+oos(r.bestStock)
    +'</td><td class="num" data-label="Import saves">'+sgn(r.importSave,r.net,true)+'</td><td class="num" data-label="India vs cheapest">'+(r.verdictLoss==null?'':sgn(r.verdictLoss*(r.net||0),r.net,false))+'</td><td data-label="Buy in India?"><span class="verdict '+vclass(r.verdict)+'">'+r.verdict+'</span></td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;wireFilters(renderIndia);wireHdr('india',renderIndia);
  var gr=app.querySelectorAll('tr.game');for(var i=0;i<gr.length;i++){gr[i].tabIndex=0;gr[i].setAttribute('role','button');gr[i].onclick=function(){editRow(this,this.getAttribute('data-n'));};gr[i].onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();editRow(this,this.getAttribute('data-n'));}};}
}
function editRow(tr,name){
  var nx=tr.nextElementSibling;if(nx&&nx.className.indexOf('expand')>=0){nx.parentNode.removeChild(nx);return;}
  var o=ov(name);var r=computeIndia(gameByName(name));var row=document.createElement('tr');row.className='expand';
  row.innerHTML='<td colspan="7"><div class="grid">'
    +fld('India discount % (blank=auto)','ed_disc',o.discount!=null?o.discount*100:'','number','auto')
    +'</div><div class="small muted" style="margin-top:8px">India listed '+inr(r.listed)+' '+(r.avail?'· '+esc(r.avail):'')+' · net '+inr(r.net)+' | Best '+inr(r.bestINR)+' '+(r.bestC||'')+'</div>'
    +'<div style="margin-top:10px"><button class="act" id="ed_save">Save</button> <button class="ghost" id="ed_own">Bought — add to owned →</button> <button class="ghost" id="ed_clear" style="margin-left:6px">Clear</button></div></td>';
  if(tr.nextSibling)tr.parentNode.insertBefore(row,tr.nextSibling);else tr.parentNode.appendChild(row);
  document.getElementById('ed_save').onclick=function(){var no=Object.assign({},o);delete no.notes;var d=num(val('ed_disc'));no.discount=(d!=null?d/100:undefined);STATE.overrides[name]=clean(no);changed();render();};
  document.getElementById('ed_own').onclick=function(){ownFromBuy(name);};
  document.getElementById('ed_clear').onclick=function(){delete STATE.overrides[name];changed();render();};
}
function ownFromBuy(name){var g=gameByName(name);if(!g)return;openOwnedModal({name:displayName(g),type:g.type||'',bgg:'',fromBuy:true,buyName:name});}
function countryDetail(tr,name){
  var wasOpen=tr.nextElementSibling&&tr.nextElementSibling.className.indexOf('expand')>=0;
  var open=document.querySelectorAll('tr.expand');for(var q=0;q<open.length;q++)open[q].parentNode.removeChild(open[q]);
  if(wasOpen)return;
  var g=gameByName(name);if(!g)return;var cc=cheapestCountry(g);
  var row=document.createElement('tr');row.className='expand';
  row.innerHTML='<td colspan="10"><div class="small muted">'+esc(displayName(g))+' · cheapest '+inr(cc.inr)+' '+(cc.c||'')+'</div><div style="margin-top:8px"><button class="act" id="cd_own">Bought — add to owned →</button></div></td>';
  if(tr.nextSibling)tr.parentNode.insertBefore(row,tr.nextSibling);else tr.parentNode.appendChild(row);
  row.querySelector('#cd_own').onclick=function(){ownFromBuy(name);};
}
function clean(o){var r={};for(var k in o)if(o[k]!==undefined&&o[k]!=='')r[k]=o[k];return r;}
function fld(label,id,value,type,ph){return '<div class="fld"><label>'+label+'</label><input type="'+(type||'text')+'" id="'+id+'" value="'+esc(value)+'" placeholder="'+esc(ph||'')+'"/></div>';}

function renderCountry(){
  var rows=allGames().map(function(g){return computeCountry(g,country);}).filter(function(r){return r.priceINR!=null&&passFilters(r,r.priceINR,r.loss);});
  sortRows(rows,sortState.country);
  var cols=[['name','Game',''],['local','Price ('+CUR[country]+')','num'],['priceINR','Price (INR)','num'],['rankN','Rank here',''],['india','India (net)','num opt'],['bestC','Best','opt'],['bestINR','Best (INR)','num opt'],['vsIndia','vs India','num'],['loss','vs cheapest','num'],['verdict','Verdict','']];
  var extra='<label class="chk">Country <select id="cc">'+COUNTRIES.map(function(c){return '<option '+(c===country?'selected':'')+'>'+c+'</option>';}).join('')+'</select></label>';
  var h=filterBar(extra)+'<div class="small muted" style="margin-bottom:6px">'+rows.length+' games available in '+country+'</div>';
  h+='<div class="tbl-wrap cardify"><table><thead>'+hdr('country',cols)+'</thead><tbody>';
  rows.forEach(function(r){h+='<tr class="game" data-n="'+esc(r.name)+'"><td>'+esc(r.disp||r.name)+(r.bgoLink?' <a class="golink" href="'+esc(r.bgoLink)+'" target="_blank" rel="noopener" title="Open on Board Game Oracle" onclick="event.stopPropagation()">↗</a>':'')+'</td><td class="num" data-label="Price ('+CUR[country]+')">'+loc(r.local)+'</td><td class="num" data-label="Price (INR)">'+inr(r.priceINR)+oos(r.avail)+'</td><td data-label="Rank here">'+ordinal(r.rank)+'</td><td class="num opt" data-label="India (net)">'+inr(r.india)
    +'</td><td class="opt" data-label="Best">'+(r.bestC||'')+'</td><td class="num opt" data-label="Best (INR)">'+inr(r.bestINR)+'</td><td class="num" data-label="vs India">'+sgn(r.vsIndia,r.india,true)+'</td><td class="num" data-label="vs cheapest">'+sgn(r.loss!=null?r.loss*(r.bestINR||0):null,r.bestINR,false)+'</td><td data-label="Verdict"><span class="verdict '+vclass(r.verdict)+'">'+r.verdict+'</span></td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;
  document.getElementById('cc').onchange=function(e){country=e.target.value;renderCountry();};
  wireFilters(renderCountry);wireHdr('country',renderCountry);
  var gr=app.querySelectorAll('tr.game');for(var i=0;i<gr.length;i++){gr[i].tabIndex=0;gr[i].setAttribute('role','button');gr[i].onclick=function(){countryDetail(this,this.getAttribute('data-n'));};gr[i].onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();countryDetail(this,this.getAttribute('data-n'));}};}
}

function storeCalc(store){
  var fx=fxRate(CUR[store.country||'USA']);var disc=(num(store.discount)||0)/100;var oh=(num(store.overhead)||0)/100;
  var shipMode=store.shipMode||'local';var shipVal=num(store.shipping)||0;
  var items=(store.items||[]).map(function(it){
    var g=gameByName(it.game);var iv=g?indiaNet(g):{net:null,stock:''};
    var website=num(it.price);var billing=website!=null?website*(1-disc):null;
    var finalINR=billing!=null?billing*fx*(1+oh):null;
    var benefit=(iv.net!=null&&finalINR!=null)?iv.net-finalINR:null;
    var cPriceINR=g?rawINR(g,store.country):null;
    var lossCountry=(finalINR!=null&&cPriceINR!=null)?finalINR-cPriceINR:null;
    var cc=g?cheapestCountry(g):{inr:null,c:null};
    var lossCheap=(finalINR!=null&&cc.inr!=null)?finalINR-cc.inr:null;
    return {game:it.game,website:website,billing:billing,finalINR:finalINR,india:iv.net,benefit:benefit,avail:iv.stock,cPriceINR:cPriceINR,lossCountry:lossCountry,cheapINR:cc.inr,cheapC:cc.c,lossCheap:lossCheap};
  });
  var subBilling=items.reduce(function(s,x){return s+(x.billing||0);},0);
  var shipLocal=shipMode==='pct'?subBilling*(shipVal/100):shipVal;
  var shipINR=shipLocal*fx;
  var totFinal=items.reduce(function(s,x){return s+(x.finalINR||0);},0)+shipINR;
  var totWebsite=items.reduce(function(s,x){return s+(x.website||0);},0);
  var totIndia=items.reduce(function(s,x){return s+(x.india||0);},0);
  var benefit=totIndia-totFinal;
  return {fx:fx,items:items,shipINR:shipINR,totWebsite:totWebsite,totFinal:totFinal,totIndia:totIndia,benefit:benefit,benefitPct:totIndia>0?benefit/totIndia:null};
}
function renderAnalysis(){
  var stores=STATE.stores||[];
  var h='<div class="controls"><button class="act" id="addStore">+ Add store</button><span class="pill">each store = one basket / order</span></div>';
  if(stores.length>1){h+='<div class="card"><h3>Basket comparison</h3><div class="tbl-wrap"><table><thead><tr><th>Store</th><th class="opt">Country</th><th class="num">Games</th><th class="num">Total cost</th><th class="num">Total India</th><th class="num">Benefit</th></tr></thead><tbody>';
    stores.forEach(function(st){var c=storeCalc(st);h+='<tr><td>'+esc(st.name||'(unnamed)')+'</td><td class="opt">'+(st.country||'')+'</td><td class="num">'+(st.items||[]).length+'</td><td class="num">'+inr(c.totFinal)+'</td><td class="num">'+inr(c.totIndia)+'</td><td class="num">'+sgn(c.benefit,c.totIndia,true)+'</td></tr>';});
    h+='</tbody></table></div></div>';}
  if(!stores.length)h+='<div class="small muted">No stores yet. Add a store, set its country / discount / shipping / overhead, then add the games you plan to buy there.</div>';
  stores.forEach(function(st,si){var c=storeCalc(st);
    h+='<div class="card"><div class="grid">'
      +'<div class="fld"><label>Store / site</label><input data-s="'+si+'" data-k="name" value="'+esc(st.name||'')+'" placeholder="Amazon US"/></div>'
      +'<div class="fld"><label>Country</label><select data-s="'+si+'" data-k="country">'+COUNTRIES.map(function(cc){return '<option '+((st.country||'USA')===cc?'selected':'')+'>'+cc+'</option>';}).join('')+'</select></div>'
      +'<div class="fld"><label>Discount %</label><input type="number" data-s="'+si+'" data-k="discount" value="'+esc(st.discount!=null?st.discount:'')+'"/></div>'
      +'<div class="fld"><label>Shipping</label><input type="number" data-s="'+si+'" data-k="shipping" value="'+esc(st.shipping!=null?st.shipping:'')+'"/></div>'
      +'<div class="fld"><label>Shipping type</label><select data-s="'+si+'" data-k="shipMode"><option value="local" '+((st.shipMode||'local')==='local'?'selected':'')+'>'+CUR[st.country||'USA']+' amount</option><option value="pct" '+(st.shipMode==='pct'?'selected':'')+'>% of order</option></select></div>'
      +'<div class="fld"><label>Overhead %</label><input type="number" data-s="'+si+'" data-k="overhead" value="'+esc(st.overhead!=null?st.overhead:'')+'"/></div>'
      +'</div>';
    h+='<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Game</th><th class="num">Website ('+CUR[st.country||'USA']+')</th><th class="num">Billing ('+CUR[st.country||'USA']+')</th><th class="num">Final (INR)</th><th class="num opt">India</th><th class="num">Benefit</th><th class="opt">Avail.</th><th class="num opt">'+(st.country||'USA')+' price</th><th class="num">Loss vs '+(st.country||'USA')+'</th><th class="num opt">Cheapest</th><th class="opt">Ch. country</th><th class="num">Loss vs cheapest</th><th></th></tr></thead><tbody>';
    c.items.forEach(function(it,ii){h+='<tr><td>'+esc(it.game)+'</td>'
      +'<td class="num"><input type="number" data-s="'+si+'" data-it="'+ii+'" data-k="price" value="'+esc(it.website!=null?it.website:'')+'" style="width:80px;text-align:right"/></td>'
      +'<td class="num">'+loc(it.billing)+'</td><td class="num">'+inr(it.finalINR)+'</td><td class="num opt">'+inr(it.india)+'</td>'
      +'<td class="num">'+sgn(it.benefit,it.india,true)+'</td><td class="opt small muted">'+esc(it.avail||'')+'</td>'
      +'<td class="num opt">'+inr(it.cPriceINR)+'</td><td class="num">'+sgn(it.lossCountry,it.cPriceINR,false)+'</td>'
      +'<td class="num opt">'+inr(it.cheapINR)+'</td><td class="opt">'+(it.cheapC||'')+'</td><td class="num">'+sgn(it.lossCheap,it.cheapINR,false)+'</td>'
      +'<td><button class="ghost" data-rmit="'+ii+'" data-s="'+si+'">×</button></td></tr>';});
    h+='<tr class="tot"><td>Total ('+c.items.length+(st.shipping?' + ship '+inr(c.shipINR):'')+')</td><td class="num">'+loc(c.totWebsite)+'</td><td></td><td class="num">'+inr(c.totFinal)+'</td><td class="num opt">'+inr(c.totIndia)+'</td><td class="num">'+sgn(c.benefit,c.totIndia,true)+'</td><td colspan="7"></td></tr>';
    h+='</tbody></table></div>';
    h+='<div style="margin-top:8px"><select data-addsel="'+si+'"><option value="">+ add a game…</option>'+allGames().map(function(g){return '<option>'+esc(g.name)+'</option>';}).join('')+'</select> <button class="danger" data-rmstore="'+si+'" style="padding:7px 11px;float:right">Remove store</button></div></div>';
  });
  app.innerHTML=h;
  var add=document.getElementById('addStore');if(add)add.onclick=function(){STATE.stores=(STATE.stores||[]).concat([{name:'',country:'USA',discount:'',shipping:'',shipMode:'local',overhead:cfg('overheadPct')*100,items:[]}]);changed();render();};
  var f=app.querySelectorAll('[data-k]');for(var i=0;i<f.length;i++)f[i].onchange=function(){var si=+this.getAttribute('data-s'),it=this.getAttribute('data-it'),k=this.getAttribute('data-k');var st=STATE.stores[si];if(it!=null){st.items[+it]=Object.assign({},st.items[+it]);st.items[+it][k]=this.value;}else{st[k]=this.value;}changed();render();};
  var sel=app.querySelectorAll('[data-addsel]');for(var j=0;j<sel.length;j++)sel[j].onchange=function(){var si=+this.getAttribute('data-addsel');var name=this.value;if(!name)return;var st=STATE.stores[si];var g=gameByName(name);var auto=g&&g.prices?g.prices[st.country]:null;st.items=(st.items||[]).concat([{game:name,price:auto!=null?auto:''}]);changed();render();};
  var ri=app.querySelectorAll('[data-rmit]');for(var k=0;k<ri.length;k++)ri[k].onclick=function(){STATE.stores[+this.getAttribute('data-s')].items.splice(+this.getAttribute('data-rmit'),1);changed();render();};
  var rs=app.querySelectorAll('[data-rmstore]');for(var m=0;m<rs.length;m++)rs[m].onclick=function(){STATE.stores.splice(+this.getAttribute('data-rmstore'),1);changed();render();};
}

function indiaSourcesFor(g){
  var o=ov(g.name);var iov=(o.india)||{};var rem=iov.remove||[];var ver=iov.verify||[];var add=iov.add||[];
  var base=(g.indiaSources||[]).filter(function(s){return rem.indexOf(s.url)<0;}).map(function(s){return {site:s.site,url:s.url,price:s.price,stock:s.stock,verified:(!!s.verified)||ver.indexOf(s.url)>=0};});
  var extra=add.filter(function(a){return rem.indexOf(a.url)<0 && !base.some(function(s){return s.url===a.url;});}).map(function(a){return {site:a.site||'Custom',url:a.url,price:null,stock:'',verified:true,pending:true};});
  return base.concat(extra);
}
function gameDetail(tr,name){
  var wasOpen=tr.nextElementSibling&&tr.nextElementSibling.className.indexOf('gmx')>=0;
  var openRows=document.querySelectorAll('tr.gmx');for(var q=0;q<openRows.length;q++)openRows[q].parentNode.removeChild(openRows[q]);   // only one detail open at a time -> no duplicate element IDs
  if(wasOpen)return;
  var g=gameByName(name);if(!g)return;var o=ov(name);var ai=STATE.added.indexOf(g);var added=ai>=0;
  var id=(o.bgoId||g.bgoId)||'';
  var LP={USA:'',UK:'/en-GB',Canada:'/en-CA',Australia:'/en-AU',NZ:'/en-NZ'};
  var h='<div class="card" style="margin:6px 0">';
  h+='<div class="fld"><label>Game name</label><input id="gd_name" value="'+esc(displayName(g))+'"/></div>';
  h+='<h3 style="margin:12px 0 6px;font-size:14px">International — Board Game Oracle</h3>';
  h+='<div class="fld"><label>BGO link or ID</label><input id="gd_bgo" value="'+esc(id)+'" placeholder="paste BGO link or ID"/></div>';
  h+='<div class="tbl-wrap" style="margin-top:6px"><table><thead><tr><th>Country</th><th class="num">Price</th><th class="num">INR</th><th>Stock</th><th></th></tr></thead><tbody>';
  COUNTRIES.forEach(function(c){var lp=g.prices?g.prices[c]:null;var ir=rawINR(g,c);var stk=(g.stock&&g.stock[c])||'';var lk=id?'https://www.boardgameoracle.com'+LP[c]+'/boardgame/price/'+id+'/x':'';
    h+='<tr><td>'+c+'</td><td class="num">'+(lp!=null?loc(lp)+' '+CUR[c]:'—')+'</td><td class="num">'+(ir!=null?inr(ir):'—')+'</td><td class="small muted">'+esc(stk)+'</td><td>'+(lk?'<a href="'+esc(lk)+'" target="_blank" rel="noopener">open ↗</a>':'')+'</td></tr>';});
  h+='</tbody></table></div>';
  var sources=indiaSourcesFor(g);
  h+='<h3 style="margin:14px 0 6px;font-size:14px">India</h3><div class="tbl-wrap"><table><thead><tr><th>Site</th><th class="num">Price</th><th>Stock</th><th>Status</th><th></th><th></th></tr></thead><tbody>';
  sources.forEach(function(s){var badge=s.pending?'<span class="pill">pending run</span>':(s.verified?'<span class="pill" style="color:var(--pos);border-color:var(--pos)">confirmed</span>':'<span class="pill" style="color:var(--maybe);border-color:var(--maybe)">⚠ check</span>');
    h+='<tr><td>'+esc(s.site)+'</td><td class="num">'+(s.price!=null?inr(s.price):'—')+'</td><td class="small muted">'+esc(s.stock||'')+'</td><td>'+badge+'</td><td>'+(s.url?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener">open ↗</a>':'')+'</td><td>'+((!s.verified&&!s.pending)?'<button class="ghost" data-verify="'+esc(s.url)+'">✓</button> ':'')+'<button class="ghost" data-remove="'+esc(s.url)+'">✕</button></td></tr>';});
  if(!sources.length)h+='<tr><td colspan="6" class="small muted">No India links yet.</td></tr>';
  h+='</tbody></table></div>';
  h+='<div class="grid" style="margin-top:8px"><div class="fld"><label>Add India link (URL)</label><input id="gd_addurl" placeholder="paste an India product page URL"/></div><div class="fld"><label>Site name</label><input id="gd_addsite" placeholder="e.g. Gameistry"/></div></div><div style="margin-top:6px"><button class="ghost" id="gd_add">Add link</button></div>';
  h+='<div style="margin-top:12px"><button class="act" id="gd_save">Save</button> <button class="ghost" id="gd_own">Add to owned →</button> <button class="danger" id="gd_del" style="padding:8px 12px;margin-left:6px">Delete game</button></div>';
  h+='<div class="small muted" style="margin-top:6px">Verify / remove / add links and BGO ID / name edits take effect on the next price run.</div></div>';
  var row=document.createElement('tr');row.className='gmx';row.innerHTML='<td colspan="2" style="padding:0 4px">'+h+'</td>';
  if(tr.nextSibling)tr.parentNode.insertBefore(row,tr.nextSibling);else tr.parentNode.appendChild(row);
  function rv(id){var el=row.querySelector('#'+id);return el?(el.value||'').trim():'';}   // read fields from THIS panel only, never a stray duplicate ID elsewhere
  function iset(fn){STATE.overrides[name]=STATE.overrides[name]||{};STATE.overrides[name].india=STATE.overrides[name].india||{};fn(STATE.overrides[name].india);}
  function refresh(){changed();row.parentNode.removeChild(row);gameDetail(tr,name);}
  var vb=row.querySelectorAll('[data-verify]');for(var i=0;i<vb.length;i++)vb[i].onclick=function(){var u=this.getAttribute('data-verify');iset(function(iv){iv.verify=iv.verify||[];if(iv.verify.indexOf(u)<0)iv.verify.push(u);});refresh();};
  var rb=row.querySelectorAll('[data-remove]');for(var k=0;k<rb.length;k++)rb[k].onclick=function(){var u=this.getAttribute('data-remove');iset(function(iv){iv.remove=iv.remove||[];if(iv.remove.indexOf(u)<0)iv.remove.push(u);});refresh();};
  row.querySelector('#gd_add').onclick=function(){var u=rv('gd_addurl');if(!u){alert('Paste a URL.');return;}iset(function(iv){iv.add=iv.add||[];iv.add.push({site:rv('gd_addsite')||'Custom',url:u});});refresh();};
  row.querySelector('#gd_save').onclick=function(){var nn=rv('gd_name');if(added){if(nn)STATE.added[ai].name=nn;}else{STATE.overrides[name]=STATE.overrides[name]||{};if(nn&&nn!==name)STATE.overrides[name].name=nn;else delete STATE.overrides[name].name;}var braw=rv('gd_bgo');var bid='';if(braw){var m=braw.match(/\/boardgame\/price\/([A-Za-z0-9_-]{6,})/);bid=m?m[1]:braw;}if(added){STATE.added[ai].bgoId=bid||'';}else{STATE.overrides[name]=STATE.overrides[name]||{};if(bid)STATE.overrides[name].bgoId=bid;else delete STATE.overrides[name].bgoId;}changed();render();};
  row.querySelector('#gd_del').onclick=function(){if(!confirm('Delete "'+name+'"?'))return;if(added){STATE.added.splice(ai,1);}else{STATE.removed=STATE.removed||[];if(STATE.removed.indexOf(name)<0)STATE.removed.push(name);}changed();render();};
  row.querySelector('#gd_own').onclick=function(){openOwnedModal({name:displayName(g),type:g.type||'',bgg:'',fromBuy:true,buyName:name});};
}
function openAddModal(){
  closeModal();
  var ovl=document.createElement('div');ovl.className='modal-ov';ovl.id='addModal';
  ovl.innerHTML='<div class="modal"><h3>Add a game</h3>'
    +'<div class="fld"><label>Game name</label><input id="ng_name" placeholder="Ark Nova"/></div>'
    +'<div class="fld" style="margin-top:12px"><label>Board Game Oracle link or ID</label><input id="ng_bgo" placeholder="paste the .../boardgame/price/... link, or the ID"/></div>'
    +'<div class="fld" style="margin-top:12px"><label>India links (one per line, optional)</label><textarea id="ng_india" rows="3" placeholder="paste one or more India product page URLs"></textarea></div>'
    +'<div class="small muted" style="margin-top:10px">Links you paste here are treated as confirmed. Prices fill in on the next run.</div>'
    +'<div class="modal-actions"><button class="ghost" id="ng_cancel">Cancel</button><button class="act" id="ng_add">Add game</button></div></div>';
  document.body.appendChild(ovl);
  ovl.onclick=function(e){if(e.target===ovl)closeModal();};
  document.onkeydown=function(e){if(e.key==='Escape')closeModal();};
  var ni=document.getElementById('ng_name');if(ni)ni.focus();
  document.getElementById('ng_cancel').onclick=closeModal;
  document.getElementById('ng_add').onclick=function(){
    var nm=val('ng_name');if(!nm){alert('Enter a game name.');return;}
    if(allGames().some(function(g){return nkey(g.name)===nkey(nm);})){alert('“'+nm+'” is already in your list.');return;}
    var raw=val('ng_bgo');var id='';if(raw){var m=raw.match(/\/boardgame\/price\/([A-Za-z0-9_-]{6,})/);id=m?m[1]:raw;}
    var iu=(val('ng_india')||'').split(/[\n,]+/).map(function(s){return s.trim();}).filter(function(s){return /^https?:\/\//.test(s);});
    STATE.added.push({name:nm,type:'Boardgame',bgoId:id,indiaUrls:iu,india:null,prices:{},stock:{},status:'Not Started'});
    closeModal();changed();render();
  };
}
function closeModal(){var m=document.getElementById('addModal');if(m)m.parentNode.removeChild(m);document.onkeydown=null;}
function renderGames(){
  var h='<div class="card"><h3>Quick notes <span class="small muted">— jot anything; does not touch the list</span></h3><textarea id="qn" rows="4" style="width:100%" placeholder="that cat trick-taking game… / check BGG hotness / ask friend about Ark Nova">'+esc(STATE.quickNotes||'')+'</textarea><div class="small muted" style="margin-top:6px" id="qnStatus">Autosaves &amp; syncs across your devices.</div></div>';
  h+='<div class="controls"><button class="act" id="ng_open">+ Add game</button><span class="pill">game name · BGO link · India links</span></div>';
  var rows=allGames().slice().sort(function(a,b){var x=displayName(a).toLowerCase(),y=displayName(b).toLowerCase();return x<y?-1:x>y?1:0;});
  h+='<div class="small muted" style="margin:4px 2px">'+rows.length+' games · sorted A→Z · tap a row to open its links &amp; prices</div><div class="tbl-wrap"><table><thead><tr><th>Game</th><th>Type</th></tr></thead><tbody>';
  rows.forEach(function(g){var renamed=(ov(g.name).name&&ov(g.name).name!==g.name);var pend=indiaSourcesFor(g).some(function(s){return !s.verified;});h+='<tr class="game" data-n="'+esc(g.name)+'"><td>'+esc(displayName(g))+(pend?' <span class="pill" style="color:var(--maybe);border-color:var(--maybe)">⚠ confirm India</span>':'')+(renamed?'<div class="small muted">was: '+esc(g.name)+'</div>':'')+'</td><td class="small muted">'+(g.type||'')+'</td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;
  var qn=document.getElementById('qn');if(qn)qn.oninput=function(){STATE.quickNotes=this.value;changed();};
  document.getElementById('ng_open').onclick=openAddModal;
  var gr=app.querySelectorAll('tr.game');for(var i=0;i<gr.length;i++){gr[i].tabIndex=0;gr[i].setAttribute('role','button');gr[i].onclick=function(){gameDetail(this,this.getAttribute('data-n'));};gr[i].onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();gameDetail(this,this.getAttribute('data-n'));}};}
}
/* ================= Collection (post-purchase) ================= */
function pint(n){return n==null||n===''||!isFinite(n)?'':(''+Math.round(n));}
function fmtINR(n){return inr(n)||'—';}
function distinct(arr,key){var s={};arr.forEach(function(o){var v=(o[key]==null?'':(''+o[key])).trim();if(v)s[v]=1;});return Object.keys(s).sort();}
function wcut(k,d){var v=(STATE.config&&k in STATE.config)?STATE.config[k]:(DATA.config?DATA.config[k]:undefined);return (v==null||!isFinite(v))?d:v;}
function weightClass(w){if(w==null||!isFinite(w))return '';var a=wcut('wLight',1.5),b=wcut('wLightMed',2.0),c=wcut('wMed',2.75),e=wcut('wMedHeavy',3.5);return w<a?'Light':w<b?'Light - Medium':w<c?'Medium':w<e?'Medium - Heavy':'Heavy';}
function mechStr(o){return (o.mechs||[]).join(', ');}
function distinctMechs(arr){var s={};arr.forEach(function(o){(o.mechs||[]).forEach(function(m){if(m)s[m]=1;});});return Object.keys(s).sort();}
function chipHue(s){var h=0;s=(s||'').toLowerCase();for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function mechChips(o){return (o.mechs||[]).map(function(x){return '<span class="chip" style="--h:'+chipHue(x)+'">'+esc(x)+'</span>';}).join('');}
function ownedBase(){return (COLLECTION.owned||[]).concat(STATE.ownedAdded||[]);}
function oedit(id){return (STATE.ownedEdits||{})[id]||{};}
function setOEdit(id,obj){STATE.ownedEdits=STATE.ownedEdits||{};STATE.ownedEdits[id]=Object.assign({},STATE.ownedEdits[id]||{},obj);changed();}
function ownedById(id){return ownedList().filter(function(x){return x.id===id;})[0];}
function ownedList(){
  var rem=STATE.ownedRemoved||[];var ed=STATE.ownedEdits||{};var out=[];
  ownedBase().forEach(function(o){ if(rem.indexOf(o.id)>=0)return; var m=Object.assign({},o,ed[o.id]||{}); if(m.sold&&m.sold.amount!=null)return; out.push(m); });
  return out;
}
function soldList(){
  var ed=STATE.ownedEdits||{};var out=(COLLECTION.sold||[]).slice();
  ownedBase().forEach(function(o){var e=ed[o.id];if(e&&e.sold&&e.sold.amount!=null)out.push(Object.assign({},o,e,{saleAmount:e.sold.amount,saleDate:e.sold.date,buyer:e.sold.buyer}));});
  (STATE.soldAdded||[]).forEach(function(x){out.push(x);});
  return out;
}

function renderOwned(){
  if(needCollection())return;
  var all=ownedBase();
  var types=['All'].concat(distinct(all,'type'));var locs=['All'].concat(distinct(all,'location'));var mechs=['All'].concat(distinctMechs(all));
  var rows=ownedList().filter(function(o){
    if(ofl.search&&norm(o.name).indexOf(norm(ofl.search))<0)return false;
    if(ofl.type!=='All'&&(o.type||'')!==ofl.type)return false;
    if(ofl.location!=='All'&&(o.location||'')!==ofl.location)return false;
    if(ofl.mech!=='All'&&(o.mechs||[]).indexOf(ofl.mech)<0)return false;
    return true;
  }).sort(function(a,b){return nkey(a.name)<nkey(b.name)?-1:1;});
  var h='<div class="controls"><input type="search" id="oq" placeholder="Search…" value="'+esc(ofl.search)+'"/>'
    +'<select id="oty">'+types.map(function(t){return '<option '+(ofl.type===t?'selected':'')+'>'+(t==='All'?'Type: all':esc(t))+'</option>';}).join('')+'</select>'
    +'<select id="oloc">'+locs.map(function(t){return '<option '+(ofl.location===t?'selected':'')+'>'+(t==='All'?'Location: all':esc(t))+'</option>';}).join('')+'</select>'
    +'<select id="omech">'+mechs.map(function(t){return '<option '+(ofl.mech===t?'selected':'')+'>'+(t==='All'?'Mechanism: all':esc(t))+'</option>';}).join('')+'</select>'
    +'<button class="act" id="oadd" style="margin-left:auto">+ Add owned</button></div>';
  h+='<div class="small muted" style="margin:4px 2px">'+rows.length+' games · tap a row to edit</div>';
  h+='<div class="tbl-wrap cardify"><table><thead><tr><th>Game</th><th>Players</th><th>Best at</th><th class="opt">Type</th><th>Mechanisms</th><th class="opt">Wt</th><th class="num opt">Time</th><th class="opt">Location</th><th class="num">Paid</th><th class="opt">Store</th></tr></thead><tbody>';
  rows.forEach(function(o){h+='<tr class="game" data-id="'+esc(o.id)+'"><td>'+esc(o.name)+'</td><td data-label="Players">'+pint(o.minP)+'–'+pint(o.maxP)+'</td><td class="small muted" data-label="Best at">'+esc(o.bestAt||'')+'</td><td class="opt small muted" data-label="Type">'+esc(o.type||'')+'</td><td class="chips" data-label="Mechanisms">'+mechChips(o)+'</td><td class="opt small muted" data-label="Weight">'+esc(weightClass(o.weight))+'</td><td class="num opt" data-label="Time">'+(o.playTime?pint(o.playTime)+'m':'')+'</td><td class="opt small muted" data-label="Location">'+esc(o.location||'')+'</td><td class="num" data-label="Paid">'+fmtINR(o.amount)+'</td><td class="opt small muted" data-label="Store">'+esc(o.store||'')+'</td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;
  var oq=document.getElementById('oq');oq.oninput=function(){ofl.search=this.value;renderOwned();var e=document.getElementById('oq');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}};
  document.getElementById('oty').onchange=function(){ofl.type=this.value;renderOwned();};
  document.getElementById('oloc').onchange=function(){ofl.location=this.value;renderOwned();};
  document.getElementById('omech').onchange=function(){ofl.mech=this.value;renderOwned();};
  document.getElementById('oadd').onclick=openOwnedModal;
  var gr=app.querySelectorAll('tr.game');for(var i=0;i<gr.length;i++){gr[i].tabIndex=0;gr[i].setAttribute('role','button');gr[i].onclick=function(){ownedDetail(this,this.getAttribute('data-id'));};gr[i].onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();ownedDetail(this,this.getAttribute('data-id'));}};}
}
function ownedDetail(tr,id){
  var wasOpen=tr.nextElementSibling&&tr.nextElementSibling.className.indexOf('gmx')>=0;
  var openRows=document.querySelectorAll('tr.gmx');for(var q=0;q<openRows.length;q++)openRows[q].parentNode.removeChild(openRows[q]);
  if(wasOpen)return;
  var o=ownedById(id);if(!o)return;
  var h='<div class="card" style="margin:6px 0"><div class="small muted" style="margin-bottom:8px">'+esc(o.name)+'  ·  weight class: '+esc(weightClass(o.weight)||'—')+'</div><div class="grid">'
    +fld('Paid (₹)','od_amt',o.amount!=null?o.amount:'','number','')
    +fld('Store','od_store',o.store||'')+fld('Country','od_country',o.country||'')+fld('Date','od_date',o.date||'','','YYYY-MM-DD')+fld('Location','od_loc',o.location||'')
    +fld('Best at (players)','od_best',o.bestAt||'','','e.g. 4 or 4,5')+fld('Type','od_type',o.type||'')
    +fld('Min players','od_min',o.minP!=null?o.minP:'','number','')+fld('Max players','od_max',o.maxP!=null?o.maxP:'','number','')+fld('Play time (min)','od_time',o.playTime!=null?o.playTime:'','number','')+fld('Weight (numeric)','od_wt',o.weight!=null?o.weight:'','number','e.g. 2.4')
    +'<div class="fld" style="grid-column:1/-1"><label>Mechanisms (comma-separated)</label><input id="od_mech" value="'+esc(mechStr(o))+'"/></div></div>'
    +'<div style="margin-top:12px"><button class="act" id="od_save">Save</button> <button class="ghost" id="od_sold">Mark sold…</button> <button class="danger" id="od_del" style="margin-left:6px">Remove</button></div>'
    +'<div id="od_soldbox" class="hide" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px"><div class="grid">'+fld('Sale amount (₹)','od_samt','','number','')+fld('Sale date','od_sdate','','','YYYY-MM-DD')+fld('Buyer','od_buyer','')+'</div><div style="margin-top:8px"><button class="act" id="od_soldsave">Confirm sold</button></div></div></div>';
  var row=document.createElement('tr');row.className='gmx';row.innerHTML='<td colspan="10" style="padding:0 4px">'+h+'</td>';
  if(tr.nextSibling)tr.parentNode.insertBefore(row,tr.nextSibling);else tr.parentNode.appendChild(row);
  row.querySelector('#od_save').onclick=function(){setOEdit(id,{amount:num(val('od_amt')),store:val('od_store'),country:val('od_country'),date:val('od_date'),location:val('od_loc'),bestAt:val('od_best'),type:val('od_type'),minP:num(val('od_min')),maxP:num(val('od_max')),playTime:num(val('od_time')),weight:num(val('od_wt')),mechs:parseMechs(val('od_mech'))});render();};
  row.querySelector('#od_sold').onclick=function(){var b=row.querySelector('#od_soldbox');b.className=b.className.indexOf('hide')>=0?'':'hide';};
  row.querySelector('#od_soldsave').onclick=function(){var a=num(val('od_samt'));if(a==null){alert('Enter the sale amount.');return;}setOEdit(id,{sold:{amount:a,date:val('od_sdate'),buyer:val('od_buyer')}});render();};
  row.querySelector('#od_del').onclick=function(){if(!confirm('Remove "'+o.name+'" from your collection?'))return;STATE.ownedRemoved=STATE.ownedRemoved||[];if(STATE.ownedRemoved.indexOf(id)<0)STATE.ownedRemoved.push(id);changed();render();};
}
function parseMechs(s){return (s||'').split(',').map(function(x){return x.trim();}).filter(Boolean);}
function openOwnedModal(prefill){
  prefill=prefill||{};
  closeModal();var ovl=document.createElement('div');ovl.className='modal-ov';ovl.id='addModal';
  var title=prefill.fromBuy?'Add to owned':'Add owned game';
  ovl.innerHTML='<div class="modal"><h3>'+title+'</h3>'
    +(prefill.fromBuy?'<div class="small muted" style="margin:-6px 0 12px">Moving “'+esc(prefill.name||'')+'” from your buy list into your collection.</div>':'')
    +'<div class="fld"><label>BoardGameGeek link (auto-fills the details)</label><div style="display:flex;gap:8px"><input id="ow_bgg" value="'+esc(prefill.bgg||'')+'" placeholder="https://boardgamegeek.com/boardgame/…" style="flex:1"/><button class="ghost" id="ow_import" style="flex:0 0 auto">Import</button></div></div>'
    +'<div class="fld" style="margin-top:12px"><label>Game name</label><input id="ow_name" value="'+esc(prefill.name||'')+'"/></div>'
    +'<div class="grid" style="margin-top:10px"><div class="fld"><label>Type</label><input id="ow_type" value="'+esc(prefill.type||'')+'" placeholder="Family / Strategy…"/></div>'+fld('Best at (players)','ow_best','','','e.g. 4 or 4,5')+fld('Min players','ow_min','','number','')+fld('Max players','ow_max','','number','')+fld('Play time (min)','ow_time','','number','')+fld('Weight (numeric)','ow_weight','','number','e.g. 2.4')+'</div>'
    +'<div class="fld" style="margin-top:10px"><label>Mechanisms (comma-separated)</label><input id="ow_mech" placeholder="Set Collection, Drafting"/></div>'
    +'<div class="small muted" style="margin-top:12px">You add these:</div>'
    +'<div class="grid" style="margin-top:6px">'+fld('Paid (₹)','ow_amt','','number','')+fld('Store','ow_store','')+fld('Country','ow_country','')+fld('Date','ow_date','','','YYYY-MM-DD')+fld('Location','ow_loc','')+'</div>'
    +'<div class="modal-actions"><button class="ghost" id="ow_cancel">Cancel</button><button class="act" id="ow_add">'+(prefill.fromBuy?'Move to owned':'Add')+'</button></div></div>';
  document.body.appendChild(ovl);ovl.onclick=function(e){if(e.target===ovl)closeModal();};document.onkeydown=function(e){if(e.key==='Escape')closeModal();};
  var ni=document.getElementById(prefill.name?'ow_amt':'ow_bgg');if(ni)ni.focus();
  document.getElementById('ow_cancel').onclick=closeModal;
  document.getElementById('ow_import').onclick=bggImport;
  document.getElementById('ow_add').onclick=function(){var nm=val('ow_name');if(!nm){alert('Enter a game name (or import from BGG first).');return;}STATE.ownedAdded=STATE.ownedAdded||[];STATE.ownedAdded.push({id:'oa'+Date.now()+Math.floor(Math.random()*1000),name:nm,amount:num(val('ow_amt')),store:val('ow_store'),country:val('ow_country'),date:val('ow_date'),type:val('ow_type'),minP:num(val('ow_min')),maxP:num(val('ow_max')),playTime:num(val('ow_time')),location:val('ow_loc'),weight:num(val('ow_weight')),bestAt:val('ow_best'),mechs:parseMechs(val('ow_mech')),bgg:val('ow_bgg')});
    if(prefill.fromBuy&&prefill.buyName){STATE.removed=STATE.removed||[];if(STATE.removed.indexOf(prefill.buyName)<0)STATE.removed.push(prefill.buyName);}
    closeModal();changed();if(prefill.fromBuy){VIEW='owned';}render();};
}
function setv(id,v){var e=document.getElementById(id);if(e&&v!=null&&(''+v)!=='')e.value=v;}
function bggBest(doc){
  var results=doc.querySelectorAll('poll[name="suggested_numplayers"] results');var list=[];
  for(var i=0;i<results.length;i++){var n=results[i].getAttribute('numplayers');var b=0;var rs=results[i].querySelectorAll('result');for(var j=0;j<rs.length;j++){if(rs[j].getAttribute('value')==='Best')b=parseInt(rs[j].getAttribute('numvotes')||'0',10);}list.push([n,b]);}
  if(!list.length)return null;var max=0;list.forEach(function(x){if(x[1]>max)max=x[1];});if(max<=0)return null;
  return list.filter(function(x){return x[1]===max;}).map(function(x){return x[0];}).join(',');
}
function bggImport(){
  var link=val('ow_bgg');var m=(link||'').match(/boardgame[a-z]*\/(\d+)/i)||(link||'').match(/(\d{3,})/);
  if(!m){alert('Paste a BoardGameGeek game link.');return;}
  var id=m[1];var btn=document.getElementById('ow_import');btn.textContent='Importing…';btn.disabled=true;
  fetch('https://boardgamegeek.com/xmlapi2/thing?id='+id+'&stats=1').then(function(r){return r.ok?r.text():Promise.reject('HTTP '+r.status);}).then(function(xml){
    var doc=new DOMParser().parseFromString(xml,'text/xml');
    var names=doc.querySelectorAll('name');var nm=null;for(var i=0;i<names.length;i++){if(names[i].getAttribute('type')==='primary'){nm=names[i].getAttribute('value');break;}}
    function av(sel){var el=doc.querySelector(sel);return el?el.getAttribute('value'):null;}
    setv('ow_name',nm);setv('ow_min',av('minplayers'));setv('ow_max',av('maxplayers'));setv('ow_time',av('maxplaytime')||av('playingtime'));
    var w=parseFloat(av('averageweight'));if(isFinite(w)&&w>0)setv('ow_weight',Math.round(w*100)/100);
    var best=bggBest(doc);if(best)setv('ow_best',best);
    var mechs=[];var ml=doc.querySelectorAll('link[type="boardgamemechanic"]');for(var k=0;k<ml.length&&k<4;k++)mechs.push(ml[k].getAttribute('value'));if(mechs.length&&!val('ow_mech'))setv('ow_mech',mechs.join(', '));
    var cat=doc.querySelector('link[type="boardgamecategory"]');if(cat&&!val('ow_type'))setv('ow_type',cat.getAttribute('value'));
    btn.textContent='Imported ✓';setTimeout(function(){btn.textContent='Import';btn.disabled=false;},1500);
  }).catch(function(e){btn.textContent='Import';btn.disabled=false;alert('Couldn’t fetch from BGG ('+e+'). BGG may be rate-limiting — try again in a moment, or fill the fields manually.');});
}
function parseCounts(s){var out=[];(s==null?'':(''+s)).replace(/\d+/g,function(m){out.push(parseInt(m,10));return m;});return out;}
function isBestAt(o,n){return parseCounts(o.bestAt).indexOf(n)>=0;}
function isPlayableAt(o,n){return o.minP!=null&&o.maxP!=null&&n>=o.minP&&n<=o.maxP;}
function byName(a,b){return nkey(a.name)<nkey(b.name)?-1:1;}
function selField(id,label,opts,cur){return '<div class="fld"><label>'+label+'</label><select id="'+id+'">'+opts.map(function(t){return '<option value="'+esc(t)+'"'+(cur===t?' selected':'')+'>'+(t==='All'?label+': all':esc(t))+'</option>';}).join('')+'</select></div>';}
function sessionGames(){return (STATE.session||[]).map(function(id){return ownedById(id);}).filter(Boolean);}
function addToSession(id){STATE.session=STATE.session||[];if(STATE.session.indexOf(id)<0){STATE.session.push(id);changed();}renderPlan();}
function rmSession(id){STATE.session=(STATE.session||[]).filter(function(x){return x!==id;});changed();renderPlan();}
function planSort(a){a.sort(function(x,y){if(plan.sort==='timeA')return (x.playTime||0)-(y.playTime||0);if(plan.sort==='timeD')return (y.playTime||0)-(x.playTime||0);return nkey(x.name)<nkey(y.name)?-1:1;});return a;}
function planTable(title,rows){
  var inS=(STATE.session||[]);
  var h='<div class="small muted" style="margin:14px 2px 4px;font-weight:600;color:var(--text)">'+title+' <span class="muted" style="font-weight:400">· '+rows.length+'</span></div>';
  h+='<div class="tbl-wrap cardify"><table><thead><tr><th>Game</th><th>Players</th><th>Best at</th><th class="opt">Type</th><th class="num">Time</th><th class="opt">Location</th><th></th></tr></thead><tbody>';
  rows.forEach(function(o){var added=inS.indexOf(o.id)>=0;h+='<tr><td>'+esc(o.name)+'</td><td data-label="Players">'+pint(o.minP)+'–'+pint(o.maxP)+'</td><td class="small muted" data-label="Best at">'+esc(o.bestAt||'')+'</td><td class="opt small muted" data-label="Type">'+esc(o.type||'')+'</td><td class="num" data-label="Time">'+(o.playTime?pint(o.playTime)+'m':'')+'</td><td class="opt small muted" data-label="Location">'+esc(o.location||'')+'</td><td data-label=""><button class="ghost mini" data-add="'+esc(o.id)+'"'+(added?' disabled':'')+'>'+(added?'✓ in session':'+ session')+'</button></td></tr>';});
  if(!rows.length)h+='<tr><td colspan="7" class="small muted">None.</td></tr>';
  h+='</tbody></table></div>';return h;
}
function wirePlan(){
  function bind(id,ev,fn){var e=document.getElementById(id);if(e)e[ev]=fn;}
  var pi=document.getElementById('pl_players');if(pi)pi.oninput=function(){plan.players=this.value;renderPlan();var e=document.getElementById('pl_players');e.focus();e.setSelectionRange(e.value.length,e.value.length);};
  var ti=document.getElementById('pl_time');if(ti)ti.oninput=function(){plan.maxTime=this.value;renderPlan();var e=document.getElementById('pl_time');e.focus();e.setSelectionRange(e.value.length,e.value.length);};
  bind('pl_loc','onchange',function(){plan.location=this.value;renderPlan();});
  bind('pl_type','onchange',function(){plan.type=this.value;renderPlan();});
  bind('pl_sort','onchange',function(){plan.sort=this.value;renderPlan();});
  bind('pl_clear','onclick',function(){if(confirm('Clear the session?')){STATE.session=[];changed();renderPlan();}});
  var ab=app.querySelectorAll('[data-add]');for(var i=0;i<ab.length;i++)ab[i].onclick=function(){addToSession(this.getAttribute('data-add'));};
  var rb=app.querySelectorAll('[data-rm]');for(var k=0;k<rb.length;k++)rb[k].onclick=function(){rmSession(this.getAttribute('data-rm'));};
}
function renderPlan(){
  if(needCollection())return;
  var list=ownedList();var locs=['All'].concat(distinct(list,'location'));var types=['All'].concat(distinct(list,'type'));
  var h='<div class="card"><h3>Plan &amp; select <span class="small muted">— build a game-night shortlist</span></h3><div class="grid">'
    +fld('Players','pl_players',plan.players,'number','e.g. 4')+fld('Max play time (min)','pl_time',plan.maxTime,'number','any')
    +selField('pl_loc','Location',locs,plan.location)+selField('pl_type','Type',types,plan.type)
    +'<div class="fld"><label>Sort</label><select id="pl_sort"><option value="name"'+(plan.sort==='name'?' selected':'')+'>Name</option><option value="timeA"'+(plan.sort==='timeA'?' selected':'')+'>Time ↑</option><option value="timeD"'+(plan.sort==='timeD'?' selected':'')+'>Time ↓</option></select></div>'
    +'</div></div>';
  var sg=sessionGames();
  if(sg.length){
    var tt=sg.reduce(function(a,o){return a+(o.playTime||0);},0);
    var lo=Math.max.apply(null,sg.map(function(o){return o.minP||1;}));var hi=Math.min.apply(null,sg.map(function(o){return o.maxP||99;}));
    h+='<div class="card"><h3 style="display:flex;align-items:center;gap:10px">Session <span class="small muted" style="font-weight:400">'+sg.length+' games'+(tt?' · ~'+tt+' min':'')+(lo<=hi?' · fits '+lo+'–'+hi+' players':'')+'</span><button class="ghost" id="pl_clear" style="margin-left:auto">Clear</button></h3>'
      +'<div class="chips-wrap">'+sg.map(function(o){return '<span class="chip sess" style="--h:'+chipHue(o.type||o.name)+'">'+esc(o.name)+(o.playTime?' · '+pint(o.playTime)+'m':'')+'<button data-rm="'+esc(o.id)+'" class="x" title="remove">×</button></span>';}).join('')+'</div></div>';
  }
  function pass(o){
    var mt=num(plan.maxTime);if(mt!=null&&o.playTime!=null&&o.playTime>mt)return false;
    if(plan.location!=='All'&&(o.location||'')!==plan.location)return false;
    if(plan.type!=='All'&&(o.type||'')!==plan.type)return false;
    return true;
  }
  var n=num(plan.players);
  if(n==null){
    h+=planTable('All owned games',planSort(list.filter(pass)));
  } else {
    var best=planSort(list.filter(function(o){return isBestAt(o,n)&&pass(o);}));
    var play=planSort(list.filter(function(o){return isPlayableAt(o,n)&&!isBestAt(o,n)&&pass(o);}));
    h+=planTable('★ Best at '+n+' players',best);
    h+=planTable('Also playable at '+n+' players',play);
  }
  app.innerHTML=h;wirePlan();
}
function renderSold(){
  if(needCollection())return;
  var rows=soldList().slice().sort(function(a,b){return (b.saleDate||'').localeCompare(a.saleDate||'');});
  var buy=rows.reduce(function(s,o){return s+(o.amount||0);},0);var sale=rows.reduce(function(s,o){return s+(o.saleAmount||0);},0);var net=sale-buy;
  var h='<div class="small muted" style="margin:4px 2px">'+rows.length+' games sold</div>';
  h+='<div class="tbl-wrap cardify"><table><thead><tr><th>Game</th><th class="num">Bought</th><th class="opt">Buy date</th><th class="opt">Store</th><th class="num">Sold</th><th class="opt">Sale date</th><th class="opt">Buyer</th><th class="num">Net</th></tr></thead><tbody>';
  rows.forEach(function(o){var nt=(o.saleAmount||0)-(o.amount||0);h+='<tr><td>'+esc(o.name)+'</td><td class="num" data-label="Bought">'+fmtINR(o.amount)+'</td><td class="opt small muted" data-label="Buy date">'+esc(o.date||'')+'</td><td class="opt small muted" data-label="Store">'+esc(o.store||'')+'</td><td class="num" data-label="Sold">'+fmtINR(o.saleAmount)+'</td><td class="opt small muted" data-label="Sale date">'+esc(o.saleDate||'')+'</td><td class="opt small muted" data-label="Buyer">'+esc(o.buyer||'')+'</td><td class="num" data-label="Net"><span class="'+(nt>=0?'pos':'neg')+'">'+(nt>=0?'+':'−')+inr(Math.abs(nt))+'</span></td></tr>';});
  h+='<tr class="tot"><td>Total</td><td class="num" data-label="Bought">'+inr(buy)+'</td><td class="opt"></td><td class="opt"></td><td class="num" data-label="Sold">'+inr(sale)+'</td><td class="opt"></td><td class="opt"></td><td class="num" data-label="Net">'+(net>=0?'+':'−')+inr(Math.abs(net))+'</td></tr>';
  h+='</tbody></table></div>';
  app.innerHTML=h;
}
function statCard(label,val){return '<div class="card stat"><div class="stat-v">'+val+'</div><div class="stat-l">'+esc(label)+'</div></div>';}
function groupSum(arr,key,vk){var m={};arr.forEach(function(o){var k=((o[key]==null?'':(''+o[key])).trim())||'?';m[k]=(m[k]||0)+(o[vk]||0);});return Object.keys(m).map(function(k){return [k,m[k]];}).sort(function(a,b){return b[1]-a[1];});}
function groupCount(arr,key){var m={};arr.forEach(function(o){var k=((o[key]==null?'':(''+o[key])).trim())||'?';m[k]=(m[k]||0)+1;});return Object.keys(m).map(function(k){return [k,m[k]];}).sort(function(a,b){return b[1]-a[1];});}
function tableCard(title,rows,money){var h='<div class="card"><h3>'+esc(title)+'</h3><div class="tbl-wrap" style="border:none;box-shadow:none;background:none"><table><tbody>';rows.forEach(function(r){h+='<tr><td>'+esc(r[0])+'</td><td class="num">'+(money?inr(r[1]):r[1])+'</td></tr>';});if(!rows.length)h+='<tr><td class="small muted">No data</td></tr>';h+='</tbody></table></div></div>';return h;}
function renderSpend(){
  if(needCollection())return;
  var owned=ownedList();var sold=soldList();
  var spentOwned=owned.reduce(function(s,o){return s+(o.amount||0);},0);
  var soldCost=sold.reduce(function(s,o){return s+(o.amount||0);},0);
  var proceeds=sold.reduce(function(s,o){return s+(o.saleAmount||0);},0);
  var net=proceeds-soldCost;
  var h='<div class="grid" style="margin-bottom:16px">'
    +statCard('Total spent (owned)',inr(spentOwned))
    +statCard('Games owned',owned.length)
    +statCard('Avg / game',inr(owned.length?spentOwned/owned.length:0))
    +statCard('Games sold',sold.length)
    +statCard('Sale proceeds',inr(proceeds))
    +statCard('Resale net',(net>=0?'+':'−')+inr(Math.abs(net)))
    +'</div>';
  var breaks={
    country:['₹ Spend by country',groupSum(owned,'country','amount'),true],
    store:['₹ Spend by store',groupSum(owned,'store','amount'),true],
    year:['₹ Spend by year',groupSum(owned.map(function(o){return {y:((o.date||'').slice(0,4)||'?'),amount:o.amount};}),'y','amount'),true],
    type:['# Owned by type',groupCount(owned,'type'),false],
    weight:['# Owned by weight',groupCount(owned.map(function(o){return {wc:weightClass(o.weight)||'?'};}),'wc'),false],
    location:['# Owned by location',groupCount(owned,'location'),false]
  };
  if(!breaks[spendBreak])spendBreak='country';
  var opts=[['country','Spend by country'],['store','Spend by store'],['year','Spend by year'],['type','Owned by type'],['weight','Owned by weight'],['location','Owned by location']];
  var b=breaks[spendBreak];
  h+='<div class="card"><h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">Breakdown <select id="sp_break" style="margin-left:auto;width:auto">'+opts.map(function(o){return '<option value="'+o[0]+'"'+(spendBreak===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></h3>';
  h+='<div class="tbl-wrap" style="border:none;box-shadow:none;background:none"><table><tbody>'+b[1].map(function(r){return '<tr><td>'+esc(r[0])+'</td><td class="num">'+(b[2]?inr(r[1]):r[1])+'</td></tr>';}).join('')+'</tbody></table></div></div>';
  app.innerHTML=h;
  document.getElementById('sp_break').onchange=function(){spendBreak=this.value;renderSpend();};
}
function renderSettings(){
  var s=STATE.sync||{};
  var h='<div class="card"><h3>Conversion rates (INR per unit)</h3><div class="grid">'+['USD','GBP','CAD','AUD','NZD'].map(function(c){return '<div class="fld"><label>'+c+'</label><input type="number" step="0.01" data-fx="'+c+'" value="'+fxRate(c)+'"/></div>';}).join('')+'</div></div>';
  h+='<div class="card"><h3>Thresholds &amp; default charges</h3><div class="grid">'
    +'<div class="fld"><label>Buy if within % of cheapest</label><input type="number" data-cfg="buyWithin" value="'+cfg('buyWithin')*100+'"/></div>'
    +'<div class="fld"><label>Maybe if within % of cheapest</label><input type="number" data-cfg="maybeWithin" value="'+cfg('maybeWithin')*100+'"/></div>'
    +'<div class="fld"><label>Default forex % (stores)</label><input type="number" data-cfg="forexPct" value="'+cfg('forexPct')*100+'"/></div>'
    +'<div class="fld"><label>Default overhead % (stores)</label><input type="number" data-cfg="overheadPct" value="'+cfg('overheadPct')*100+'"/></div>'
    +'<div class="fld"><label>Board Games India default discount %</label><input type="number" data-cfg="bgiDefaultDiscount" value="'+cfg('bgiDefaultDiscount')*100+'"/></div>'
    +'</div><div style="margin-top:8px"><button class="act" id="cfgSave">Save</button></div></div>';
  h+='<div class="card"><h3>Weight bands <span class="small muted">— numeric BGG weight → class label</span></h3><div class="grid">'
    +'<div class="fld"><label>Light — below</label><input type="number" step="0.1" data-wb="wLight" value="'+cfg('wLight')+'"/></div>'
    +'<div class="fld"><label>Light–Medium — below</label><input type="number" step="0.1" data-wb="wLightMed" value="'+cfg('wLightMed')+'"/></div>'
    +'<div class="fld"><label>Medium — below</label><input type="number" step="0.1" data-wb="wMed" value="'+cfg('wMed')+'"/></div>'
    +'<div class="fld"><label>Medium–Heavy — below</label><input type="number" step="0.1" data-wb="wMedHeavy" value="'+cfg('wMedHeavy')+'"/></div>'
    +'</div><div class="small muted" style="margin-top:6px">At or above the last cutoff = Heavy.</div><div style="margin-top:8px"><button class="act" id="wbSave">Save bands</button></div></div>';
  h+='<div class="card"><h3>Cross-device sync (GitHub)</h3><div class="small muted" style="margin-bottom:8px">Notes, added games, overrides and store baskets live in state.json in your repo. Token stays on this device.</div><div class="grid">'
    +'<div class="fld"><label>Owner</label><input id="sy_owner" value="'+esc(s.owner||'')+'"/></div><div class="fld"><label>Repo</label><input id="sy_repo" value="'+esc(s.repo||'')+'"/></div><div class="fld"><label>Branch</label><input id="sy_branch" value="'+esc(s.branch||'main')+'"/></div>'
    +'<div class="fld" style="grid-column:1/-1"><label>GitHub token (Contents: read/write)</label><input id="sy_token" type="password" value="'+esc(token())+'"/></div></div><div style="margin-top:8px"><button class="act" id="syncSave">Save &amp; push</button> <button class="ghost" id="syncPull">Pull</button> <span class="small muted" id="syncMsg"></span></div></div>';
  h+='<div class="card"><h3>Backup / reset</h3><button class="ghost" id="exp">Export</button> <button class="ghost" id="imp">Import</button><input type="file" id="impF" class="hide" accept="application/json"/> <button class="danger" id="reset" style="padding:8px 12px">Reset my edits</button></div>';
  app.innerHTML=h;
  var fxs=app.querySelectorAll('[data-fx]');for(var i=0;i<fxs.length;i++)fxs[i].onchange=function(){STATE.config=STATE.config||{};STATE.config.fx=STATE.config.fx||{};STATE.config.fx[this.getAttribute('data-fx')]=parseFloat(this.value);changed();};
  document.getElementById('cfgSave').onclick=function(){STATE.config=STATE.config||{};var cs=app.querySelectorAll('[data-cfg]');for(var i=0;i<cs.length;i++){var k=cs[i].getAttribute('data-cfg');STATE.config[k]=parseFloat(cs[i].value)/100;}changed();render();};
  var wbSave=document.getElementById('wbSave');if(wbSave)wbSave.onclick=function(){STATE.config=STATE.config||{};var ws=app.querySelectorAll('[data-wb]');for(var i=0;i<ws.length;i++){var k=ws[i].getAttribute('data-wb');var v=parseFloat(ws[i].value);if(isFinite(v))STATE.config[k]=v;}changed();render();};
  document.getElementById('syncSave').onclick=function(){STATE.sync={owner:val('sy_owner'),repo:val('sy_repo'),branch:val('sy_branch')||'main',path:'state.json'};setToken(val('sy_token'));persistLocal();pushState(true);};
  document.getElementById('syncPull').onclick=function(){STATE.sync={owner:val('sy_owner'),repo:val('sy_repo'),branch:val('sy_branch')||'main',path:'state.json'};setToken(val('sy_token'));persistLocal();pullState(true);};
  document.getElementById('exp').onclick=exportState;document.getElementById('imp').onclick=function(){document.getElementById('impF').click();};document.getElementById('impF').onchange=importState;
  document.getElementById('reset').onclick=function(){if(confirm('Reset all your edits? Scraped prices stay.')){STATE=blankState();persistLocal();render();}};
}
function changed(){persistLocal();if(syncReady()){clearTimeout(saveTimer);saveTimer=setTimeout(function(){pushState(false);},1500);setSync('warn','saving…');}}
function syncReady(){return STATE.sync&&STATE.sync.owner&&STATE.sync.repo&&token();}
function ghH(){return {'Authorization':'token '+token(),'Accept':'application/vnd.github+json'};}
function ghUrl(){var s=STATE.sync;return 'https://api.github.com/repos/'+s.owner+'/'+s.repo+'/contents/'+s.path;}
function syncBody(){var c=JSON.parse(JSON.stringify(STATE));delete c.sync;return c;}
var pushing=false, pendingPush=false;
// Single-flight push: never let two GitHub writes overlap (that causes sha conflicts and lost saves). Always flush the latest STATE last.
function pushState(manual){
  if(!syncReady()){if(manual)setMsg('Fill owner, repo and token first.');return;}
  if(pushing){pendingPush=true;return;}
  pushing=true;setSync('warn','saving…');
  fetch(ghUrl()+'?ref='+STATE.sync.branch,{headers:ghH()}).then(function(r){return r.ok?r.json():null;}).then(function(j){
    var content=btoa(unescape(encodeURIComponent(JSON.stringify(syncBody(),null,1))));
    var body={message:'Update tracker settings',content:content,branch:STATE.sync.branch};
    if(j&&j.sha)body.sha=j.sha;
    return fetch(ghUrl(),{method:'PUT',headers:ghH(),body:JSON.stringify(body)});
  }).then(function(r){if(r&&r.ok){setSync('ok','synced');setMsg('Pushed');}else{setSync('err','sync error');setMsg('Push failed');}})
  .catch(function(){setSync('err','offline');setMsg('Push error');})
  .then(function(){pushing=false;if(pendingPush){pendingPush=false;pushState(false);}});
}
function pullState(manual){if(!syncReady()){if(manual)setMsg('Fill owner, repo and token first.');return;}fetch(ghUrl()+'?ref='+STATE.sync.branch,{headers:ghH()}).then(function(r){if(!r.ok)throw r.status;return r.json();}).then(function(j){var obj=JSON.parse(decodeURIComponent(escape(atob(j.content))));var sync=STATE.sync;STATE=Object.assign(blankState(),obj);STATE.sync=sync;reconcileAdded();persistLocal();setSync('ok','synced');setMsg('Pulled');render();}).catch(function(e){if(e!==404){setMsg('Sync check failed');setSync('err','sync error');}});}
function setSync(c,t){var d=document.getElementById('syncDot'),x=document.getElementById('syncTxt');if(d)d.className='dot '+(c||'');if(x)x.textContent=t;}
function setMsg(m){var e=document.getElementById('syncMsg');if(e)e.textContent=m;}
function updateBadge(){if(syncReady())setSync('ok','sync on');else setSync('','local only');}
function exportState(){var b=new Blob([JSON.stringify(syncBody(),null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bgpt-settings.json';a.click();}
function importState(e){var f=e.target.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){try{var o=JSON.parse(rd.result);var sync=STATE.sync;STATE=Object.assign(blankState(),o);STATE.sync=sync;reconcileAdded();persistLocal();render();}catch(err){alert('Bad file');}};rd.readAsText(f);}
function repoFromUrl(){try{var h=location.hostname;var owner=(h.indexOf('.github.io')>=0)?h.split('.')[0]:'';var seg=location.pathname.split('/').filter(Boolean);var repo=seg.length?seg[0]:'';return {owner:owner,repo:repo,branch:'main'};}catch(e){return {owner:'',repo:'',branch:'main'};}}
function validateAccess(owner,repo,tok){if(!owner||!repo||!tok)return Promise.resolve(false);return fetch('https://api.github.com/repos/'+owner+'/'+repo,{headers:{'Authorization':'token '+tok,'Accept':'application/vnd.github+json'}}).then(function(r){return r.ok;}).catch(function(){return false;});}
function enterApp(){document.getElementById('nav').style.visibility='visible';if(!VIEW)VIEW='india';render();}
function showGate(msg){
  document.getElementById('nav').style.visibility='hidden';var s0=STATE.sync||{};var du=repoFromUrl();var s={owner:s0.owner||du.owner,repo:s0.repo||du.repo,branch:s0.branch||du.branch};
  app.innerHTML='<div class="card" style="max-width:460px;margin:26px auto"><h3>Connect this device</h3><div class="small muted" style="margin-bottom:10px">Owner and repo are detected from the site URL. You only need a token to sync notes across devices — or click open local-only to skip it (viewing needs no token).</div>'
    +(msg?'<div class="warn-box">'+esc(msg)+'</div>':'')
    +fld('Owner','g_owner',s.owner||'')+fld('Repo','g_repo',s.repo||'')+fld('Branch','g_branch',s.branch||'main')
    +'<div class="fld" style="margin-top:8px"><label>GitHub token</label><input id="g_token" type="password" value="'+esc(token())+'"/></div>'
    +'<div style="margin-top:10px"><button class="act" id="g_go">Connect &amp; open</button> <a href="#" id="g_skip" class="small muted" style="margin-left:12px">open local-only</a></div></div>';
  document.getElementById('g_go').onclick=function(){var owner=val('g_owner'),repo=val('g_repo'),branch=val('g_branch')||'main',tok=val('g_token');document.getElementById('g_go').textContent='Checking…';validateAccess(owner,repo,tok).then(function(ok){if(!ok){showGate('That token + repo did not validate.');return;}STATE.sync={owner:owner,repo:repo,branch:branch,path:'state.json'};setToken(tok);persistLocal();enterApp();pullState(false);});};
  document.getElementById('g_skip').onclick=function(e){e.preventDefault();enterApp();};
}
function runWorkflow(){
  if(!syncReady()){alert('Set up GitHub sync in Settings first (owner, repo and token).');return;}
  var s=STATE.sync;
  fetch('https://api.github.com/repos/'+s.owner+'/'+s.repo+'/actions/workflows/update-prices.yml/dispatches',{method:'POST',headers:ghH(),body:JSON.stringify({ref:s.branch})}).then(function(r){
    if(r.status===204){setMsg('Update started');alert('Price update started in GitHub Actions (~2 min). Refresh the page in a few minutes to see new prices.');}
    else if(r.status===403){alert('Token lacks permission — give it Actions: Read and write (in addition to Contents).');}
    else if(r.status===404){alert('Workflow not found — make sure .github/workflows/update-prices.yml is in the repo.');}
    else{alert('Could not start workflow (HTTP '+r.status+').');}
  }).catch(function(){alert('Network error starting the workflow.');});
}
function start(){
  app=document.getElementById('app');
  STATE=loadState();
  var sb=document.getElementById('saveBtn');if(sb)sb.onclick=function(){pushState(true);};
  var rb=document.getElementById('runBtn');if(rb)rb.onclick=runWorkflow;
  /* nav is built dynamically by renderNav() */
  fetch('data.json',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){DATA=d;boot();}).catch(function(){DATA={meta:{updated:'-',fx:{USD:85,GBP:117,CAD:59,AUD:55,NZD:50}},config:{buyWithin:.1,maybeWithin:.25,forexPct:.03,overheadPct:.1,delivery:0,bgiDefaultDiscount:.1},games:[]};boot();});
  function boot(){reconcileAdded();var s=STATE.sync||{};if(s.owner&&s.repo&&token()){enterApp();pullState(false);}else showGate('');}
}
start();
