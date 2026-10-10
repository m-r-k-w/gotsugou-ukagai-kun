import test from 'node:test';
import assert from 'node:assert/strict';
import { randomKey, DEFAULT_CONFIG } from '../lib/schedule.ts';
const origin='http://127.0.0.1:5173';
const config={...DEFAULT_CONFIG,days:[0,1,2,3,4,5,6,7]};
async function call(path='',method='GET',body={},key='',override={}){
  const result=await fetch(origin+'/api/events'+path,{method,headers:{'content-type':'application/json',origin,'x-edit-key':key,...override},...(method!=='GET'?{body:JSON.stringify(body)}:{})});
  const raw=await result.text();
  assert.ok(result.headers.get('content-type')?.includes('application/json'), `${result.status}: ${raw}`);
  return {status:result.status,data:JSON.parse(raw),headers:result.headers};
}
test('共有APIの保存・再編集・集計・権限・入力境界',async t=>{
  const admin=randomKey(),editor=randomKey(),wrong=randomKey();
  let event,answer;
  await t.test('イベント作成',async()=>{const r=await call('','POST',{title:'API検証専用（架空データ）',description:'動作確認',config},admin);assert.equal(r.status,201);event=r.data.id;});
  await t.test('別オリジンからの更新を拒否',async()=>{assert.equal((await call('/'+event,'PATCH',{title:'不正',description:'',config},admin,{origin:'https://example.invalid'})).status,403);});
  await t.test('空の名前・対象外セル・変更済み設定を拒否',async()=>{
    for(const value of [{name:'',slots:[]},{name:'テスト',slots:['0:480']}])assert.equal((await call(`/${event}/answers`,'POST',{...value,config},editor)).status,400);
    assert.equal((await call(`/${event}/answers`,'POST',{name:'テスト',slots:[],config:DEFAULT_CONFIG},editor)).status,409);
  });
  await t.test('祝日を含む回答を保存',async()=>{const r=await call(`/${event}/answers`,'POST',{name:'テストA',slots:['3:1140','7:480'],config},editor);assert.equal(r.status,201);answer=r.data.id;});
  await t.test('再送でも同じ回答を1件だけ保存',async()=>{const r=await call(`/${event}/answers`,'POST',{name:'テストA',slots:['3:1140','7:480'],config},editor);assert.equal(r.data.id,answer);const listing=await call('/'+event);assert.equal(listing.data.answers.length,1);});
  await t.test('集計に秘密キーやハッシュを返さず、キャッシュしない',async()=>{const r=await call('/'+event);assert.equal(r.headers.get('cache-control'),'no-store');const serialized=JSON.stringify(r.data);assert.ok(!serialized.includes('hash'));assert.ok(!serialized.includes(editor));assert.ok(!serialized.includes(admin));});
  await t.test('他人の回答の編集・管理を拒否',async()=>{
    assert.equal((await call(`/${event}/answers/${answer}`,'GET',{},wrong)).status,403);
    assert.equal((await call(`/${event}/answers/${answer}`,'PUT',{name:'不正',slots:[],config},wrong)).status,403);
    assert.equal((await call(`/${event}?manage=1`,'GET',{},wrong)).status,403);
  });
  await t.test('本人の再編集・空の選択保存',async()=>{assert.equal((await call(`/${event}/answers/${answer}`,'PUT',{name:'テストA改',slots:[],config},editor)).status,200);const r=await call(`/${event}/answers/${answer}`,'GET',{},editor);assert.equal(r.data.name,'テストA改');assert.deepEqual(r.data.slots,[]);});
  await t.test('〇・△と自由コメントを保存・復元・集計し、再編集できる',async()=>{
    const comment='隔週なら参加できます。\n<img src=x onerror=alert(1)>\'--';
    const body={name:'テストA改',slots:['3:1140'],tentativeSlots:['7:480'],comment,config};
    assert.equal((await call(`/${event}/answers/${answer}`,'PUT',body,editor)).status,200);
    const restored=await call(`/${event}/answers/${answer}`,'GET',{},editor);
    assert.deepEqual(restored.data.slots,body.slots);assert.deepEqual(restored.data.tentativeSlots,body.tentativeSlots);assert.equal(restored.data.comment,comment);
    const listing=await call('/'+event);assert.equal(listing.data.answers[0].comment,comment);assert.deepEqual(listing.data.answers[0].tentativeSlots,body.tentativeSlots);
    assert.equal((await call(`/${event}/answers/${answer}`,'PUT',{...body,slots:[],tentativeSlots:[],comment:''},editor)).status,200);
  });
  await t.test('〇△重複・不正な△・500文字超コメントを拒否',async()=>{
    for(const value of [{slots:['3:1140'],tentativeSlots:['3:1140']},{slots:[],tentativeSlots:['0:480']},{slots:[],comment:'あ'.repeat(501)},{slots:[],comment:{text:'不正'}}])assert.equal((await call(`/${event}/answers/${answer}`,'PUT',{name:'検証',config,...value},editor)).status,400);
    const r=await call(`/${event}/answers/${answer}`,'GET',{},editor);assert.equal(r.data.name,'テストA改');assert.equal(r.data.comment,'');
  });
  await t.test('回答開始後の時間枠変更を拒否、タイトルは更新可能',async()=>{
    assert.equal((await call('/'+event,'PATCH',{title:'更新',description:'',config:{...config,step:60}},admin)).status,409);
    assert.equal((await call('/'+event,'PATCH',{title:'検証・更新済み',description:'',config},admin)).status,200);
  });
  await t.test('20名を別キーで保存して集計に反映',async()=>{
    const keys=Array.from({length:19},randomKey);
    for(const [index,key] of keys.entries())assert.equal((await call(`/${event}/answers`,'POST',{name:`架空${index+2}`,slots:['3:1140'],config},key)).status,201);
    const r=await call('/'+event);assert.equal(r.data.answers.length,20);assert.equal(r.data.answers.filter(a=>a.slots.includes('3:1140')).length,19);
  });
  await t.test('HTML・SQL風の入力を文字列として保存する',async()=>{
    const text='<img src=x onerror=alert(1)>\'--';
    const r=await call(`/${event}/answers`,'POST',{name:text,slots:[],config},randomKey());assert.equal(r.status,201);
    const listing=await call('/'+event);assert.ok(listing.data.answers.some(a=>a.name===text));assert.equal(listing.data.answers.length,21);
  });
  // Deliberately preserve local test records. Deletion is not needed for this check.
});
