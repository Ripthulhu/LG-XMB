'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const inputs = require('../app/input-discovery.js');
const Categories = require('../app/app-categories.js');
const Order = require('../app/menu-order.js');
const hdmi = n => ({id:`HDMI_${n}`, appId:`com.webos.app.hdmi${n}`, port:n, connected:false});
const analog = [
  {id:'AV_1', appId:'com.webos.app.externalinput.av1', port:1, label:'AV', connected:false},
  {id:'COMP_1', appId:'com.webos.app.externalinput.component', port:1, label:'Component', connected:false}
];
function model() {
  const cats = [
    {id:'tv',title:'TV',items:[{id:'com.webos.app.livetv',title:'Live TV'}, ...[1,2,3,4].map(n=>inputs.item(inputs.normalize([hdmi(n)])[0]))]},
    {id:'apps',title:'Apps',items:[]}
  ];
  const storage = {getItem(){return null;},setItem(){throw Error('Discovery must not write preferences');}};
  const order = new Order(cats, storage);
  const selections=[2,0], model=new Categories(cats,order,storage);
  model.reconcile([{id:'com.webos.app.livetv',title:'Live TV'}],selections);
  return {cats,order,selections,model};
}

test('input discovery uses the device inventory, without assuming four HDMI sockets', () => {
  for (const count of [0,1,2,3,4,5]) {
    const devices = Array.from({length:count},(_,i)=>hdmi(i+1));
    assert.deepEqual(inputs.normalize(devices).map(x=>x.port),devices.map(x=>x.port));
  }
});

test('analog inputs retain native app IDs and stay separate from HDMI previews', () => {
  const result = inputs.normalize([hdmi(1),...analog]);
  assert.deepEqual(result.map(x=>x.kind),['hdmi','av','component']);
  assert.deepEqual(result.map(inputs.item).map(x=>[x.id,x.icon,x.action]),[
    ['com.webos.app.hdmi1','hdmi','input'],
    ['com.webos.app.externalinput.av1','live','input'],
    ['com.webos.app.externalinput.component','live','input']
  ]);
});

test('numeric string ports from older replies are accepted only when they match the ID', () => {
  assert.equal(inputs.normalize([{...hdmi(2),port:'2'}]).length,1);
  for (const port of ['02','2;reboot','3',2.5,null])
    assert.deepEqual(inputs.normalize([{...hdmi(2),port}]),[]);
});

test('virtual or contradictory analog sources cannot become launcher targets', () => {
  assert.deepEqual(inputs.normalize([
    {...analog[0],id:'HDMI_1'}, {...analog[1],port:2},
    {id:'AV_1',port:1,appId:'com.example.player',label:'AV'},
    {id:'WIDI_1',port:1,appId:'com.webos.app.widi',label:'Wireless'}
  ]),[]);
});

test('input reconciliation removes absent sockets and preserves app rows, selection and order', () => {
  const f=model(), live=f.cats[0].items[0], hdmi2=f.cats[0].items[2];
  assert.equal(f.model.reconcileInputs(inputs.normalize([hdmi(1),hdmi(2),...analog]),f.selections),true);
  assert.deepEqual(f.cats[0].items.map(x=>x.id),[live.id,'com.webos.app.hdmi1',hdmi2.id,...analog.map(x=>x.appId)]);
  assert.equal(f.cats[0].items[0],live);
  assert.equal(f.cats[0].items[2],hdmi2);
  assert.equal(f.selections[0],2);
  assert.equal(f.model.reconcileInputs(inputs.normalize([hdmi(1),hdmi(2),...analog]),f.selections),false);
});

test('application refresh cannot resurrect phantom inputs or duplicate them under Apps', () => {
  const f=model();
  f.model.reconcileInputs(inputs.normalize([hdmi(1)]),f.selections);
  f.model.reconcile([...[1,2,3,4].map(n=>({id:`com.webos.app.hdmi${n}`,title:`HDMI ${n}`})),
    {id:analog[0].appId,title:'AV'}, {id:'com.webos.app.livetv',title:'Live TV'}, {id:'netflix',title:'Netflix'}], f.selections);
  assert.deepEqual(f.cats[0].items.map(x=>x.id),['com.webos.app.livetv','com.webos.app.hdmi1']);
  assert.deepEqual(f.cats[1].items.map(x=>x.id),['netflix']);
});

test('labels update existing objects, sorted selection survives, empty inventory removes only inputs', () => {
  const f=model();
  f.model.reconcileInputs(inputs.normalize([hdmi(1),hdmi(2)]),f.selections);
  f.order.modes.tv='az';
  f.order.apply(f.cats[0],'com.webos.app.hdmi2');
  const old=f.cats[0].items.find(x=>x.id==='com.webos.app.hdmi2');
  f.selections[0]=f.cats[0].items.indexOf(old);
  assert.equal(f.model.reconcileInputs(inputs.normalize([hdmi(1),{...hdmi(2),label:'A console'}]),f.selections),true);
  assert.equal(f.cats[0].items[f.selections[0]],old);
  assert.equal(old.title,'A console');
  f.model.reconcileInputs([],f.selections);
  assert.deepEqual(f.cats[0].items.map(x=>x.id),['com.webos.app.livetv']);
  assert.equal(f.selections[0],0);
});


test('SCART accepts the unnumbered source ID used by the stock key router', () => {
  const native = {id:'SCART',port:1,appId:'com.webos.app.externalinput.scart',label:'SCART'};
  assert.equal(inputs.normalize([native])[0].kind,'scart');
  assert.equal(inputs.item(inputs.normalize([native])[0]).description,'Switch to SCART.');
  assert.deepEqual(inputs.normalize([{...native,id:'SCART_2'}]),[]);
});
