import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPaperPosition,applyAssessment,updatePrices,estimatePnL,tradeMetrics,riskCommitted} from './engine.js';
import './styles.css';
import { installAiBridge, getAiFyersLoginUrl, beginAiFyersLogin, AI_SERVER_MANAGED } from './bridge.js';
import { loadAiSession, saveAiSession, clearAiSession, remainingAiSession } from './auth.js';
installAiBridge();

if ('serviceWorker' in navigator) {
 window.addEventListener('load', () => {
   navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
     .catch(error=>console.warn('PWA service worker registration failed:',error));
 }, {once:true});
}

const STORAGE='mentor-ai-paper-lab-v1';
const starting={positions:[],closed:[],decisions:[],settings:{capital:50000,riskPct:1},auto:false};
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const stamp=v=>v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';
function load(){try{const s=JSON.parse(localStorage.getItem(STORAGE));return s&&typeof s==='object'?{...starting,...s,auto:false}:starting}catch{return starting}}
function extractPrices(data){
 const out={};
 for(const item of data?.d||[]){
   const symbol=item?.n||item?.v?.symbol;
   const px=Number(item?.v?.lp);
   if(symbol&&Number.isFinite(px)&&px>0) out[symbol]=px;
 }
 return out;
}
function csv(rows){
 const keys=['id','strategy','symbol','side','quantity','entry','exitPrice','pnl','openedAt','closedAt','entryReason','exitReason','model'];
 const cell=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 return [keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}
function download(name,body,type='application/json'){
 const blob=new Blob([body],{type});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function App(){
 const [book,setBook]=useState(load);
 const bookRef=useRef(book);
 const [snapshot,setSnapshot]=useState(null);
 const [broker,setBroker]=useState(null);
 const [cloud,setCloud]=useState(null);
 const [cloudError,setCloudError]=useState('');
 const refreshCloud=async()=>{
  if(!AI_SERVER_MANAGED)return null;
  const session=loadAiSession();
  if(!session?.token){setCloud(null);return null}
  try{
   const response=await fetch('/api/ai-paper/state',{cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Autonomous worker is unavailable');
   setCloud(result);setCloudError('');return result;
  }catch(err){setCloudError(err.message||'Standalone paper worker unavailable');return null}
 };
 const updateCloud=async values=>{
  const response=await fetch('/api/ai-paper/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Could not change server research');
  setCloud(result);
  return result;
 };
 const displayBook=AI_SERVER_MANAGED?{
  positions:cloud?.positions||[],closed:cloud?.closed||[],decisions:cloud?.decisions||[],
  settings:book.settings,auto:cloud?.enabled===true
 }:book;
 const autoActive=AI_SERVER_MANAGED?cloud?.enabled===true:book.auto;

 const [password,setPassword]=useState('');
 const [remember,setRemember]=useState(true);
 const [session,setSession]=useState(loadAiSession);
 const [authBusy,setAuthBusy]=useState(false);
 const [authChecking,setAuthChecking]=useState(true);
 const [authError,setAuthError]=useState('');
 const sessionActive=remainingAiSession(session)>0;
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [latest,setLatest]=useState(null);
 const assessmentView=AI_SERVER_MANAGED?(cloud?.lastAssessment||null):latest;
 const [now,setNow]=useState(Date.now());
 const [menuOpen,setMenuOpen]=useState(false);
 const [activePage,setActivePage]=useState('overview');
 const [installEvent,setInstallEvent]=useState(null);
 const [installInstructions,setInstallInstructions]=useState(false);
 const [installed,setInstalled]=useState(()=>{
   return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone);
 });
 const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent);
 const requestInstall=async()=>{
   setMenuOpen(false);
   if(installed)return;
   if(installEvent){
     try{
       await installEvent.prompt();
       const result=await installEvent.userChoice;
       if(result?.outcome==='accepted')setInstalled(true);
       setInstallEvent(null);
     }catch{setInstallInstructions(true)}
   }else{setInstallInstructions(true)}
 };
 useEffect(()=>{
   const onInstall=e=>{e.preventDefault();setInstallEvent(e)};
   const onInstalled=()=>{setInstalled(true);setInstallInstructions(false);setInstallEvent(null)};
   window.addEventListener('beforeinstallprompt',onInstall);
   window.addEventListener('appinstalled',onInstalled);
   return()=>{
     window.removeEventListener('beforeinstallprompt',onInstall);
     window.removeEventListener('appinstalled',onInstalled);
   };
 },[]);
 useEffect(()=>{
   if(!installInstructions)return;
   const onKey=e=>{if(e.key==='Escape')setInstallInstructions(false)};
   document.addEventListener('keydown',onKey);
   return()=>document.removeEventListener('keydown',onKey);
 },[installInstructions]);
 const selectPage=(page)=>{
   setActivePage(page);
   setMenuOpen(false);
   window.scrollTo({top:0,behavior:'smooth'});
 };
 const goToPositions=()=>{
   setActivePage('overview');
   setMenuOpen(false);
   requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('positions')?.scrollIntoView({behavior:'smooth',block:'start'})));
 };
 useEffect(()=>{
   if(!menuOpen)return;
   const onEscape=e=>{if(e.key==='Escape')setMenuOpen(false)};
   document.addEventListener('keydown',onEscape);
   return()=>document.removeEventListener('keydown',onEscape);
 },[menuOpen]);
 const running=useRef(false);
 const setSafe=change=>{
   const next=typeof change==='function'?change(bookRef.current):change;
   bookRef.current=next;setBook(next);
   try{localStorage.setItem(STORAGE,JSON.stringify({...next,auto:false}))}catch{}
 };
 const log=(type,payload)=>setSafe(s=>({...s,decisions:[{id:crypto.randomUUID(),at:new Date().toISOString(),type,...payload},...(s.decisions||[])].slice(0,2000)}));

 const signOut=()=>{
   setCloud(null);
   clearAiSession();
   setSession(null);
   setPassword('');
   setAuthError('');
   setSafe(prev=>({...prev,auto:false}));
   setStatus('Signed out of Claude AI. Saved paper positions and your research journal are unchanged.');
 };

 const signIn=async event=>{
   event.preventDefault();
   if(authBusy||!password.trim())return;
   setAuthBusy(true);
   setAuthError('');
   try{
     const response=await fetch('/.netlify/functions/ai-session',{
       method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({action:'login',password,remember})
     });
     const result=await response.json().catch(()=>({}));
     if(!response.ok||!result.token)throw Error(result.error||'AI login failed. Check backend availability.');
     const next={token:result.token,expiresAt:result.expiresAt,remembered:result.remembered===true};
     saveAiSession(next);
     setSession(next);
     setPassword('');
     setStatus('Claude access enabled. '+(next.remembered?'This browser will remember your session for up to 7 days.':'Session access will end when the tab closes.'));
   }catch(error){
     setAuthError(error?.message||'Could not connect to the secure AI login service.');
     setPassword('');
   }finally{setAuthBusy(false)}
 };

 useEffect(()=>{
   let cancelled=false;
   async function verifySession(){
     const saved=loadAiSession();
     if(!saved){if(!cancelled){setSession(null);setAuthChecking(false)}return}
     try{
       const response=await fetch('/.netlify/functions/ai-session',{
         method:'POST',headers:{'content-type':'application/json','Authorization':'Bearer '+saved.token},
         body:JSON.stringify({action:'verify'})
       });
       if(response.status===401){
         clearAiSession();
         if(!cancelled){setSession(null);setStatus('Your previous AI session has expired. Sign in again.')}
       }else if(!response.ok){
         if(!cancelled)setStatus('AI login verification is temporarily unavailable. Research remains paused.');
       }else if(!cancelled){setSession(saved)}
     }catch{
       if(!cancelled)setStatus('Could not verify the AI session. Check the backend connection.');
     }finally{if(!cancelled)setAuthChecking(false)}
   }
   void verifySession();
   return()=>{cancelled=true};
 },[]);
 useEffect(()=>{
  if(!AI_SERVER_MANAGED||!sessionActive)return;
  void refreshCloud();
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void refreshCloud()},6000);
  return()=>clearInterval(interval);
 },[sessionActive,session?.token]);
 const refreshStatus=async()=>{
  try{const r=await fetch('/api/fyers/status',{cache:'no-store'});const j=await r.json();setBroker(j);return j}
  catch{setBroker({configured:false,authenticated:false});return null}
 };
 const market=async()=>{
  const response=await fetch('/api/fyers/mentor-snapshot',{cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw Error(body.error||'FYERS snapshot unavailable; connect your second FYERS application.');
  setSnapshot(body);return body;
 };
 const priceTick=async()=>{
  const pos=bookRef.current.positions;
  if(!pos.length)return;
  const symbols=[...new Set(pos.map(p=>p.symbol).filter(Boolean))];
  const quotes={};let spot=null;
  try{
   for(let i=0;i<symbols.length;i+=8){
     const chunk=[...symbols.slice(i,i+8),'NSE:NIFTY50-INDEX'];
     const r=await fetch('/api/fyers/quote?symbol='+encodeURIComponent(chunk.join(',')),{cache:'no-store'});
     if(!r.ok)throw Error('Live quotes unavailable');
     Object.assign(quotes,extractPrices(await r.json()));
   }
   spot=quotes['NSE:NIFTY50-INDEX'];
   const next=updatePrices(bookRef.current.positions,quotes,spot);
   if(next.closed.length){
     setSafe(s=>({...s,positions:next.positions,closed:[...next.closed,...s.closed],decisions:[
       ...next.closed.map(p=>({id:crypto.randomUUID(),at:new Date().toISOString(),type:'PAPER_EXIT',reason:p.exitReason,positionId:p.id,price:p.exitPrice})),
       ...s.decisions].slice(0,2000)}));
   }else if(Object.keys(quotes).length){
     setSafe(s=>({...s,positions:next.positions}));
   }
  }catch{setStatus('Quote connection interrupted. Existing paper positions remain open; prices may be stale.')}
 };
 const analyse=async()=>{
  if(running.current)return;
  if(authChecking||!sessionActive){setStatus('Unlock Claude AI to run an assessment.');return}
  running.current=true;setBusy(true);setStatus('Refreshing FYERS data and requesting Claude assessment…');
  try{
   if(AI_SERVER_MANAGED){
     const r=await fetch('/api/ai-paper/analyse',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
     const answer=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(answer.error||'Server-side analysis failed');
     await refreshCloud();
     setStatus(answer.skipped?'Server research: '+answer.reason:'Claude decision and paper positions saved on the server.');
     return;
   }
   const shot=await market();
   if(shot.live!==true||shot.market?.phase!=='LIVE') {setStatus('NIFTY session is not LIVE. No paper entry created.');return}
   const response=await fetch('/.netlify/functions/ai-analyze',{
     method:'POST',headers:{'content-type':'application/json','Authorization':'Bearer '+session.token},
     body:JSON.stringify({snapshot:shot,positions:bookRef.current.positions}),
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error+(result.detail?' — '+result.detail:'')||'AI analysis unavailable');
   const a={...result.assessment,model:result.model};
   setLatest({...a,at:result.at});
   const applied=applyAssessment(bookRef.current.positions,a);
   let positions=applied.positions;
   const records=[];
   for(const change of applied.changes)records.push({type:'TRAIL',reason:change.reason,positionId:change.id,price:change.newStop});
   if(a.action==='ENTER'){
     const entry=createPaperPosition({snapshot:shot,assessment:a,open:positions,
       capital:Number(bookRef.current.settings.capital),riskPct:Number(bookRef.current.settings.riskPct)});
     if(entry.position){positions=[...positions,entry.position];records.push({type:'PAPER_ENTRY',reason:a.reason,positionId:entry.position.id,price:entry.position.entry})}
     else records.push({type:'ENTRY_REJECTED',reason:entry.error});
   }
   const newEvents=[
     {type:'CLAUDE_'+a.action,reason:a.reason,regime:a.regime,model:result.model},
     ...records].map(e=>({id:crypto.randomUUID(),at:new Date().toISOString(),...e}));
   setSafe(s=>({...s,positions,decisions:[...newEvents,...s.decisions].slice(0,2000)}));
   setStatus(a.action==='ENTER'?'Claude analysis recorded. Paper entry depends on risk validation.':'Claude recommends WAIT. The decision is saved.');
   await priceTick();
  }catch(err){setStatus(err?.message||'Claude request failed. No new trade entered.')}
  finally{running.current=false;setBusy(false)}
 };
 useEffect(()=>{void refreshStatus(); const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
 useEffect(()=>{if(!broker?.authenticated)return;void market().catch(e=>setStatus(e.message));const t=setInterval(()=>void market().catch(()=>{}),15000);return()=>clearInterval(t)},[broker?.authenticated]);
 useEffect(()=>{if(!broker?.authenticated)return;const t=setInterval(()=>void priceTick(),5000);return()=>clearInterval(t)},[broker?.authenticated]);
 useEffect(()=>{if(AI_SERVER_MANAGED||!book.auto||!broker?.authenticated||!sessionActive||authChecking)return;
   const t=setInterval(()=>{if(document.visibilityState==='visible'&&new Date().getHours()>=9)void analyse()},60000);
   return()=>clearInterval(t);
 },[book.auto,broker?.authenticated,sessionActive,authChecking,session?.token]);
 const stats=tradeMetrics(displayBook.closed);
 const openProfit=displayBook.positions.reduce((a,p)=>a+estimatePnL(p),0);
 const capital=Number(book.settings.capital)||50000;
 const isLive=snapshot?.live===true && snapshot?.market?.phase==='LIVE';
 const readOnly=!broker?.authenticated;
 const toggleAuto=async()=>{
  if(!AI_SERVER_MANAGED){setSafe(s=>({...s,auto:!s.auto}));return}
  try{await updateCloud({enabled:!autoActive});setStatus(autoActive?'New server-side paper entries paused. Protective stops continue.':'Server-side autonomous paper trading enabled; it can continue while the PWA is closed.')}
  catch(error){setStatus(error.message)}
 };
 const connectBroker=async()=>{try{await beginAiFyersLogin()}catch(err){setStatus(err.message)}};
 const saveServerRisk=async()=>{if(!AI_SERVER_MANAGED)return;try{await updateCloud({capital:Number(book.settings.capital),riskPct:Number(book.settings.riskPct)});setStatus('Virtual risk settings saved on the paper worker.')}catch(e){setStatus(e.message)}};

 const openCount=displayBook.positions.length;
 return <div className="shell">
  <header className="top top-v3">
   <div className="header-main">
    <div className="brand-v3">
     <span className="brand-symbol" aria-hidden="true"><b>M</b><small>AI</small></span>
     <div className="brand-copy">
      <span className="brand-kicker-v3">INDEX OPTIONS MENTOR <span>2.0</span></span>
      <strong>Claude <span>Paper Lab</span></strong>
     </div>
    </div>
    <div className="header-indicators" aria-label="System status">
     <span className="status-pill paper"><i aria-hidden="true"></i> PAPER ONLY</span>
     <span className={'status-pill '+(broker?.authenticated?'connected':'offline')}><i aria-hidden="true"></i> FYERS {broker?.authenticated?'LINKED':'OFFLINE'}</span>
     <span className={'status-pill '+(sessionActive?'connected':'offline')}><i aria-hidden="true"></i> AI {sessionActive?'UNLOCKED':'LOCKED'}</span>
    </div>
   </div>
   <div className="header-sub">
     <nav className="header-nav" aria-label="Main dashboard sections">
      <button type="button" className={activePage==='overview'?'selected':''} onClick={()=>selectPage('overview')}>Overview</button>
      <button type="button" onClick={goToPositions}>Open positions</button>
     </nav>
     <div className="header-account">
      {sessionActive?<>
        <span className="header-session">{session.remembered?'Remembered until '+stamp(session.expiresAt):'Session active'}</span>
        <button className="header-signout" onClick={signOut} type="button">Sign out <span aria-hidden="true">↗</span></button>
       </>:<button className="header-signout login" type="button" onClick={()=>selectPage('control')}>Unlock AI <span aria-hidden="true">↗</span></button>}
     </div>
     <button type="button" className="hamburger-trigger" aria-expanded={menuOpen} aria-controls="mentor-ai-navigation" aria-label="Open navigation menu" onClick={()=>setMenuOpen(v=>!v)}>
      <span className="hamburger-lines" aria-hidden="true"><i></i><i></i><i></i></span><span>Menu</span>
     </button>
   </div>
  </header>
  {menuOpen && <>
    <button type="button" className="menu-backdrop" aria-label="Close navigation menu" onClick={()=>setMenuOpen(false)}></button>
    <aside id="mentor-ai-navigation" className="menu-drawer" role="dialog" aria-modal="true" aria-label="Mentor AI menu">
     <div className="menu-drawer-head">
      <div><span>MENTOR AI 2.0</span><strong>Explore your workspace</strong></div>
      <button type="button" className="menu-close" onClick={()=>setMenuOpen(false)} aria-label="Close menu">✕</button>
     </div>
     <div className="menu-drawer-items">
      <button type="button" className={'menu-link '+(activePage==='overview'?'active':'')} onClick={()=>selectPage('overview')}>
       <span className="menu-icon" aria-hidden="true">▦</span><span><strong>Overview</strong><small>Market summary and live paper positions</small></span><span className="menu-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className={'menu-link '+(activePage==='control'?'active':'')} onClick={()=>selectPage('control')}>
       <span className="menu-icon" aria-hidden="true">⚙</span><span><strong>Control Centre</strong><small>AI login, risk settings and research controls</small></span><span className="menu-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className={'menu-link '+(activePage==='journal'?'active':'')} onClick={()=>selectPage('journal')}>
       <span className="menu-icon" aria-hidden="true">▤</span><span><strong>Independent Learning Journal</strong><small>All Claude decisions, trades and exports</small></span><span className="menu-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className={'menu-link '+(activePage==='guide'?'active':'')} onClick={()=>selectPage('guide')}>
       <span className="menu-icon" aria-hidden="true">?</span><span><strong>How the AI Works</strong><small>Paper execution process and limitations</small></span><span className="menu-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className="menu-link menu-install" disabled={installed} onClick={requestInstall}>
       <span className="menu-icon" aria-hidden="true">⌂</span><span><strong>{installed?'Installed on this device':'Install / Add to Home Screen'}</strong><small>Launch Mentor AI like a dedicated mobile app</small></span><span className="menu-arrow" aria-hidden="true">›</span>
      </button>
     </div>
     <div className="menu-drawer-foot"><span className="menu-foot-dot"></span> Independent research · No real orders</div>
    </aside>
  </>}
  {installInstructions && <div className="install-backdrop" role="presentation" onClick={()=>setInstallInstructions(false)}>
    <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" onClick={e=>e.stopPropagation()}>
     <div className="install-dialog-head"><div className="install-dialog-brand"><img src={`${import.meta.env.BASE_URL}icons/mentor-ai-192.png`} alt="Mentor AI app icon"/><div><strong id="install-dialog-title">Add Mentor AI to Home Screen</strong><small>Install the PWA and open it like a native app</small></div></div><button className="install-close" type="button" onClick={()=>setInstallInstructions(false)} aria-label="Close installation instructions">✕</button></div>
     {isIOS ? <div className="install-steps"><p>On your iPhone or iPad, use <strong>Safari</strong> for the easiest installation.</p><p><b>1.</b> Tap the <strong>Share</strong> icon (square with an upward arrow) in Safari.</p><p><b>2.</b> Scroll down and select <strong>Add to Home Screen</strong>.</p><p><b>3.</b> Name it <strong>Mentor AI</strong> and tap <strong>Add</strong>.</p></div>
      : <div className="install-steps"><p>In Chrome or Edge, open the browser menu and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p>If no installation option appears, use a modern browser over HTTPS and reopen this page.</p></div>}
     <button type="button" className="accent install-confirm" onClick={()=>setInstallInstructions(false)}>Got it</button>
    </section>
   </div>}
  <main id="main-content">
  {activePage==='overview' && <div className="workspace-view overview-view">
  <section className="hero" id="overview">
   <div><p className="overline">SEPARATE RESEARCH ENVIRONMENT</p><h1>Autonomous intelligence.<br/><span>Zero live orders.</span></h1>
   <p>Claude reviews verified market snapshots, decides whether to enter, and manages simulated exits and trailing stops. Multiple independent positions can coexist.</p>
   {AI_SERVER_MANAGED && <div className="server-mode-note"><strong>Server paper engine:</strong> {cloud?.safetyLocked?'paper-only safeguards active':'waiting for protected server'} · {autoActive?'autonomous mode running':'new entries paused'}{cloudError?' · '+cloudError:''}</div>}
   <div className="heroActions"><button onClick={connectBroker} className="accent">{broker?.authenticated?'Reconnect FYERS':'Connect FYERS'}</button><button className="secondary" onClick={()=>void refreshStatus()}>Check connection</button>{!installed&&<button className="install-hero-btn" onClick={requestInstall} type="button"><span aria-hidden="true">⌂</span> Install app</button>}</div>
   </div><div className="heroCard"><small>MARKET CONTEXT</small><div className="big">{fmt(snapshot?.market?.spot)}</div><span>NIFTY 50 · {snapshot?.market?.phase||'Waiting'}</span><hr/><div className="split"><span>Session</span><strong>{snapshot?.market?.sessionDate||'—'}</strong></div><div className="split"><span>Last refresh</span><strong>{stamp(snapshot?.generatedAt)}</strong></div><div className="split"><span>Clock (IST)</span><strong>{new Date(now).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</strong></div></div>
  </section>
  <section className="metrics">
   <div className="metric"><small>OPEN AI POSITIONS</small><strong>{openCount}</strong><span>Multiple entries allowed</span></div>
   <div className="metric"><small>UNREALISED P&L</small><strong className={openProfit>=0?'gain':'loss'}>₹{fmt(openProfit)}</strong><span>Indicative quote marks</span></div>
   <div className="metric"><small>REALIZED P&L</small><strong className={stats.total>=0?'gain':'loss'}>₹{fmt(stats.total)}</strong><span>{stats.count} closed paper trades</span></div>
   <div className="metric"><small>WIN RATE</small><strong>{fmt(stats.winRate)}%</strong><span>Before costs / slippage</span></div>
  </section>
  <div className="grid intelligence-grid">
   <section className="card intelligence">
    <div className="sectHead"><div><small>LAST CLAUDE DECISION</small><h2>Market intelligence</h2></div><span className="pill">{assessmentView?.action||'AWAITING ANALYSIS'}</span></div>
    <div className="assessment"><h3>{assessmentView?.regime||'No analysis yet'}</h3><p>{assessmentView?.summary||'Connect a separate FYERS application and configure Claude to review the live session.'}</p></div>
    <div className="insight"><small>AI EXPLANATION</small><p>{assessmentView?.reason||'Nothing has been evaluated.'}</p></div>
    <div className="insight"><small>EVENT COVERAGE</small><p>{assessmentView?.eventCaution||'An independent verified news/calendar feed is not connected. Claude should not guess breaking events.'}</p></div>
    <p className="tiny">Latest: {stamp(assessmentView?.at)} · {assessmentView?.model||'claude-sonnet-5-5'}</p>
   </section>
  </div>
  <section className="card tableCard" id="positions"><div className="sectHead"><div><small>POSITION GUARDIAN</small><h2>Open paper positions</h2></div><strong>{openCount} active</strong></div>
    {openCount? <div className="scroll"><table><thead><tr><th>Contract</th><th>Direction</th><th>Entry</th><th>Mark</th><th>Trail stop</th><th>Qty</th><th>P&L</th><th>Opened (IST)</th></tr></thead><tbody>{displayBook.positions.map(p=><tr key={p.id}><td>{p.symbol}</td><td>{p.side}</td><td>₹{fmt(p.entry)}</td><td>₹{fmt(p.currentPrice)}</td><td>₹{fmt(p.optionStop)}</td><td>{p.quantity}</td><td className={estimatePnL(p)>=0?'gain':'loss'}>₹{fmt(estimatePnL(p))}</td><td>{stamp(p.openedAt)}</td></tr>)}</tbody></table></div> : <p className="empty">No open Claude positions. Existing Mentor trades are unaffected.</p>}
  </section>
  </div>}
  {activePage==='control' && <div className="workspace-view settings-view">
    <div className="workspace-heading"><div><span className="workspace-eyebrow">RESEARCH SETTINGS</span><h1>Control Centre</h1><p>Unlock Claude, set virtual risk limits and control simulated market research.</p></div><button type="button" onClick={()=>selectPage('overview')} className="workspace-back">← Overview</button></div>
    <div className="settings-body">
   <section className="card control" id="agent">
    <div className="sectHead"><div><small>CONTROL CENTRE</small><h2>Claude trading agent</h2></div><span className="pill">MODEL · SONNET 5.5</span></div>
    {sessionActive ?
      <div className="ai-auth-status">
       <div className="auth-avatar" aria-hidden="true">✓</div>
       <div><strong>AI access unlocked</strong><p>{session.remembered?'This device will stay signed in until '+stamp(session.expiresAt):'Signed in for this browser tab.'} Your Claude API key remains on the private backend.</p></div>
      </div>
      :
      <form className="ai-login-form" onSubmit={signIn}>
       <div className="login-heading"><span className="lock-icon" aria-hidden="true">⌁</span><div><strong>Unlock Claude AI</strong><p>Sign in once to run research and simulated trades.</p></div></div>
       <label>AI access password <span>(MENTOR_AI_ACCESS_KEY)</span>
         <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your AI access password" required/>
       </label>
       <label className="remember-choice"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span><strong>Remember this device for 7 days</strong><small>Stores an expiring access token, never your password.</small></span></label>
       {authError&&<p className="auth-error" role="alert">{authError}</p>}
       <button className="accent login-submit" type="submit" disabled={authBusy||!password.trim()}>{authBusy?'Signing in…':'Unlock Claude'} <span aria-hidden="true">→</span></button>
      </form>
    }
    <div className="two">
    <label>Virtual capital (₹)<input type="number" min="10000" max="100000000" value={book.settings.capital} onChange={e=>setSafe(s=>({...s,settings:{...s.settings,capital:e.target.value}}))}/></label>
    <label>Risk per position (%)<input type="number" min=".1" max="5" step=".1" value={book.settings.riskPct} onChange={e=>setSafe(s=>({...s,settings:{...s.settings,riskPct:e.target.value}}))}/></label>
    </div>
    <p className="support">Virtual risk committed: ₹{fmt(riskCommitted(displayBook.positions))}. Per-position risk and a portfolio risk ceiling apply. A separate Claude setup can enter while another position is open.</p>
    <div className="toolbar"><button className="accent" disabled={busy||readOnly||!isLive||!sessionActive||authChecking} onClick={()=>void analyse()}>{busy?'Analysing…':'Run Claude analysis'}</button><button disabled={!broker?.authenticated||!sessionActive||authChecking||(AI_SERVER_MANAGED&&!cloud?.safetyLocked)} className={autoActive?'danger':'secondary'} onClick={toggleAuto}>{autoActive?'Pause new entries':AI_SERVER_MANAGED?'Enable server research':'Enable auto research'}</button>{AI_SERVER_MANAGED&&<button className="secondary" type="button" onClick={saveServerRisk} disabled={!sessionActive}>Save server risk</button>}</div>
    <p className="notice">{status||(AI_SERVER_MANAGED?'Server research uses persistent storage; enabling automation requires an actively hosted worker.':'Auto research runs every minute only while this browser tab is open.')}</p>
   </section>
    </div>
  </div>}
  {activePage==='journal' && <div className="workspace-view journal-view">
    <div className="workspace-heading"><div><span className="workspace-eyebrow">CLAUDE RESEARCH RECORDS</span><h1>Independent Learning Journal</h1><p>Review every saved wait, rejection, entry, exit and trailing-stop decision. Export your paper-trading data for comparison.</p></div><button type="button" onClick={()=>selectPage('overview')} className="workspace-back">← Overview</button></div>
  <section className="card tableCard" id="journal"><div className="sectHead"><div><small>INDEPENDENT LEARNING JOURNAL</small><h2>Decisions & closed trades</h2></div><div className="toolbar"><button className="secondary" onClick={()=>download('claude-trades.csv',csv(displayBook.closed),'text/csv')}>Export trades CSV</button><button className="secondary" onClick={()=>download('claude-paper-journal.json',JSON.stringify(displayBook,null,2))}>Export all JSON</button></div></div>
   <div className="scroll"><table><thead><tr><th>Time (IST)</th><th>Event</th><th>Position</th><th>Reason</th></tr></thead><tbody>{displayBook.decisions.slice(0,30).map(row=><tr key={row.id}><td>{stamp(row.at)}</td><td>{row.type}</td><td>{row.positionId?.slice(0,8)||'—'}</td><td>{row.reason||'—'}</td></tr>)}</tbody></table></div>
   {!displayBook.decisions.length && <p className="empty">No AI decisions saved yet. WAIT outcomes, risk rejections, entries, trails, and exits will appear here.</p>}
  </section>
  </div>}
  {activePage==='guide' && <div className="workspace-view guide-view">
    <div className="workspace-heading"><div><span className="workspace-eyebrow">PAPER TRADING EXPLAINED</span><h1>How Mentor AI Works</h1><p>Claude decides whether to enter or manage a simulated position; fixed risk checks and quote monitoring provide independent safeguards.</p></div><button type="button" onClick={()=>selectPage('overview')} className="workspace-back">← Overview</button></div>
    <div className="guide-steps">
     <article className="guide-step"><span className="guide-number">01</span><div><h3>Get a verified FYERS snapshot</h3><p>The app reads NIFTY market and option-contract data from your separately authorised non-trading FYERS application.</p></div></article>
     <article className="guide-step"><span className="guide-number">02</span><div><h3>Ask Claude to assess the setup</h3><p>Claude interprets the available market structure, model parameters and existing paper positions. It chooses WAIT or ENTER and may request HOLD, TRAIL or EXIT for each open position.</p></div></article>
     <article className="guide-step"><span className="guide-number">03</span><div><h3>Validate simulated risk</h3><p>Every entry requires a matching option contract, valid protective stops and sufficient virtual risk budget. Other simulated positions do not automatically block a fresh setup.</p></div></article>
     <article className="guide-step"><span className="guide-number">04</span><div><h3>Monitor stops and log outcomes</h3><p>While your browser is open and connected, quote checks monitor paper positions. The journal logs Claude decisions, simulated fills, exits and trailing-stop changes.</p></div></article>
    </div>
    <div className="guide-warning"><strong>Important research limits</strong><p>No live orders are sent. There is no independently connected breaking-news or economic-calendar feed. Automatic analysis only runs while this browser tab is open and visible, and paper positions and the journal are saved on this device—not in a persistent cloud database. Quote-based fills omit transaction costs, spreads and slippage, so displayed P&amp;L does not prove real-world performance.</p></div>
    <button className="accent guide-open-control" onClick={()=>selectPage('control')} type="button">Open Control Centre →</button>
  </div>}
  <footer><strong>Mentor AI Paper Lab</strong> · Isolated GitHub branch · Local browser journal · Paper-only execution. Simulated fills use observed quotes and may differ from realizable prices. Not live broker trades.</footer>
  </main></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
