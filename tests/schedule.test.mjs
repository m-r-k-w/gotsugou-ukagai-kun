import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig, allSlots, validateSlots, rankSlots, strokePoints, randomKey, validateName } from '../lib/schedule.ts';

test('平日30分・土日祝8〜22時は独立した有効枠になる',()=>{
  const config=validateConfig({...DEFAULT_CONFIG,days:[0,1,2,3,4,5,6,7]});
  const slots=allSlots(config);
  assert.equal(slots.length,5*8+3*28);
  assert.ok(slots.includes('5:480'));
  assert.ok(slots.includes('7:1290'));
  assert.ok(!slots.includes('0:480'));
  assert.ok(!slots.includes('7:1320'));
});
test('不正な曜日・時刻・刻み幅を拒否する',()=>{
  for (const invalid of [{days:[]},{days:[1,1]},{days:[8]},{start:1320},{end:1500},{start:1081},{step:15},{step:60,end:1290}]) assert.throws(()=>validateConfig({...DEFAULT_CONFIG,...invalid}));
});
test('対象外・重複・非配列の回答を拒否する',()=>{
  for(const invalid of [['0:480'],['0:1080','0:1080'],['7:1080'],'0:1080']) assert.throws(()=>validateSlots(invalid,DEFAULT_CONFIG));
  assert.deepEqual(validateSlots([],DEFAULT_CONFIG),[]);
});
test('ランキングは人数順・同率は同順位・重複は二重計上しない',()=>{
  const meeting={config:DEFAULT_CONFIG,answers:[{slots:['0:1080','0:1080','1:1080']},{slots:['1:1080','2:1080']},{slots:['0:1080','2:1080']}]};
  const ranks=rankSlots(meeting);
  assert.deepEqual(ranks.slice(0,3).map(r=>[r.count,r.rank]),[[2,1],[2,1],[2,1]]);
  assert.equal(ranks[3].rank,4);
});
test('20人の全員一致を正しく集計する',()=>{
  const ranks=rankSlots({config:DEFAULT_CONFIG,answers:Array.from({length:20},()=>({slots:['3:1140']}))});
  assert.equal(ranks[0].count,20);assert.equal(ranks[0].key,'3:1140');
});
test('回答0件と全員未選択では人数0',()=>{
  for(const answers of [[],[{slots:[]}]]) assert.ok(rankSlots({config:DEFAULT_CONFIG,answers}).every(r=>r.count===0));
});
test('高速・逆方向・斜めドラッグの補間は6px以内',()=>{
  for(const end of [{x:0,y:500},{x:-170,y:-330},{x:800,y:120}]) {
    let previous={x:0,y:0};const points=strokePoints(previous,end);
    for(const point of points){assert.ok(Math.hypot(point.x-previous.x,point.y-previous.y)<=6.0001);previous=point;}
    assert.deepEqual(points.at(-1),end);
  }
});
test('名前の必須・長さと編集キーの形式',()=>{
  assert.equal(validateName('  ニックネーム  '),'ニックネーム');
  for(const name of ['',null,' '.repeat(3),'あ'.repeat(41)])assert.throws(()=>validateName(name));
  const keys=Array.from({length:100},randomKey);assert.equal(new Set(keys).size,100);assert.ok(keys.every(k=>/^[a-f0-9]{64}$/.test(k)));
});
