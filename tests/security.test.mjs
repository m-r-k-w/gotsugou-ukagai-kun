import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { enforceLimits, writePolicies, RateLimitError } from '../lib/rate-limit.ts';
import { createBackup, verifyBackup } from '../lib/backup.ts';
import { DEFAULT_CONFIG } from '../lib/schedule.ts';

const secret='local-test-only-'+'a'.repeat(64);
function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE request_limits (id TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE INDEX request_limits_expiry_idx ON request_limits(expires_at)');
  const db={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async run(){return sqlite.prepare(sql).run(...values);},async first(){return sqlite.prepare(sql).get(...values)??null;}};}};
  return {sqlite,db};
}
test('同時投稿を含めてSQLが上限を厳守し、期限後には再操作できる',async()=>{
  const {sqlite,db}=database();
  try {
    const policy=[{scope:'test',subject:'192.0.2.1',limit:7,seconds:60}];
    const results=await Promise.allSettled(Array.from({length:20},()=>enforceLimits(db,secret,policy,1000)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,7);
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason instanceof RateLimitError && r.reason.retryAfter===59));
    const rows=sqlite.prepare('SELECT * FROM request_limits').all();assert.equal(rows.length,1);assert.equal(rows[0].hits,7);assert.ok(!rows[0].id.includes('192.0.2.1'));
    await enforceLimits(db,secret,policy,60000);assert.equal(sqlite.prepare('SELECT hits FROM request_limits').get().hits,1);
  } finally {sqlite.close();}
});
test('IPの上限を超えた投稿は全体の作成枠を消費せず、鍵を変えても逃れられない',async()=>{
  const {sqlite,db}=database();
  try {
    const make=key=>new Request('https://example.invalid/api/events',{headers:{'cf-connecting-ip':'192.0.2.9','x-edit-key':key}});
    for(let i=0;i<10;i++)await enforceLimits(db,secret,writePolicies(make(String(i)),true),1000);
    await assert.rejects(()=>enforceLimits(db,secret,writePolicies(make('changed'),true),1000),RateLimitError);
    assert.deepEqual(sqlite.prepare('SELECT hits FROM request_limits ORDER BY hits').all().map(r=>r.hits),[10,10,11]);
    assert.deepEqual(writePolicies(new Request('https://example.invalid',{headers:{'x-forwarded-for':'spoof'}}),false),[{scope:'writes',subject:'unavailable',limit:120,seconds:600}]);
  } finally {sqlite.close();}
});
test('同じ時間帯でも署名鍵が違えば接続元の識別子は一致しない',async()=>{
  const {sqlite,db}=database();
  try {
    const policies=[{scope:'test',subject:'192.0.2.1',limit:1,seconds:60}];
    await enforceLimits(db,secret,policies,1000);await enforceLimits(db,'b'.repeat(64),policies,1000);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM request_limits').get().count,2);
  } finally {sqlite.close();}
});

const eventId='11111111-1111-4111-8111-111111111111', adminHash='a'.repeat(64);
function sample() {return {version:1,event:{id:eventId,title:'検証',description:'架空データ',config:JSON.stringify(DEFAULT_CONFIG),adminHash,createdAt:1000},answers:[{id:'22222222-2222-4222-8222-222222222222',name:'テスト',slots:JSON.stringify({slots:['0:1080'],tentativeSlots:['1:1080'],comment:'隔週なら可'}),editHash:'b'.repeat(64),updatedAt:2000}]};}
test('正しい鍵と管理URLで回答・コメント・元の編集権限を復元できる',async()=>{
  const data=sample(), file=await createBackup(data,secret);
  assert.deepEqual(await verifyBackup(file,secret,eventId,adminHash),data);
  data.answers[0].slots=JSON.stringify(['0:1080']);assert.deepEqual(await verifyBackup(await createBackup(data,secret),secret,eventId,adminHash),data);
});
test('改変・別の鍵・別のページ・別の管理権限による復旧は拒否',async()=>{
  const file=await createBackup(sample(),secret);
  await assert.rejects(()=>verifyBackup({...file,payload:file.payload.replace('検証','改変')},secret,eventId,adminHash));
  await assert.rejects(()=>verifyBackup(file,'c'.repeat(64),eventId,adminHash));
  await assert.rejects(()=>verifyBackup(file,secret,'33333333-3333-4333-8333-333333333333',adminHash));
  await assert.rejects(()=>verifyBackup(file,secret,eventId,'c'.repeat(64)));
  await assert.rejects(()=>verifyBackup({format:'gotsugou-backup',payload:'{}',signature:'z'.repeat(64)},secret,eventId,adminHash));
});
test('署名があっても不正な回答・重複ID・件数超過は拒否',async()=>{
  for(const change of [data=>data.answers[0].slots=JSON.stringify({slots:['7:0']}),data=>data.answers.push({...data.answers[0]}),data=>data.answers=Array.from({length:101},()=>data.answers[0]),data=>data.event.createdAt=-1]) {
    const data=sample();change(data);await assert.rejects(()=>createBackup(data,secret).then(file=>verifyBackup(file,secret,eventId,adminHash)));
  }
});
