'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, ArrowRight, Check, CheckCheck, Copy, Users, Clock3, ArrowLeft, Plus, ShieldCheck, ChevronDown, X, BarChart3, RotateCcw, MousePointer2, Trash2 } from 'lucide-react';
import { DAYS, NOTICE, DEFAULT_CONFIG, type Schedule, type Meeting, type Answer, time, range, slotKey, slotLabel, rankSlots, randomKey, strokePoints, validateConfig } from '@/lib/schedule';

type View = 'create' | 'reply' | 'results' | 'admin' | 'edit' | 'shared';
type LocationState = { view: View; event: string; answer: string; key: string };
async function api<T = {id:string}>(path: string, method = 'GET', body?: unknown, key = ''): Promise<T> {
  const result = await fetch(`/api/events${path}`, {method, cache:'no-store', headers:{'Content-Type':'application/json', ...(key ? {'X-Edit-Key':key} : {})}, ...(method !== 'GET' ? {body:JSON.stringify(body ?? {})} : {})});
  if (!result.headers.get('content-type')?.includes('application/json')) throw new Error('保存先に一時的に接続できません。入力を残したまま、もう一度お試しください。');
  const data = await result.json() as T & {error?:string};
  if (!result.ok) throw new Error(data.error ?? '通信に失敗しました。もう一度お試しください。');
  return data;
}
function readLocation(): LocationState {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('view') ?? (query.has('event') ? 'reply' : 'create');
  return {view: ['create','reply','results','admin','edit','shared'].includes(view) ? view as View : 'create', event:query.get('event') ?? '',answer:query.get('answer') ?? '',key:window.location.hash.slice(1)};
}
function relativeUrl(event: string, view: View, key = '', answer = '') {
  const query = new URLSearchParams({event,view});
  if (answer) query.set('answer',answer);
  return `/?${query}${key ? `#${key}` : ''}`;
}
function PrivacyNote() { return <p className="privacy"><ShieldCheck size={17}/><span>{NOTICE}</span></p>; }
function DayLabel({day}: {day:number}) { return <>{DAYS[day]}<span className="day-en">{['MON','TUE','WED','THU','FRI','SAT','SUN','HOL'][day]}</span></>; }

function TimeGrid({config, selected = new Set(), onChange, counts, total = 0, onDetail, disabled = false, compact = false}: {config: Schedule; selected?: Set<string>; onChange?: (selected: Set<string>) => void; counts?: Map<string,number>; total?: number; onDetail?: (key:string) => void; disabled?: boolean; compact?: boolean}) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(selected);
  const stroke = useRef<{id:number; add:boolean; previous:{x:number;y:number}; original:Set<string>} | null>(null);
  current.current = selected;
  const editable = !!onChange && !disabled;
  const starts = config.days.map(d => range(config,d)[0]), ends = config.days.map(d => range(config,d)[1]);
  const start = Math.min(...starts), end = Math.max(...ends);
  const rows = Array.from({length:(end-start)/config.step},(_,i) => start+i*config.step);
  function keysAt(points: {x:number;y:number}[]) {
    return points.map(point => document.elementFromPoint(point.x,point.y)?.closest<HTMLElement>('[data-slot]')).filter((element): element is HTMLElement => !!element && !!root.current?.contains(element)).map(element => element.dataset.slot!);
  }
  function paint(keys: string[], add: boolean) {
    const next = new Set(current.current);
    keys.forEach(key => add ? next.add(key) : next.delete(key));
    current.current = next;
    onChange?.(next);
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editable || event.button !== 0 || !event.isPrimary || stroke.current) return;
    const keys = keysAt([{x:event.clientX,y:event.clientY}]);
    if (!keys.length) return;
    event.preventDefault();
    const add = !current.current.has(keys[0]);
    stroke.current = {id:event.pointerId,add,previous:{x:event.clientX,y:event.clientY},original:new Set(current.current)};
    event.currentTarget.setPointerCapture(event.pointerId);
    paint(keys,add);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = stroke.current;
    if (!active || active.id !== event.pointerId) return;
    event.preventDefault();
    const next = {x:event.clientX,y:event.clientY};
    paint(keysAt(strokePoints(active.previous,next)),active.add);
    active.previous = next;
  }
  return <div className={`table-scroll ${compact ? 'compact-grid' : ''}`}>
    <div ref={root} className={`time-grid ${editable ? 'paintable' : ''}`} style={{'--days':config.days.length} as CSSProperties} role="group" aria-label="曜日と時間帯" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => {stroke.current=null;}} onLostPointerCapture={() => {stroke.current=null;}} onPointerCancel={() => {if(stroke.current){onChange?.(stroke.current.original);stroke.current=null;}}}>
      <div className="grid-corner">時間 <small>JST</small></div>
      {config.days.map(day => <div className={`grid-day ${day>=5 ? 'extra-day' : ''}`} key={day}><DayLabel day={day}/></div>)}
      {rows.map(minute => <div className="grid-row" key={minute}>
        <div className="grid-time">{time(minute)}<span>{time(minute+config.step)}</span></div>
        {config.days.map(day => {
          const [from,to] = range(config,day), key=slotKey(day,minute), available=minute>=from && minute<to;
          const count=counts?.get(key) ?? 0, active=selected.has(key), all=total>0 && count===total;
          const heat=count===0 ? 0 : Math.max(1,Math.ceil(count/Math.max(total,1)*4));
          return available ? <button type="button" key={key} data-slot={key} disabled={disabled} tabIndex={compact ? -1 : 0} className={`slot ${active?'selected':''} ${counts ? `heat-${heat}` : ''} ${all ? 'unanimous' : ''}`} aria-label={`${slotLabel(key,config.step)}${counts ? ` ${count}/${total}名が参加可能` : active ? ' 選択済み' : ' 未選択'}`} aria-pressed={counts ? undefined : active} onClick={event => {if(counts) onDetail?.(key); else if(editable && event.detail===0) paint([key],!current.current.has(key));}}>
            {counts ? <><span>{count}<small>/{total}</small></span>{all && <Check size={13}/>}</> : active ? <Check size={17} strokeWidth={2.5}/> : <span className="empty-mark"/>}
          </button> : <div key={key} className="slot unavailable" aria-label={`${DAYS[day]} ${time(minute)} 対象外`}>—</div>;
        })}
      </div>)}
      <div className="grid-corner grid-bottom">曜日 <small>JST</small></div>
      {config.days.map(day => <div className={`grid-day grid-bottom ${day>=5 ? 'extra-day' : ''}`} key={`bottom-${day}`}><DayLabel day={day}/></div>)}
    </div>
  </div>;
}

function ConfigFields({config,onChange,locked = false}: {config:Schedule;onChange:(config:Schedule)=>void;locked?:boolean}) {
  function set(field: keyof Schedule, value: number) { onChange({...config,[field]:value}); }
  function timeSelect(label: string, field: 'start'|'end'|'extraStart'|'extraEnd') {
    return <label className="time-field"><span>{label}</span><select disabled={locked} value={config[field]} onChange={e=>set(field,Number(e.target.value))}>{Array.from({length:49},(_,i)=>i*30).map(value=><option key={value} value={value}>{time(value)}</option>)}</select></label>;
  }
  return <>
    <fieldset disabled={locked}><legend>対象の曜日</legend><div className="day-picker">{DAYS.map((day,i)=><button type="button" key={day} aria-pressed={config.days.includes(i)} className={config.days.includes(i)?'chosen':''} onClick={()=>onChange({...config,days:config.days.includes(i)?config.days.filter(d=>d!==i):[...config.days,i].sort((a,b)=>a-b)})}>{day}</button>)}</div><p className="field-hint">土・日・祝は、それぞれ追加できます。</p></fieldset>
    <div className="range-fields"><span className="range-label">月〜金</span>{timeSelect('開始','start')}<span className="range-dash">〜</span>{timeSelect('終了','end')}</div>
    {config.days.some(d=>d>=5) && <div className="range-fields extra-range"><span className="range-label">土・日・祝</span>{timeSelect('開始','extraStart')}<span className="range-dash">〜</span>{timeSelect('終了','extraEnd')}</div>}
    <div className="field"><label htmlFor="step">1枠の長さ</label><select id="step" disabled={locked} value={config.step} onChange={e=>set('step',Number(e.target.value))}><option value={30}>30分</option><option value={60}>60分</option></select></div>
    <p className="field-hint">すべて日本時間。祝日は「祝日の通常の都合」として、ほかの曜日と分けて回答します。</p>
    {locked && <p className="warning">回答があるため、曜日・時間枠は変更できません。変更する場合は新しい調整ページを作成してください。</p>}
  </>;
}
function UrlCard({label,url,secret = false}: {label:string;url:string;secret?:boolean}) {
  const [copied,setCopied]=useState(false);
  return <div className={`url-card ${secret?'secret':''}`}><div><strong>{label}</strong>{secret && <span className="small-tag">自分だけで保管</span>}</div><div className="copy-row"><input aria-label={label} readOnly value={url} onFocus={e=>e.target.select()}/><button className="secondary icon-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setCopied(false);}}}>{copied?<Check size={17}/>:<Copy size={17}/>}<span>{copied?'コピー済み':'コピー'}</span></button></div><small>{secret?'このURLを知っている人は変更できます。紛失すると再発行できません。':'コピーできない場合は、URL欄を選択してコピーしてください。'}</small></div>;
}

export default function MeetingApp() {
  const [location,setLocation]=useState<LocationState>({view:'create',event:'',answer:'',key:''});
  const [ready,setReady]=useState(false), [loading,setLoading]=useState(false), [busy,setBusy]=useState(false);
  const [meeting,setMeeting]=useState<Meeting|null>(null), [error,setError]=useState(''), [message,setMessage]=useState('');
  const [title,setTitle]=useState(''), [description,setDescription]=useState(''), [config,setConfig]=useState<Schedule>(DEFAULT_CONFIG);
  const [name,setName]=useState(''), [selected,setSelected]=useState<Set<string>>(new Set()), [saved,setSaved]=useState<{id:string;key:string}|null>(null);
  const [detail,setDetail]=useState<string|null>(null), [showAll,setShowAll]=useState(false), [confirmAction,setConfirmAction]=useState<{type:'event'|'answer';id?:string;name?:string}|null>(null);
  const [emptyConfirm,setEmptyConfirm]=useState(false), [dirty,setDirty]=useState(false);
  const replyKey=useRef(''), requestNumber=useRef(0);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const {view,event,key}=location;
  const base=ready?window.location.origin:'';
  function navigate(next:LocationState) { window.history.pushState(null,'',next.view==='create'?'/':relativeUrl(next.event,next.view,next.key,next.answer));setLocation(next);setMessage('');setError('');setDetail(null);setSaved(null);setDirty(false);window.scrollTo({top:0}); }
  useEffect(()=>{setLocation(readLocation());setReady(true);const pop=()=>{setLocation(readLocation());setSaved(null);setDirty(false);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{
    if(!ready)return;
    const number=++requestNumber.current;
    setError('');setMeeting(null);setName('');setSelected(new Set());setSaved(null);setShowAll(false);
    if(view==='create'){setLoading(false);setTitle('');setDescription('');setConfig({...DEFAULT_CONFIG});return;}
    if(!event){setError('URLが不完全です。共有されたURLを確認してください。');return;}
    setLoading(true);
    (async()=>{try{
      const data=await api<Meeting>(`/${event}${view==='admin'||view==='shared'?'?manage=1':''}`,'GET',undefined,key);
      if(number!==requestNumber.current)return;
      setMeeting(data);setTitle(data.title);setDescription(data.description);setConfig(data.config);
      if(view==='edit') {const answer=await api<Answer>(`/${event}/answers/${location.answer}`,'GET',undefined,key);if(number!==requestNumber.current)return;setName(answer.name);setSelected(new Set(answer.slots));}
      replyKey.current=view==='edit'?key:randomKey();
    }catch(e){if(number===requestNumber.current){setError((e as Error).message);setMeeting(null);}}finally{if(number===requestNumber.current)setLoading(false);}})();
  },[ready,view,event,key,location.answer]);
  useEffect(()=>{if(detail || confirmAction || emptyConfirm)dialogRef.current?.showModal();else dialogRef.current?.close();},[detail,confirmAction,emptyConfirm]);
  async function refresh() {try{setBusy(true);const data=await api<Meeting>(`/${event}${view==='admin'?'?manage=1':''}`,'GET',undefined,key);setMeeting(data);setMessage('最新の回答に更新しました。');setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function create() {setError('');setBusy(true);try{validateConfig(config);const adminKey=randomKey();const data=await api('','POST',{title,description,config},adminKey);navigate({view:'shared',event:data.id,answer:'',key:adminKey});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function saveAnswer() {
    setEmptyConfirm(false);setBusy(true);setError('');
    try {const data=await api(`/${event}/answers${view==='edit'?`/${location.answer}`:''}`,view==='edit'?'PUT':'POST',{name,slots:[...selected],config:meeting!.config},replyKey.current);setSaved({id:data.id,key:replyKey.current});setDirty(false);window.scrollTo({top:0});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function saveSettings() {setBusy(true);setError('');try{await api(`/${event}`,'PATCH',{title,description,config},key);setMeeting({...meeting!,title,description,config});setMessage('設定を保存しました。');setDirty(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function remove() {if(!confirmAction)return;setBusy(true);setError('');try{await api(`/${event}${confirmAction.type==='answer'?`/answers/${confirmAction.id}`:''}`,'DELETE',{},key);if(confirmAction.type==='event'){navigate({view:'create',event:'',answer:'',key:''});setMessage('調整ページを削除しました。');}else{setMeeting({...meeting!,answers:meeting!.answers.filter(a=>a.id!==confirmAction.id)});setMessage('回答を削除しました。');}setConfirmAction(null);}catch(e){setError((e as Error).message);setConfirmAction(null);}finally{setBusy(false);}}
  function closeDialog(){setDetail(null);setConfirmAction(null);setEmptyConfirm(false);}
  const ranks=meeting?rankSlots(meeting):[], total=meeting?.answers.length ?? 0, counts=new Map(ranks.map(r=>[r.key,r.count]));
  const positive=ranks.filter(r=>r.count>0), recommendations=showAll?positive:positive.slice(0,5);
  const tiedMore=positive.length>5 && positive[4]?.count===positive[5]?.count;
  const isAnswer=view==='reply'||view==='edit';
  const selectedDetail=detail&&meeting?{yes:meeting.answers.filter(a=>a.slots.includes(detail)),no:meeting.answers.filter(a=>!a.slots.includes(detail))}:null;
  let previewConfig:Schedule|null=null;try{previewConfig=validateConfig(config);}catch{}

  return <>
    <header className="site-header"><div className="header-inner"><a className="brand" href="/" aria-label="ご都合うかがい君 ホーム"><span className="brand-symbol"><CalendarDays size={23}/></span><span>ご都合うかがい君<small>（仮）</small></span></a><span className="header-caption">定例の時間を、みんなで。</span><span className="timezone"><span/>日本時間 JST</span></div></header>
    <main className={`main ${view==='create'?'create-main':''}`}>
      {(view!=='create' && meeting && !saved) && <div className="event-nav"><span className="eyebrow">RECURRING MEETING</span><nav aria-label="ページ切り替え">{!isAnswer&&<a href={relativeUrl(event,'reply')}>回答する</a>}{view!=='results'&&<a href={relativeUrl(event,'results')}>集計を見る <ArrowRight size={14}/></a>}</nav></div>}
      {error&&<div role="alert" className="alert error">{error}</div>}{message&&<div role="status" className="alert success"><Check size={18}/>{message}</div>}
      {!ready||loading?<div className="loading">ページを読み込んでいます…</div>:<>
      {view==='create'&&<>
        <section className="intro"><p className="eyebrow"><span/> 毎週の「いつにする？」を、かんたんに。</p><h1>みんなに合う、<br className="mobile-break"/>いつもの時間。</h1><p>空いている曜日・時間をなぞるだけ。<br className="mobile-break"/>定例ミーティングの候補が、ひと目で見つかります。</p></section>
        <div className="create-layout"><section className="panel create-panel"><div className="section-heading"><span className="section-icon"><Plus size={20}/></span><div><h2>調整ページをつくる</h2><p>まずは、聞きたい曜日と時間を設定。</p></div></div>
          <form onSubmit={e=>{e.preventDefault();void create();}}><div className="field"><label htmlFor="title">ミーティング名 <span className="required">必須</span></label><input id="title" placeholder="例：AI勉強会 定例ミーティング" value={title} maxLength={100} required onChange={e=>setTitle(e.target.value)}/></div><div className="field"><label htmlFor="description">ひとこと <span className="optional">任意</span></label><textarea id="description" placeholder="例：いつもの参加しやすい時間を教えてください。" value={description} maxLength={1000} rows={2} onChange={e=>setDescription(e.target.value)}/></div>
          <ConfigFields config={config} onChange={setConfig}/><div className="form-bottom"><p><Users size={15}/>参加者は回答時に追加。人数の事前登録は不要です。</p><button className="primary full" disabled={busy}>{busy?'作成しています…':'調整ページをつくる'}<ArrowRight size={18}/></button><small>アカウント登録・ログインは不要</small></div></form>
        </section><aside className="preview-column"><div className="preview-top"><span className="eyebrow">HOW IT WORKS</span><span className="preview-label">回答画面のイメージ</span></div><h2>空いている時間を、<br/>すいっと、なぞる。</h2><p>クリックを何度もする必要はありません。<br/>PCでもスマートフォンでも、まとめて選択。</p><div className="preview-paper"><div className="preview-paper-top"><span><span className="status-dot"/> 参加できる時間</span><small>{config.step}分ごと</small></div>{previewConfig?<TimeGrid config={previewConfig} selected={new Set(['1:1140','1:1170','2:1170','3:1140','3:1170','3:1200','4:1200'])} disabled compact/>:<div className="empty-state">曜日・時間帯を設定するとプレビューが表示されます。</div>}<div className="preview-foot"><MousePointer2 size={15}/>なぞって選択。もう一度なぞって解除。</div></div><ol className="flow"><li><span>1</span>URLを共有</li><li><span>2</span>みんなが回答</li><li><span>3</span>候補がわかる</li></ol><PrivacyNote/></aside></div>
      </>}
      {view==='shared'&&meeting&&<section className="panel completion"><div className="completion-icon"><CheckCheck size={28}/></div><p className="eyebrow">READY TO SHARE</p><h1>調整ページができました。</h1><p>回答URLを、チームのみなさんに共有してください。</p><h2 className="meeting-name">{meeting.title}</h2><UrlCard label="回答URL" url={base+relativeUrl(event,'reply')}/><UrlCard label="集計URL" url={base+relativeUrl(event,'results')}/><UrlCard label="管理URL" url={base+relativeUrl(event,'admin',key)} secret/><div className="action-row"><a className="primary" href={relativeUrl(event,'reply')}>自分も回答する<ArrowRight size={17}/></a><a className="secondary" href={relativeUrl(event,'admin',key)}>管理画面へ</a></div><p className="field-hint">回答・集計URLを知る人は、ニックネームと回答内容を閲覧できます。</p></section>}
      {isAnswer&&meeting&&(saved?<section className="panel completion"><div className="completion-icon"><CheckCheck size={28}/></div><p className="eyebrow">THANK YOU</p><h1>回答を保存しました。</h1><p>{name}さん、ご協力ありがとうございます。</p><div className="saved-summary"><strong>{selected.size}</strong> 枠の参加可能な時間を保存しました。</div><UrlCard label="あなた専用の編集URL" url={base+relativeUrl(event,'edit',saved.key,saved.id)} secret/><div className="action-row"><a className="primary" href={relativeUrl(event,'results')}>みんなの回答を見る<ArrowRight size={17}/></a><a className="secondary" href={relativeUrl(event,'edit',saved.key,saved.id)}>回答を修正する</a></div></section>:<>
        <section className="event-heading"><h1>{meeting.title}</h1>{meeting.description&&<p className="description">{meeting.description}</p>}<div className="meta"><span><Clock3 size={15}/>{config.step}分刻み・日本時間</span><span><Users size={15}/>{total}名が回答済み</span>{view==='edit'&&<span className="small-tag">自分の回答を編集中</span>}</div></section>
        <form className="answer-layout" onSubmit={e=>{e.preventDefault();if(!selected.size)setEmptyConfirm(true);else void saveAnswer();}}>
          <div className="panel answer-panel"><div className="name-step"><label htmlFor="nickname"><span className="step">1</span>ニックネーム</label><input id="nickname" placeholder="例：えど" autoComplete="off" maxLength={40} value={name} required disabled={busy} onChange={e=>{setName(e.target.value);setDirty(true);}}/><span className="field-hint">本名でなくて大丈夫です。</span></div><div className="grid-heading"><div><h2><span className="step">2</span>参加できる時間をなぞる</h2><p>定例になっても無理なく参加できる時間を選んでください。</p></div><span className="selection-count">{selected.size} 枠 選択中</span></div><div className="grid-tools"><span><span className="legend-selected"/>参加できる</span><button type="button" className="text-button" disabled={!selected.size||busy} onClick={()=>{setSelected(new Set());setDirty(true);}}><RotateCcw size={14}/>選択をクリア</button></div><TimeGrid config={meeting.config} selected={selected} onChange={next=>{setSelected(next);setDirty(true);}} disabled={busy}/><p className="grid-instruction"><MousePointer2 size={15}/>なぞって選択・解除。スクロールは表の外側で。キーボードはTabとSpaceで選べます。</p><p className="field-hint">「祝」を選んだ場合、月〜日は祝日以外の通常の都合としてお答えください。</p></div>
          <aside className="answer-aside"><div className="panel save-panel"><span className="eyebrow">ALMOST DONE</span><h2><span className="step">3</span>保存して完了</h2><p>回答はあとから修正できます。<br/>保存後の編集URLを保管してください。</p><button className="primary full" disabled={busy}>{busy?'保存しています…':'回答を保存する'}<Check size={18}/></button><p className="save-caption">{selected.size ? `${selected.size}枠を選択中` : 'まだ時間が選ばれていません'}</p></div><PrivacyNote/><p className="field-hint">回答・集計URLを知る人は、ニックネームと回答内容を閲覧できます。</p></aside>
        </form></>)}
      {view==='results'&&meeting&&<>
        <section className="event-heading results-heading"><div><h1>{meeting.title}</h1><p>みんなの「参加できる」を、ひとつの表に。</p>{meeting.description&&<p className="description">{meeting.description}</p>}</div><button className="secondary" disabled={busy} onClick={()=>void refresh()}><RotateCcw size={16}/>{busy?'更新中…':'最新の回答に更新'}</button></section>
        <div className="stats"><div><span>回答者</span><strong>{total}<small>名</small></strong></div><div><span>全員が参加できる枠</span><strong>{total?ranks.filter(r=>r.count===total).length:0}<small>枠</small></strong></div><div><span>最も集まれる人数</span><strong>{ranks[0]?.count??0}<small>/ {total}名</small></strong></div></div>
        <section className="recommendations"><div className="section-title"><div><span className="eyebrow">BEST TIMES</span><h2>定例ミーティング候補</h2></div><small>参加できる人数が多い順・{config.step}分枠</small></div>{total===0?<div className="panel empty-state"><Users size={28}/><h3>最初の回答を待っています。</h3><p>回答が集まると、ここにおすすめの時間が表示されます。</p><a className="secondary" href={relativeUrl(event,'reply')}>回答する<ArrowRight size={16}/></a></div>:!positive.length?<div className="panel empty-state"><h3>参加可能な時間がまだありません。</h3><p>全員の回答が未選択です。時間帯を広げるなど、チームで相談してみてください。</p></div>:<><div className="candidate-list">{recommendations.map((item,index)=><button type="button" key={item.key} className={`candidate ${index===0?'best':''}`} onClick={()=>setDetail(item.key)}><span className="rank">{String(item.rank).padStart(2,'0')}</span><span className="candidate-time"><strong>{slotLabel(item.key,config.step)}</strong><small>{item.count===total?'全員が参加できます':`${total-item.count}名が参加できません`}</small></span><span className="candidate-count">{item.count}<small>/{total}名</small></span><ArrowRight size={17}/></button>)}</div>{positive.length>5&&<button className="text-button more-candidates" onClick={()=>setShowAll(!showAll)}>{showAll?'上位5件に戻す':tiedMore?'同率の候補・ほかの候補も見る':'ほかの候補も見る'}<ChevronDown size={16}/></button>}</>}</section>
        <div className="results-layout"><section className="panel heatmap-panel"><div className="section-title"><div><span className="eyebrow">WEEKLY HEATMAP</span><h2>曜日・時間ごとの参加状況</h2></div><BarChart3 size={22}/></div><div className="heatmap-legend"><span>少ない</span><i className="heat-0"/><i className="heat-1"/><i className="heat-2"/><i className="heat-3"/><i className="heat-4"/><span>多い</span><strong><Check size={12}/>全員</strong></div><TimeGrid config={config} counts={counts} total={total} onDetail={setDetail}/><p className="grid-instruction">時間帯を押すと、参加できる人・できない人を確認できます。</p></section><aside className="panel respondents"><div className="section-title"><h2>回答したメンバー</h2><span className="number-tag">{total}名</span></div>{!total?<p className="field-hint">まだ回答はありません。</p>:<ul>{meeting.answers.map((answer,i)=><li key={answer.id}><span className="avatar">{answer.name.slice(0,1)}</span><span>{answer.name}</span><Check size={16}/></li>)}</ul>}<p className="field-hint">各自の回答で、メンバーが追加されます。分母は回答済みの人数です。</p><UrlCard label="回答URLを共有" url={base+relativeUrl(event,'reply')}/></aside></div>
      </>}
      {view==='admin'&&meeting&&<><section className="event-heading"><p className="eyebrow">MANAGE MEETING</p><h1>調整ページの管理</h1><p>このページのURLは、主催者だけで保管してください。</p></section><div className="admin-layout"><section className="panel"><h2>ページの設定</h2><form onSubmit={e=>{e.preventDefault();void saveSettings();}}><div className="field"><label htmlFor="title">ミーティング名</label><input id="title" value={title} required maxLength={100} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/></div><div className="field"><label htmlFor="description">ひとこと</label><textarea id="description" value={description} maxLength={1000} rows={3} onChange={e=>{setDescription(e.target.value);setDirty(true);}}/></div><ConfigFields config={config} onChange={value=>{setConfig(value);setDirty(true);}} locked={total>0}/><button className="primary" disabled={busy}>設定を保存する<Check size={17}/></button></form></section><div><section className="panel"><h2>共有するURL</h2><UrlCard label="回答URL" url={base+relativeUrl(event,'reply')}/><UrlCard label="集計URL" url={base+relativeUrl(event,'results')}/></section><section className="panel manage-answers"><h2>回答済み <span className="number-tag">{total}名</span></h2>{meeting.answers.map(answer=><div className="manage-answer" key={answer.id}><span>{answer.name}</span><button className="text-button danger-text" disabled={busy} onClick={()=>setConfirmAction({type:'answer',id:answer.id,name:answer.name})}><Trash2 size={15}/>削除</button></div>)}{!total&&<p className="field-hint">まだ回答はありません。</p>}</section><section className="danger-zone"><h3>調整ページを削除</h3><p>すべての回答も削除されます。元には戻せません。</p><button className="secondary danger-text" onClick={()=>setConfirmAction({type:'event'})} disabled={busy}><Trash2 size={16}/>この調整ページを削除</button></section></div></div></>}
      </>}
      {error&&!meeting&&view!=='create'&&!loading&&<a className="secondary" href="/"><ArrowLeft size={16}/>新しい調整ページをつくる</a>}
    </main>
    <footer className="site-footer"><span>ご都合うかがい君（仮）</span><span>なぞって回答。みんなで決める。</span></footer>
    <dialog ref={dialogRef} className="detail-dialog" onCancel={e=>{if(busy){e.preventDefault();return;}closeDialog();}} onClick={e=>{if(e.target===e.currentTarget&&!busy)closeDialog();}}><button className="dialog-close" aria-label="閉じる" disabled={busy} onClick={closeDialog}><X size={20}/></button>
      {detail&&meeting&&selectedDetail&&<><span className="eyebrow">TIME SLOT DETAILS</span><h2>{slotLabel(detail,config.step)}</h2><p className="field-hint">回答済み {total}名の参加状況</p><div className="detail-group yes"><h3><Check size={16}/>参加可能 <span>{selectedDetail.yes.length}名</span></h3><div className="name-tags">{selectedDetail.yes.map(a=><span key={a.id}>{a.name}</span>)}{!selectedDetail.yes.length&&<p>該当する人はいません。</p>}</div></div><div className="detail-group"><h3>参加不可 <span>{selectedDetail.no.length}名</span></h3><div className="name-tags">{selectedDetail.no.map(a=><span key={a.id}>{a.name}</span>)}{!selectedDetail.no.length&&<p>該当する人はいません。</p>}</div></div></>}
      {confirmAction&&<><h2>{confirmAction.type==='event'?'調整ページを削除しますか？':`${confirmAction.name}さんの回答を削除しますか？`}</h2><p>{confirmAction.type==='event'?'すべての回答と共有URLが使えなくなります。':'この回答は集計からも除かれます。'}この操作は元に戻せません。</p><div className="action-row"><button className="secondary" disabled={busy} onClick={closeDialog}>キャンセル</button><button className="danger-button" disabled={busy} onClick={()=>void remove()}>{busy?'削除しています…':'削除する'}</button></div></>}
      {emptyConfirm&&<><h2>時間を選択せずに保存しますか？</h2><p>すべての時間帯が「参加不可」として集計されます。あとから編集URLで変更できます。</p><div className="action-row"><button className="secondary" onClick={closeDialog}>選択に戻る</button><button className="primary" onClick={()=>void saveAnswer()}>このまま保存</button></div></>}
    </dialog>
  </>;
}

