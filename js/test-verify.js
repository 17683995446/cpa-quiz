// 简洁验证脚本 - 验证R18-001修复
global.window = { addEventListener:()=>{}, removeEventListener:()=>{}, location:{hash:'',hostname:'localhost'}, history:{pushState:()=>{},replaceState:()=>{}}, localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}, setTimeout:setTimeout, setInterval:setInterval, clearTimeout:clearTimeout, clearInterval:clearInterval, Date:Date, JSON:JSON, console:console, alert:()=>{}, confirm:()=>true, performance:{now:()=>0} };
global.document = { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], addEventListener:()=>{}, removeEventListener:()=>{}, title:'', body:{innerHTML:''}, createElement:()=>({style:{},classList:{add:()=>{},remove:()=>{},contains:()=>false},appendChild:()=>{},setAttribute:()=>{},remove:()=>{}}), createDocumentFragment:()=>({appendChild:()=>{},childNodes:[]}) };
global.showToast = () => {};
global.escapeHtml = (t) => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
global.CONSTANTS = { DAILY_QUIZ_COUNT:10, SEARCH_MIN_LENGTH:2, SEARCH_MAX_LENGTH:50, MS_PER_DAY:86400000, DAILY_HISTORY_DAYS:30 };
global.SUBJECTS_CONFIG = { accounting:{id:'accounting',name:'会计',color:'#6366f1'} };
global.getSubjectQuestions = () => [{id:1,type:'single',question:'Q',options:[{letter:'A',content:'A'}],answer:'A',chapter:'Ch1',difficulty:'中等'}];
global.searchQuestions = () => [];
global.AppState = {};
global.DebounceLock = { locks:new Map(), isLocked(){return false}, clear(){}, clearAll(){} };
global.L = () => {}; // 日志函数占位

const fs = require('fs');
const code = fs.readFileSync('/workspace/cpa-quiz/js/app.js','utf8');

// 提取Storage代码（第55行到第465行）
const lines = code.split('\n');
const storageCode = lines.slice(54, 465).join('\n');
eval(storageCode);

let passed=0, failed=0;
function test(name,fn){try{fn();passed++;console.log('✅ '+name)}catch(e){failed++;console.log('❌ '+name+': '+e.message)}}
function assert(c,msg){if(!c)throw new Error(msg||'assert failed')}

// === 核心修复验证 ===

// R18-001: updateStats首次调用不应崩溃
test('R18-001: updateStats首次调用(单题模式)',()=>{
    // 模拟首次使用：localStorage中无stats数据
    Storage.set('stats', null);
    Storage.updateStats(true, 'accounting');
    const stats = Storage.get('stats');
    assert(stats.totalAnswered === 1, 'totalAnswered应为1, 实际:'+stats.totalAnswered);
    assert(stats.totalCorrect === 1, 'totalCorrect应为1, 实际:'+stats.totalCorrect);
    assert(stats.subjectStats.accounting.answered === 1, 'accounting.answered应为1');
    assert(stats.subjectStats.accounting.correct === 1, 'accounting.correct应为1');
    Storage.set('stats', null);
});

test('R18-001: updateStats首次调用(批量模式)',()=>{
    Storage.set('stats', null);
    Storage.updateStats(8, 10);
    const stats = Storage.get('stats');
    assert(stats.totalAnswered === 10, 'totalAnswered应为10');
    assert(stats.totalCorrect === 8, 'totalCorrect应为8');
    Storage.set('stats', null);
});

test('R18-001: updateStats连续调用',()=>{
    Storage.set('stats', null);
    Storage.updateStats(true, 'accounting');
    Storage.updateStats(false, 'accounting');
    Storage.updateStats(true, 'accounting');
    const stats = Storage.get('stats');
    assert(stats.totalAnswered === 3, 'totalAnswered应为3');
    assert(stats.totalCorrect === 2, 'totalCorrect应为2');
    assert(stats.subjectStats.accounting.answered === 3, 'accounting.answered应为3');
    assert(stats.subjectStats.accounting.correct === 2, 'accounting.correct应为2');
    Storage.set('stats', null);
});

// Storage基础功能
test('Storage.get/set往返',()=>{
    Storage.set('k1',{a:1,b:'hello'});
    const r = Storage.get('k1');
    assert(r.a===1 && r.b==='hello');
    Storage.set('k1',null);
});

test('Storage.update原子操作',()=>{
    Storage.set('ctr',{count:0});
    Storage.update('ctr',(d)=>{d.count++;return d},{count:0});
    assert(Storage.get('ctr').count===1);
    Storage.set('ctr',null);
});

test('Storage.toggleFavorite添加',()=>{
    Storage.set('favorites',[]);
    assert(Storage.toggleFavorite('accounting_1','accounting')===true);
    assert(Storage.getFavorites().length===1);
    Storage.set('favorites',null);
});

test('Storage.toggleFavorite取消',()=>{
    Storage.set('favorites',[{key:'accounting_1',subjectId:'accounting',addedAt:Date.now()}]);
    assert(Storage.toggleFavorite('accounting_1','accounting')===false);
    assert(Storage.getFavorites().length===0);
    Storage.set('favorites',null);
});

test('Storage.addWrongQuestion',()=>{
    Storage.set('wrong_questions',[]);
    Storage.addWrongQuestion('accounting_1','accounting');
    assert(Storage.getWrongQuestions().length===1);
    Storage.set('wrong_questions',null);
});

test('Storage.addWrongQuestion不重复',()=>{
    Storage.set('wrong_questions',[{key:'accounting_1',subjectId:'accounting',addedAt:Date.now()}]);
    Storage.addWrongQuestion('accounting_1','accounting');
    assert(Storage.getWrongQuestions().length===1);
    Storage.set('wrong_questions',null);
});

test('Storage.removeWrongQuestion',()=>{
    Storage.set('wrong_questions',[{key:'accounting_1',subjectId:'accounting',addedAt:Date.now()}]);
    Storage.removeWrongQuestion('accounting_1');
    assert(Storage.getWrongQuestions().length===0);
    Storage.set('wrong_questions',null);
});

test('Storage.saveNote',()=>{
    Storage.set('notes',[]);
    Storage.saveNote('accounting_1','测试笔记',['tag1']);
    assert(Storage.get('notes',[]).length===1);
    Storage.set('notes',null);
});

test('Storage.deleteNote',()=>{
    Storage.set('notes',[{key:'accounting_1',content:'test',tags:[],addedAt:Date.now()}]);
    Storage.deleteNote('accounting_1');
    assert(Storage.get('notes',[]).length===0);
    Storage.set('notes',null);
});

test('Storage.getDailyStatus无记录',()=>{
    Storage.set('daily_status',null);
    assert(Storage.getDailyStatus()===false);
});

test('Storage.setDailyStatus',()=>{
    Storage.setDailyStatus();
    assert(Storage.getDailyStatus()===true);
    Storage.set('daily_status',null);
});

test('Storage._cleanupOldData递归保护',()=>{
    Storage._isCleaning = true;
    Storage._cleanupOldData();
    Storage._isCleaning = false;
});

test('Storage._cleanupOldData正常清理',()=>{
    Storage.set('wrong_questions',Array.from({length:600},(_,i)=>({key:'k_'+i,subjectId:'accounting',addedAt:Date.now()-i})));
    Storage.set('favorites',Array.from({length:600},(_,i)=>({key:'f_'+i,subjectId:'accounting',addedAt:Date.now()-i})));
    Storage._cleanupOldData();
    assert(Storage.get('wrong_questions',[]).length<=500);
    assert(Storage.get('favorites',[]).length<=500);
    Storage.set('wrong_questions',null);
    Storage.set('favorites',null);
});

test('Storage.update异常返回默认值',()=>{
    Storage.set('test_err',{val:1});
    const r = Storage.update('test_err',()=>{throw new Error('test')},{val:0});
    assert(r.val===0);
});

console.log('\n=== 结果: '+passed+' 通过, '+failed+' 失败 ===');
if(failed>0) process.exit(1);
