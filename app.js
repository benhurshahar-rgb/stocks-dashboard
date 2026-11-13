(function(){
"use strict";
var OWNER="benhurshahar-rgb", REPO="stocks-dashboard", WF="update.yml";
var API="https://api.github.com/repos/"+OWNER+"/"+REPO;
var ORDER=["1d","1w","1m","ytd","1y","3y"];
var LABEL={"1d":"יום","1w":"שבוע","1m":"חודש","ytd":"מתחילת השנה","1y":"שנה","3y":"3 שנים"};
var PALETTE=["#3b82f6","#06b6d4","#8b5cf6","#f97316","#eab308","#ec4899","#0f766e","#6366f1","#a16207","#84cc16","#ef4444","#64748b"];

/* ---------- storage (this device only) ---------- */
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} }
var token=lsGet("gh-token")||"";
var UI={ period: lsGet("period")||"1y", fxOn: lsGet("fxOn")!=="0" };

var CFG=null, D=null, cfgSha=null, S=null;
var app=document.getElementById("app");
var busy="", pollTimer=null;

/* ---------- formatting ---------- */
function ils(v){ return v==null?"—":"₪"+Math.round(v).toLocaleString("he-IL"); }
function ilsShort(v){ if(v==null) return "—"; var a=Math.abs(v), s=v<0?"-":""; if(a>=1e6) return s+"₪"+(a/1e6).toFixed(2)+" מ׳"; if(a>=1e3) return s+"₪"+Math.round(a/1e3).toLocaleString("he-IL")+" א׳"; return s+"₪"+Math.round(a); }
function pct(x){ return x==null?"—":"⁦"+(x>0?"+":"")+(x*100).toFixed(2)+"%⁩"; }
function cls(x){ return x==null?"na":(x>=0?"up":"down"); }
function fmtDate(d){ if(!d) return "—"; var p=d.split("-"); return p[2]+"."+p[1]+"."+p[0]; }
function days(a,b){ return Math.round((Date.parse(b)-Date.parse(a))/864e5); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }
function ago(iso){ var m=Math.round((Date.now()-Date.parse(iso))/6e4); if(m<1) return "עכשיו"; if(m<60) return "לפני "+m+" דק׳"; var h=Math.round(m/60); if(h<24) return "לפני "+h+" שע׳"; return "לפני "+Math.round(h/24)+" ימים"; }
function hm(iso){ try{ return new Date(iso).toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jerusalem"}); }catch(e){ return ""; } }

/* ---------- GitHub I/O ---------- */
function b64(str){ return btoa(unescape(encodeURIComponent(str))); }
function unb64(s){ return decodeURIComponent(escape(atob(s.replace(/\n/g,"")))); }
function gh(path,opt){
  opt=opt||{}; var h={"Accept":"application/vnd.github+json"};
  if(token) h.Authorization="Bearer "+token;
  if(opt.body) h["Content-Type"]="application/json";
  return fetch(API+path,{method:opt.method||"GET",headers:h,body:opt.body?JSON.stringify(opt.body):undefined,cache:"no-store"});
}
function loadFile(name){
  // 1) GitHub API (fresh), 2) raw, 3) the copy served with this page
  return gh("/contents/"+name+"?ref=main").then(function(r){
    if(!r.ok) throw new Error("api "+r.status);
    return r.json().then(function(j){ return {sha:j.sha, json:JSON.parse(unb64(j.content))}; });
  }).catch(function(){
    return fetch("https://raw.githubusercontent.com/"+OWNER+"/"+REPO+"/main/"+name+"?t="+Date.now(),{cache:"no-store"})
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .catch(function(){ return fetch(name+"?t="+Date.now(),{cache:"no-store"}).then(function(r){ if(!r.ok) throw 0; return r.json(); }); })
      .then(function(j){ return {sha:null,json:j}; });
  });
}
function loadData(){ return loadFile("data.json").then(function(x){ D=x.json; }); }
function loadAll(){
  return Promise.all([loadFile("config.json"),loadData()]).then(function(res){
    CFG=res[0].json; cfgSha=res[0].sha;
    var local=lsGet("cfg-local");
    if(local){ try{ var l=JSON.parse(local); if(l&&l.assets) CFG=l; }catch(e){} }
  });
}
function saveConfig(){
  var text=JSON.stringify(CFG,null,1)+"\n";
  if(!token){ lsSet("cfg-local",text); status("נשמר רק במכשיר הזה. חבר את GitHub (למטה) כדי לשמור לכל המכשירים ולמשוך מחירים למניה חדשה.","warn"); build(); render(); return; }
  status("שומר…","busy");
  var getSha=cfgSha?Promise.resolve(cfgSha):gh("/contents/config.json?ref=main").then(function(r){return r.json();}).then(function(j){return j.sha;});
  getSha.then(function(sha){
    return gh("/contents/config.json",{method:"PUT",body:{message:"עדכון רשימת הנכסים מהדשבורד",content:b64(text),sha:sha,branch:"main"}});
  }).then(function(r){
    if(!r.ok) return r.json().then(function(j){ throw new Error(j.message||r.status); });
    return r.json().then(function(j){ cfgSha=j.content.sha; lsSet("cfg-local",null); status("נשמר. המחירים מתעדכנים, זה לוקח כ-2 דקות.","busy"); waitForData(); });
  }).catch(function(e){ lsSet("cfg-local",text); status("השמירה ב-GitHub נכשלה ("+e.message+"). השינוי נשמר במכשיר הזה. בדוק את הטוקן בהגדרות.","warn"); });
  build(); render();
}
function refreshNow(){
  if(!token){ window.open("https://github.com/"+OWNER+"/"+REPO+"/actions/workflows/"+WF,"_blank"); return; }
  status("מבקש עדכון מחירים…","busy");
  gh("/actions/workflows/"+WF+"/dispatches",{method:"POST",body:{ref:"main"}}).then(function(r){
    if(r.status===204){ status("העדכון התחיל. המחירים יופיעו תוך כ-2 דקות.","busy"); waitForData(); }
    else return r.json().then(function(j){ throw new Error(j.message||r.status); });
  }).catch(function(e){ status("לא הצלחתי להפעיל עדכון ("+e.message+"). בדוק את הטוקן בהגדרות.","warn"); });
}
function waitForData(){
  var before=D&&D.updatedAt, n=0; clearInterval(pollTimer);
  pollTimer=setInterval(function(){
    n++; loadData().then(function(){
      if(D.updatedAt!==before){ clearInterval(pollTimer); status("המחירים עודכנו ✓","ok"); build(); render(); }
      else if(n>=24){ clearInterval(pollTimer); status("העדכון לוקח יותר מהרגיל. אפשר לבדוק בלשונית Actions ב-GitHub.","warn"); }
    }).catch(function(){});
  },15000);
}
var stMsg="", stCls="";
function status(t,c){ stMsg=t; stCls=c||""; var el=document.getElementById("st"); if(el){ el.className="st "+stCls; el.textContent=t; el.hidden=!t; } }

/* ---------- model ---------- */
function build(){
  S={ amount:+CFG.amount||3700000, asOf:D.asOf, periods:D.periods, fx:D.fx||{}, fxOn:UI.fxOn, period:UI.period,
      assets:CFG.assets.map(function(a){ var x={}; for(var k in a) x[k]=a[k];
        if(a.type==="stock"){ x.currency=/\.TA$/i.test(a.ticker||"")?"ILS":"USD"; x.prices=(D.prices||{})[a.ticker]||null; x.series=(D.series||{})[a.ticker]||null; }
        return x; }) };
}
function members(){ return S.assets.filter(function(x){ return x.type==="stock" && !x.index; }); }
function value(a,p){
  if(a.type==="portfolio"){ var vs=members().map(function(m){return value(m,p);}).filter(function(v){return v!=null;}); if(!vs.length) return null; return vs.reduce(function(x,y){return x+y;},0)/vs.length; }
  if(a.type==="deposit"){
    // A deposit with a start date is the real one: the amount until it starts, then interest net of 15% tax.
    if(a.start) return S.amount*Math.pow(1+(+a.rate||0)*0.85/100,Math.max(0,days(a.start,S.asOf))/365);
    var d=days(S.periods[p],S.asOf); return S.amount*Math.pow(1+(+a.rate||0)/100,d/365); }
  var p0=a.prices&&+a.prices[p], p1=a.prices&&+a.prices.now;
  if(!p0||!p1) return null;
  var f=1; if(S.fxOn && a.currency==="USD" && S.fx[p] && S.fx.now) f=S.fx.now/S.fx[p];
  return S.amount*(p1/p0)*f;
}
function ret(a,p){ var v=value(a,p); return v==null?null:v/S.amount-1; }
function sparkPts(a,P){
  var start=S.periods[P==="1d"?"1w":P], pts=[];
  if(a.type==="portfolio"){
    var ms=members().map(function(m){ var q=sparkPts(m,P); return q.length?q:null; }).filter(Boolean);
    if(!ms.length) return [];
    var ref=ms.slice().sort(function(x,y){return y.length-x.length;})[0];
    return ref.map(function(r){ var t=r[0], sum=0;
      ms.forEach(function(q){ var v=q[0][1]; for(var i=0;i<q.length&&q[i][0]<=t;i++) v=q[i][1]; sum+=v/q[0][1]; });
      return [t,sum/ms.length]; });
  }
  if(a.type==="deposit"){
    var n=24, d0=Date.parse(start), d1=Date.parse(S.asOf);
    for(var i=0;i<=n;i++){ var t=d0+(d1-d0)*i/n; pts.push([t, Math.pow(1+(+a.rate||0)/100,(t-d0)/864e5/365)]); }
    return pts;
  }
  if(a.series) a.series.forEach(function(r){ if(r[0]>=start && r[0]<=S.asOf) pts.push([Date.parse(r[0]),+r[1]]); });
  if(pts.length && a.prices && a.prices.now) pts[pts.length-1]=[pts[pts.length-1][0],+a.prices.now];
  return pts;
}
var gid=0;
function spark(a,P){
  var pts=sparkPts(a,P); if(pts.length<2) return '<svg class="spark" viewBox="0 0 160 52"></svg>';
  var W=160,H=52,pad=4, x0=pts[0][0], x1=pts[pts.length-1][0], ys=pts.map(function(q){return q[1];});
  var lo=Math.min.apply(null,ys), hi=Math.max.apply(null,ys); if(hi===lo){hi+=1;lo-=1;}
  function X(t){ return x1===x0?0:(t-x0)/(x1-x0)*W; } function Y(v){ return pad+(hi-v)/(hi-lo)*(H-2*pad); }
  var up=ys[ys.length-1]>=ys[0], col=up?"var(--up)":"var(--down)", id="g"+(gid++);
  var line=pts.map(function(q,i){return (i?"L":"M")+X(q[0]).toFixed(1)+","+Y(q[1]).toFixed(1);}).join("");
  var base=Y(ys[0]).toFixed(1), lx=X(x1).toFixed(1), ly=Y(ys[ys.length-1]).toFixed(1);
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="גרף">'+
    '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+col+'" stop-opacity=".28"/><stop offset="1" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'+
    '<line x1="0" x2="'+W+'" y1="'+base+'" y2="'+base+'" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" opacity=".6" vector-effect="non-scaling-stroke"/>'+
    '<path d="'+line+'L'+lx+','+H+'L0,'+H+'Z" fill="url(#'+id+')"/>'+
    '<path d="'+line+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+
    '<circle cx="'+lx+'" cy="'+ly+'" r="3" fill="'+col+'"/></svg>';
}
function sorted(){ return S.assets.slice().sort(function(x,y){ var a=value(x,S.period), b=value(y,S.period); if(a==null) return 1; if(b==null) return -1; return b-a; }); }

/* ---------- update card ---------- */
function expectedClose(){
  try{
    var f=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
    var p={}; f.formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
    var d=new Date(Date.UTC(+p.year,+p.month-1,+p.day)), h=+p.hour%24, m=+p.minute, wd=d.getUTCDay();
    if(!(wd>=1&&wd<=5&&(h>16||(h===16&&m>=45)))){ do{ d=new Date(d.getTime()-864e5); }while(d.getUTCDay()===0||d.getUTCDay()===6); }
    return d.toISOString().slice(0,10);
  }catch(e){ return null; }
}
function updCard(){
  var exp=expectedClose(), stale=exp && S.asOf<exp && !D.marketOpen;
  var btn='<button class="btn" type="button" id="refresh">🔄 עדכן עכשיו</button>';
  var when=D.marketOpen?'<b>🟢 המסחר פתוח · מחירים חיים, עודכנו '+ago(D.updatedAt)+' ('+hm(D.updatedAt)+')</b><small>מתעדכן אוטומטית כל חצי שעה בזמן המסחר בארה"ב.</small>'
    :'<b>✓ מעודכן לסגירת המסחר של '+fmtDate(S.asOf)+'</b><small>עודכן '+ago(D.updatedAt)+'. בזמן המסחר בארה"ב (16:30 עד 23:00 שעון ישראל) המחירים מתעדכנים כל חצי שעה.</small>';
  if(stale) when='<b>⚠ חסרה הסגירה של '+fmtDate(exp)+' (הנתונים מ-'+fmtDate(S.asOf)+')</b><small>'+(token?'לחץ "עדכן עכשיו".':'לחץ "עדכן עכשיו". בעמוד שייפתח ב-GitHub לחץ Run workflow ואז שוב Run workflow.')+' בחג בארה"ב אין סגירה חדשה.</small>';
  return '<div class="upd '+(stale?'stale':'ok')+'" role="status"><div class="t">'+when+'</div>'+btn+'</div>'+
    '<div class="st '+stCls+'" id="st" role="status"'+(stMsg?'':' hidden')+'>'+esc(stMsg)+'</div>';
}

/* ---------- render ---------- */
function tile(c,k,name,v){ var r=v==null?null:v/S.amount-1;
  return '<div class="tile" style="--c:'+esc(c)+'"><span class="k">'+k+'</span><span class="v num">'+ils(v)+'</span><span class="pl num '+cls(r)+'">'+(r==null?"—":(r>=0?"▲ ":"▼ ")+"⁦"+(r>=0?"+":"-")+ils(Math.abs(v-S.amount))+"⁩ · "+pct(r))+'</span><span class="s">'+esc(name)+'</span></div>'; }
function render(){
  var prev={}; document.querySelectorAll(".row[data-id]").forEach(function(el){ prev[el.dataset.id]=el.getBoundingClientRect().top; });
  var list=sorted(), P=S.period;
  var vals=list.map(function(a){return value(a,P);}).filter(function(v){return v!=null;});
  var max=Math.max.apply(null,vals.concat([S.amount]))*1.04;
  var dep=list.filter(function(a){return a.type==="deposit";})[0], depV=dep?value(dep,P):null;
  var withV=list.filter(function(a){return value(a,P)!=null;}), lead=withV[0], last=withV[withV.length-1];
  var beat=dep?list.filter(function(a){return a.type==="stock" && !a.index && value(a,P)!=null && value(a,P)>depV;}).length:0;
  var h='<a href="hon/" style="display:inline-block;margin-bottom:12px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;padding:9px 16px;border-radius:999px;text-decoration:none">→ חזרה להון עצמי</a><div class="top"><div><h1>חסכונות</h1>';
  h+='<div class="sub">'+ils(S.amount)+' בכל אפיק · נכון ל-'+fmtDate(S.asOf)+' · דולר/שקל '+(S.fx.now?S.fx.now.toFixed(3):"—")+'</div></div>'+
    '<button class="btn '+(token?'ghost':'')+'" type="button" id="gotoGh">⚙️ '+(token?'מחובר ל-GitHub ✓':'חיבור ל-GitHub')+'</button></div>';
  h+=updCard();
  h+='<div class="tiles">';
  if(lead) h+=tile(lead.color,"🥇 מוביל ב"+LABEL[P],lead.name,value(lead,P));
  if(last && last!==lead) h+=tile(last.color,"במקום האחרון",last.name,value(last,P));
  if(dep) h+=tile(dep.color,"פיקדון "+(+dep.rate).toFixed(2)+"% (רף השוואה)",dep.name,depV);
  if(dep) h+='<div class="tile" style="--c:var(--accent)"><span class="k">כמה מניות ניצחו את הפיקדון</span><span class="v num">'+beat+' מתוך '+members().length+'</span><span class="s">בתקופה: '+LABEL[P]+' (מאז '+fmtDate(S.periods[P])+')</span></div>';
  h+='</div>';
  h+='<div class="panel controls"><div class="seg" role="group" aria-label="תקופה">';
  ORDER.forEach(function(p){ h+='<button type="button" data-period="'+p+'" aria-pressed="'+(p===P)+'">'+LABEL[p]+'</button>'; });
  h+='</div><div class="ctrl-row"><label class="sw" for="fx"><input type="checkbox" id="fx" '+(S.fxOn?"checked":"")+'> כולל השפעת שער הדולר</label>';
  h+='<label class="amount" for="amt">סכום לכל אפיק ₪ <input id="amt" class="num" inputmode="numeric" value="'+S.amount.toLocaleString("en-US")+'"></label>';
  h+='<button class="btn" type="button" id="add">+ הוסף מניה / פיקדון</button></div></div>';
  h+='<div class="board">';
  list.forEach(function(a,i){
    var v=value(a,P), r=ret(a,P), w=v==null?0:Math.max(1,v/max*100), mk=S.amount/max*100;
    var sub=a.type==="portfolio"?members().length+" מניות · "+ilsShort(S.amount/Math.max(1,members().length))+" לכל מניה"
      :a.type==="deposit"?"פיקדון · "+(+a.rate).toFixed(2)+"% לשנה"
      :esc(a.ticker)+" · "+(a.prices?(a.currency==="USD"?"$":"₪")+(+a.prices.now).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"ממתין לנתונים");
    h+='<div class="row'+(i===0&&v!=null?' first':'')+(a.type==="portfolio"?' port':'')+'" data-id="'+esc(a.id)+'" style="--c:'+esc(a.color)+'">';
    h+='<div class="rank">'+(v==null?"–":i+1)+'</div><div class="name"><b>'+esc(a.name)+'</b><small>'+sub+'</small></div>';
    h+='<div class="spk">'+spark(a,P)+'<small>'+(a.type==="deposit"?"צמיחת הפיקדון":a.type==="portfolio"?"שווי התיק בדולר":"מחיר ב-$")+' · '+(P==="1d"?"שבוע אחרון":LABEL[P])+'</small></div>';
    h+='<div class="mid"><div class="barwrap"><div class="bar" style="width:'+w.toFixed(2)+'%"></div><div class="mark" style="inset-inline-start:'+mk.toFixed(2)+'%"></div></div><div class="chips">';
    ORDER.forEach(function(p){ var x=ret(a,p); h+='<span class="chip '+cls(x)+(p===P?' sel':'')+'">'+LABEL[p]+' '+pct(x)+'</span>'; });
    h+='</div></div>';
    h+='<div class="val"><div class="big num">'+ils(v)+'</div><div class="pl num '+cls(r)+'">'+(r==null?(a.type==="stock"?"ממתין לנתונים, יתעדכן תוך כמה דקות":"אין נתון לתקופה"):(r>=0?"▲ ":"▼ ")+"⁦"+(r>=0?"+":"-")+ils(Math.abs(v-S.amount))+"⁩ · "+pct(r))+'</div></div>';
    h+='<div class="acts">'+(a.type==="portfolio"?'':'<button class="icon" type="button" data-edit="'+esc(a.id)+'" aria-label="ערוך '+esc(a.name)+'">✎</button>')+'<button class="icon del" type="button" data-del="'+esc(a.id)+'" aria-label="מחק '+esc(a.name)+'">🗑</button></div></div>';
  });
  h+='</div>';
  h+='<div class="panel"><h2>כל התקופות במבט אחד</h2><div class="sub">שווי ההשקעה היום ותשואה, לפי מועד הכניסה. ירוק רווח, אדום הפסד.</div><div class="tblwrap"><table><thead><tr><th class="l">אפיק</th>';
  ORDER.forEach(function(p){ h+='<th class="'+(p===P?'colsel':'')+'">'+LABEL[p]+'<br><span style="font-weight:400">מאז '+fmtDate(S.periods[p])+'</span></th>'; });
  h+='</tr></thead><tbody>';
  list.forEach(function(a){
    h+='<tr><td class="l"><i style="background:'+esc(a.color)+'"></i>'+esc(a.name)+'</td>';
    ORDER.forEach(function(p){ var x=ret(a,p), v=value(a,p);
      var t=x==null?0:Math.min(1,Math.abs(x)/(p==="3y"?2.5:p==="1y"||p==="ytd"?0.6:p==="1m"?0.15:0.06));
      var bg=x==null?"var(--bg)":"color-mix(in srgb,"+(x>=0?"var(--up)":"var(--down)")+" "+Math.round(8+t*34)+"%,transparent)";
      h+='<td class="'+(p===P?'colsel':'')+'" style="background:'+bg+'"><span class="p '+cls(x)+'">'+pct(x)+'</span><span class="m">'+ilsShort(v)+'</span></td>'; });
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';
  h+='<details class="panel gh" id="ghp"'+(token?'':'')+'><summary>⚙️ חיבור ל-GitHub '+(token?'<span class="pill ok">מחובר</span>':'<span class="pill">לא מחובר</span>')+'</summary>';
  h+='<p class="note">החיבור מאפשר לכפתורים לשמור שינויים לכל המכשירים ולהפעיל עדכון מחירים בלחיצה. בלי חיבור הדשבורד עדיין מתעדכן לבד, אבל שינויים נשמרים רק במכשיר הזה. הטוקן נשמר רק בדפדפן הזה.</p>';
  h+='<ol class="note"><li>היכנס ל-<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li><li>Token name: <b>stocks-dashboard</b>, Expiration: עד שנה</li><li>Repository access: <b>Only select repositories</b> ← בחר <b>stocks-dashboard</b></li><li>Permissions ← Repository: <b>Contents: Read and write</b> וגם <b>Actions: Read and write</b></li><li>Generate token, העתק והדבק כאן:</li></ol>';
  h+='<div class="ctrl-row"><input id="tok" type="password" dir="ltr" placeholder="github_pat_…" value="" autocomplete="off" style="flex:1;min-width:200px"><button class="btn" type="button" id="tokSave">שמור</button>'+(token?'<button class="btn ghost" type="button" id="tokDel">נתק</button>':'')+'</div></details>';
  h+='<div class="foot note"><div>החישוב: אילו הושקעו '+ils(S.amount)+' בתחילת כל תקופה, כמה הם שווים היום. מניות לפי מחיר (בלי דיבידנדים ועמלות)'+(S.fxOn?', כולל שינוי שער הדולר מול השקל':', בלי השפעת שער הדולר')+'. הפיקדון בריבית דריבית שנתית, לפני מס. התיק שווה המשקל מחלק את הסכום שווה בשווה בין כל המניות (בלי ה-S&P 500 ובלי פיקדונות) ומחזיק בלי איזון. ה-S&P 500 מוצג דרך קרן SPY. "מתחילת השנה" נמדד מסגירת 31.12.</div>';
  h+='<div>מקור הנתונים: Yahoo Finance, נמשך אוטומטית ב-GitHub Actions. אין לראות בזה ייעוץ השקעות.</div></div>';
  app.innerHTML='<div class="wrap">'+h+'</div>'+modalHTML();
  bind();
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!reduce) document.querySelectorAll(".row[data-id]").forEach(function(el){
    var old=prev[el.dataset.id]; if(old==null) return; var dy=old-el.getBoundingClientRect().top; if(!dy) return;
    el.style.transition="none"; el.style.transform="translateY("+dy+"px)";
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.style.transition="transform .6s cubic-bezier(.2,.8,.2,1)"; el.style.transform=""; }); });
  });
}

/* ---------- modal ---------- */
var editing=null, delId=null;
function modalHTML(){
  var h='<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">אפיק</h2><form id="frm" class="fgrid" novalidate>';
  h+='<label class="f" for="f-type">סוג<select id="f-type"><option value="stock">מניה / קרן</option><option value="deposit">פיקדון</option></select></label>';
  h+='<label class="f" for="f-name">שם<input id="f-name" required></label>';
  h+='<label class="f st full" for="f-ticker">סימול בבורסה<input id="f-ticker" dir="ltr" placeholder="למשל NFLX, או TEVA.TA לבורסה בתל אביב"></label>';
  h+='<label class="f dp full" for="f-rate">ריבית שנתית מובטחת (%)<input id="f-rate" inputmode="decimal" dir="ltr"></label>';
  h+='<div class="f full">צבע<div class="swatches" id="sw">';
  PALETTE.forEach(function(c){ h+='<button type="button" data-c="'+c+'" style="background:'+c+'" aria-label="צבע '+c+'" aria-pressed="false"></button>'; });
  h+='</div></div><div class="note full st">את המחירים הדשבורד מושך לבד לפי הסימול. מחפשים את הסימול ב-Yahoo Finance.</div>';
  h+='<div class="err full" id="err"></div><div class="mrow full"><button class="btn" type="submit">שמור</button><button class="btn ghost" type="button" id="cancel">ביטול</button></div></form></div></div>';
  h+='<div class="scrim" id="confirm"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="ct"><h2 id="ct">למחוק?</h2><div id="ctext"></div><div class="mrow"><button class="btn danger" type="button" id="cyes">מחק</button><button class="btn ghost" type="button" id="cno">ביטול</button></div></div></div>';
  return h;
}
function $(id){ return document.getElementById(id); }
function setType(t){ document.querySelectorAll(".st").forEach(function(e){e.style.display=t==="stock"?"":"none";}); document.querySelectorAll(".dp").forEach(function(e){e.style.display=t==="deposit"?"":"none";}); }
function pickColor(c){ document.querySelectorAll("#sw button").forEach(function(b){ b.setAttribute("aria-pressed",String(b.dataset.c===c)); }); $("sw").dataset.val=c; }
function cfgAsset(id){ return CFG.assets.filter(function(x){return x.id===id;})[0]; }
function openModal(a){
  editing=a?a.id:null; $("mt").textContent=a?"עריכת "+a.name:"הוספת מניה או פיקדון";
  var t=a?a.type:"stock"; $("f-type").value=t; setType(t);
  $("f-name").value=a?a.name:""; $("f-ticker").value=a?a.ticker||"":""; $("f-rate").value=a&&a.type==="deposit"?a.rate:"4.65";
  var used=CFG.assets.map(function(x){return x.color;});
  pickColor(a?a.color:(PALETTE.filter(function(c){return used.indexOf(c)<0;})[0]||PALETTE[0]));
  $("err").textContent=""; $("scrim").classList.add("open"); $("f-name").focus();
}
function submit(e){
  e.preventDefault();
  var t=$("f-type").value, name=$("f-name").value.trim();
  if(!name){ $("err").textContent="צריך לתת שם."; return; }
  var old=editing?cfgAsset(editing):null;
  var a={id:editing||("a"+Date.now().toString(36)), type:t, name:name, color:$("sw").dataset.val};
  if(old&&old.index) a.index=true;
  if(t==="deposit"){ var r=parseFloat(String($("f-rate").value).replace(",",".")); if(!isFinite(r)){ $("err").textContent="הריבית צריכה להיות מספר, למשל 4.65."; return; } a.rate=r; }
  else { var tk=$("f-ticker").value.trim().toUpperCase(); if(!/^[A-Z0-9.^=\-]{1,15}$/.test(tk)){ $("err").textContent="צריך סימול תקין, למשל NFLX."; return; } a.ticker=tk; }
  if(editing) CFG.assets=CFG.assets.map(function(x){return x.id===editing?a:x;});
  else { var pi=-1; CFG.assets.forEach(function(x,i){ if(x.type==="portfolio"||x.type==="deposit") if(pi<0) pi=i; }); if(pi<0) CFG.assets.push(a); else CFG.assets.splice(pi,0,a); }
  $("scrim").classList.remove("open"); saveConfig();
}
function bind(){
  document.querySelectorAll("[data-period]").forEach(function(b){ b.onclick=function(){ UI.period=S.period=b.dataset.period; lsSet("period",UI.period); render(); }; });
  $("fx").onchange=function(){ UI.fxOn=S.fxOn=this.checked; lsSet("fxOn",this.checked?"1":"0"); render(); };
  $("amt").onchange=function(){ var n=parseFloat(String(this.value).replace(/,/g,"")); if(n>0){ CFG.amount=n; saveConfig(); } else this.value=S.amount.toLocaleString("en-US"); };
  $("add").onclick=function(){ openModal(null); };
  $("refresh").onclick=refreshNow;
  $("gotoGh").onclick=function(){ var d=$("ghp"); d.open=true; d.scrollIntoView({behavior:"smooth",block:"start"}); setTimeout(function(){ var t=$("tok"); if(t) t.focus({preventScroll:true}); },400); };
  document.querySelectorAll("[data-edit]").forEach(function(b){ b.onclick=function(){ openModal(cfgAsset(b.dataset.edit)); }; });
  document.querySelectorAll("[data-del]").forEach(function(b){ b.onclick=function(){ var a=cfgAsset(b.dataset.del); if(!a) return; delId=a.id; $("ctext").textContent="להסיר את "+a.name+" מההשוואה?"; $("confirm").classList.add("open"); $("cno").focus(); }; });
  $("f-type").onchange=function(){ setType(this.value); };
  document.querySelectorAll("#sw button").forEach(function(b){ b.onclick=function(){ pickColor(b.dataset.c); }; });
  $("frm").onsubmit=submit; $("cancel").onclick=function(){ $("scrim").classList.remove("open"); };
  $("cno").onclick=function(){ $("confirm").classList.remove("open"); };
  $("cyes").onclick=function(){ CFG.assets=CFG.assets.filter(function(x){return x.id!==delId;}); $("confirm").classList.remove("open"); saveConfig(); };
  ["scrim","confirm"].forEach(function(id){ $(id).onclick=function(e){ if(e.target===this) this.classList.remove("open"); }; });
  $("tokSave").onclick=function(){ var v=$("tok").value.trim(); if(!v) return; status("בודק את הטוקן…","busy");
    var prevTok=token; token=v;
    gh("").then(function(r){ return r.json().then(function(j){ if(!r.ok||!j.permissions||!j.permissions.push) throw new Error(j.message||"אין הרשאת כתיבה"); }); })
      .then(function(){ lsSet("gh-token",v); status("מחובר ✓","ok"); var local=lsGet("cfg-local"); if(local){ saveConfig(); } else render(); })
      .catch(function(e){ token=prevTok; status("הטוקן לא עובד: "+e.message+". בדוק שבחרת את המאגר stocks-dashboard ואת ההרשאות.","warn"); });
  };
  if($("tokDel")) $("tokDel").onclick=function(){ token=""; lsSet("gh-token",null); status("נותק","ok"); render(); };
}
document.addEventListener("keydown",function(e){ if(e.key==="Escape"){ ["scrim","confirm"].forEach(function(id){ var el=$(id); if(el) el.classList.remove("open"); }); } });

/* ---------- start ---------- */
app.innerHTML='<div class="wrap"><div class="upd ok"><div class="t"><b>טוען נתונים…</b></div></div></div>';
loadAll().then(function(){ lastU=D.updatedAt; build(); render(); })
  .catch(function(){ app.innerHTML='<div class="wrap"><div class="upd stale"><div class="t"><b>הנתונים עוד לא מוכנים</b><small>אם המאגר נוצר עכשיו, העדכון הראשון לוקח כ-2 דקות. רענן את הדף בעוד רגע.</small></div></div></div>'; });
var lastU=null;
setInterval(function(){ if(document.hidden) return; loadData().then(function(){ if(D&&CFG&&D.updatedAt!==lastU){ lastU=D.updatedAt; build(); render(); } }).catch(function(){}); },5*60*1000);
})();
