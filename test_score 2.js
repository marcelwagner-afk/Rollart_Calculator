// ====== TEST: Verify score computation with per-sub judge scores ======
// This simulates what happens AFTER the fixes:
// 1. parsePDF now stores per-sub j1,j2,j3
// 2. handleLoadSkater passes per-sub judges to comboEls

const JUMPS = [
  {name:'Waltz',code:'1W',base:0.4,lt:0,ltlt:0,goe:{3:0.3,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.3},combo:0.41,comboLt:0,comboLtLt:0},
  {name:'Toeloop',code:'1T',base:0.6,lt:0.42,ltlt:0.3,goe:{3:0.3,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.3},combo:0.61,comboLt:0.43,comboLtLt:0.31},
  {name:'Salchow',code:'1S',base:0.6,lt:0.42,ltlt:0.3,goe:{3:0.3,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.3},combo:0.61,comboLt:0.43,comboLtLt:0.31},
  {name:'Flip',code:'1F',base:0.8,lt:0.56,ltlt:0.4,goe:{3:0.4,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.4},combo:0.86,comboLt:0.6,comboLtLt:0.43},
  {name:'Loop',code:'1Lo',base:0.9,lt:0.63,ltlt:0.45,goe:{3:0.4,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.4},combo:0.96,comboLt:0.67,comboLtLt:0.48},
  {name:'Thoren',code:'1Th',base:0.9,lt:0.63,ltlt:0.45,goe:{3:0.4,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':-0.4},combo:0.96,comboLt:0.67,comboLtLt:0.48},
  {name:'Axel',code:'1A',base:1.3,lt:0.91,ltlt:0.65,goe:{3:0.4,2:0.3,1:0.2,'m1':-0.2,'m2':-0.3,'m3':-0.4},combo:1.4,comboLt:0.98,comboLtLt:0.7},
];
const SOLO_SPINS = [
  {name:'Upright Spin',code:'U',base:0.5,goe:{3:0.3,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':0}},
  {name:'Sit Spin',code:'S',base:0.8,goe:{3:0.3,2:0.2,1:0.1,'m1':-0.1,'m2':-0.2,'m3':0}},
  {name:'USpB',code:'USpB',base:1.0,goe:{3:0.6,2:0.4,1:0.2,'m1':-0.2,'m2':-0.4,'m3':-0.6}},
  {name:'SSpB',code:'SSpB',base:1.3,goe:{3:0.6,2:0.4,1:0.2,'m1':-0.2,'m2':-0.4,'m3':-0.6}},
];
const COMBO_SPINS = [
  {name:'CSpB',code:'CSpB',base:1.7,goe:{3:0.6,2:0.4,1:0.2,'m1':-0.2,'m2':-0.4,'m3':-0.6}},
  {name:'CSp1',code:'CSp1',base:2.3,goe:{3:0.6,2:0.4,1:0.2,'m1':-0.2,'m2':-0.4,'m3':-0.6}},
];
const STEP_SEQUENCES = [
  {name:'StB',code:'StB',base:1.8,goe:{3:0.9,2:0.6,1:0.3,'m1':-0.3,'m2':-0.6,'m3':-1}},
  {name:'St1',code:'St1',base:2.3,goe:{3:0.9,2:0.6,1:0.3,'m1':-0.3,'m2':-0.6,'m3':-1}},
];

const ELEMENT_TYPES = [
  {code:'CoJ',label:'Combination Jump',data:JUMPS,isCombo:true,hasRotation:true},
  {code:'SJu',label:'Solo Jump',data:JUMPS,isCombo:false,hasRotation:true},
  {code:'CSp',label:'Combination Spin',data:COMBO_SPINS,isCombo:true,hasRotation:false},
  {code:'SSp',label:'Solo Spin',data:SOLO_SPINS,isCombo:false,hasRotation:false},
  {code:'FoSq',label:'Footwork Sequence',data:STEP_SEQUENCES,isCombo:false,hasRotation:false},
];

const getBase = (el, isCombo, rotation) => {
  if (!el) return 0;
  if (isCombo && el.combo !== undefined) {
    if (rotation==='lt') return el.comboLt||0;
    if (rotation==='ltlt') return el.comboLtLt||0;
    return el.combo;
  }
  if (el.lt !== undefined) {
    if (rotation==='lt') return el.lt||0;
    if (rotation==='ltlt') return el.ltlt||0;
  }
  return el.base;
};

const getGoePoints = (el, goeInt) => {
  if (!el || goeInt===0) return 0;
  if (goeInt>0) return el.goe[goeInt]||0;
  return el.goe['m'+Math.abs(goeInt)]||0;
};

const calcJudgeGoe = (el, judgeScores, jCount) => {
  if (!el || !judgeScores) return 0;
  const scores = judgeScores.slice(0, jCount);
  if (scores.every(g=>g===0)) return 0;
  const points = scores.map(g => getGoePoints(el, g));
  if (jCount===5) {
    const sorted = [...points].sort((a,b)=>a-b);
    return Math.round((sorted.slice(1,4).reduce((s,v)=>s+v,0)/3)*100)/100;
  }
  return Math.round((points.reduce((s,v)=>s+v,0)/jCount)*100)/100;
};

const computeRow = (row, types, jCount) => {
  const typeDef = types.find(t=>t.code===row.typeCode);
  if (!typeDef) return {base:0,goeVal:0,score:0};
  if (row.nv) return {base:0,goeVal:0,score:0};
  const dgFactor = row.dg ? 0.5 : 1;

  if (typeDef.isCombo) {
    const subs = row.comboEls || [];
    const hasComboValues = typeDef.data.some(e=>e.combo!==undefined);
    let totalBase = 0, totalGoe = 0;
    subs.forEach(sub => {
      const el = typeDef.data.find(e=>e.code===sub.code);
      if (!el) return;
      if (!sub.nv) {
        const b = hasComboValues ? getBase(el, true, sub.rotation||'normal') : el.base;
        totalBase += b;
        const subGoe = calcJudgeGoe(el, sub.judgeGoe||[0,0,0,0,0], jCount);
        totalGoe += subGoe;
      }
    });
    totalBase = Math.round(totalBase * dgFactor * 100) / 100;
    totalGoe = Math.round(totalGoe * 100) / 100;
    return {base:totalBase,goeVal:totalGoe,score:totalBase+totalGoe};
  } else {
    const el = typeDef.data.find(e=>e.code===row.elCode);
    if (!el) return {base:0,goeVal:0,score:0};
    const base = Math.round(getBase(el, false, row.rotation||'normal') * dgFactor * 100) / 100;
    const goeVal = calcJudgeGoe(el, row.judgeGoe, jCount);
    return {base,goeVal,score:base+goeVal};
  }
};

// =========================================================
// TEST 1: With per-sub judge scores (FIXED behavior)
// =========================================================
console.log("=== TEST 1: With per-sub judge scores (FIXED) ===\n");

// Simulating a Tots skater from PDF:
// Elements as stored in PDF with per-sub judges now included
const storedElements = [
  { type: "Jump", typeCode: "SJu", elCode: "1Lo", base: 0.90, judges: [0,0,0], subElements: [] },
  { type: "Jump", typeCode: "SJu", elCode: "1W", base: 0.40, judges: [0,0,0], subElements: [] },
  { type: "ComboJump", typeCode: "CoJ", elCode: "", base: 1.22,
    judges: [0,-1,0],  // first sub's judges (legacy)
    subElements: [
      { code: "1T", base: 0.61, j1: 0, j2: -1, j3: 0 },  // NOW includes j1,j2,j3!
      { code: "1S", base: 0.61, j1: 0, j2: -1, j3: 0 },
    ]
  },
  { type: "Jump", typeCode: "SJu", elCode: "1F", base: 0.80, judges: [1,0,1], subElements: [] },
  { type: "ComboSpin", typeCode: "CSp", elCode: "", base: 1.70,
    judges: [-1,-1,-1],
    subElements: [
      { code: "CSpB", base: 1.70, j1: -1, j2: -1, j3: -1 },
    ]
  },
  { type: "Spin", typeCode: "SSp", elCode: "U", base: 0.50, judges: [0,0,0], subElements: [] },
  { type: "Step Sequence", typeCode: "FoSq", elCode: "StB", base: 1.80, judges: [0,1,0], subElements: [] },
];

// Simulate handleLoadSkater mapping (FIXED version)
const padJudges = (arr) => { const a = arr || [0,0,0,0,0]; while (a.length < 5) a.push(0); return a.slice(0,5); };

const rows = storedElements.map(el => {
  const jGoe = padJudges(el.judges);

  if (el.type === "ComboJump" && el.subElements.length > 0) {
    return {
      typeCode: "CoJ", elCode: "",
      judgeGoe: jGoe,
      rotation: "normal",
      comboEls: el.subElements.map(s => ({
        code: s.code, rotation: "normal", nv: false,
        judgeGoe: padJudges([s.j1||0, s.j2||0, s.j3||0]),  // FIXED: per-sub judges
      })),
      nv: false, dg: false, bonuses: [],
    };
  }

  if (el.type === "ComboSpin" && el.typeCode === "CSp") {
    return {
      typeCode: "CSp", elCode: "",
      judgeGoe: jGoe,
      rotation: "normal",
      comboEls: [{
        code: "CSpB", rotation: "normal", nv: false,
        judgeGoe: jGoe,
      }],
      nv: false, dg: false, bonuses: [],
    };
  }

  return {
    typeCode: el.typeCode, elCode: el.elCode,
    judgeGoe: jGoe,
    rotation: "normal", comboEls: [],
    nv: false, dg: false, bonuses: [],
  };
});

const jCount = 3;
let totalTES = 0;

rows.forEach((r,i) => {
  const res = computeRow(r, ELEMENT_TYPES, jCount);
  totalTES += res.score;
  const label = r.typeCode + ' ' + (r.elCode || r.comboEls.map(c=>c.code).join('+'));
  console.log(`  ${i+1}. ${label.padEnd(15)} base=${res.base.toFixed(2)}  goe=${res.goeVal.toFixed(2)}  score=${res.score.toFixed(2)}`);
});

console.log(`\n  TES Total: ${totalTES.toFixed(2)}`);

// PCS
const calcPcsAvg = (scores, jCount) => {
  const s = scores.slice(0, jCount);
  if (s.every(v=>v===0)) return 0;
  return Math.round((s.reduce((a,v)=>a+v,0)/jCount)*100)/100;
};

const pcs = {skating:[2.5,2.75,2.5,0,0],transitions:[2.25,2.5,2.25,0,0],performance:[2.5,2.75,2.5,0,0],choreography:[2.25,2.5,2.25,0,0]};
const pcsFactor = 0.8;
let totalPCS = 0;

console.log("\n  PCS (factor " + pcsFactor + "):");
['skating','transitions','performance','choreography'].forEach(key => {
  const avg = calcPcsAvg(pcs[key], jCount);
  const sc = Math.round(avg * pcsFactor * 100) / 100;
  totalPCS += sc;
  console.log(`    ${key.padEnd(15)}: judges ${pcs[key].slice(0,3)} -> avg=${avg.toFixed(2)} x${pcsFactor} = ${sc.toFixed(2)}`);
});
console.log(`  PCS Total: ${totalPCS.toFixed(2)}`);

const ded = 0.5;
const finalTotal = totalTES + totalPCS - ded;
console.log(`\n  Deductions: -${ded.toFixed(2)}`);
console.log(`  =============================`);
console.log(`  FINAL TOTAL: ${finalTotal.toFixed(2)}`);
console.log(`  (Expected from PDF: ~12.15)`);

// =========================================================
// TEST 2: Compare OLD behavior (no per-sub judges)
// =========================================================
console.log("\n\n=== TEST 2: OLD behavior (per-sub judges lost = [0,0,0,0,0]) ===\n");

const oldRows = storedElements.map(el => {
  const jGoe = padJudges(el.judges);

  if (el.type === "ComboJump" && el.subElements.length > 0) {
    return {
      typeCode: "CoJ", elCode: "",
      judgeGoe: jGoe,
      rotation: "normal",
      comboEls: el.subElements.map(s => ({
        code: s.code, rotation: "normal", nv: false,
        judgeGoe: padJudges(null),  // OLD: always [0,0,0,0,0]
      })),
      nv: false, dg: false, bonuses: [],
    };
  }

  if (el.type === "ComboSpin" && el.typeCode === "CSp") {
    return {
      typeCode: "CSp", elCode: "",
      judgeGoe: jGoe,
      rotation: "normal",
      comboEls: [{
        code: "CSpB", rotation: "normal", nv: false,
        judgeGoe: jGoe,
      }],
      nv: false, dg: false, bonuses: [],
    };
  }

  return {
    typeCode: el.typeCode, elCode: el.elCode,
    judgeGoe: jGoe,
    rotation: "normal", comboEls: [],
    nv: false, dg: false, bonuses: [],
  };
});

let oldTotalTES = 0;
oldRows.forEach((r,i) => {
  const res = computeRow(r, ELEMENT_TYPES, jCount);
  oldTotalTES += res.score;
  const label = r.typeCode + ' ' + (r.elCode || r.comboEls.map(c=>c.code).join('+'));
  console.log(`  ${i+1}. ${label.padEnd(15)} base=${res.base.toFixed(2)}  goe=${res.goeVal.toFixed(2)}  score=${res.score.toFixed(2)}`);
});
console.log(`\n  OLD TES Total: ${oldTotalTES.toFixed(2)}`);
console.log(`  DIFF: ${(totalTES - oldTotalTES).toFixed(2)} (from per-sub judge fix)`);
