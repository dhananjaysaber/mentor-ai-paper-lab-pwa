import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPaperPosition,applyAssessment,updatePrices,estimatePnL,tradeMetrics,riskCommitted} from './engine.js';
import './styles.css';
import { installAiBridge, getAiFyersLoginUrl } from './bridge.js';
import { loadAiSession, saveAiSession, clearAiSession, remainingAiSession } from './auth.js';
installAiBridge();

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
 const [now,setNow]=useState(Date.now());
 const running=useRef(false);
 const setSafe=change=>{
   const next=typeof change==='function'?change(bookRef.current):change;
   bookRef.current=next;setBook(next);
   try{localStorage.setItem(STORAGE,JSON.stringify({...next,auto:false}))}catch{}
 };
 const log=(type,payload)=>setSafe(s=>({...s,decisions:[{id:crypto.randomUUID(),at:new Date().toISOString(),type,...payload},...(s.decisions||[])].slice(0,2000)}));

 const signOut=()=>{
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
 useEffect(()=>{if(!book.auto||!broker?.authenticated||!sessionActive||authChecking)return;
   const t=setInterval(()=>{if(document.visibilityState==='visible'&&new Date().getHours()>=9)void analyse()},60000);
   return()=>clearInterval(t);
 },[book.auto,broker?.authenticated,sessionActive,authChecking,session?.token]);
 const stats=useMemo(()=>tradeMetrics(book.closed),[book.closed]);
 const openProfit=book.positions.reduce((a,p)=>a+estimatePnL(p),0);
 const capital=Number(book.settings.capital)||50000;
 const isLive=snapshot?.live===true && snapshot?.market?.phase==='LIVE';
 const readOnly=!broker?.authenticated;
 const openCount=book.positions.length;
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
     <span className={'status-pill '+(broker?.authenticated?'connected':'offline')}><i aria-hidden="true"></i> FYERS {broker?.authenticated?'LIVE':'OFFLINE'}</span>
     <span className={'status-pill '+(sessionActive?'connected':'offline')}><i aria-hidden="true"></i> AI {sessionActive?'UNLOCKED':'LOCKED'}</span>
    </div>
   </div>
   <div className="header-sub">
     <nav className="header-nav" aria-label="Mentor AI sections">
      <a href="#overview">Overview</a>
      <a href="#agent">AI Agent</a>
      <a href="#positions">Positions</a>
      <a href="#journal">Journal</a>
     </nav>
     <div className="header-account">
      {sessionActive?<>
        <span className="header-session">{session.remembered?'Remembered until '+stamp(session.expiresAt):'Session active'}</span>
        <button className="header-signout" onClick={signOut} type="button">Sign out <span aria-hidden="true">↗</span></button>
       </>:<a className="header-signout login" href="#agent">Unlock AI <span aria-hidden="true">↗</span></a>}
     </div>
   </div>
  </header>
  <main>
  <section className="hero" id="overview">
   <div><p className="overline">SEPARATE RESEARCH ENVIRONMENT</p><h1>Autonomous intelligence.<br/><span>Zero live orders.</span></h1>
   <p>Claude reviews verified market snapshots, decides whether to enter, and manages simulated exits and trailing stops. Multiple independent positions can coexist.</p>
   <div className="heroActions"><button onClick={()=>location.assign(getAiFyersLoginUrl())} className="accent">{broker?.authenticated?'Reconnect FYERS':'Connect FYERS'}</button><button className="secondary" onClick={()=>void refreshStatus()}>Check connection</button></div>
   </div><div className="heroCard"><small>MARKET CONTEXT</small><div className="big">{fmt(snapshot?.market?.spot)}</div><span>NIFTY 50 · {snapshot?.market?.phase||'Waiting'}</span><hr/><div className="split"><span>Session</span><strong>{snapshot?.market?.sessionDate||'—'}</strong></div><div className="split"><span>Last refresh</span><strong>{stamp(snapshot?.generatedAt)}</strong></div><div className="split"><span>Clock (IST)</span><strong>{new Date(now).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}</strong></div></div>
  </section>
  <section className="metrics">
   <div className="metric"><small>OPEN AI POSITIONS</small><strong>{openCount}</strong><span>Multiple entries allowed</span></div>
   <div className="metric"><small>UNREALISED P&L</small><strong className={openProfit>=0?'gain':'loss'}>₹{fmt(openProfit)}</strong><span>Indicative quote marks</span></div>
   <div className="metric"><small>REALIZED P&L</small><strong className={stats.total>=0?'gain':'loss'}>₹{fmt(stats.total)}</strong><span>{stats.count} closed paper trades</span></div>
   <div className="metric"><small>WIN RATE</small><strong>{fmt(stats.winRate)}%</strong><span>Before costs / slippage</span></div>
  </section>
  <div className="grid">
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
    <p className="support">Virtual risk committed: ₹{fmt(riskCommitted(book.positions))}. Per-position risk and a portfolio risk ceiling apply. A separate Claude setup can enter while another position is open.</p>
    <div className="toolbar"><button className="accent" disabled={busy||readOnly||!isLive||!sessionActive||authChecking} onClick={()=>void analyse()}>{busy?'Analysing…':'Run Claude analysis'}</button><button disabled={!broker?.authenticated||!sessionActive||authChecking} className={book.auto?'danger':'secondary'} onClick={()=>setSafe(s=>({...s,auto:!s.auto}))}>{book.auto?'Pause auto research':'Enable auto research'}</button></div>
    <p className="notice">{status||'Market-data and Claude secrets must be configured before analysis. Auto research runs every minute only while this browser tab is open.'}</p>
   </section>
   <section className="card intelligence">
    <div className="sectHead"><div><small>LAST CLAUDE DECISION</small><h2>Market intelligence</h2></div><span className="pill">{latest?.action||'AWAITING ANALYSIS'}</span></div>
    <div className="assessment"><h3>{latest?.regime||'No analysis yet'}</h3><p>{latest?.summary||'Connect a separate FYERS application and configure Claude to review the live session.'}</p></div>
    <div className="insight"><small>AI EXPLANATION</small><p>{latest?.reason||'Nothing has been evaluated.'}</p></div>
    <div className="insight"><small>EVENT COVERAGE</small><p>{latest?.eventCaution||'An independent verified news/calendar feed is not connected. Claude should not guess breaking events.'}</p></div>
    <p className="tiny">Latest: {stamp(latest?.at)} · {latest?.model||'claude-sonnet-5-5'}</p>
   </section>
  </div>
  <section className="card tableCard" id="positions"><div className="sectHead"><div><small>POSITION GUARDIAN</small><h2>Open paper positions</h2></div><strong>{openCount} active</strong></div>
    {openCount? <div className="scroll"><table><thead><tr><th>Contract</th><th>Direction</th><th>Entry</th><th>Mark</th><th>Trail stop</th><th>Qty</th><th>P&L</th><th>Opened (IST)</th></tr></thead><tbody>{book.positions.map(p=><tr key={p.id}><td>{p.symbol}</td><td>{p.side}</td><td>₹{fmt(p.entry)}</td><td>₹{fmt(p.currentPrice)}</td><td>₹{fmt(p.optionStop)}</td><td>{p.quantity}</td><td className={estimatePnL(p)>=0?'gain':'loss'}>₹{fmt(estimatePnL(p))}</td><td>{stamp(p.openedAt)}</td></tr>)}</tbody></table></div> : <p className="empty">No open Claude positions. Existing Mentor trades are unaffected.</p>}
  </section>
  <section className="card tableCard" id="journal"><div className="sectHead"><div><small>INDEPENDENT LEARNING JOURNAL</small><h2>Decisions & closed trades</h2></div><div className="toolbar"><button className="secondary" onClick={()=>download('claude-trades.csv',csv(book.closed),'text/csv')}>Export trades CSV</button><button className="secondary" onClick={()=>download('claude-paper-journal.json',JSON.stringify(book,null,2))}>Export all JSON</button></div></div>
   <div className="scroll"><table><thead><tr><th>Time (IST)</th><th>Event</th><th>Position</th><th>Reason</th></tr></thead><tbody>{book.decisions.slice(0,30).map(row=><tr key={row.id}><td>{stamp(row.at)}</td><td>{row.type}</td><td>{row.positionId?.slice(0,8)||'—'}</td><td>{row.reason||'—'}</td></tr>)}</tbody></table></div>
   {!book.decisions.length && <p className="empty">No AI decisions saved yet. WAIT outcomes, risk rejections, entries, trails, and exits will appear here.</p>}
  </section>
  <footer><strong>Mentor AI Paper Lab</strong> · Isolated GitHub branch · Local browser journal · Paper-only execution. Simulated fills use observed quotes and may differ from realizable prices. Not live broker trades.</footer>
  </main></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
