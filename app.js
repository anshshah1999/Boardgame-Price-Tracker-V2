"use strict";
var LS_STATE='bgpt_state', LS_TOKEN='bgpt_token';
var COUNTRIES=['USA','UK','Canada','Australia','NZ'];
var CUR={USA:'USD',UK:'GBP',Canada:'CAD',Australia:'AUD',NZ:'NZD'};
var DATA=null, STATE=null, VIEW='india', saveTimer=null;
var flt={search:'',priceCap:'',lossCap:'',type:'All'};
var country='USA';
var sortState={india:{k:'verdictLoss',d:1},country:{k:'loss',d:1}};
var lastFocus=null;

function blankState(){return {overrides:{}, added:[], stores:[], removed:[], quickAdd:'', quickNotes:'', sync:{owner:'',repo:'',branch:'main',path:'state.json'}};}
function loadState(){try{return Object.assign(blankState(),JSON.parse(localStorage.getItem(LS_STATE)||'{}'));}catch(e){return blankState();}}
function persistLocal(){localStorage.setItem(LS_STATE,JSON.stringify(STATE));}
function token(){return localStorage.getItem(LS_TOKEN)||'';}
function setToken(t){if(t)localStorage.setItem(LS_TOKEN,t);else localStorage.removeItem(LS_TOKEN);}
function cfg(k){return (STATE.config&&k in STATE.config)?STATE.config[k]:DATA.config[k];}
function fxRate(c){if(c==='INR')return 1;return (STATE.config&&STATE.config.fx&&STATE.config.fx[c]!=null)?STATE.config.fx[c]:DATA.meta.fx[c];}
function allGames(){var rem=STATE.removed||[];return DATA.games.concat(STATE.added||[]).filter(function(g){return rem.indexOf(g.name)<0;});}
function gameByName(n){return allGames().filter(function(x){return x.name===n;})[0];}
function ov(name){return STATE.overrides[name]||{};}
function displayName(g){var o=STATE.overrides[g.name];return (o&&o.name)?o.name:g.name;}
function oos(stock){return /out of stock|unavail|sold out|see store|pre-order/i.test(stock||'')?' <span class="pill" style="color:var(--neg);border-color:var(--neg)">'+esc(stock)+'</span>':'';}
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
function sgn(amount,base,posGood){if(amount==null||!isFinite(amount))return '';var good=amount===0?null:(posGood?amount>0:amount<0);var col=good===null?'':(good?'pos':'neg');var p=(base&&base!=0)?(amount/base*100):null;return '<span class="'+col+'">'+(amount>0?'+':amount<0?'−':'')+inr(Math.abs(amount))+(p!=null?' <span class="small">('+Math.abs(p).toFixed(1)+'%)</span>':'')+'</span>';}

function indiaNet(g){var o=ov(g.name);var src=g.india&&g.india.source?g.india.source:'';var disc=(o.discount!=null?o.discount:(g.india&&g.india.discount!=null?g.india.discount:(g.discount!=null?g.discount:null)));if(disc==null)disc=/board games india/i.test(src)?cfg('bgiDefaultDiscount'):0;var ip=g.india&&g.india.price?g.india.price:null;return {net:ip!=null?ip*(1-disc):null,disc:disc,listed:ip,src:src,stock:(g.india&&g.india.stock)||''};}
function rawINR(g,c){var p=g.prices?g.prices[c]:null;return (p!=null&&p>0)?p*fxRate(CUR[c]):null;}
function cheapestCountry(g){var best=null,bc=null;COUNTRIES.forEach(function(c){var v=rawINR(g,c);if(v!=null&&(best==null||v<best)){best=v;bc=c;}});return {inr:best,c:bc};}

function computeIndia(g){
  var iv=indiaNet(g);var cc=cheapestCountry(g);
  var opts=[];if(iv.net!=null)opts.push(iv.net);if(cc.inr!=null)opts.push(cc.inr);
  var cheapest=opts.length?Math.min.apply(null,opts):null;
  var vloss=(iv.net!=null&&cheapest!=null&&cheapest>0)?(iv.net-cheapest)/cheapest:null;
  var save=(iv.net!=null&&cc.inr!=null)?iv.net-cc.inr:null;
  return {name:g.name,disp:displayName(g),type:g.type||'',net:iv.net,disc:iv.disc,listed:iv.listed,avail:iv.stock,bestC:cc.c,bestINR:cc.inr,bestStock:(cc.c&&g.stock)?(g.stock[cc.c]||''):'',importSave:save,importPct:(save!=null&&iv.net)?save/iv.net:null,verdictLoss:vloss,verdict:verdictFromLoss(vloss)};
}
function computeCountry(g,c){
  var iv=indiaNet(g);var priceLocal=g.prices?g.prices[c]:null;var priceINR=rawINR(g,c);var cc=cheapestCountry(g);
  var loss=(priceINR!=null&&cc.inr!=null&&cc.inr>0)?(priceINR-cc.inr)/cc.inr:null;
  var vsIndia=(iv.net!=null&&priceINR!=null)?iv.net-priceINR:null;
  var vals=COUNTRIES.map(function(cc2){return rawINR(g,cc2);}).filter(function(v){return v!=null;}).sort(function(a,b){return a-b;});
  var rank=(priceINR!=null)?(vals.indexOf(priceINR)+1):null;
  return {name:g.name,disp:displayName(g),type:g.type||'',local:priceLocal,priceINR:priceINR,india:iv.net,bestC:cc.c,bestINR:cc.inr,loss:loss,verdict:verdictFromLoss(loss),vsIndia:vsIndia,vsIndiaPct:(vsIndia!=null&&iv.net)?vsIndia/iv.net:null,avail:(g.stock&&g.stock[c])||'',rank:rank,rankN:(rank==null?99:rank)};
}

var app;
function render(){
  document.getElementById('updated').textContent=DATA?('data updated '+DATA.meta.updated):'';
  var b=document.querySelectorAll('#nav button');for(var i=0;i<b.length;i++)b[i].className=(b[i].getAttribute('data-v')===VIEW?'active':'');
  if(VIEW==='india')renderIndia();else if(VIEW==='country')renderCountry();else if(VIEW==='analysis')renderAnalysis();else if(VIEW==='games')renderGames();else renderSettings();
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
  h+='<div class="tbl-wrap"><table><thead>'+hdr('india',cols)+'</thead><tbody>';
  rows.forEach(function(r){h+='<tr class="game" data-n="'+esc(r.name)+'"><td>'+esc(r.disp||r.name)
    +'</td><td class="num">'+inr(r.net)+(r.disc?'<div class="small muted">'+pct(r.disc)+' off</div>':'')+'</td><td class="opt">'+(r.bestC||'')+'</td><td class="num">'+inr(r.bestINR)+oos(r.bestStock)
    +'</td><td class="num">'+sgn(r.importSave,r.net,true)+'</td><td class="num">'+(r.verdictLoss==null?'':sgn(r.verdictLoss*(r.net||0),r.net,false))+'</td><td><span class="verdict '+vclass(r.verdict)+'">'+r.verdict+'</span></td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;wireFilters(renderIndia);wireHdr('india',renderIndia);
  var gr=app.querySelectorAll('tr.game');for(var i=0;i<gr.length;i++)gr[i].onclick=function(){editRow(this,this.getAttribute('data-n'));};
}
function editRow(tr,name){
  var nx=tr.nextElementSibling;if(nx&&nx.className.indexOf('expand')>=0){nx.parentNode.removeChild(nx);return;}
  var o=ov(name);var r=computeIndia(gameByName(name));var row=document.createElement('tr');row.className='expand';
  row.innerHTML='<td colspan="7"><div class="grid">'
    +fld('India discount % (blank=auto)','ed_disc',o.discount!=null?o.discount*100:'','number','auto')
    +'<div class="fld" style="grid-column:1/-1"><label>Notes</label><textarea id="ed_notes" rows="2">'+esc(o.notes||'')+'</textarea></div></div>'
    +'<div class="small muted" style="margin-top:8px">India listed '+inr(r.listed)+' '+(r.avail?'· '+esc(r.avail):'')+' · net '+inr(r.net)+' | Best '+inr(r.bestINR)+' '+(r.bestC||'')+'</div>'
    +'<div style="margin-top:8px"><button class="act" id="ed_save">Save</button> <button class="ghost" id="ed_clear">Clear</button></div></td>';
  if(tr.nextSibling)tr.parentNode.insertBefore(row,tr.nextSibling);else tr.parentNode.appendChild(row);
  document.getElementById('ed_save').onclick=function(){var no=Object.assign({},o);var d=num(val('ed_disc'));no.discount=(d!=null?d/100:undefined);var nt=val('ed_notes');no.notes=nt||undefined;STATE.overrides[name]=clean(no);changed();render();};
  document.getElementById('ed_clear').onclick=function(){delete STATE.overrides[name];changed();render();};
}
function clean(o){var r={};for(var k in o)if(o[k]!==undefined&&o[k]!=='')r[k]=o[k];return r;}
function fld(label,id,value,type,ph){return '<div class="fld"><label>'+label+'</label><input type="'+(type||'text')+'" id="'+id+'" value="'+esc(value)+'" placeholder="'+esc(ph||'')+'"/></div>';}

function renderCountry(){
  var rows=allGames().map(function(g){return computeCountry(g,country);}).filter(function(r){return r.priceINR!=null&&passFilters(r,r.priceINR,r.loss);});
  sortRows(rows,sortState.country);
  var cols=[['name','Game',''],['local','Price ('+CUR[country]+')','num'],['priceINR','Price (INR)','num'],['rankN','Rank here',''],['india','India (net)','num opt'],['bestC','Best','opt'],['bestINR','Best (INR)','num opt'],['vsIndia','vs India','num'],['loss','vs cheapest','num'],['verdict','Verdict','']];
  var extra='<label class="chk">Country <select id="cc">'+COUNTRIES.map(function(c){return '<option '+(c===country?'selected':'')+'>'+c+'</option>';}).join('')+'</select></label>';
  var h=filterBar(extra)+'<div class="small muted" style="margin-bottom:6px">'+rows.length+' games available in '+country+'</div>';
  h+='<div class="tbl-wrap"><table><thead>'+hdr('country',cols)+'</thead><tbody>';
  rows.forEach(function(r){h+='<tr><td>'+esc(r.disp||r.name)+'</td><td class="num">'+loc(r.local)+'</td><td class="num">'+inr(r.priceINR)+oos(r.avail)+'</td><td>'+ordinal(r.rank)+'</td><td class="num opt">'+inr(r.india)
    +'</td><td class="opt">'+(r.bestC||'')+'</td><td class="num opt">'+inr(r.bestINR)+'</td><td class="num">'+sgn(r.vsIndia,r.india,true)+'</td><td class="num">'+sgn(r.loss!=null?r.loss*(r.bestINR||0):null,r.bestINR,false)+'</td><td><span class="verdict '+vclass(r.verdict)+'">'+r.verdict+'</span></td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;
  document.getElementById('cc').onchange=function(e){country=e.target.value;renderCountry();};
  wireFilters(renderCountry);wireHdr('country',renderCountry);
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

function renderGames(){
  var h='<div class="card"><h3>Quick notes <span class="small muted">— jot anything; does not touch the list</span></h3><textarea id="qn" rows="4" style="width:100%" placeholder="that cat trick-taking game… / check BGG hotness / ask friend about Ark Nova">'+esc(STATE.quickNotes||'')+'</textarea><div style="margin-top:8px"><button class="act" id="qnSave">Save notes</button></div></div>';
  h+='<div class="card"><h3>Add a game</h3><div class="grid"><div class="fld"><label>Game name</label><input id="ng_name" placeholder="Ark Nova"/></div><div class="fld" style="grid-column:1/-1"><label>Board Game Oracle link or ID (optional)</label><input id="ng_bgo" placeholder="paste the .../boardgame/price/... link, or the ID"/></div></div><div style="margin-top:8px"><button class="act" id="ng_add">Add game</button></div></div>';
  var rows=allGames();
  h+='<div class="small muted" style="margin:4px 2px">'+rows.length+' games</div><div class="tbl-wrap"><table><thead><tr><th>Game</th><th>Type</th><th class="opt">BGO ID</th><th></th></tr></thead><tbody>';
  rows.forEach(function(g){var o=ov(g.name);var ai=STATE.added.indexOf(g);var added=ai>=0;var renamed=(o.name&&o.name!==g.name);var gid=(o.bgoId||g.bgoId)||'';h+='<tr><td><input data-gname="'+esc(g.name)+'"'+(added?' data-added="'+ai+'"':'')+' value="'+esc(displayName(g))+'" style="min-width:150px"/>'+(renamed?'<div class="small muted">was: '+esc(g.name)+'</div>':'')+'</td><td class="small muted">'+(g.type||'')+'</td><td class="opt small muted">'+esc(gid)+'</td><td><button class="ghost" data-del="'+esc(g.name)+'"'+(added?' data-added="'+ai+'"':'')+'>delete</button></td></tr>';});
  h+='</tbody></table></div>';
  app.innerHTML=h;
  document.getElementById('qnSave').onclick=function(){STATE.quickNotes=val('qn');changed();};
  document.getElementById('ng_add').onclick=function(){var nm=val('ng_name');if(!nm){alert('Enter a game name.');return;}var raw=val('ng_bgo');var id='';if(raw){var m=raw.match(/\/boardgame\/price\/([A-Za-z0-9_-]{6,})/);id=m?m[1]:raw;}STATE.added.push({name:nm,type:'Boardgame',bgoId:id,india:null,prices:{},stock:{},status:'Not Started'});changed();render();};
  var ed=app.querySelectorAll('[data-gname]');for(var i=0;i<ed.length;i++)ed[i].onchange=function(){
    var orig=this.getAttribute('data-gname');var ai2=this.getAttribute('data-added');var nv=this.value.trim();
    if(ai2!=null){if(nv)STATE.added[+ai2].name=nv;}else{STATE.overrides[orig]=STATE.overrides[orig]||{};if(nv&&nv!==orig)STATE.overrides[orig].name=nv;else delete STATE.overrides[orig].name;}
    var link=prompt('Optional — paste the Board Game Oracle link for this game to set its scrape ID (leave blank to skip):','');
    if(link){var m=link.match(/\/boardgame\/price\/([A-Za-z0-9_-]{6,})/);if(m){if(ai2!=null){STATE.added[+ai2].bgoId=m[1];}else{STATE.overrides[orig]=STATE.overrides[orig]||{};STATE.overrides[orig].bgoId=m[1];}alert('Set BGO ID: '+m[1]);}else{alert('Could not find an ID in that link — expected .../boardgame/price/<ID>/...');}}
    changed();render();};
  var rm=app.querySelectorAll('[data-del]');for(var j=0;j<rm.length;j++)rm[j].onclick=function(){var nm=this.getAttribute('data-del');var ai3=this.getAttribute('data-added');if(!confirm('Delete "'+nm+'" from the list?'))return;if(ai3!=null){STATE.added.splice(+ai3,1);}else{STATE.removed=STATE.removed||[];if(STATE.removed.indexOf(nm)<0)STATE.removed.push(nm);}changed();render();};
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
  h+='<div class="card"><h3>Cross-device sync (GitHub)</h3><div class="small muted" style="margin-bottom:8px">Notes, added games, overrides and store baskets live in state.json in your repo. Token stays on this device.</div><div class="grid">'
    +'<div class="fld"><label>Owner</label><input id="sy_owner" value="'+esc(s.owner||'')+'"/></div><div class="fld"><label>Repo</label><input id="sy_repo" value="'+esc(s.repo||'')+'"/></div><div class="fld"><label>Branch</label><input id="sy_branch" value="'+esc(s.branch||'main')+'"/></div>'
    +'<div class="fld" style="grid-column:1/-1"><label>GitHub token (Contents: read/write)</label><input id="sy_token" type="password" value="'+esc(token())+'"/></div></div><div style="margin-top:8px"><button class="act" id="syncSave">Save &amp; push</button> <button class="ghost" id="syncPull">Pull</button> <span class="small muted" id="syncMsg"></span></div></div>';
  h+='<div class="card"><h3>Backup / reset</h3><button class="ghost" id="exp">Export</button> <button class="ghost" id="imp">Import</button><input type="file" id="impF" class="hide" accept="application/json"/> <button class="danger" id="reset" style="padding:8px 12px">Reset my edits</button></div>';
  app.innerHTML=h;
  var fxs=app.querySelectorAll('[data-fx]');for(var i=0;i<fxs.length;i++)fxs[i].onchange=function(){STATE.config=STATE.config||{};STATE.config.fx=STATE.config.fx||{};STATE.config.fx[this.getAttribute('data-fx')]=parseFloat(this.value);changed();};
  document.getElementById('cfgSave').onclick=function(){STATE.config=STATE.config||{};var cs=app.querySelectorAll('[data-cfg]');for(var i=0;i<cs.length;i++){var k=cs[i].getAttribute('data-cfg');STATE.config[k]=parseFloat(cs[i].value)/100;}changed();render();};
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
function pushState(manual){if(!syncReady()){if(manual)setMsg('Fill owner, repo and token first.');return;}fetch(ghUrl()+'?ref='+STATE.sync.branch,{headers:ghH()}).then(function(r){return r.ok?r.json():null;}).then(function(j){var content=btoa(unescape(encodeURIComponent(JSON.stringify(syncBody(),null,1))));var body={message:'Update tracker settings',content:content,branch:STATE.sync.branch};if(j&&j.sha)body.sha=j.sha;return fetch(ghUrl(),{method:'PUT',headers:ghH(),body:JSON.stringify(body)});}).then(function(r){if(r&&r.ok){setSync('ok','synced');setMsg('Pushed');}else{setSync('err','sync error');setMsg('Push failed');}}).catch(function(){setSync('err','offline');setMsg('Push error');});}
function pullState(manual){if(!syncReady()){if(manual)setMsg('Fill owner, repo and token first.');return;}fetch(ghUrl()+'?ref='+STATE.sync.branch,{headers:ghH()}).then(function(r){if(!r.ok)throw r.status;return r.json();}).then(function(j){var obj=JSON.parse(decodeURIComponent(escape(atob(j.content))));var sync=STATE.sync;STATE=Object.assign(blankState(),obj);STATE.sync=sync;persistLocal();setSync('ok','synced');setMsg('Pulled');render();}).catch(function(e){if(e!==404){setMsg('Sync check failed');setSync('err','sync error');}});}
function setSync(c,t){var d=document.getElementById('syncDot'),x=document.getElementById('syncTxt');if(d)d.className='dot '+(c||'');if(x)x.textContent=t;}
function setMsg(m){var e=document.getElementById('syncMsg');if(e)e.textContent=m;}
function updateBadge(){if(syncReady())setSync('ok','sync on');else setSync('','local only');}
function exportState(){var b=new Blob([JSON.stringify(syncBody(),null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bgpt-settings.json';a.click();}
function importState(e){var f=e.target.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){try{var o=JSON.parse(rd.result);var sync=STATE.sync;STATE=Object.assign(blankState(),o);STATE.sync=sync;persistLocal();render();}catch(err){alert('Bad file');}};rd.readAsText(f);}
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
  var navBtns=document.querySelectorAll('#nav button');for(var bb=0;bb<navBtns.length;bb++)navBtns[bb].onclick=function(){VIEW=this.getAttribute('data-v');render();};
  fetch('data.json',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){DATA=d;boot();}).catch(function(){DATA={meta:{updated:'-',fx:{USD:85,GBP:117,CAD:59,AUD:55,NZD:50}},config:{buyWithin:.1,maybeWithin:.25,forexPct:.03,overheadPct:.1,delivery:0,bgiDefaultDiscount:.1},games:[]};boot();});
  function boot(){var s=STATE.sync||{};if(s.owner&&s.repo&&token()){enterApp();pullState(false);}else showGate('');}
}
start();
