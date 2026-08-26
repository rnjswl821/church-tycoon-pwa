'use strict';

/* ===================== 데이터 정의 ===================== */

const STORAGE_KEY = 'church-tycoon-save-v1';
/* 저장슬롯 3개(오너 지시) — 슬롯1은 항상 자동저장되는 "지금 진행 중인 게임" 그 자체(기존
   STORAGE_KEY 그대로, 하위호환 유지). 슬롯2·3은 자동저장되지 않는 수동 스냅샷으로, 원하는
   시점에 "슬롯에 저장"을 눌러야 채워진다. 내보내기(파일 다운로드) 시 이 3개 중 고를 수 있다. */
const SAVE_SLOT_KEYS = { 1: STORAGE_KEY, 2: 'church-tycoon-save-v1-slot2', 3: 'church-tycoon-save-v1-slot3' };

/* 10단계 성장 시대(오너 지시로 5→10 확장) — 식물의 생장 과정을 그대로 따라간다.
   이벤트 해금 등 게임 로직은 이 배열의 인덱스가 아니라 아래 EVENT_TIER_* 상수를 직접
   참조하므로, 여기 이름·개수·경계값을 바꿔도 게임 밸런스에는 영향이 없다. */
const TIERS = [
  { key: 'seed',    name: '씨앗교회',     min: 0,   msg: '작은 씨앗 하나로 시작합니다. 몇 안 되는 성도들이 모여 함께 예배드립니다.' },
  { key: 'root',    name: '뿌리교회',     min: 20,  msg: '땅 깊이 뿌리를 내렸습니다. 흔들리지 않는 믿음의 기초가 든든히 섰습니다.' },
  { key: 'sprout',  name: '새싹교회',     min: 45,  msg: '새싹이 돋았습니다! 서로를 알아가는 가족 같은 공동체로 자라고 있습니다.' },
  { key: 'stem',    name: '줄기교회',     min: 80,  msg: '줄기가 곧게 자랐습니다. 여러 사역과 직분이 하나의 몸처럼 세워지고 있습니다.' },
  { key: 'tree',    name: '나무교회',     min: 130, msg: '든든한 나무처럼 자라났습니다. 지역사회의 쉼터가 되어가고 있습니다.' },
  { key: 'bud',     name: '봉오리교회',   min: 200, msg: '꽃봉오리가 맺혔습니다. 다음세대와 여러 공동체가 함께 피어날 준비를 합니다.' },
  { key: 'flower',  name: '꽃교회',       min: 300, msg: '아름다운 꽃을 피웠습니다. 지역사회에 향기로운 소문이 퍼져나갑니다.' },
  { key: 'fruit',   name: '열매교회',     min: 450, msg: '첫 열매를 맺었습니다. 다양한 사역과 세대가 어우러지는 교회가 되었습니다.' },
  { key: 'forest',  name: '숲교회',       min: 650, msg: '숲을 이루었습니다. 이제 이 교회는 더 많은 이웃 공동체를 섬기고 세우는 역할을 합니다.' },
  { key: 'garden',  name: '축복의동산',   min: 900, msg: '축복의 동산을 이루었습니다. 씨앗 하나로 시작한 여정이 많은 생명을 품는 터전이 되었습니다.' },
];

/* 이벤트·기관 해금에 쓰는 성장 구간 — TIERS 표시용 이름·개수와 분리된 안정적인 상수. */
const EVENT_TIER_SPROUT = 30;
const EVENT_TIER_FRUIT = 100;
const EVENT_TIER_TREE = 300;
const EVENT_TIER_MEGA = 1000;

/* 성장 단계 100레벨(오너 지시) — 위 5개 시대(TIERS)의 이름·마일스톤 대사는 그대로 두고,
   그 안을 성도수 기준 100단계로 잘게 나눈 "보조 눈금"이다. 이벤트 해금 등 게임 로직은
   전부 TIERS를 그대로 참조하므로(EVENT_TIER_SPROUT 등) LEVELS는 순수 표시용이며 로직에
   영향을 주지 않는다. 초반 구간을 촘촘하게, 후반 구간을 성기게 잡아(제곱 곡선) 플레이
   시간이 많이 몰리는 초중반에 레벨업 피드백이 자주 오도록 했다. */
const LEVELS = (function () {
  /* Lv.1→Lv.2는 성도 15명(오너 확정 — 새 게임 시작 성도수 12명보다 확실히 위).
     그 뒤로는 레벨마다 요구 증가폭 자체가 점점 커지는 등차수열이라 "갈수록 어려워지는"
     체감 곡선이 된다(레벨100 ≈ 성도 9,600명대 — 오너 지시로 최대 1만명 규모까지 확장). */
  const arr = [{ level: 1, min: 0 }, { level: 2, min: 15 }];
  let cur = 15;
  let gap = 1;
  const GAP_GROWTH = 2.0; // Lv.100 ≈ 9,600명대(오너 지시 — 최대 1만명 교회까지 성장)
  for (let lvl = 3; lvl <= 100; lvl++) {
    cur += Math.round(gap);
    arr.push({ level: lvl, min: cur });
    gap += GAP_GROWTH;
  }
  return arr;
})();

function currentLevel(members) {
  let lv = LEVELS[0];
  for (const l of LEVELS) if (members >= l.min) lv = l; else break;
  return lv;
}
function nextLevel(members) {
  for (const l of LEVELS) if (members < l.min) return l;
  return null;
}

const BUILDINGS = {
  /* 예배당·교육관은 돈만으로 업그레이드할 수 없다(오너 지시) — 이미 그만큼 성도가 모여
     "더는 못 담을 만큼" 찼을 때만 확장이 허락된다. `reqMembers`는 순수 조건(gate)이며,
     정원(cap)처럼 업그레이드의 "효과"로 지급되는 값이 아니다 — 정원 수치 자체를 보상으로
     주는 게 아니라, 그만큼 실제로 성장해 있어야 확장을 시작할 수 있다는 뜻. 예배당은
     "현재 레벨 정원만큼 이미 찼을 것"을 조건으로 삼아 자연스럽게 이어지도록 했다. */
  sanctuary: {
    name: '예배당', icon: 'micon_b_sanctuary.png',
    desc: '예배와 모임의 중심 공간입니다. 레벨을 올리면 성도 정원(수용 한계)이 늘어납니다. 이미 정원이 찰 만큼 성도가 모여야 다음 단계로 확장할 수 있습니다.',
    levels: [
      { cap: 40 },
      { cap: 90,    cost: 12000000,   reqMembers: 40 },
      { cap: 200,   cost: 35000000,   reqMembers: 81 },
      { cap: 400,   cost: 90000000,   reqMembers: 180 },
      { cap: 800,   cost: 220000000,  reqMembers: 360 },
      { cap: 1600,  cost: 550000000,  reqMembers: 720 },
      { cap: 3200,  cost: 1400000000, reqMembers: 1440 },
      { cap: 6000,  cost: 3200000000, reqMembers: 2880 },
      { cap: 10500, cost: 7500000000, reqMembers: 5400 },
    ],
    statLine: (lv) => `정원 ${BUILDINGS.sanctuary.levels[lv].cap}명`,
  },
  education: {
    name: '교육관', icon: 'micon_b_education.png',
    desc: '주일학교·다음세대 교육 공간입니다. 신앙지수 상승폭과 정착률이 늘어납니다. 다음세대를 감당할 만큼 성도가 모여야 확장할 수 있습니다.',
    levels: [
      { faithBonus: 0,   retention: 0 },
      { faithBonus: 0.6, retention: 0.02, cost: 10000000, reqMembers: 15 },
      { faithBonus: 1.2, retention: 0.04, cost: 20000000, reqMembers: EVENT_TIER_SPROUT },
      { faithBonus: 1.8, retention: 0.06, cost: 32000000, reqMembers: EVENT_TIER_FRUIT },
      { faithBonus: 2.4, retention: 0.08, cost: 50000000, reqMembers: EVENT_TIER_TREE },
    ],
    statLine: (lv) => `신앙지수 +${BUILDINGS.education.levels[lv].faithBonus.toFixed(1)}/주 · 정착률 +${(BUILDINGS.education.levels[lv].retention*100).toFixed(0)}%`,
  },
  fellowship: {
    name: '친교실', icon: 'micon_b_fellowship.png',
    desc: '식사와 교제를 나누는 공간입니다. 지역 신뢰도와 봉사자 유입이 늘어납니다.',
    levels: [
      { repBonus: 0,   volGain: 0 },
      { repBonus: 0.5, volGain: 0.3, cost: 8000000 },
      { repBonus: 1.0, volGain: 0.6, cost: 16000000 },
      { repBonus: 1.5, volGain: 1.0, cost: 28000000 },
      { repBonus: 2.0, volGain: 1.5, cost: 45000000 },
    ],
    statLine: (lv) => `지역신뢰 +${BUILDINGS.fellowship.levels[lv].repBonus.toFixed(1)}/주`,
  },
  parking: {
    name: '주차장', icon: 'micon_b_parking.png',
    desc: '접근성을 높여 새가족 유입에 도움을 줍니다.',
    levels: [
      { visitorBonus: 0 },
      { visitorBonus: 0.4, cost: 5000000 },
      { visitorBonus: 0.8, cost: 10000000 },
      { visitorBonus: 1.3, cost: 18000000 },
    ],
    statLine: (lv) => `새가족 유입 +${BUILDINGS.parking.levels[lv].visitorBonus.toFixed(1)}/주`,
  },
};

/* 사례비는 2026년 국내 교회 시세 조사(README 참조 — 부목사 평균/표준 사례비)를 그대로 반영했다.
   건축비는 같은 조사(평당 500~700만원)를 근거로 처음 산정했으나, 실제 주간 헌금 수입 대비
   너무 커서(시뮬레이션 검증 결과 첫 확장까지 100주+ 소요) 게임이 진행되지 않는 문제가 있어
   플레이 가능한 속도로 재조정했다 — "억 단위의 realistic-느낌" 규모는 유지하되 정확한 평당
   단가 역산은 포기했다(README 경제 밸런스 절 참조). */
/* 부교역자 = 이름 있는 후보자를 이력서 보고 직접 뽑아 청빙하는 자리(오너 지시).
   역할별 성별은 실제 명칭 관례를 따른다("여전도사"는 여성 호칭) — 이 프로젝트가 참고하는
   고신헌법 자체도 안수직 자격을 남성으로 명시하므로(2부 제65조 등) 게임도 그 관례를 따랐다. */
const STAFF = {
  edu_evangelist: {
    name: '교육전도사', icon: 'micon_s_teacher.png', genderConstraint: null,
    desc: '다음세대 교육을 전담해 정착률을 크게 높입니다.',
    unlockMembers: EVENT_TIER_SPROUT,
    baseMonthlySalary: 1800000,
    effect: { retentionBonus: 0.05 },
  },
  female_evangelist: {
    name: '여전도사', icon: 'micon_s_evangelist_f.png', genderConstraint: 'F',
    desc: '심방과 구제를 도맡아 지역신뢰와 신앙지수를 함께 높입니다.',
    unlockMembers: EVENT_TIER_SPROUT,
    baseMonthlySalary: 1700000,
    effect: { reputationPerWeek: 0.6, faithPerWeek: 0.3 },
  },
  licentiate: {
    name: '강도사', icon: 'micon_s_scroll.png', genderConstraint: 'M',
    desc: '설교 실습과 전도를 겸하며 새가족 유입에 도움을 줍니다.',
    unlockMembers: 60,
    baseMonthlySalary: 2000000,
    effect: { faithPerWeek: 0.6, visitorPerWeek: 0.5 },
  },
  associate_pastor: {
    name: '부목사', icon: 'micon_s_pastor.png', genderConstraint: 'M',
    desc: '설교와 심방을 나누어 신앙지수 상승을 돕습니다.',
    unlockMembers: EVENT_TIER_FRUIT,
    baseMonthlySalary: 2500000,
    effect: { faithPerWeek: 1.5 },
  },
};

const HOUSING_WEEKLY_COST = 200000;
const HOUSING_EFFECT_MULT = 1.3;

function staffWeeklySalary(key, candidate) {
  const def = STAFF[key];
  const factor = (candidate && candidate.salaryFactor) || 1;
  const base = Math.round((def.baseMonthlySalary * factor * 12) / 52);
  return base + ((candidate && candidate.housing) ? HOUSING_WEEKLY_COST : 0);
}

/* 담임목사(플레이어) 사례비 — 그동안 지출 목록에 아예 없던 것을 오너 지시로 추가했다.
   1.0배가 2026년 시세 조사 기준 표준 사례비, 0.5~2.0배 사이에서 직접 조정할 수 있다.
   너무 박봉(0.7배 미만)이면 사기가 떨어져 신앙지수가 조금씩 더 깎이고, 넉넉히(1.0배 초과)
   책정하면 아주 소폭(최대 +0.2/주) 신앙지수에 보탬이 된다 — 다만 상한을 낮게 잡아 "사례비만
   올리면 이긴다"는 식으로 다른 투자를 밀어내는 지배전략이 되지 않도록 했다. */
const PASTOR_BASE_MONTHLY_SALARY = 3500000;
const PASTOR_SALARY_MIN_MULT = 0.5;
const PASTOR_SALARY_MAX_MULT = 2.0;
const PASTOR_SALARY_STEP = 0.1;

function pastorWeeklySalary(s) {
  return Math.round((PASTOR_BASE_MONTHLY_SALARY * (s.pastorSalaryMult || 1) * 12) / 52);
}

/* ---- 후보자(이력서) 생성 — 시드 기반이라 같은 자리에 새로 후보를 낼 때만 새 사람이 뜬다 ---- */
const CAND_SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
const CAND_GIVEN = ['민준', '서연', '도현', '지우', '하은', '성민', '예은', '준영', '수빈', '재현', '은서', '현우', '소율', '민재', '다은', '승우', '유진', '태윤', '채원', '동현'];
const CAND_MBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
const CAND_FAMILY = ['미혼', '기혼(자녀 없음)', '기혼(자녀 1명)', '기혼(자녀 2명)', '기혼(자녀 3명)'];
const CAND_STYLES = ['설교', '심방', '상담', '다음세대교육', '청년사역', '찬양인도', '행정·기획', '전도', '소그룹인도', '제자훈련'];
const CAND_INTRO_TEMPLATES = [
  (s) => `${s[0]} 사역에 은사가 있습니다. 성도들과 함께 웃고 우는 목회를 하고 싶습니다.`,
  (s) => `${s[0]}와(과) ${s[1] || s[0]}을(를) 통해 이 교회를 섬기고 싶은 사역자입니다.`,
  (s) => `말씀과 기도로 준비된 사역자입니다. ${s[0]} 사역에 특별히 마음이 있습니다.`,
  (s) => `${s[0]}을(를) 가장 잘하고, ${s[1] || s[0]}에도 꾸준히 힘써왔습니다.`,
];

function seededRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
}

function generateCandidate(seed, genderConstraint) {
  const rnd = seededRng(seed);
  const gender = genderConstraint || (rnd() < 0.5 ? 'M' : 'F');
  const name = CAND_SURNAMES[Math.floor(rnd() * CAND_SURNAMES.length)] + CAND_GIVEN[Math.floor(rnd() * CAND_GIVEN.length)];
  const age = 26 + Math.floor(rnd() * 20);
  const mbti = CAND_MBTI[Math.floor(rnd() * CAND_MBTI.length)];
  const family = CAND_FAMILY[Math.floor(rnd() * CAND_FAMILY.length)];
  const pool = CAND_STYLES.slice();
  const styles = [];
  const styleCount = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < styleCount && pool.length; i++) styles.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const wantsHousing = rnd() < 0.5;
  const intro = CAND_INTRO_TEMPLATES[Math.floor(rnd() * CAND_INTRO_TEMPLATES.length)](styles);
  const salaryFactor = 0.9 + rnd() * 0.3;
  return { name, gender, age, mbti, family, styles, wantsHousing, intro, salaryFactor };
}

function candidatesFor(roleKey) {
  const def = STAFF[roleKey];
  const gen = (state.candidateGen && state.candidateGen[roleKey]) || 0;
  /* candidateSeed는 새 게임을 시작할 때마다 무작위로 하나 뽑혀 저장된다(오너 지시: "부교역자
     후보들도 랜덤하게 나오도록") — 예전엔 역할 이름(hashStr(roleKey))만으로 시드를 잡아서
     어느 게임을 새로 시작해도 항상 똑같은 세 사람이 나왔다. 지금은 같은 판 안에서는(같은
     candidateGen일 때) 후보가 안정적으로 유지되면서도, 판마다·역할마다 다른 사람이 뜬다. */
  const baseSeed = hashStr(roleKey) + gen * 7919 + (state.candidateSeed || 0);
  return [0, 1, 2].map((i) => generateCandidate(baseSeed + i * 104729, def.genderConstraint));
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

/* 직분자 개별 이름 — 임직 주차 배열(숫자)만 저장하던 구조를 바꾸지 않고, 표시할 때만
   (역할+임직주차+순번)을 시드로 결정론적 이름을 만든다(교적부 열람 기능, 오너 지시).
   같은 값이면 항상 같은 이름이 나오므로 저장 데이터 마이그레이션 없이 안정적으로 표시된다. */
/* 연령대는 고신헌법 자격 조건을 그대로 따른다: 장로 40~66세(2부 제65조), 집사 35~66세
   (제75조), 권사 45~66세(제81조). 후보자 생성 시 등록연한(tenureYears)도 함께 부여하는데,
   교회 자체가 존재해온 기간(churchAgeYears)을 넘을 수 없다(오너 지시: "임직자의 조건 등등
   맞게") — OFFICERS.unlock에서 이미 교회 나이가 등록연한 미만이면 후보 생성 자체를 막으므로
   여기 s는 있을 때만 상한 계산에 쓰고, 없으면 헌법상 최소연한만 반환한다(구버전 저장 표시용). */
const OFFICER_AGE_RANGE = { elder: [40, 66], deacon: [35, 66], exhorter: [45, 66] };

function officerDisplayProfile(roleKey, seed, idx, s) {
  const rnd = seededRng(hashStr(`${roleKey}:${seed}:${idx}`));
  const name = CAND_SURNAMES[Math.floor(rnd() * CAND_SURNAMES.length)] + CAND_GIVEN[Math.floor(rnd() * CAND_GIVEN.length)];
  const [minAge, maxAge] = OFFICER_AGE_RANGE[roleKey] || [40, 66];
  const age = minAge + Math.floor(rnd() * (maxAge - minAge + 1));
  const family = CAND_FAMILY[Math.floor(rnd() * CAND_FAMILY.length)];
  const minTenure = OFFICER_MIN_TENURE[roleKey] || 2;
  const cap = s ? Math.min(age - 18, churchAgeYears(s)) : minTenure;
  const maxTenure = Math.max(minTenure, cap);
  const tenureYears = minTenure + Math.floor(rnd() * (maxTenure - minTenure + 1));
  return { name, age, family, tenureYears };
}

/* 공동의회에 세울 후보 셋 — 같은 주 안에서는 안정적으로 유지되고, 주가 바뀌면 새로 갱신된다. */
function officerCandidatesFor(roleKey) {
  const seed = `${state.week}:${state.candidateSeed || 0}`;
  return [0, 1, 2].map((idx) => officerDisplayProfile(roleKey, seed, idx, state));
}

/* 실제 투표를 흉내낸 찬성률 — 신앙지수·지역신뢰가 좋은(공동체가 건강한) 교회일수록 높다.
   고신헌법 제67조(장로), 준용 조항(집사·권사)의 "공동의회 2/3 이상 찬성" 문턱을 그대로 쓴다. */
const OFFICER_VOTE_THRESHOLD = 2 / 3;

function officerVoteApprovalRate(s) {
  const base = 0.55 + (s.faith / 100) * 0.25 + (s.reputation / 100) * 0.1;
  return clamp(base, 0.3, 0.95);
}

/* 일반 성도 개별 열람(오너 지시) — 수천~수만 명이 될 수 있어 한 번에 전부 DOM에 그리면
   느려지므로, "더 보기" 방식으로 필요한 만큼만 점진적으로 불러온다. 각 성도의 이름·나이는
   순번을 시드로 한 결정론적 값이라 다시 렌더링해도 매번 같은 사람으로 나온다. */
const GENERAL_MEMBERS_PAGE = 50;
let generalMembersShown = GENERAL_MEMBERS_PAGE;

const CAMPAIGN_HISTORY_PAGE = 10;
let campaignHistoryShown = CAMPAIGN_HISTORY_PAGE;

/* 교인 구분(원입교인→학습교인→세례교인)은 고신헌법 2부 제21~29조 근거(README 참조) —
   나이가 어리면 아직 학습 전 단계인 경우가 자연스러워 원입교인 비중을 살짝 높였다. */
const MEMBER_STATUS = ['원입교인', '원입교인', '학습교인', '세례교인', '세례교인', '세례교인'];
const MEMBER_GIFTS = ['찬양', '봉사', '가르침', '섬김', '기도', '전도', '나눔', '환대', '중보기도', '심방'];

function generalMemberProfile(i, churchAgeWeeks) {
  const rnd = seededRng(hashStr('genmember:' + i));
  const gender = rnd() < 0.5 ? 'M' : 'F';
  const name = CAND_SURNAMES[Math.floor(rnd() * CAND_SURNAMES.length)] + CAND_GIVEN[Math.floor(rnd() * CAND_GIVEN.length)];
  const age = Math.floor(rnd() * 80);
  const family = age < 19 ? '미성년자' : CAND_FAMILY[Math.floor(rnd() * CAND_FAMILY.length)];
  const status = age < 15 ? '유아세례교인' : MEMBER_STATUS[Math.floor(rnd() * MEMBER_STATUS.length)];
  const gift = MEMBER_GIFTS[Math.floor(rnd() * MEMBER_GIFTS.length)];
  /* 등록년차는 나이뿐 아니라 "교회 자체가 존재해온 기간"도 넘을 수 없다 — 개척 1년 미만인
     교회에 등록 11년차 성도가 있는 건 시간상 불가능하다(오너가 발견한 실제 오류). */
  const churchAgeYears = Math.max(0, Math.floor((churchAgeWeeks || 0) / WEEKS_PER_MONTH / 12));
  const maxJoinYears = Math.min(age, churchAgeYears);
  const joinYears = maxJoinYears > 0 ? 1 + Math.floor(rnd() * maxJoinYears) : 0;
  return { name, gender, age, family, status, gift, joinYears };
}

const MINISTRIES = {
  dawn_prayer: {
    name: '새벽기도', icon: 'micon_m_dawn.png',
    desc: '매일 새벽 함께 기도하며 신앙의 뿌리를 든든히 합니다.',
    upkeep: 50000,
    effect: { faithPerWeek: 1.2 },
    unlock: () => true,
    lockDesc: '',
  },
  cell_groups: {
    name: '소그룹모임', icon: 'micon_m_house.png',
    desc: '구역·순모임으로 성도 간 교제와 정착을 돕습니다.',
    upkeep: 90000,
    effect: { retentionBonus: 0.03, faithPerWeek: 0.5 },
    unlock: (s) => s.volunteers >= 3,
    lockDesc: '봉사자 3명 이상 필요',
  },
  /* 다음세대 사역을 연령대별로 세분화(오너 지시) — 기존 "어린이부" 하나로 뭉뚱그려져
     있던 것을 실제 교회 부서 편제처럼 나눴다. SFC(학생신앙운동)는 고신 교단 산하 실제
     학생신앙운동 단체명이다(고신헌법 2부 제43조 근거). */
  infant_ministry: {
    name: '영유아부', icon: 'micon_m_infant.png',
    desc: '영아·유아를 둔 가정을 품는 사역입니다. 젊은 가정의 정착과 입소문에 도움이 됩니다.',
    upkeep: 80000,
    effect: { retentionBonus: 0.02, visitorPerWeek: 0.15 },
    unlock: (s) => s.buildings.education >= 1 && !!s.departmentsActive.education_dept,
    lockDesc: '교육관 1레벨 + 교육부 조직 필요',
  },
  elementary_ministry: {
    name: '유초등부', icon: 'micon_m_elementary.png',
    desc: '유치부터 초등 자녀를 둔 가정을 품는 사역입니다. 가정 단위 새가족 유입에 도움이 됩니다.',
    upkeep: 90000,
    effect: { retentionBonus: 0.02, visitorPerWeek: 0.25 },
    unlock: (s) => s.buildings.education >= 1 && !!s.departmentsActive.education_dept,
    lockDesc: '교육관 1레벨 + 교육부 조직 필요',
  },
  sfc_ministry: {
    name: 'SFC(중고등부)', icon: 'micon_m_sfc.png',
    desc: '중·고등학생 신앙 공동체입니다. 학업으로 흔들리기 쉬운 시기에 신앙의 뿌리를 다집니다.',
    upkeep: 110000,
    effect: { faithPerWeek: 0.3, retentionBonus: 0.02 },
    unlock: (s) => s.members >= EVENT_TIER_SPROUT && !!s.departmentsActive.education_dept,
    lockDesc: `성도 ${EVENT_TIER_SPROUT}명 이상 + 교육부 조직 필요`,
  },
  youth_ministry: {
    name: '청년부', icon: 'micon_m_youth.png',
    desc: '청년 세대의 신앙과 공동체를 세웁니다.',
    upkeep: 150000,
    effect: { faithPerWeek: 0.6, reputationPerWeek: 0.4 },
    unlock: (s) => s.members >= 40 && !!s.departmentsActive.education_dept,
    lockDesc: '성도수 40명 이상 + 교육부 조직 필요',
  },
  diakonia: {
    name: '봉사단', icon: 'micon_m_basket.png',
    desc: '지역사회를 섬기는 나눔 사역입니다. 지역 신뢰도가 꾸준히 오릅니다.',
    upkeep: 130000,
    effect: { reputationPerWeek: 1.0 },
    unlock: (s) => s.volunteers >= 5,
    lockDesc: '봉사자 5명 이상 필요',
  },
  bible_study: {
    name: '성경공부', icon: 'micon_m_bible.png',
    desc: '말씀을 함께 배우며 신앙의 기초를 다지는 모임입니다.',
    upkeep: 60000,
    effect: { faithPerWeek: 0.8 },
    unlock: () => true,
    lockDesc: '',
  },
  doctrine_class: {
    name: '새신자반', icon: 'micon_m_notepad.png',
    desc: '원입교인이 학습교인으로 자라가도록 돕는 첫 교육입니다(2부 제3장 교인 구분 근거).',
    upkeep: 50000,
    effect: { retentionBonus: 0.02 },
    unlock: (s) => s.members >= 20,
    lockDesc: '성도수 20명 이상 필요',
  },
  baptism_class: {
    name: '세례교육반', icon: 'micon_m_water.png',
    desc: '학습교인이 세례(입교)교인으로 자라가도록 돕는 교육입니다(2부 제21~29조 교인 구분 근거).',
    upkeep: 55000,
    effect: { retentionBonus: 0.02, faithPerWeek: 0.3 },
    unlock: (s) => s.members >= EVENT_TIER_SPROUT,
    lockDesc: `성도 ${EVENT_TIER_SPROUT}명 이상 필요`,
  },
  discipleship_training: {
    name: '제자훈련', icon: 'micon_m_notebook.png',
    desc: '세례교인이 말씀과 삶으로 더 깊이 훈련받는 과정입니다.',
    upkeep: 70000,
    effect: { faithPerWeek: 0.6 },
    unlock: (s) => s.members >= EVENT_TIER_FRUIT,
    lockDesc: `성도 ${EVENT_TIER_FRUIT}명 이상 필요`,
  },
  leadership_school: {
    name: '지도자훈련(리더십스쿨)', icon: 'micon_m_youth.png',
    desc: '장차 직분자·교사로 세워질 이들을 미리 훈련하는 과정입니다.',
    upkeep: 90000,
    effect: { faithPerWeek: 0.4, reputationPerWeek: 0.3 },
    unlock: (s) => s.members >= EVENT_TIER_TREE,
    lockDesc: `성도 ${EVENT_TIER_TREE}명 이상 필요`,
  },
};

/* 남전도회·여전도회·사역팀·교육부 — 사역(프로그램)과 구분되는 교회 기관·부서.
   메커니즘은 MINISTRIES와 완전히 동일(주당 유지비 + 상시 효과)하되, 별도 섹션으로
   보여준다("구역"은 이미 소그룹모임이 같은 역할을 하고 있어 중복 추가하지 않았다). */
const DEPARTMENTS = {
  mens_fellowship: {
    name: '남전도회', icon: 'micon_d_mens.png',
    desc: '남성 성도들이 교제하며 전도와 봉사를 함께 감당하는 기관입니다.',
    upkeep: 40000,
    effect: { reputationPerWeek: 0.3 },
    unlock: (s) => s.members >= EVENT_TIER_SPROUT,
    lockDesc: `성도 ${EVENT_TIER_SPROUT}명 이상 필요`,
  },
  womens_fellowship: {
    name: '여전도회', icon: 'micon_d_womens.png',
    desc: '여성 성도들이 교제하며 구제와 선교를 후원하는 기관입니다.',
    upkeep: 40000,
    effect: { reputationPerWeek: 0.3, faithPerWeek: 0.2 },
    unlock: (s) => s.members >= EVENT_TIER_SPROUT,
    lockDesc: `성도 ${EVENT_TIER_SPROUT}명 이상 필요`,
  },
  ministry_team: {
    name: '사역팀(찬양·미디어)', icon: 'micon_d_mic.png',
    desc: '찬양·미디어·안내 등 예배와 행사를 섬기는 통합 봉사팀입니다.',
    upkeep: 70000,
    effect: { visitorPerWeek: 0.2, reputationPerWeek: 0.2 },
    unlock: (s) => s.volunteers >= 5,
    lockDesc: '봉사자 5명 이상 필요',
  },
  education_dept: {
    name: '교육부', icon: 'micon_d_school.png',
    desc: '유아부부터 청소년부까지 다음세대 교육을 총괄하는 부서입니다.',
    upkeep: 60000,
    effect: { retentionBonus: 0.02, faithPerWeek: 0.3 },
    unlock: (s) => s.buildings.education >= 1,
    lockDesc: '교육관 1레벨 이상 필요',
  },
};

/* 목회방향 세팅(오너 지시) — 5개 항목 × 선택지 4개, 한번 고르면 비용 없이 매주 계속
   적용되는 지속 효과다("선택한 목회 방향에 따라 교회 성장이 이루어져 가도록"). 사역·건물처럼
   돈으로 사는 게 아니라 "이 교회를 어떤 색깔로 이끌 것인가"를 정하는 것이라, 항목마다 오르는
   값과 내리는 값을 함께 둬서 정답이 없게 했다(다른 4택 시스템들과 같은 설계 원칙). 항목은
   서로 독립적이라 5개를 자유롭게 조합할 수 있다. */
const PASTORAL_DIRECTIONS = {
  preaching: {
    name: '설교 방향', icon: 'micon_m_bible.png',
    desc: '주일 강단에서 무엇을 가장 우선할 것인가',
    options: {
      expository: { name: '강해설교', desc: '본문을 깊이 풀어 가르칩니다. 기존 성도의 신앙이 깊어지지만, 새가족에겐 다소 어렵게 느껴질 수 있습니다.', effect: { faithPerWeek: 0.3, visitorPerWeek: -0.1 } },
      topical: { name: '주제설교', desc: '삶에 적용되는 주제를 다룹니다. 무난하고 균형 잡힌 접근입니다.', effect: { faithPerWeek: 0.15, reputationPerWeek: 0.1 } },
      evangelistic: { name: '전도설교', desc: '복음을 쉽고 분명하게 전합니다. 새가족에게 좋지만, 기존 성도에게는 다소 얕게 느껴질 수 있습니다.', effect: { visitorPerWeek: 0.25, faithPerWeek: -0.1 } },
      pastoral: { name: '목양설교', desc: '위로와 치유를 강조합니다. 정착에 도움이 되지만 도전과 결단은 약해질 수 있습니다.', effect: { retentionBonus: 0.015, faithPerWeek: -0.05 } },
    },
  },
  worship: {
    name: '예배 스타일', icon: 'micon_ui_sparkle.png',
    desc: '예배 순서와 분위기를 어떻게 꾸릴 것인가',
    options: {
      traditional: { name: '전통적 예배', desc: '경건하고 안정적인 순서를 지킵니다. 깊이는 있지만 새로운 이들에게는 다소 낯설 수 있습니다.', effect: { faithPerWeek: 0.2, visitorPerWeek: -0.15 } },
      contemporary: { name: '현대적 예배', desc: '찬양과 미디어를 적극 활용합니다. 젊은 세대 유입에 좋지만 신앙의 깊이는 상대적으로 약해질 수 있습니다.', effect: { visitorPerWeek: 0.2, faithPerWeek: -0.1 } },
      seeker: { name: '열린예배', desc: '초신자가 편하게 느끼도록 문턱을 낮춥니다. 유입엔 강하지만 정착률은 다소 아쉬울 수 있습니다.', effect: { visitorPerWeek: 0.3, retentionBonus: -0.01 } },
      liturgical: { name: '절기 중심 예배', desc: '교회력과 절기를 따라 예배합니다. 신앙의 깊이는 더하지만 지역에는 다소 보수적으로 비칠 수 있습니다.', effect: { faithPerWeek: 0.25, reputationPerWeek: -0.1 } },
    },
  },
  growth: {
    name: '성장 전략', icon: 'micon_ui_people.png',
    desc: '교회의 에너지를 어디에 집중할 것인가',
    options: {
      discipleship: { name: '내실 다지기', desc: '양육과 훈련에 집중합니다. 정착률은 오르지만 새가족 유입 속도는 더딜 수 있습니다.', effect: { retentionBonus: 0.02, visitorPerWeek: -0.1 } },
      community: { name: '지역사회 섬김', desc: '이웃을 섬기는 데 힘씁니다. 지역 신뢰가 크게 오르지만 내부 양육은 상대적으로 약해질 수 있습니다.', effect: { reputationPerWeek: 0.3, faithPerWeek: -0.1 } },
      nextgen: { name: '다음세대 집중', desc: '교육과 다음세대에 자원을 집중합니다. 정착에 좋지만 대외 인지도 확대는 더딜 수 있습니다.', effect: { retentionBonus: 0.015, reputationPerWeek: -0.1 } },
      missional: { name: '개척·선교 지향', desc: '밖으로 파송하는 데 힘씁니다. 지역 신뢰는 오르지만 내부 결속은 다소 느슨해질 수 있습니다.', effect: { reputationPerWeek: 0.2, retentionBonus: -0.01 } },
    },
  },
  finance: {
    name: '재정 운용 철학', icon: 'micon_ui_floppy.png',
    desc: '교회 재정을 어떤 태도로 다룰 것인가',
    options: {
      frugal: { name: '검소한 운영', desc: '아끼고 절제하며 운영합니다. 신뢰는 쌓이지만 때로 인색하게 비칠 수 있습니다.', effect: { retentionBonus: 0.01, reputationPerWeek: -0.05 } },
      balanced: { name: '균형 투자', desc: '무리하지 않는 선에서 고르게 씁니다. 모든 면에서 무난한 소폭의 도움이 됩니다.', effect: { faithPerWeek: 0.05, reputationPerWeek: 0.05, retentionBonus: 0.005 } },
      aggressive: { name: '적극 투자', desc: '과감하게 투자해 눈에 띄는 변화를 만듭니다. 효과는 크지만 성도들이 다소 부담을 느낄 수 있습니다.', effect: { faithPerWeek: 0.2, reputationPerWeek: 0.2, retentionBonus: -0.015 } },
      generous: { name: '나눔 중심', desc: '구제와 나눔에 우선순위를 둡니다. 지역 평판은 크게 오르지만 내적 신앙 강화는 더딜 수 있습니다.', effect: { reputationPerWeek: 0.3, faithPerWeek: -0.1 } },
    },
  },
  leadership: {
    name: '리더십 스타일', icon: 'micon_o_elder.png',
    desc: '교회를 어떤 방식으로 이끌어갈 것인가',
    options: {
      pastor_centered: { name: '담임 중심 리더십', desc: '담임목사가 방향을 뚜렷이 제시합니다. 신앙 지도는 분명하지만 성도 참여감은 다소 약해질 수 있습니다.', effect: { faithPerWeek: 0.15, retentionBonus: -0.01 } },
      session_centered: { name: '당회 중심', desc: '당회의 협의를 중시합니다. 안정적이고 균형 잡힌 운영입니다.', effect: { retentionBonus: 0.01, reputationPerWeek: 0.05 } },
      gift_based: { name: '은사 중심 팀사역', desc: '각자의 은사에 맡겨 다양하게 사역합니다. 외부에는 매력적이지만 통일감은 약해질 수 있습니다.', effect: { visitorPerWeek: 0.15, faithPerWeek: -0.05 } },
      congregational: { name: '성도 참여형', desc: '성도들이 함께 결정하고 참여합니다. 정착과 소속감은 강해지지만 의사결정과 확장은 더딜 수 있습니다.', effect: { retentionBonus: 0.02, visitorPerWeek: -0.1 } },
    },
  },
};

/* 부교역자·직분자 개인의 신앙 상태(오너 지시: "신앙 상태 신호등과 개인사 발생 시 표기하여
   목회적 조치를 취할 수 있도록"). wellbeing(0~100)이 낮을수록 신호등이 빨간불에 가까워진다.
   성도 수천~수만 명 전원을 추적할 수는 없어(교적부 개별 열람과 별개로) 부교역자·직분자처럼
   이미 개별 신상이 저장되는 사람들에게만 적용한다. */
function wellbeingColor(wb) {
  const v = typeof wb === 'number' ? wb : 70;
  if (v >= 60) return 'good';
  if (v >= 30) return 'warn';
  return 'bad';
}

const PERSONAL_EVENTS = [
  { title: '가정의 어려움', icon: 'micon_m_house.png', body: (n) => `${n}님의 가정에 어려운 일이 있다는 소식이 들려옵니다.` },
  { title: '건강이 안 좋아지셨습니다', icon: 'micon_ev_hospital.png', body: (n) => `${n}님이 최근 건강이 좋지 않아 사역에 지장을 겪고 있습니다.` },
  { title: '지친 기색이 역력합니다', icon: 'micon_ev_tired.png', body: (n) => `${n}님이 쉼 없이 달려오느라 많이 지친 듯합니다.` },
  { title: '신앙의 방황', icon: 'micon_ev_rain.png', body: (n) => `${n}님이 요즘 신앙의 회의와 씨름하고 있다는 이야기가 들려옵니다.` },
  { title: '재정적 어려움', icon: 'micon_ev_chartdown.png', body: (n) => `${n}님의 가정 형편이 요즘 넉넉지 않다는 소식이 들려옵니다.` },
  { title: '관계의 갈등', icon: 'micon_ev_chat.png', body: (n) => `${n}님이 다른 성도와 작은 갈등을 겪고 있다는 이야기가 들려옵니다.` },
];
const PERSONAL_EVENT_CHOICES = [
  { label: '시간을 내어 깊이 돌본다', wellbeingDelta: 15, cost: 100000 },
  { label: '짧게라도 마음을 전한다', wellbeingDelta: 7, cost: 30000 },
  { label: '지금은 여력이 없어 넘어간다', wellbeingDelta: -10, cost: 0 },
];

function eligiblePersonRefs() {
  const refs = [];
  for (const key in STAFF) {
    if (state.staffHired[key]) refs.push({ kind: 'staff', key, person: state.staffHired[key] });
  }
  for (const key in OFFICERS) {
    (state.officers[key] || []).forEach((entry) => {
      if (entry && typeof entry === 'object') refs.push({ kind: 'officer', key, person: entry });
    });
  }
  return refs;
}

function showPersonalEvent(ref, template) {
  document.getElementById('eventIcon').src = 'assets/' + template.icon;
  document.getElementById('eventTitle').textContent = template.title;
  document.getElementById('eventBody').textContent = template.body(ref.person.name);
  const box = document.getElementById('eventChoices');
  renderConfirmableChoices(box, PERSONAL_EVENT_CHOICES.map((c) => ({
    label: c.label,
    onConfirm: () => {
      if (c.cost) state.fund = Math.max(0, state.fund - c.cost);
      ref.person.wellbeing = clamp((ref.person.wellbeing || 70) + c.wellbeingDelta, 0, 100);
      addLog(`${ref.person.name}님의 개인사에 "${c.label}"(으)로 응답했습니다(신앙 상태 ${c.wellbeingDelta >= 0 ? '+' : ''}${c.wellbeingDelta}).`);
      saveGame();
      render();
      hideModal('eventModal');
    },
  })));
  showModal('eventModal');
}

const CAMPAIGNS = {
  revival: {
    name: '부흥회', icon: 'micon_c_flame.png',
    desc: '집중 은혜의 기간을 마련해 신앙지수를 크게 끌어올립니다.',
    cost: 5000000,
    apply: (s) => { s.faith = clamp(s.faith + 12, 0, 100); return '부흥회로 성도들의 신앙이 뜨거워졌습니다.'; },
  },
  outreach_festival: {
    name: '전도축제', icon: 'micon_c_tentflag.png',
    desc: '지역 주민을 초청하는 축제입니다. 새가족이 한 번에 여럿 찾아옵니다.',
    cost: 4000000,
    apply: (s) => {
      const n = Math.max(1, Math.round(3 + s.reputation / 12));
      s.memberFrac += n; s.members = Math.floor(s.memberFrac);
      return `전도축제로 새가족 ${n}명이 등록했습니다.`;
    },
  },
  summer_retreat: {
    name: '여름수련회', icon: 'micon_c_tent.png',
    desc: '함께 떠나는 수련회입니다. 신앙과 공동체 결속이 깊어집니다.',
    cost: 6000000,
    apply: (s) => {
      s.faith = clamp(s.faith + 6, 0, 100);
      s.volunteerFrac += 1; s.volunteers = Math.floor(s.volunteerFrac);
      return '여름수련회를 통해 공동체의 결속이 깊어졌습니다.';
    },
  },
};

/* 시간 가속권 — 자동진행 속도를 한시적으로 높이는 소모 아이템 3종(오너 지시). 획득처는
   두 갈래: ① 성장 단계(TIERS)가 오를 때마다 자동 지급(초반 단계는 소, 후반 단계는 대 —
   플레이가 진행될수록 더 큰 보상), ② 교회 재정으로 즉시 구매(행사 탭). 사용 중에는 중첩 없이
   하나만 활성화된다(동시에 여러 배속이 겹치는 혼란 방지). */
const BOOST_ITEMS = {
  small:  { name: '가속권(소)', icon: 'micon_boost_small.png', mult: 2, durationMs: 20 * 60 * 1000, cost: 2000000,  desc: '20분 동안 시간의 흐름이 2배 빨라집니다.' },
  medium: { name: '가속권(중)', icon: 'micon_boost_medium.png', mult: 3, durationMs: 30 * 60 * 1000, cost: 6000000,  desc: '30분 동안 시간의 흐름이 3배 빨라집니다.' },
  large:  { name: '가속권(대)', icon: 'micon_boost_large.png', mult: 5, durationMs: 30 * 60 * 1000, cost: 15000000, desc: '30분 동안 시간의 흐름이 5배 빨라집니다.' },
};
/* 성장 단계(TIERS, 총 10단계)를 3구간으로 나눠 초반엔 소, 중반엔 중, 후반엔 대를 지급한다. */
function boostGrantFor(tierKey) {
  const idx = TIERS.findIndex((t) => t.key === tierKey);
  if (idx < 0) return null;
  if (idx <= 2) return 'small';
  if (idx <= 6) return 'medium';
  return 'large';
}

/* 선택지는 항상 4개, 그리고 각 선택지 안에 오르는 값과 내리는 값을 함께 넣어
   "공짜로 좋기만 한" 선택지가 없도록 설계했다(신중한 선택 유도). 효과는 선택 전에는
   보여주지 않고, 선택 직후 실제 변화량을 계산해 결과 화면에서만 공개한다(app.js
   showEvent/showEventResult 참조). */
const EVENTS = [
  {
    id: 'settle', icon: 'micon_ev_door.png', title: '새가족의 낯선 첫걸음',
    body: '지난주 처음 예배에 나온 가정이 있습니다. 아직 서먹한 얼굴로 뒷자리에 앉아 있습니다.',
    choices: [
      { label: '성대한 환영 만찬을 준비한다',
        apply: (s) => { s.fund -= 300000; s.reputation = clamp(s.reputation + 3, 0, 100); return '정성스러운 환영 만찬에 새가족이 큰 감동을 받았습니다.'; } },
      { label: '소박한 다과로 환영 모임을 연다',
        apply: (s) => { s.fund -= 80000; s.reputation = clamp(s.reputation + 2, 0, 100); return '소박하지만 따뜻한 환영에 마음을 열었습니다.'; } },
      { label: '목자가 직접 심방을 간다',
        apply: (s) => { s.fund -= 40000; s.faith = clamp(s.faith + 2, 0, 100); return '정성 어린 심방에 새가족이 큰 감사를 표했습니다.'; } },
      { label: '각자 자연스럽게 다가가도록 둔다',
        apply: (s) => { s.fund += 50000; s.reputation = clamp(s.reputation - 1, 0, 100); return '별다른 지출은 없었지만, 다소 무심하다는 인상을 남겼습니다.'; } },
    ],
  },
  {
    id: 'conflict', icon: 'micon_ev_chat.png', title: '소그룹의 작은 오해',
    body: '소그룹 모임에서 작은 오해로 언성이 높아졌다는 이야기가 들려왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT,
    choices: [
      { label: '담임이 직접 만나 깊이 중재한다',
        apply: (s) => { s.fund -= 50000; s.faith = clamp(s.faith + 3, 0, 100); return '깊은 대화 끝에 오해가 완전히 풀렸습니다.'; } },
      { label: '화해의 식사 자리를 마련한다',
        apply: (s) => { s.fund -= 100000; s.faith = clamp(s.faith + 2, 0, 100); s.reputation = clamp(s.reputation + 1, 0, 100); return '함께한 식사 자리에서 마음이 풀렸습니다.'; } },
      { label: '소그룹 리더에게 중재를 맡긴다',
        apply: (s) => { s.fund -= 20000; s.faith = clamp(s.faith + 1, 0, 100); return '리더의 중재로 무난히 넘어갔습니다.'; } },
      { label: '시간이 해결해주길 기다린다',
        apply: (s) => { s.fund += 30000; s.faith = clamp(s.faith - 1, 0, 100); return '별다른 조치가 없었고, 갈등이 오래가며 마음에 앙금이 남았습니다.'; } },
    ],
  },
  {
    id: 'service_request', icon: 'micon_ev_hospital.png', title: '지역 요양원의 방문 요청',
    body: '가까운 요양원에서 위문 방문을 부탁해 왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT,
    choices: [
      { label: '정성껏 선물을 준비해 방문한다',
        apply: (s) => { s.fund -= 150000; s.reputation = clamp(s.reputation + 4, 0, 100); return '정성 어린 방문에 어르신들이 큰 위로를 받았습니다.'; } },
      { label: '봉사팀을 꾸려 방문한다',
        apply: (s) => { s.fund -= 50000; s.reputation = clamp(s.reputation + 2, 0, 100); return '봉사팀의 방문에 큰 위로가 되었습니다.'; } },
      { label: '소수 인원이 짧게 다녀온다',
        apply: (s) => { s.fund -= 10000; s.reputation = clamp(s.reputation + 1, 0, 100); return '짧은 방문이었지만 마음을 전했습니다.'; } },
      { label: '이번엔 참여를 보류한다',
        apply: (s) => { s.fund += 30000; s.reputation = clamp(s.reputation - 1, 0, 100); return '아쉽지만 이번엔 참여하지 못했습니다.'; } },
    ],
  },
  {
    id: 'youth_leaving', icon: 'micon_ev_backpack.png', title: '청년들의 발걸음이 뜸해집니다',
    body: '몇몇 청년들이 학업과 직장을 이유로 하나둘 발걸음이 뜸해졌습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT,
    choices: [
      { label: '청년부 전담 사역자를 세우고 예산을 크게 늘린다',
        apply: (s) => { s.fund -= 800000; s.faith = clamp(s.faith + 3, 0, 100); s.memberFrac += 2; s.members = Math.floor(s.memberFrac); return '집중 투자 덕분에 청년들이 다시 마음을 붙였습니다.'; } },
      { label: '청년부 프로그램 예산을 늘린다',
        apply: (s) => { s.fund -= 300000; s.faith = clamp(s.faith + 2, 0, 100); s.memberFrac += 1; s.members = Math.floor(s.memberFrac); return '늘어난 프로그램에 청년 한 명이 다시 나오기 시작했습니다.'; } },
      { label: '청년들과 개별 면담 시간을 갖는다',
        apply: (s) => { s.fund -= 20000; s.faith = clamp(s.faith + 1, 0, 100); return '진심 어린 면담에 마음이 조금 열렸습니다.'; } },
      { label: '지금은 여력이 없어 지켜본다',
        apply: (s) => { s.fund += 50000; s.memberFrac = Math.max(0, s.memberFrac - 1); s.members = Math.floor(s.memberFrac); return '결국 청년 한 명이 다른 교회로 옮겼습니다.'; } },
    ],
  },
  {
    id: 'special_offering', icon: 'micon_ev_letter.png', title: '한 성도의 특별한 헌신',
    body: '오래 섬겨온 한 성도가 예배당 보수를 위해 특별한 헌신을 하고 싶다고 조용히 찾아왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT && s.week >= 260, // "오래 섬겨온" 표현과 맞도록 최소 5년 이상 지난 뒤에만(게임 속도가 빨라져 1년으로는 여전히 일러 보인다는 재지적으로 상향)
    choices: [
      { label: '감사히 받아 예배당 보수에 전액 사용한다',
        apply: (s) => { s.fund += 3000000; s.faith = clamp(s.faith - 1, 0, 100); return '든든한 헌신이었지만, 갑작스러운 집행에 절차상 잡음이 조금 있었습니다.'; } },
      { label: '절반은 감사헌금으로, 절반은 이웃돕기로 사용한다',
        apply: (s) => { s.fund += 1500000; s.reputation = clamp(s.reputation + 2, 0, 100); return '나눔의 방향이 이웃에게도 선한 영향을 남겼습니다.'; } },
      { label: '마음만 감사히 받고 정중히 사양한다',
        apply: (s) => { s.fund -= 20000; s.reputation = clamp(s.reputation + 1, 0, 100); return '작은 답례를 준비해 마음을 전했고, 검소한 태도가 신뢰를 주었습니다.'; } },
      { label: '정중히 사양하고 정기 헌금으로만 운영한다',
        apply: (s) => { s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation - 1, 0, 100); return '원칙을 지킨 결정에 일부는 서운해했지만, 신앙의 중심은 굳건해졌습니다.'; } },
    ],
  },
  {
    id: 'tight_finances', icon: 'micon_ev_chartdown.png', title: '이번 달, 재정이 유난히 빠듯합니다',
    body: '이런저런 지출이 겹치며 이번 달 살림이 유난히 빠듯해졌습니다.',
    choices: [
      { label: '전 사역자와 함께 지출을 철저히 점검한다',
        apply: (s) => { s.fund += 400000; s.faith = clamp(s.faith + 1, 0, 100); return '꼼꼼한 점검으로 새는 지출을 크게 줄였습니다.'; } },
      { label: '이번 달만 긴축 운영한다',
        apply: (s) => { s.fund += 150000; s.reputation = clamp(s.reputation - 1, 0, 100); return '살림은 나아졌지만, 갑작스러운 긴축에 불편해하는 이들도 있었습니다.'; } },
      { label: '성도들에게 상황을 투명하게 공유한다',
        apply: (s) => { s.fund -= 30000; s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation + 1, 0, 100); return '자료를 준비하는 비용이 들었지만, 투명한 소통이 신뢰를 더했습니다.'; } },
      { label: '일단 지켜보기로 한다',
        apply: (s) => { s.fund -= 50000; s.faith = clamp(s.faith - 1, 0, 100); return '뚜렷한 대책 없이 새는 지출이 계속됐습니다.'; } },
    ],
  },
  {
    id: 'joint_outreach', icon: 'micon_ev_handshake.png', title: '이웃 교회의 연합 제안',
    body: '이웃 교회에서 함께하는 연합 전도행사를 제안해 왔습니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT,
    choices: [
      { label: '우리 교회가 앞장서서 주최를 맡는다',
        apply: (s) => { s.fund -= 600000; s.reputation = clamp(s.reputation + 4, 0, 100); s.memberFrac += 2; s.members = Math.floor(s.memberFrac); return '적극적인 주최에 지역에 선한 영향력을 크게 나누었습니다.'; } },
      { label: '기쁘게 함께한다',
        apply: (s) => { s.fund -= 200000; s.reputation = clamp(s.reputation + 3, 0, 100); s.memberFrac += 1; s.members = Math.floor(s.memberFrac); return '연합행사를 통해 지역에 선한 영향력을 나누었습니다.'; } },
      { label: '소수 인원만 파견해 교류한다',
        apply: (s) => { s.fund -= 50000; s.reputation = clamp(s.reputation + 1, 0, 100); return '작은 교류였지만 관계의 끈을 이어갔습니다.'; } },
      { label: '지금은 우리 사역에 집중한다',
        apply: (s) => { s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation - 1, 0, 100); return '내실을 다지는 시간이었지만, 이웃 교회는 다소 서운해했습니다.'; } },
    ],
  },
  {
    id: 'hard_season', icon: 'micon_ev_rain.png', title: '어려운 시기를 지나는 이웃들',
    body: '요즘 형편이 어려워진 이웃들의 소식이 들려옵니다.',
    choices: [
      { label: '구제 기금을 넉넉히 마련해 이웃을 돕는다',
        apply: (s) => { s.fund -= 500000; s.reputation = clamp(s.reputation + 5, 0, 100); s.faith = clamp(s.faith + 2, 0, 100); return '넉넉한 나눔이 이웃에게 큰 힘이 되었습니다.'; } },
      { label: '형편껏 구제 기금을 마련한다',
        apply: (s) => { s.fund -= 200000; s.reputation = clamp(s.reputation + 3, 0, 100); s.faith = clamp(s.faith + 1, 0, 100); return '작지만 진심 어린 나눔이 전해졌습니다.'; } },
      { label: '필요한 가정을 개별적으로 살핀다',
        apply: (s) => { s.fund -= 50000; s.reputation = clamp(s.reputation + 1, 0, 100); return '조용한 섬김이 몇몇 가정에 힘이 되었습니다.'; } },
      { label: '우리 교회 살림부터 먼저 지킨다',
        apply: (s) => { s.fund += 80000; s.reputation = clamp(s.reputation - 2, 0, 100); return '살림은 지켰지만, 아쉬움이 남는 선택이었습니다.'; } },
    ],
  },
  {
    id: 'elder_wisdom', icon: 'micon_ev_candle.png', title: '오래 섬겨온 어른의 조언',
    body: '오랫동안 교회를 섬겨온 한 어르신이 조용히 다가와 기도모임을 하나 더 열어보면 어떻겠냐고 권합니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT && s.week >= 260, // "오래 섬겨온"·"오랫동안" 표현과 맞도록 5년 이상으로 상향(다른 유사 이벤트와 통일)
    choices: [
      { label: '조언대로 새 기도모임을 열고 적극 알린다',
        apply: (s) => { s.fund -= 50000; s.faith = clamp(s.faith + 3, 0, 100); return '적극적으로 알린 새 기도모임에 많은 이들이 참여했습니다.'; } },
      { label: '조언을 따라 기도모임을 하나 더 연다',
        apply: (s) => { s.fund -= 15000; s.faith = clamp(s.faith + 2, 0, 100); return '작은 기도모임이 큰 은혜의 통로가 되었습니다.'; } },
      { label: '기존 모임 시간을 조금 늘리는 것으로 대신한다',
        apply: (s) => { s.fund -= 10000; s.faith = clamp(s.faith + 1, 0, 100); return '다과를 조금 더 준비해 늘어난 시간을 채웠습니다.'; } },
      { label: '지금의 흐름을 유지한다',
        apply: (s) => { s.fund += 20000; s.faith = clamp(s.faith - 1, 0, 100); return '별다른 변화 없이 한 주가 지나갔습니다.'; } },
    ],
  },
  {
    id: 'mission_trip', icon: 'micon_ev_plane.png', title: '단기선교 제안',
    body: '한 단체로부터 단기선교팀을 보내달라는 제안이 들어왔습니다.',
    available: (s) => s.members >= EVENT_TIER_TREE && s.fund >= 1500000,
    choices: [
      { label: '대규모 팀을 꾸려 다녀온다',
        apply: (s) => { s.fund -= 1500000; s.faith = clamp(s.faith + 4, 0, 100); s.reputation = clamp(s.reputation + 2, 0, 100); return '다녀온 팀의 간증이 온 교회에 큰 은혜가 되었습니다.'; } },
      { label: '적정 규모의 팀을 꾸려 다녀온다',
        apply: (s) => { s.fund -= 900000; s.faith = clamp(s.faith + 3, 0, 100); s.reputation = clamp(s.reputation + 1, 0, 100); return '다녀온 팀의 간증이 큰 은혜가 되었습니다.'; } },
      { label: '소수 정예로 짧게 다녀온다',
        apply: (s) => { s.fund -= 400000; s.faith = clamp(s.faith + 2, 0, 100); return '짧았지만 의미 있는 시간이었습니다.'; } },
      { label: '이번엔 국내 사역에 집중한다',
        apply: (s) => { s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation - 1, 0, 100); return '가까운 곳부터 섬기기로 했지만, 제안한 단체는 아쉬워했습니다.'; } },
    ],
  },
  {
    id: 'dedication_service', icon: 'micon_ev_ribbon.png', title: '헌당 감사예배 제안',
    body: '새로 확장한 공간을 두고 헌당 감사예배를 드리자는 제안이 나왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT && Object.values(s.buildings).some((v) => v >= 1),
    choices: [
      { label: '성대하게 헌당예배를 드리고 지역에 알린다',
        apply: (s) => { s.fund -= 400000; s.reputation = clamp(s.reputation + 4, 0, 100); return '성대한 헌당예배가 지역에 좋은 소문으로 퍼졌습니다.'; } },
      { label: '조용히 감사예배만 드린다',
        apply: (s) => { s.fund -= 80000; s.faith = clamp(s.faith + 2, 0, 100); return '조용하지만 깊은 감사의 예배가 되었습니다.'; } },
      { label: '성도들과 작은 다과회만 갖는다',
        apply: (s) => { s.fund -= 30000; s.faith = clamp(s.faith + 1, 0, 100); return '소박한 자리였지만 감사한 마음을 나누었습니다.'; } },
      { label: '예배 없이 그냥 사용을 시작한다',
        apply: (s) => { s.fund += 20000; s.reputation = clamp(s.reputation - 1, 0, 100); return '비용은 아꼈지만, 아쉬워하는 성도들도 있었습니다.'; } },
    ],
  },
  {
    id: 'online_ministry', icon: 'micon_ev_camera.png', title: '온라인 예배 송출 제안',
    body: '거동이 어려운 성도들을 위해 예배를 온라인으로 송출하자는 의견이 나왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT,
    choices: [
      { label: '전문 장비를 갖추고 제대로 시작한다',
        apply: (s) => { s.fund -= 700000; s.reputation = clamp(s.reputation + 3, 0, 100); s.memberFrac += 1; s.members = Math.floor(s.memberFrac); return '선명한 화질의 온라인 예배에 새로운 참여자가 생겼습니다.'; } },
      { label: '스마트폰으로 간단히 송출을 시작한다',
        apply: (s) => { s.fund -= 100000; s.reputation = clamp(s.reputation + 2, 0, 100); return '소박하지만 정성이 담긴 송출이 시작되었습니다.'; } },
      { label: '봉사자 한 명이 맡아 소박하게 진행한다',
        apply: (s) => { s.fund -= 20000; s.faith = clamp(s.faith + 1, 0, 100); return '한 봉사자의 헌신으로 소박하게 시작됐습니다.'; } },
      { label: '아직은 시기상조라 미룬다',
        apply: (s) => { s.fund += 30000; s.reputation = clamp(s.reputation - 1, 0, 100); return '거동이 어려운 성도들은 여전히 아쉬워했습니다.'; } },
    ],
  },
  {
    id: 'wedding_request', icon: 'micon_ev_wedding.png', title: '성도 자녀의 결혼식 요청',
    body: '오래 섬긴 성도의 자녀가 우리 예배당에서 결혼식을 올리고 싶다고 요청해왔습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT && s.week >= 260, // "오래 섬긴" 표현과 맞도록 최소 5년 이상 지난 뒤에만(게임 속도가 빨라져 1년으로는 여전히 일러 보인다는 재지적으로 상향)
    choices: [
      { label: '예배당을 아름답게 단장해 축하한다',
        apply: (s) => { s.fund -= 200000; s.faith = clamp(s.faith + 2, 0, 100); s.reputation = clamp(s.reputation + 2, 0, 100); return '아름답게 꾸며진 예배당에서 뜻깊은 예식이 열렸습니다.'; } },
      { label: '정성껏 예식을 준비해 축하한다',
        apply: (s) => { s.fund -= 60000; s.reputation = clamp(s.reputation + 1, 0, 100); return '정성이 담긴 예식에 온 교회가 함께 기뻐했습니다.'; } },
      { label: '축하 인사와 함께 장소만 제공한다',
        apply: (s) => { s.fund -= 10000; s.reputation = clamp(s.reputation + 1, 0, 100); return '소박했지만 따뜻한 축하가 되었습니다.'; } },
      { label: '다른 성도들과의 형평성을 고려해 정중히 조율한다',
        apply: (s) => { s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation - 1, 0, 100); return '원칙은 지켰지만, 서운함이 조금 남았습니다.'; } },
    ],
  },
  {
    id: 'bereavement_care', icon: 'micon_ev_dove.png', title: '상을 당한 성도 가정',
    body: '오랫동안 함께한 성도 가정이 갑작스러운 상을 당했습니다.',
    available: (s) => s.members >= EVENT_TIER_SPROUT && s.week >= 260, // "오랫동안 함께한" 표현과 맞도록 최소 5년 이상 지난 뒤에만(게임 속도가 빨라져 1년으로는 여전히 일러 보인다는 재지적으로 상향)
    choices: [
      { label: '목회자와 성도들이 삼일 내내 함께한다',
        apply: (s) => { s.fund -= 150000; s.faith = clamp(s.faith + 3, 0, 100); return '함께한 삼일이 가정에 큰 위로가 되었습니다.'; } },
      { label: '장례 예배를 정성껏 인도하고 필요한 도움을 준다',
        apply: (s) => { s.fund -= 80000; s.faith = clamp(s.faith + 2, 0, 100); s.reputation = clamp(s.reputation + 1, 0, 100); return '정성스러운 예배가 유가족에게 힘이 되었습니다.'; } },
      { label: '위로 심방과 부조로 마음을 전한다',
        apply: (s) => { s.fund -= 50000; s.faith = clamp(s.faith + 1, 0, 100); return '따뜻한 위로의 마음이 전해졌습니다.'; } },
      { label: '바쁜 일정으로 짧게 조문만 한다',
        apply: (s) => { s.fund += 20000; s.faith = clamp(s.faith - 1, 0, 100); return '짧은 조문에 아쉬움이 남는 이들도 있었습니다.'; } },
    ],
  },
  {
    id: 'facility_repair', icon: 'micon_ev_wrench.png', title: '노후 시설 보수가 필요합니다',
    body: '오래된 배관과 전기 설비 여기저기서 문제가 생기고 있습니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT && Object.values(s.buildings).some((v) => v >= 2),
    choices: [
      { label: '전면 보수 공사를 진행한다',
        apply: (s) => { s.fund -= 600000; s.reputation = clamp(s.reputation + 2, 0, 100); s.faith = clamp(s.faith + 1, 0, 100); return '말끔해진 시설에 성도들의 만족도가 높아졌습니다.'; } },
      { label: '급한 부분만 우선 수리한다',
        apply: (s) => { s.fund -= 200000; s.reputation = clamp(s.reputation + 1, 0, 100); return '급한 불은 껐지만, 근본적인 해결은 아니었습니다.'; } },
      { label: '봉사자들이 힘을 모아 손수 고친다',
        apply: (s) => { s.fund -= 30000; return '봉사자들의 땀방울로 비용을 아꼈습니다.'; } },
      { label: '예산이 없어 당분간 미룬다',
        apply: (s) => { s.fund += 30000; s.reputation = clamp(s.reputation - 2, 0, 100); return '불편을 호소하는 성도들이 늘어났습니다.'; } },
    ],
  },
  {
    id: 'missionary_support', icon: 'micon_ev_globe.png', title: '파송 선교사의 후원 요청',
    body: '해외에서 사역 중인 선교사님이 사역지 상황이 어려워졌다며 후원을 요청해왔습니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT && s.fund >= 1000000,
    choices: [
      { label: '정기 후원금을 크게 늘린다',
        apply: (s) => { s.fund -= 500000; s.faith = clamp(s.faith + 3, 0, 100); return '늘어난 후원에 선교사님이 큰 힘을 얻었습니다.'; } },
      { label: '이번 한 번 특별 후원을 보낸다',
        apply: (s) => { s.fund -= 250000; s.faith = clamp(s.faith + 2, 0, 100); return '특별 후원이 시기적절한 도움이 되었습니다.'; } },
      { label: '성도들과 함께 기도로 동참한다',
        apply: (s) => { s.faith = clamp(s.faith + 1, 0, 100); s.reputation = clamp(s.reputation - 1, 0, 100); return '기도로 함께했지만, 실질적 도움은 아쉬웠습니다.'; } },
      { label: '교회 재정 형편상 어렵다고 답한다',
        apply: (s) => { s.fund += 20000; s.faith = clamp(s.faith - 1, 0, 100); return '어려운 답변에 마음이 무거웠습니다.'; } },
    ],
  },
  {
    id: 'staff_burnout', icon: 'micon_ev_tired.png', title: '지친 사역자들',
    body: '쉼 없이 달려온 사역자들의 얼굴에 지친 기색이 역력합니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT && Object.keys(s.staffHired).filter((k) => s.staffHired[k]).length >= 2,
    choices: [
      { label: '안식월(한 달 휴가)을 마련해준다',
        apply: (s) => { s.fund -= 400000; s.faith = clamp(s.faith + 2, 0, 100); return '충분한 쉼을 얻은 사역자들이 다시 힘을 냈습니다.'; } },
      { label: '짧은 휴가와 격려금을 드린다',
        apply: (s) => { s.fund -= 150000; s.faith = clamp(s.faith + 1, 0, 100); return '작은 쉼이었지만 감사한 마음이 컸습니다.'; } },
      { label: '감사 인사와 함께 회식 자리를 마련한다',
        apply: (s) => { s.fund -= 60000; s.faith = clamp(s.faith + 1, 0, 100); return '함께한 식사 자리가 잠시나마 위로가 되었습니다.'; } },
      { label: '지금은 바빠서 넘어간다',
        apply: (s) => { s.fund += 30000; s.faith = clamp(s.faith - 2, 0, 100); return '지친 기색이 좀처럼 가시지 않았습니다.'; } },
    ],
  },
  {
    id: 'generous_legacy', icon: 'micon_s_scroll.png', title: '은퇴 성도의 유산 기부',
    body: '은퇴 후 이 교회에 정착해 신앙생활을 해온 한 성도님이, 평생 모은 재산의 일부를 교회에 남기고 싶다고 조용히 찾아오셨습니다.',
    available: (s) => s.members >= EVENT_TIER_TREE && s.week >= 260, // "정착해 신앙생활을 해온" 표현과 맞도록 5년 이상으로 상향(다른 유사 이벤트와 통일)
    choices: [
      { label: '감사히 받아 다음세대를 위한 기금으로 삼는다',
        apply: (s) => { s.fund += 5000000; s.faith = clamp(s.faith + 2, 0, 100); return '귀한 유산이 다음세대를 위한 밑거름이 되었습니다.'; } },
      { label: '감사히 받아 교회 살림에 보탠다',
        apply: (s) => { s.fund += 5000000; s.reputation = clamp(s.reputation - 1, 0, 100); return '살림에 큰 보탬이 됐지만, 사용처를 두고 작은 이견이 있었습니다.'; } },
      { label: '절반만 받고 나머지는 가족에게 돌려드린다',
        apply: (s) => { s.fund += 2500000; s.faith = clamp(s.faith + 1, 0, 100); return '절제된 결정에 오히려 깊은 존경을 받았습니다.'; } },
      { label: '정중히 사양하고 축복만 전한다',
        apply: (s) => { s.reputation = clamp(s.reputation + 1, 0, 100); s.faith = clamp(s.faith - 1, 0, 100); return '사양한 마음은 귀했지만, 성도님은 못내 서운해하셨습니다.'; } },
    ],
  },
  {
    id: 'community_disaster', icon: 'micon_ev_siren.png', title: '지역에 갑작스런 재난 소식',
    body: '인근 지역에 화재 피해 소식이 전해지며 도움의 손길이 필요합니다.',
    available: (s) => s.members >= EVENT_TIER_TREE,
    choices: [
      { label: '구호물품과 성금을 크게 보낸다',
        apply: (s) => { s.fund -= 400000; s.reputation = clamp(s.reputation + 5, 0, 100); return '큰 나눔이 이재민들에게 실질적인 도움이 되었습니다.'; } },
      { label: '성도들과 모금해 지원한다',
        apply: (s) => { s.fund -= 150000; s.reputation = clamp(s.reputation + 3, 0, 100); return '십시일반 모은 정성이 이웃에게 전해졌습니다.'; } },
      { label: '기도와 작은 위로 편지를 보낸다',
        apply: (s) => { s.reputation = clamp(s.reputation + 1, 0, 100); s.faith = clamp(s.faith - 1, 0, 100); return '실질적 도움이 크지 않아 아쉬워하는 성도도 있었습니다.'; } },
      { label: '우리 교회 사정도 넉넉지 않아 지켜본다',
        apply: (s) => { s.fund += 30000; s.reputation = clamp(s.reputation - 2, 0, 100); return '지켜만 보는 것에 마음이 무거웠습니다.'; } },
    ],
  },
  {
    id: 'sunday_school_boom', icon: 'micon_ev_teddy.png', title: '주일학교가 북적입니다',
    body: '아이들이 부쩍 늘어 주일학교 교실이 비좁아졌습니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT,
    choices: [
      { label: '즉시 공간을 확장하고 교사를 충원한다',
        apply: (s) => { s.fund -= 350000; s.faith = clamp(s.faith + 2, 0, 100); s.memberFrac += 1; s.members = Math.floor(s.memberFrac); return '넉넉해진 공간에 아이들의 웃음소리가 커졌습니다.'; } },
      { label: '반을 나누어 시간을 조정한다',
        apply: (s) => { s.fund -= 60000; s.faith = clamp(s.faith + 1, 0, 100); return '시간을 나누어 붐비는 문제를 완화했습니다.'; } },
      { label: '기존 봉사자들이 조금 더 애써준다',
        apply: (s) => { s.fund -= 15000; s.faith = clamp(s.faith + 1, 0, 100); return '봉사자들의 헌신으로 잘 버텼습니다.'; } },
      { label: '다음 기회에 정비하기로 한다',
        apply: (s) => { s.fund += 30000; s.faith = clamp(s.faith - 1, 0, 100); return '비좁은 교실에 대한 불만이 조금씩 쌓였습니다.'; } },
    ],
  },
  {
    id: 'growth_plateau', icon: 'micon_ev_chartup.png', title: '성도수가 제자리걸음입니다',
    body: '건물도 사역도 늘었는데, 정작 새가족은 눈에 띄게 늘지 않고 있습니다. 지역에 우리 교회 이야기가 잘 퍼지지 않는 듯합니다.',
    available: (s) => s.members >= EVENT_TIER_FRUIT && s.reputation < 55,
    choices: [
      { label: '지역 신뢰 회복을 위한 전면적인 섬김 캠페인을 시작한다',
        apply: (s) => { s.fund -= 700000; s.reputation = clamp(s.reputation + 8, 0, 100); return '적극적인 섬김에 지역의 시선이 달라지기 시작했습니다.'; } },
      { label: '이웃과의 접점을 늘리는 작은 캠페인을 시작한다',
        apply: (s) => { s.fund -= 250000; s.reputation = clamp(s.reputation + 4, 0, 100); return '작지만 꾸준한 노력이 조금씩 소문나기 시작했습니다.'; } },
      { label: '기존 성도들에게 입소문을 부탁한다',
        apply: (s) => { s.fund -= 30000; s.reputation = clamp(s.reputation + 1, 0, 100); return '성도들의 자발적인 입소문이 작은 보탬이 되었습니다.'; } },
      { label: '내실을 다지며 때를 기다린다',
        apply: (s) => { s.reputation = clamp(s.reputation - 2, 0, 100); return '뚜렷한 변화 없이 정체가 계속되었습니다.'; } },
    ],
  },
  {
    id: 'financial_scandal', icon: 'micon_ev_newspaper.png', title: '재정 운용에 대한 의혹이 제기되었습니다',
    body: '일부 성도들 사이에서 헌금 사용처가 불투명하다는 소문이 돌기 시작했습니다. 대응을 늦추면 신뢰가 크게 흔들릴 수 있습니다.',
    available: (s) => s.members >= EVENT_TIER_TREE,
    choices: [
      { label: '외부 회계법인에 전면 감사를 의뢰하고 결과를 공개한다',
        apply: (s) => { s.fund -= 600000; s.reputation = clamp(s.reputation + 5, 0, 100); s.faith = clamp(s.faith + 2, 0, 100); return '투명한 감사 결과 공개에 오히려 신뢰가 더 두터워졌습니다.'; } },
      { label: '제직회 명의로 재정 내역을 상세히 공개한다',
        apply: (s) => { s.fund -= 100000; s.reputation = clamp(s.reputation + 2, 0, 100); return '성실한 공개에 대부분의 의혹이 해소되었습니다.'; } },
      { label: '짧은 해명 공지만 낸다',
        apply: (s) => { s.fund -= 20000; s.reputation = clamp(s.reputation - 1, 0, 100); return '해명이 부족했는지 의혹이 완전히 가시지는 않았습니다.'; } },
      { label: '근거 없는 소문이라며 대응하지 않는다',
        apply: (s) => { s.reputation = clamp(s.reputation - 6, 0, 100); s.faith = clamp(s.faith - 2, 0, 100); return '침묵이 오히려 의혹을 키워 신뢰가 크게 흔들렸습니다.'; } },
    ],
  },
  {
    id: 'schism_risk', icon: 'micon_ev_bolt.png', title: '내부 분열의 조짐이 보입니다',
    body: '교회가 커지면서 방향성을 둘러싼 의견 차이가 깊어졌습니다. 일부 성도들이 따로 모임을 만들려 한다는 이야기까지 들려옵니다.',
    available: (s) => s.members >= EVENT_TIER_MEGA,
    choices: [
      { label: '당회를 소집해 며칠간 집중적으로 중재하고 화해를 이끈다',
        apply: (s) => { s.fund -= 800000; s.faith = clamp(s.faith + 4, 0, 100); return '진심 어린 중재 끝에 공동체가 다시 하나로 모였습니다.'; } },
      { label: '전 성도가 참여하는 공개 대화의 시간을 마련한다',
        apply: (s) => { s.fund -= 300000; s.faith = clamp(s.faith + 2, 0, 100); s.memberFrac = Math.max(0, s.memberFrac - 3); s.members = Math.floor(s.memberFrac); return '대화로 큰 갈등은 풀렸지만, 몇몇은 이미 마음이 떠나 있었습니다.'; } },
      { label: '당회에 조용히 수습을 맡긴다',
        apply: (s) => { s.fund -= 50000; s.memberFrac = Math.max(0, s.memberFrac - 8); s.members = Math.floor(s.memberFrac); return '조용한 수습이었지만 적지 않은 성도가 떠났습니다.'; } },
      { label: '시간이 지나면 가라앉으리라 믿고 지켜본다',
        apply: (s) => { s.faith = clamp(s.faith - 3, 0, 100); s.memberFrac = Math.max(0, s.memberFrac - 20); s.members = Math.floor(s.memberFrac); return '갈등이 곪아 터지며 적지 않은 성도들이 교회를 떠나고 말았습니다.'; } },
    ],
  },
];

/* 고신총회 헌법 2부 관리표준(제63~84조·제108~109조) 근거 — 권징(재판·시벌) 절차는
   민감한 사법 영역이라 이 게임에 담지 않고, 직분 임직 요건·당회 조직요건만 가볍게
   반영한다. 정확한 연령·조건은 게임 진행 속도에 맞춰 단순화했다(README 출처 참조). */
/* 임직 한도는 교회 규모에 비례해 늘어난다(오너 지시) — 성도 25명당 1자리, 최소 2자리.
   실제로도 교인이 많아질수록 당회·제직회 정원이 함께 늘어나는 것과 같은 원리다. */
function officerMaxFor(s) {
  return Math.max(2, Math.floor(s.members / 25));
}

/* 등록연한(장로 3년·집사·권사 2년)은 2부 제65·75·81조 근거. 교회 자체가 그 연한보다
   어리면 아무리 성도·봉사자가 많아도 후보 자격을 갖춘 사람이 있을 수 없다 — 그래서 unlock
   조건에 churchAgeYears(s)도 함께 검사한다(오너 지시: "임직자의 조건 등등 맞게"). */
const OFFICER_MIN_TENURE = { elder: 3, deacon: 2, exhorter: 2 };

const OFFICERS = {
  elder: {
    name: '장로', icon: 'micon_o_elder.png',
    desc: '만 40~66세, 등록 3년 이상 된 세례교인 중 신망 있는 이를 공동의회 2/3 이상 찬성으로 세웁니다. 목사와 함께 당회를 이루어 교회를 돌봅니다(2부 제63~68조). 항존직이라 한번 임직하면 정년(만 70세)까지 계속 시무합니다.',
    cost: 500000, volCost: 2,
    unlock: (s) => s.members >= 30 && churchAgeYears(s) >= OFFICER_MIN_TENURE.elder,
    lockDesc: `세례교인(성도) 30명 이상 + 개척 ${OFFICER_MIN_TENURE.elder}년 이상 필요 — 당회 조직요건(제109조)·등록연한(제65조)`,
    perUnitNote: '정착률 +2%p',
  },
  deacon: {
    name: '집사', icon: 'micon_o_deacon.png',
    desc: '만 35~66세, 등록 2년 이상 된 성도 중 봉사와 회계, 구제를 섬길 이를 공동의회 2/3 이상 찬성으로 세웁니다. 살림을 든든히 맡아 교회의 신뢰를 더합니다(2부 제75~78조). 항존직이라 한번 임직하면 정년(만 70세)까지 계속 시무합니다.',
    cost: 400000, volCost: 1,
    unlock: (s) => s.volunteers >= 5 && churchAgeYears(s) >= OFFICER_MIN_TENURE.deacon,
    lockDesc: `봉사자 5명 이상 + 개척 ${OFFICER_MIN_TENURE.deacon}년 이상 필요 — 등록연한(제75조)`,
    perUnitNote: '지역신뢰 +0.3/주',
  },
  exhorter: {
    name: '권사', icon: 'micon_o_exhorter.png',
    desc: '만 45~66세, 등록 2년 이상 된 여성도 중 심방을 통해 병자와 약한 이를 위로하고 격려할 이를 공동의회 2/3 이상 찬성으로 세웁니다(2부 제81~84조). 항존직에 준하는 직분이라 한번 임직하면 정년(만 70세)까지 계속 시무합니다.',
    cost: 400000, volCost: 1,
    unlock: (s) => s.volunteers >= 5 && churchAgeYears(s) >= OFFICER_MIN_TENURE.exhorter,
    lockDesc: `봉사자 5명 이상 + 개척 ${OFFICER_MIN_TENURE.exhorter}년 이상 필요 — 등록연한(제81조)`,
    perUnitNote: '신앙지수 +0.3/주',
  },
};

/* ===================== 유틸 ===================== */

/* 재정 수입 내역을 종류별로 나눠 보여준다(오너 지시) — 실제 총 수입 계산식은 그대로 두고,
   표시할 때만 비율로 쪼갠다(밸런스에 영향 없는 순수 표시용 분해). 비율은 국내 교회 헌금
   구성비의 통상적인 인상을 반영한 근사치. */
const OFFERING_TYPES = [
  { key: 'tithe', name: '십일조', ratio: 0.40 },
  { key: 'sunday', name: '주일헌금', ratio: 0.30 },
  { key: 'thanks', name: '감사헌금', ratio: 0.15 },
  { key: 'mission', name: '선교헌금', ratio: 0.10 },
  { key: 'other', name: '기타헌금', ratio: 0.05 },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }

function fmtWon(n) {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  if (a >= 100000000) {
    const val = a / 100000000;
    return sign + (Number.isInteger(val) ? val : val.toFixed(1)) + '억원';
  }
  if (a >= 10000) return sign + Math.round(a / 10000).toLocaleString('ko-KR') + '만원';
  return sign + a.toLocaleString('ko-KR') + '원';
}

const WEEKS_PER_MONTH = 4.345;

/* 교회 자체가 실제로 존재해온 햇수(정수, 내림) — 직분자 임직 등록연한 조건(장로 3년·집사·
   권사 2년, 2부 제65·75·81조)이 개척 초기엔 물리적으로 성립할 수 없다는 걸 검사하는 데 쓴다. */
function churchAgeYears(s) {
  return Math.floor(Math.max(0, s.week - 1) / WEEKS_PER_MONTH / 12);
}

function formatChurchAge(week) {
  const elapsedWeeks = Math.max(0, week - 1);
  const totalMonths = Math.floor(elapsedWeeks / WEEKS_PER_MONTH);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years <= 0) return `개척 ${months}개월`;
  return `개척 ${years}년 ${months}개월`;
}

/* 절대 시간 표기 — "개척 00년 00개월"은 게임 내 상대 나이고, 이건 실제로 게임을 시작한
   달력 날짜(gameStartDate)에서 경과 주 수만큼 흘려 계산한 게임 속 달력 날짜다(오너 지시).
   게임 속 시간 흐름 속도만큼(자동진행 간격 등) 이 날짜도 함께 빨리 흐른다. */
function formatAbsoluteDate(s) {
  const start = new Date(s.gameStartDate + 'T00:00:00');
  const elapsedWeeks = Math.max(0, s.week - 1);
  const d = new Date(start.getTime() + elapsedWeeks * 7 * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function currentTier(members) {
  let t = TIERS[0];
  for (const tier of TIERS) if (members >= tier.min) t = tier;
  return t;
}
function nextTier(members) {
  for (const tier of TIERS) if (members < tier.min) return tier;
  return null;
}

/* ===================== 상태 관리 ===================== */

function newGame(name) {
  return {
    name: name || '은혜교회',
    week: 1,
    fund: 8000000,
    members: 12, memberFrac: 12,
    faith: 60,
    reputation: 40,
    volunteers: 3, volunteerFrac: 3,
    buildings: { sanctuary: 0, education: 0, fellowship: 0, parking: 0 },
    staffHired: {},
    candidateGen: {},
    ministriesActive: {},
    departmentsActive: {},
    officers: { elder: [], deacon: [], exhorter: [] }, // 각 원소 = 임직한 주차(항존직 — 자동 만료 없음)
    logs: [],
    recentEventIds: [],
    lastEventWeek: 0,
    tierReached: 'seed',
    financialCrisisWeeks: 0,
    lastSavedAt: Date.now(),
    endingShown: false,
    boostItems: { small: 0, medium: 0, large: 0 },
    speedBoostKey: null, speedBoostMultiplier: 1, speedBoostUntil: 0,
    gameStartDate: new Date().toISOString().slice(0, 10), // 절대 시간 표기의 기준점(게임을 실제로 시작한 날짜)
    pastorSalaryMult: 1,
    candidateSeed: Math.floor(Math.random() * 1000000000), // 이 판에서 부교역자 후보들이 어떤 사람으로 나올지 결정하는 무작위 시드
    campaignHistory: [],
    pastoralDirections: {}, // { 항목키: 선택한 옵션키 } — 미설정 항목은 효과 없음
  };
}

let isFirstEverLaunch = true;
try { isFirstEverLaunch = !localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
let state = loadGame() || newGame();
let currentTab = 'dashboard';

/* loadGame()과 저장파일 불러오기(import) 양쪽에서 공유하는 마이그레이션 로직 —
   구버전 저장이나 내보내기 파일이 최신 필드 구조를 갖추도록 보정한다.
   유효한 저장이 아니면(week 필드 없음) null을 반환한다. */
function migrateSave(s) {
  if (!s || typeof s.week !== 'number') return null;
  if (!s.officers) s.officers = { elder: 0, deacon: 0, exhorter: 0 };
  if (!s.recentEventIds) s.recentEventIds = [];
  if (typeof s.lastEventWeek !== 'number') s.lastEventWeek = s.week;
  if (typeof s.endingShown !== 'boolean') s.endingShown = false;
  if (!s.lastSavedAt) s.lastSavedAt = Date.now();
  if (!s.departmentsActive) s.departmentsActive = {};
  if (!s.candidateGen) s.candidateGen = {};
  if (!s.boostItems) s.boostItems = { small: 0, medium: 0, large: 0 };
  if (typeof s.speedBoostMultiplier !== 'number') s.speedBoostMultiplier = 1;
  if (typeof s.speedBoostUntil !== 'number') s.speedBoostUntil = 0;
  if (typeof s.speedBoostKey === 'undefined') s.speedBoostKey = null;
  if (!s.gameStartDate) s.gameStartDate = new Date().toISOString().slice(0, 10);
  if (typeof s.pastorSalaryMult !== 'number') s.pastorSalaryMult = 1;
  if (typeof s.candidateSeed !== 'number') s.candidateSeed = Math.floor(Math.random() * 1000000000); // 구버전 저장 호환 — 이 판만의 시드를 새로 부여
  if (!Array.isArray(s.campaignHistory)) s.campaignHistory = [];
  if (!s.pastoralDirections || typeof s.pastoralDirections !== 'object') s.pastoralDirections = {};
  for (const k of ['elder', 'deacon', 'exhorter']) {
    if (typeof s.officers[k] === 'number') {
      const n = s.officers[k];
      s.officers[k] = [];
      for (let i = 0; i < n; i++) s.officers[k].push(s.week); // 구버전(숫자 카운트) 호환 — 임직 주차 배열로 변환
    } else if (!Array.isArray(s.officers[k])) {
      s.officers[k] = [];
    }
  }
  for (const k in (s.staffHired || {})) {
    if (s.staffHired[k] === true) s.staffHired[k] = null; // 구버전(불리언) 저장 호환 — 이름 있는 후보자로 다시 청빙 필요
    if (s.staffHired[k] === false) s.staffHired[k] = null;
    if (s.staffHired[k] && typeof s.staffHired[k].wellbeing !== 'number') s.staffHired[k].wellbeing = 70; // 구버전 저장 호환
  }
  for (const k of ['elder', 'deacon', 'exhorter']) {
    (s.officers[k] || []).forEach((entry) => {
      if (entry && typeof entry === 'object' && typeof entry.wellbeing !== 'number') entry.wellbeing = 70; // 구버전 저장 호환
    });
  }
  return s;
}

function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateSave(JSON.parse(raw));
  } catch (e) { return null; }
}

function saveGame() {
  try {
    state.lastSavedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveIndicator();
  } catch (e) { /* storage unavailable: continue without persistence */ }
}

function flashSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = '자동 저장됨';
  el.style.opacity = '1';
  clearTimeout(flashSaveIndicator._t);
  flashSaveIndicator._t = setTimeout(() => { el.style.opacity = '0.4'; }, 1200);
}

function addLog(text) {
  state.logs.unshift({ week: state.week, text });
  if (state.logs.length > 60) state.logs.length = 60;
}

/* ===================== 게임 엔진 ===================== */

function computeModifiers(s) {
  const mod = { faithPerWeek: 0, reputationPerWeek: 0, retentionBonus: 0, visitorPerWeek: 0, volunteerGain: 0 };
  for (const key in STAFF) {
    if (s.staffHired[key]) {
      const e = STAFF[key].effect;
      const mult = s.staffHired[key].housing ? HOUSING_EFFECT_MULT : 1;
      mod.faithPerWeek += (e.faithPerWeek || 0) * mult;
      mod.reputationPerWeek += (e.reputationPerWeek || 0) * mult;
      mod.retentionBonus += (e.retentionBonus || 0) * mult;
      mod.visitorPerWeek += (e.visitorPerWeek || 0) * mult;
    }
  }
  for (const key in MINISTRIES) {
    if (s.ministriesActive[key]) {
      const e = MINISTRIES[key].effect;
      const amult = staffAssignedTo(s, 'ministry', key) ? STAFF_ASSIGNMENT_MULT : 1;
      mod.faithPerWeek += (e.faithPerWeek || 0) * amult;
      mod.reputationPerWeek += (e.reputationPerWeek || 0) * amult;
      mod.retentionBonus += (e.retentionBonus || 0) * amult;
      mod.visitorPerWeek += (e.visitorPerWeek || 0) * amult;
    }
  }
  for (const key in DEPARTMENTS) {
    if (s.departmentsActive[key]) {
      const e = DEPARTMENTS[key].effect;
      const amult = staffAssignedTo(s, 'department', key) ? STAFF_ASSIGNMENT_MULT : 1;
      mod.faithPerWeek += (e.faithPerWeek || 0) * amult;
      mod.reputationPerWeek += (e.reputationPerWeek || 0) * amult;
      mod.retentionBonus += (e.retentionBonus || 0) * amult;
      mod.visitorPerWeek += (e.visitorPerWeek || 0) * amult;
    }
  }
  const edu = BUILDINGS.education.levels[s.buildings.education];
  mod.faithPerWeek += edu.faithBonus || 0;
  mod.retentionBonus += edu.retention || 0;
  const fel = BUILDINGS.fellowship.levels[s.buildings.fellowship];
  mod.reputationPerWeek += fel.repBonus || 0;
  mod.volunteerGain += fel.volGain || 0;
  const park = BUILDINGS.parking.levels[s.buildings.parking];
  mod.visitorPerWeek += park.visitorBonus || 0;

  if (s.officers) {
    mod.retentionBonus += (s.officers.elder || []).length * 0.02;
    mod.reputationPerWeek += (s.officers.deacon || []).length * 0.3;
    mod.faithPerWeek += (s.officers.exhorter || []).length * 0.3;
  }

  const psm = s.pastorSalaryMult || 1;
  if (psm < 0.7) mod.faithPerWeek -= (0.7 - psm) * 3;
  else if (psm > 1.0) mod.faithPerWeek += Math.min(psm - 1.0, 0.5) * 0.4;

  if (s.pastoralDirections) {
    for (const catKey in PASTORAL_DIRECTIONS) {
      const chosenKey = s.pastoralDirections[catKey];
      if (!chosenKey) continue;
      const opt = PASTORAL_DIRECTIONS[catKey].options[chosenKey];
      if (!opt) continue;
      const e = opt.effect;
      mod.faithPerWeek += e.faithPerWeek || 0;
      mod.reputationPerWeek += e.reputationPerWeek || 0;
      mod.retentionBonus += e.retentionBonus || 0;
      mod.visitorPerWeek += e.visitorPerWeek || 0;
    }
  }

  return mod;
}

function computeUpkeep(s) {
  let total = pastorWeeklySalary(s);
  for (const key in STAFF) if (s.staffHired[key]) total += staffWeeklySalary(key, s.staffHired[key]);
  for (const key in MINISTRIES) if (s.ministriesActive[key]) total += MINISTRIES[key].upkeep;
  for (const key in DEPARTMENTS) if (s.departmentsActive[key]) total += DEPARTMENTS[key].upkeep;
  return total;
}

/* 지출도 종류별로 나눠 보여준다(오너 지시) — 수입 쪽(OFFERING_TYPES)은 가상의 비율 분해였지만
   이쪽은 실제로 이미 나뉘어 있는 항목(담임목사·부교역자·사역·부서)을 그대로 합산해 보여준다. */
function upkeepBreakdown(s) {
  const rows = [{ name: '담임목사 사례비', amount: pastorWeeklySalary(s) }];
  let staffTotal = 0;
  for (const key in STAFF) if (s.staffHired[key]) staffTotal += staffWeeklySalary(key, s.staffHired[key]);
  if (staffTotal > 0) rows.push({ name: '부교역자 사례비', amount: staffTotal });
  let minTotal = 0;
  for (const key in MINISTRIES) if (s.ministriesActive[key]) minTotal += MINISTRIES[key].upkeep;
  if (minTotal > 0) rows.push({ name: '사역 유지비', amount: minTotal });
  let deptTotal = 0;
  for (const key in DEPARTMENTS) if (s.departmentsActive[key]) deptTotal += DEPARTMENTS[key].upkeep;
  if (deptTotal > 0) rows.push({ name: '부서 유지비', amount: deptTotal });
  return rows;
}

function isNeglected(s) {
  const anyMinistry = Object.keys(s.ministriesActive).some((k) => s.ministriesActive[k]);
  const anyDept = Object.keys(s.departmentsActive).some((k) => s.departmentsActive[k]);
  const anyStaff = Object.keys(s.staffHired).some((k) => s.staffHired[k]);
  const anyOfficer = (s.officers.elder || []).length + (s.officers.deacon || []).length + (s.officers.exhorter || []).length > 0;
  return !anyMinistry && !anyDept && !anyStaff && !anyOfficer;
}

function advanceWeek() {
  const s = state;
  const mod = computeModifiers(s);
  const sanctuaryCap = BUILDINGS.sanctuary.levels[s.buildings.sanctuary].cap;
  const neglected = s.week > 3 && isNeglected(s);

  const offerRate = 8000 + s.faith * 120;
  const income = Math.round(s.members * offerRate);
  const upkeep = computeUpkeep(s);
  const neglectOverhead = neglected ? Math.round(income * 1.5) : 0;
  const net = income - upkeep - neglectOverhead;
  s.fund += net;

  let crisisNote = null;
  if (s.fund < 0) {
    s.financialCrisisWeeks = (s.financialCrisisWeeks || 0) + 1;
  } else {
    s.financialCrisisWeeks = 0;
  }
  if (s.financialCrisisWeeks >= 3) {
    const activeMin = Object.keys(s.ministriesActive).filter((k) => s.ministriesActive[k]).map((k) => ({ k, kind: 'ministry', upkeep: MINISTRIES[k].upkeep, name: MINISTRIES[k].name }));
    const activeDept = Object.keys(s.departmentsActive).filter((k) => s.departmentsActive[k]).map((k) => ({ k, kind: 'dept', upkeep: DEPARTMENTS[k].upkeep, name: DEPARTMENTS[k].name }));
    const active = activeMin.concat(activeDept);
    if (active.length) {
      active.sort((a, b) => b.upkeep - a.upkeep);
      const cut = active[0];
      if (cut.kind === 'ministry') s.ministriesActive[cut.k] = false;
      else s.departmentsActive[cut.k] = false;
      crisisNote = `재정이 어려워져 '${cut.name}'을(를) 잠시 쉬기로 했습니다.`;
    } else {
      const hiredStaff = Object.keys(s.staffHired).filter((k) => s.staffHired[k]);
      if (hiredStaff.length) {
        hiredStaff.sort((a, b) => staffWeeklySalary(b, s.staffHired[b]) - staffWeeklySalary(a, s.staffHired[a]));
        const cut = hiredStaff[0];
        const cutName = s.staffHired[cut].name;
        s.staffHired[cut] = null;
        crisisNote = `사역과 사례비 지출이 계속 수입을 넘어서, 재정 형편상 ${STAFF[cut].name} ${cutName}와(과) 아쉬운 작별을 하게 되었습니다.`;
      } else {
        crisisNote = '재정이 계속 어려워지고 있습니다. 지출을 점검해 주세요.';
      }
    }
    s.fund = Math.max(s.fund, 0);
    s.financialCrisisWeeks = 0;
  }

  const faithDecay = neglected ? 1.5 : (s.faith > 70 ? 0.4 : 0.1);
  const prevFaith = s.faith;
  s.faith = clamp(s.faith + mod.faithPerWeek - faithDecay, 0, 100);

  const repDecay = neglected ? 1.0 : 0.2;
  const prevRep = s.reputation;
  s.reputation = clamp(s.reputation + mod.reputationPerWeek - repDecay, 0, 100);

  /* 입소문 효과 — 지역신뢰가 높을수록 "성도가 성도를 부르는" 유입이 성도수에 비례해 붙는다.
     지역신뢰가 낮으면 이 항이 작아 이탈률(churn, 0.006/주 하한)을 못 넘어서고, 지역신뢰가
     충분히 높아야 비로소 순유입이 되어 대형교회 규모(만 명 단위)까지 자랄 수 있다 — 시설만
     불려서는 못 크고 반드시 지역신뢰 투자가 있어야 하는 구조(오너 지시: 1만명까지 성장 가능,
     레벨100 밸런스에 맞출 것). */
  const wordOfMouthRate = 0.007;
  const roomLeft = Math.max(0, sanctuaryCap - s.members);
  let visitors = neglected ? 0 : 0.4 + s.reputation * 0.045 + mod.visitorPerWeek + s.memberFrac * (s.reputation / 100) * wordOfMouthRate;
  if (roomLeft <= 0) visitors = 0;
  else visitors = Math.min(visitors, roomLeft + 2);

  const churnRate = Math.max(0.006, 0.028 - mod.retentionBonus - (s.faith >= 60 ? 0.006 : 0)) + (neglected ? 0.02 : 0);
  const churn = s.memberFrac * churnRate;

  const prevMembers = s.members;
  s.memberFrac = Math.max(0, s.memberFrac + visitors - churn);
  s.members = Math.floor(s.memberFrac);

  const volGrowth = (mod.volunteerGain || 0) + s.reputation * 0.01;
  const prevVolunteers = s.volunteers;
  s.volunteerFrac = Math.max(0, s.volunteerFrac + volGrowth * 0.2);
  s.volunteers = Math.floor(s.volunteerFrac);

  s.week += 1;

  const tier = currentTier(s.members);
  let milestone = null;
  let grantedBoost = null;
  if (tier.key !== s.tierReached && TIERS.findIndex((t) => t.key === tier.key) > TIERS.findIndex((t) => t.key === s.tierReached)) {
    s.tierReached = tier.key;
    milestone = tier;
    grantedBoost = boostGrantFor(tier.key);
    if (grantedBoost) s.boostItems[grantedBoost] = (s.boostItems[grantedBoost] || 0) + 1;
  }

  addLog(`${fmtWon(income)} 교회 재정 수입, ${fmtWon(upkeep)} 사역과 사례비 지출 (순 ${net >= 0 ? '+' : ''}${fmtWon(net)})`);
  if (neglected) addLog(`사역·직분자 없이 방치되어 관리비 ${fmtWon(neglectOverhead)}가 새고, 신앙지수·지역신뢰가 평소보다 빠르게 떨어졌습니다.`);
  if (crisisNote) addLog(crisisNote);
  if (grantedBoost) addLog(`${tier.name} 성장을 축하하며 ${BOOST_ITEMS[grantedBoost].name}을(를) 받았습니다.`);

  return {
    income, upkeep, net, neglected, neglectOverhead, grantedBoost,
    faithDelta: +(s.faith - prevFaith).toFixed(1),
    repDelta: +(s.reputation - prevRep).toFixed(1),
    memberDelta: s.members - prevMembers,
    volunteerDelta: s.volunteers - prevVolunteers,
    crisisNote, milestone,
  };
}

/* 이벤트는 매주 뜨지 않는다 — 게임 속 시간으로 "대략 한 달에 한 번" 정도의 리듬을 준다.
   최소 4주(한 달) 간격을 강제한 뒤, 그 이후로는 매주 40% 확률로 발생시켜 평균 간격이
   4~5주 안팎이 되면서도 기계적으로 똑같은 주차에 반복되지 않게 했다(오너 지시). */
const EVENT_MIN_GAP_WEEKS = 8;
const EVENT_TRIGGER_PROB = 0.5;

function pickEvent() {
  const pool = EVENTS.filter((e) => !e.available || e.available(state));
  if (!pool.length) return null;
  const recent = state.recentEventIds || [];
  let choicePool = pool.filter((e) => recent.indexOf(e.id) === -1);
  if (!choicePool.length) choicePool = pool;
  const chosen = choicePool[Math.floor(Math.random() * choicePool.length)];
  state.recentEventIds = [chosen.id, ...recent].slice(0, 8);
  return chosen;
}

/* ===================== 액션 ===================== */

function actionUpgradeBuilding(key) {
  const def = BUILDINGS[key];
  const lv = state.buildings[key];
  const next = def.levels[lv + 1];
  if (!next) return;
  if (state.fund < next.cost) return;
  if (next.reqMembers && state.members < next.reqMembers) return;
  state.fund -= next.cost;
  state.buildings[key] = lv + 1;
  addLog(`${def.name}을(를) ${lv + 1}레벨로 확장했습니다.`);
  saveGame();
  render();
}

/* 담당 사역 배정 — 부교역자를 청빙할 때 어느 사역/부서를 맡길지 고른다(오너 지시).
   이미 다른 사역자가 맡은 곳은 목록에서 빠지므로, 추가로 부교역자를 청빙할 때는
   자연히 "남은" 사역/부서 중에서만 고르게 된다. */
const STAFF_ASSIGNMENT_MULT = 1.4;

function claimedAssignmentKeys(s) {
  const claimed = new Set();
  for (const roleKey in STAFF) {
    const hired = s.staffHired[roleKey];
    if (hired && hired.assignedTo) claimed.add(hired.assignedTo.type + ':' + hired.assignedTo.key);
  }
  return claimed;
}

function staffAssignedTo(s, type, key) {
  for (const roleKey in STAFF) {
    const hired = s.staffHired[roleKey];
    if (hired && hired.assignedTo && hired.assignedTo.type === type && hired.assignedTo.key === key) return hired;
  }
  return null;
}

function assignmentLabel(assignedTo) {
  if (!assignedTo) return null;
  const def = assignedTo.type === 'ministry' ? MINISTRIES[assignedTo.key] : DEPARTMENTS[assignedTo.key];
  return def ? def.name : null;
}

function actionHireCandidate(key, candidateIndex) {
  const def = STAFF[key];
  if (state.staffHired[key]) return;
  if (state.members < def.unlockMembers) return;
  const candidate = candidatesFor(key)[candidateIndex];
  if (!candidate) return;
  showAssignmentPicker(key, candidate);
}

function showAssignmentPicker(staffKey, candidate) {
  const claimed = claimedAssignmentKeys(state);
  const options = [];
  for (const k in MINISTRIES) {
    if (MINISTRIES[k].unlock(state) && !claimed.has('ministry:' + k)) options.push({ type: 'ministry', key: k, name: MINISTRIES[k].name, icon: MINISTRIES[k].icon });
  }
  for (const k in DEPARTMENTS) {
    if (DEPARTMENTS[k].unlock(state) && !claimed.has('department:' + k)) options.push({ type: 'department', key: k, name: DEPARTMENTS[k].name, icon: DEPARTMENTS[k].icon });
  }

  document.getElementById('eventIcon').src = 'assets/micon_ui_clipboard.png';
  document.getElementById('eventTitle').textContent = `${candidate.name}에게 맡길 사역을 정해주세요`;
  document.getElementById('eventBody').textContent =
    `담당 사역·부서를 정하면 그 사역의 효과가 ${Math.round((STAFF_ASSIGNMENT_MULT - 1) * 100)}% 늘어납니다. 이미 다른 사역자가 맡고 있는 곳은 목록에 뜨지 않습니다.`;
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  options.forEach((opt) => {
    const btn = el('button', 'choice-btn');
    btn.innerHTML = `<span class="choice-label"><img class="inline-icon" src="assets/${opt.icon}" alt=""> ${opt.name}</span>`;
    btn.addEventListener('click', () => {
      actionHireCandidateConfirmed(staffKey, candidate, { type: opt.type, key: opt.key });
      hideModal('eventModal');
    });
    box.appendChild(btn);
  });
  const skip = el('button', 'choice-btn');
  skip.innerHTML = `<span class="choice-label">나중에 정하기(담당 없이 청빙)</span>`;
  skip.addEventListener('click', () => {
    actionHireCandidateConfirmed(staffKey, candidate, null);
    hideModal('eventModal');
  });
  box.appendChild(skip);
  showModal('eventModal');
}

function actionHireCandidateConfirmed(key, candidate, assignedTo) {
  const def = STAFF[key];
  state.staffHired[key] = Object.assign({ housing: false, hireWeek: state.week, assignedTo, wellbeing: 70 }, candidate);
  const label = assignmentLabel(assignedTo);
  addLog(`${def.name} ${candidate.name}을(를) 청빙했습니다.${label ? ` (${label} 담당)` : ''}`);
  saveGame();
  render();
}

function actionReleaseStaff(key) {
  const def = STAFF[key];
  const hired = state.staffHired[key];
  if (!hired) return;
  state.staffHired[key] = null;
  if (!state.candidateGen) state.candidateGen = {};
  state.candidateGen[key] = (state.candidateGen[key] || 0) + 1;
  addLog(`${def.name} ${hired.name}와(과) 아쉬운 작별을 했습니다.`);
  saveGame();
  render();
}

function actionRerollCandidates(key) {
  if (state.staffHired[key]) return;
  if (!state.candidateGen) state.candidateGen = {};
  state.candidateGen[key] = (state.candidateGen[key] || 0) + 1;
  addLog(`${STAFF[key].name} 후보자 명단을 새로 받아보았습니다.`);
  saveGame();
  render();
}

function actionToggleHousing(key) {
  const hired = state.staffHired[key];
  if (!hired) return;
  hired.housing = !hired.housing;
  addLog(`${STAFF[key].name} ${hired.name}에게 사택을 ${hired.housing ? '제공하기로' : '더 이상 제공하지 않기로'} 했습니다.`);
  saveGame();
  render();
}

function actionAdjustPastorSalary(delta) {
  const next = Math.round((( state.pastorSalaryMult || 1) + delta) * 10) / 10;
  state.pastorSalaryMult = clamp(next, PASTOR_SALARY_MIN_MULT, PASTOR_SALARY_MAX_MULT);
  addLog(`담임목사 사례비를 월 ${fmtWon(pastorWeeklySalary(state) * 52 / 12)}(${state.pastorSalaryMult.toFixed(1)}배)(으)로 조정했습니다.`);
  saveGame();
  render();
}

function actionToggleMinistry(key) {
  const def = MINISTRIES[key];
  const active = !!state.ministriesActive[key];
  if (!active && !def.unlock(state)) return;
  state.ministriesActive[key] = !active;
  addLog(`${def.name} 사역을 ${!active ? '시작' : '중단'}했습니다.`);
  saveGame();
  render();
}

function actionToggleDepartment(key) {
  const def = DEPARTMENTS[key];
  const active = !!state.departmentsActive[key];
  if (!active && !def.unlock(state)) return;
  state.departmentsActive[key] = !active;
  addLog(`${def.name}을(를) ${!active ? '조직' : '잠시 중단'}했습니다.`);
  saveGame();
  render();
}

/* 역대 행사 보고서(오너 지시) — 행사를 치를 때마다 결과를 기록해두어, 다음에 같은 행사를
   또 열지 다른 걸 시도할지 판단할 근거로 삼을 수 있게 한다. */
const CAMPAIGN_HISTORY_MAX = 50;

function actionCampaign(key) {
  const def = CAMPAIGNS[key];
  if (state.fund < def.cost) return;
  const before = snapshotStats(state);
  state.fund -= def.cost;
  const msg = def.apply(state);
  const after = snapshotStats(state);
  addLog(msg);
  if (!state.campaignHistory) state.campaignHistory = [];
  state.campaignHistory.unshift({
    week: state.week, key, name: def.name, icon: def.icon, msg,
    fundDelta: after.fund - before.fund,
    memberDelta: after.members - before.members,
    faithDelta: +(after.faith - before.faith).toFixed(1),
    repDelta: +(after.reputation - before.reputation).toFixed(1),
    volunteerDelta: after.volunteers - before.volunteers,
  });
  if (state.campaignHistory.length > CAMPAIGN_HISTORY_MAX) state.campaignHistory.length = CAMPAIGN_HISTORY_MAX;
  saveGame();
  render();
}

/* 직분자 임직 절차 — 고신헌법 제67조(장로 선택, 공동의회 2/3 이상 찬성) 및 준용 조항
   (집사·권사)을 그대로 게임에 반영한다(오너 지시): 후보자 중 한 명을 추천 → 공동의회
   투표(2/3 이상 찬성해야 가결) → 가결된 경우에만 실제 임직. 부결되면 준비 비용 일부만
   들고, 아무도 임직되지 않았으니 봉사자는 소모되지 않는다. */
function actionOrdainOfficer(key) {
  const def = OFFICERS[key];
  const count = (state.officers[key] || []).length;
  if (count >= officerMaxFor(state)) return;
  if (!def.unlock(state)) return;
  if (state.fund < def.cost || state.volunteerFrac < def.volCost) return;
  showOfficerCandidatePicker(key);
}

function showOfficerCandidatePicker(key) {
  const def = OFFICERS[key];
  const candidates = officerCandidatesFor(key);
  document.getElementById('eventIcon').src = 'assets/' + def.icon;
  document.getElementById('eventTitle').textContent = `${def.name} 후보를 추천해주세요`;
  document.getElementById('eventBody').textContent = '공동의회 투표에 부칠 후보 한 분을 고르세요. 2/3 이상 찬성해야 임직됩니다.';
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  candidates.forEach((c) => {
    const btn = el('button', 'choice-btn');
    btn.innerHTML = `<span class="choice-label">${c.name} · ${c.age}세 · ${c.family} · 등록 ${c.tenureYears}년차</span>`;
    btn.addEventListener('click', () => showConfirmOrdain(key, c));
    box.appendChild(btn);
  });
  showModal('eventModal');
}

function showConfirmOrdain(key, candidate) {
  const def = OFFICERS[key];
  document.getElementById('eventIcon').src = 'assets/' + def.icon;
  document.getElementById('eventTitle').textContent = `${candidate.name}님을 ${def.name} 후보로 세울까요?`;
  document.getElementById('eventBody').textContent =
    `${fmtWon(def.cost)}과 봉사자 ${def.volCost}명이 준비됩니다. 공동의회 투표에서 2/3 이상 찬성해야 실제 임직됩니다 — 부결되면 준비 비용 일부만 들고 봉사자는 소모되지 않습니다.`;
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const yes = el('button', 'choice-btn');
  yes.innerHTML = `<span class="choice-label">공동의회 투표에 부친다</span>`;
  yes.addEventListener('click', () => actionOrdainOfficerConfirmed(key, candidate));
  const no = el('button', 'choice-btn');
  no.innerHTML = `<span class="choice-label">다음에 한다</span>`;
  no.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(yes);
  box.appendChild(no);
  showModal('eventModal');
}

function actionOrdainOfficerConfirmed(key, candidate) {
  const def = OFFICERS[key];
  if (state.fund < def.cost || state.volunteerFrac < def.volCost) return;
  const approval = officerVoteApprovalRate(state);
  const roll = clamp(approval + (Math.random() * 0.2 - 0.1), 0, 1);
  const passed = roll >= OFFICER_VOTE_THRESHOLD;
  const pct = Math.round(roll * 100);
  if (passed) {
    state.fund -= def.cost;
    state.volunteerFrac = Math.max(0, state.volunteerFrac - def.volCost);
    state.volunteers = Math.floor(state.volunteerFrac);
    state.officers[key].push({ week: state.week, name: candidate.name, age: candidate.age, family: candidate.family, tenureYears: candidate.tenureYears, wellbeing: 70 });
    addLog(`공동의회 투표(찬성 ${pct}%)로 ${candidate.name}님이 ${def.name}(으)로 가결·임직되었습니다(노회 고시를 거쳤습니다 — 항존직이라 정년까지 계속 시무합니다).`);
  } else {
    const failCost = Math.round(def.cost * 0.3);
    state.fund = Math.max(0, state.fund - failCost);
    addLog(`공동의회 투표(찬성 ${pct}%)에서 ${candidate.name}님의 ${def.name} 피택이 2/3 문턱을 넘지 못해 부결되었습니다(준비 비용 ${fmtWon(failCost)} 지출).`);
  }
  saveGame();
  render();
  showVoteResult(def, candidate, pct, passed);
  if (passed && key === 'elder' && state.officers.elder.length === 2) {
    showSessionMilestone();
  }
}

function showVoteResult(def, candidate, pct, passed) {
  document.getElementById('eventIcon').src = passed ? 'assets/micon_ui_check.png' : 'assets/micon_ui_warning.png';
  document.getElementById('eventTitle').textContent = passed ? '가결되었습니다' : '부결되었습니다';
  document.getElementById('eventBody').textContent =
    `${candidate.name}님의 ${def.name} 피택에 대한 공동의회 투표 결과: 찬성 ${pct}%(2/3 이상 필요)\n\n` +
    (passed ? `${def.name}(으)로 임직되었습니다.` : '다음 기회에 다시 추천해 보세요.');
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const okBtn = el('button', 'btn btn-primary result-ok-btn', '확인');
  okBtn.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(okBtn);
  showModal('eventModal');
}

function showSessionMilestone() {
  document.getElementById('milestoneTitle').textContent = '완전당회가 구성되었습니다!';
  document.getElementById('milestoneBody').textContent = '시무장로 2인이 모여 완전당회를 이루었습니다(고신헌법 2부 제108조). 담임목사와 장로들이 함께 교회를 살피며, 이제부터 정착률이 꾸준히 오릅니다.';
  showModal('milestoneModal');
}

function actionNextWeek() {
  lastTickAt = Date.now();
  const summary = advanceWeek();
  state.lastSummary = summary;
  saveGame();
  render();
  renderDashboardSummary(summary);

  if (summary.milestone && summary.milestone.key === TIERS[TIERS.length - 1].key && !state.endingShown) {
    state.endingShown = true;
    saveGame();
    showEnding();
  } else if (summary.milestone) {
    showMilestone(summary.milestone, summary.grantedBoost);
  } else if (state.week - (state.lastEventWeek || 0) >= EVENT_MIN_GAP_WEEKS && Math.random() < EVENT_TRIGGER_PROB) {
    const refs = eligiblePersonRefs();
    if (refs.length && Math.random() < 0.3) {
      const ref = refs[Math.floor(Math.random() * refs.length)];
      const template = PERSONAL_EVENTS[Math.floor(Math.random() * PERSONAL_EVENTS.length)];
      state.lastEventWeek = state.week;
      saveGame();
      showPersonalEvent(ref, template);
    } else {
      const ev = pickEvent();
      if (ev) {
        state.lastEventWeek = state.week;
        saveGame();
        showEvent(ev);
      }
    }
  }
}

function actionResetGame() {
  state = newGame(state.name);
  currentTab = 'dashboard';
  saveGame();
  render();
}

/* ===================== 저장 파일 내보내기·불러오기 =====================
   일반 모바일게임의 "저장" 개념을 이 기기·이 브라우저에만 묶인 자동저장(localStorage)
   너머로 확장한다 — 파일로 내보내 보관해두면 기기를 바꾸거나 브라우저 데이터를 지워도
   그 파일로 불러와 이어할 수 있다. 아티팩트(claude.ai) 미리보기 샌드박스에서는 다운로드가
   막혀 있어 이 기능이 동작하지 않을 수 있다 — GitHub Pages 정식 배포판에서 정상 동작한다. */
function readSlot(n) {
  if (n === 1) return state;
  try {
    const raw = localStorage.getItem(SAVE_SLOT_KEYS[n]);
    if (!raw) return null;
    return migrateSave(JSON.parse(raw));
  } catch (e) { return null; }
}

function actionSaveToSlot(n) {
  if (n === 1) { saveGame(); render(); return; }
  try {
    localStorage.setItem(SAVE_SLOT_KEYS[n], JSON.stringify(state));
    addLog(`지금 진행 상황을 저장슬롯${n}에 저장했습니다.`);
  } catch (e) { /* storage unavailable */ }
  render();
}

function actionExportSave() {
  showExportSlotPicker();
}

function showExportSlotPicker() {
  document.getElementById('eventIcon').src = 'assets/micon_ui_floppy.png';
  document.getElementById('eventTitle').textContent = '어느 저장슬롯을 내보낼까요?';
  document.getElementById('eventBody').textContent = '슬롯1은 지금 진행 중인 게임입니다. 슬롯2·3은 "슬롯에 저장"으로 미리 담아둔 스냅샷일 때만 내보낼 수 있습니다.';
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  for (let n = 1; n <= 3; n++) {
    const data = readSlot(n);
    const btn = el('button', 'choice-btn');
    btn.innerHTML = `<span class="choice-label">저장슬롯${n}${n === 1 ? ' (현재 진행)' : ''} — ${data ? `"${data.name}" · ${data.week}주차 · 성도 ${fmt(data.members)}명` : '비어있음'}</span>`;
    if (!data) { btn.disabled = true; }
    else btn.addEventListener('click', () => { exportSlotData(data, n); hideModal('eventModal'); });
    box.appendChild(btn);
  }
  showModal('eventModal');
}

function exportSlotData(data, n) {
  try {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `목양타이쿤_${data.name}_${data.week}주차_슬롯${n}_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    addLog(`저장슬롯${n}을(를) 파일로 내보냈습니다.`);
  } catch (e) { /* 다운로드가 막힌 환경(예: 아티팩트 미리보기)에서는 조용히 무시 */ }
}

function actionImportSaveFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed = null;
    try { parsed = migrateSave(JSON.parse(String(reader.result))); } catch (e) { parsed = null; }
    if (!parsed) {
      showImportResult(false, '올바른 저장 파일이 아닙니다.');
      return;
    }
    showConfirmImport(parsed);
  };
  reader.readAsText(file);
}

function showConfirmImport(parsed) {
  document.getElementById('eventIcon').src = 'assets/micon_ui_folder.png';
  document.getElementById('eventTitle').textContent = '이 저장 파일을 불러올까요?';
  document.getElementById('eventBody').textContent =
    `"${parsed.name}" · ${parsed.week}주차 · 성도 ${fmt(parsed.members)}명\n\n지금 진행 중인 내용은 사라지고 이 저장 파일로 덮어씁니다.`;
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const yes = el('button', 'choice-btn');
  yes.innerHTML = `<span class="choice-label">불러온다</span>`;
  yes.addEventListener('click', () => {
    state = parsed;
    currentTab = 'dashboard';
    saveGame();
    render();
    hideModal('eventModal');
  });
  const no = el('button', 'choice-btn');
  no.innerHTML = `<span class="choice-label">취소한다</span>`;
  no.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(yes);
  box.appendChild(no);
  showModal('eventModal');
}

function showImportResult(ok, message) {
  document.getElementById('eventIcon').src = ok ? 'assets/micon_ui_check.png' : 'assets/micon_ui_warning.png';
  document.getElementById('eventTitle').textContent = ok ? '불러오기 완료' : '불러오기 실패';
  document.getElementById('eventBody').textContent = message;
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const okBtn = el('button', 'btn btn-primary result-ok-btn', '확인');
  okBtn.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(okBtn);
  showModal('eventModal');
}

/* ===================== 렌더링 ===================== */

function render() {
  document.getElementById('churchName').value = state.name;
  updateTimeLabels();
  const tier = currentTier(state.members);
  const lvl = currentLevel(state.members);
  document.getElementById('tierBadge').textContent = `${tier.name} · Lv.${lvl.level}`;

  setStat('statFund', fmtWon(state.fund));
  setStat('statMembers', fmt(state.members) + '명');
  setStat('statFaith', Math.round(state.faith) + '%');
  setStat('statReputation', Math.round(state.reputation) + '%');
  setStat('statVolunteers', fmt(state.volunteers) + '명');

  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));

  const content = document.getElementById('tabContent');
  content.innerHTML = '';
  if (currentTab === 'dashboard') content.appendChild(renderDashboard());
  if (currentTab === 'campaigns') content.appendChild(renderCampaigns());
  if (currentTab === 'buildings') content.appendChild(renderBuildings());
  if (currentTab === 'ministries') content.appendChild(renderMinistries());
  if (currentTab === 'staff') content.appendChild(renderStaff());
  if (currentTab === 'directions') content.appendChild(renderDirections());
  if (currentTab === 'log') content.appendChild(renderLog());
}

function setStat(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/* 접고 펼치기(오너 지시: "교적부는 평소 리스트가 접혀 있다가 눌러야 펼쳐지도록, 다른
   항목들도 적용 가능한 곳엔 적용") — 펼침 상태는 세션 동안만 유지하는 순수 UI 상태라
   저장 데이터에는 없다(탭을 벗어났다 돌아오면 다시 기본값으로). 헤더를 클릭하면 그
   섹션만 다시 그려 넣는다. */
const collapsedSections = {};

function collapsibleHeader(key, title, defaultCollapsed) {
  if (!(key in collapsedSections)) collapsedSections[key] = defaultCollapsed;
  const collapsed = collapsedSections[key];
  const header = el('div', 'section-title collapsible-header', `<span class="collapse-arrow">${collapsed ? '▸' : '▾'}</span> ${title}`);
  header.addEventListener('click', () => { collapsedSections[key] = !collapsedSections[key]; render(); });
  return header;
}

function renderDashboard() {
  const wrap = el('div');

  const sumCard = el('div', 'card');
  sumCard.id = 'dashSummaryCard';
  const summaryInner = state.lastSummary
    ? buildSummaryRowsHtml(state.lastSummary)
    : '<div class="dash-summary-row"><span>다음 주로 넘어가면 이번 주 사역 결과가 표시됩니다.</span></div>';
  sumCard.innerHTML = `
    <div class="card-title"><img class="inline-icon" src="assets/micon_ui_clipboard.png" alt=""> 이번 주 요약${state.lastSummary ? ` (${state.week - 1}주차)` : ''}</div>
    <div class="dash-summary" id="dashSummary">${summaryInner}</div>`;
  wrap.appendChild(sumCard);

  const officerMax = officerMaxFor(state);
  const officerCounts = { elder: (state.officers.elder || []).length, deacon: (state.officers.deacon || []).length, exhorter: (state.officers.exhorter || []).length };
  const officerVacant = officerCounts.elder < officerMax || officerCounts.deacon < officerMax || officerCounts.exhorter < officerMax;
  const officerCard = el('div', 'card');
  officerCard.innerHTML = `
    <div class="card-title"><img class="inline-icon" src="assets/micon_ui_people.png" alt=""> 직분자 현황</div>
    <div class="card-sub">장로 ${officerCounts.elder}/${officerMax} · 집사 ${officerCounts.deacon}/${officerMax} · 권사 ${officerCounts.exhorter}/${officerMax}</div>
    ${officerVacant ? `<div class="card-sub">공석이 있습니다 — '사역자' 탭에서 임직할 수 있습니다.</div>` : ''}`;
  wrap.appendChild(officerCard);

  const tier = currentTier(state.members);
  const nt = nextTier(state.members);
  const lvl = currentLevel(state.members);
  const nl = nextLevel(state.members);
  const track = el('div', 'card');
  const trackHtml = TIERS.map((t) => {
    const reached = state.members >= t.min;
    return `<span class="${reached ? 'reached' : ''}">${t.name}</span>`;
  }).join('<span> → </span>');
  track.innerHTML = `
    <div class="card-title"><img class="inline-icon" src="assets/micon_ui_sparkle.png" alt=""> 교회의 성장 단계 — ${tier.name} (Lv.${lvl.level}/100)</div>
    <div class="card-sub">${nl ? `다음 레벨(Lv.${nl.level})까지 성도 ${fmt(nl.min - state.members)}명` : '최고 레벨입니다.'}</div>
    <div class="card-sub">${nt ? `다음 단계 '${nt.name}'까지 성도 ${fmt(nt.min - state.members)}명` : '최고 단계에 도달했습니다.'}</div>
    <div class="milestone-track">${trackHtml}</div>`;
  wrap.appendChild(track);

  return wrap;
}

function renderCampaigns() {
  const wrap = el('div');
  wrap.appendChild(el('div', 'section-title', '행사 — 한 번의 교회 재정으로 큰 변화를'));
  for (const key in CAMPAIGNS) {
    const def = CAMPAIGNS[key];
    const card = el('div', 'card');
    const afford = state.fund >= def.cost;
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name}</div>
          <div class="card-sub">${def.desc}</div>
        </div>
        <div class="card-action">
          <button class="btn btn-outline btn-small" ${afford ? '' : 'disabled'} data-campaign="${key}">${fmtWon(def.cost)}</button>
        </div>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-campaign]').forEach((b) => b.addEventListener('click', () => actionCampaign(b.dataset.campaign)));

  if (state.campaignHistory && state.campaignHistory.length) {
    wrap.appendChild(collapsibleHeader('campaignHistory', `역대 행사 보고서 (${state.campaignHistory.length}건) — 다음 행사를 정할 때 참고하세요`, true));
    const hist = state.campaignHistory;
    const shown = collapsedSections.campaignHistory ? 0 : Math.min(campaignHistoryShown, hist.length);
    for (let i = 0; i < shown; i++) {
      const h = hist[i];
      const deltas = [
        ['재정', h.fundDelta, 'won'], ['성도수', h.memberDelta, 'count'],
        ['신앙지수', h.faithDelta, 'num'], ['지역신뢰', h.repDelta, 'num'], ['봉사자', h.volunteerDelta, 'count'],
      ];
      const deltaHtml = deltas.filter(([, d]) => d).map(([label, d, kind]) => {
        const cls = d > 0 ? 'delta-pos' : 'delta-neg';
        const text = kind === 'won' ? (d > 0 ? '+' : '') + fmtWon(d) : `${d > 0 ? '+' : ''}${d}`;
        return `<span class="${cls}" style="margin-right:8px">${label} ${text}</span>`;
      }).join('') || '<span class="delta-zero">눈에 띄는 변화 없음</span>';
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="card-row">
          <img class="card-emoji-img" src="assets/${h.icon}" alt="">
          <div class="card-main">
            <div class="card-title">${h.name} <span class="card-level">${h.week}주차</span></div>
            <div class="card-sub">${escapeHtml(h.msg)}</div>
            <div class="card-sub" style="margin-top:6px">${deltaHtml}</div>
          </div>
        </div>`;
      wrap.appendChild(card);
    }
    if (!collapsedSections.campaignHistory && shown < hist.length) {
      const remain = hist.length - shown;
      const moreBtn = el('button', 'btn btn-outline btn-small', `${fmt(Math.min(CAMPAIGN_HISTORY_PAGE, remain))}건 더 보기 (${fmt(remain)}건 남음)`);
      moreBtn.style.width = '100%';
      moreBtn.addEventListener('click', () => { campaignHistoryShown += CAMPAIGN_HISTORY_PAGE; render(); });
      wrap.appendChild(moreBtn);
    }
  }

  wrap.appendChild(el('div', 'section-title', '가속권 — 시간의 흐름을 한시적으로 빠르게'));
  const boosting = currentSpeedMultiplier() > 1;
  if (boosting) {
    const remainMin = Math.max(0, Math.ceil((state.speedBoostUntil - Date.now()) / 60000));
    const activeCard = el('div', 'card');
    activeCard.innerHTML = `<div class="card-title"><img class="inline-icon" src="assets/${BOOST_ITEMS[state.speedBoostKey].icon}" alt=""> ${BOOST_ITEMS[state.speedBoostKey].name} 사용 중</div>
      <div class="card-sub">${state.speedBoostMultiplier}배속 · ${remainMin}분 남음 (끝날 때까지 다른 가속권을 겹쳐 쓸 수 없습니다)</div>`;
    wrap.appendChild(activeCard);
  }
  for (const key in BOOST_ITEMS) {
    const def = BOOST_ITEMS[key];
    const owned = (state.boostItems && state.boostItems[key]) || 0;
    const afford = state.fund >= def.cost;
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name} <span class="card-level">보유 ${owned}개</span></div>
          <div class="card-sub">${def.desc}</div>
          <div class="card-sub">성장 단계 도달 시 자동 지급 · 직접 구매 가능</div>
        </div>
      </div>
      <div class="card-row" style="margin-top:8px; gap:6px">
        <button class="btn btn-outline btn-small" ${owned > 0 && !boosting ? '' : 'disabled'} data-use-boost="${key}">사용하기</button>
        <button class="btn btn-ghost btn-small" ${afford ? '' : 'disabled'} data-buy-boost="${key}">구매 ${fmtWon(def.cost)}</button>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-use-boost]').forEach((b) => b.addEventListener('click', () => actionUseBoost(b.dataset.useBoost)));
  wrap.querySelectorAll('[data-buy-boost]').forEach((b) => b.addEventListener('click', () => actionBuyBoost(b.dataset.buyBoost)));

  return wrap;
}

function summaryRow(label, valueText, kind) {
  const cls = kind === 'pos' ? 'delta-pos' : kind === 'neg' ? 'delta-neg' : 'delta-zero';
  return `<div class="dash-summary-row"><span>${label}</span><span class="${cls}">${valueText}</span></div>`;
}
function summaryDeltaText(v) {
  if (v > 0) return `+${v}`;
  if (v < 0) return `${v}`;
  return '0';
}

function buildSummaryRowsHtml(summary) {
  const rows = [];
  rows.push(summaryRow('교회 재정 수입', `+${fmtWon(summary.income)}`, 'pos'));
  OFFERING_TYPES.forEach((t) => {
    rows.push(`<div class="dash-summary-row dash-summary-sub"><span>ㄴ ${t.name}</span><span class="delta-zero">${fmtWon(summary.income * t.ratio)}</span></div>`);
  });
  rows.push(summaryRow('사역과 사례비 지출', `-${fmtWon(summary.upkeep)}`, 'neg'));
  upkeepBreakdown(state).forEach((r) => {
    rows.push(`<div class="dash-summary-row dash-summary-sub"><span>ㄴ ${r.name}</span><span class="delta-zero">${fmtWon(r.amount)}</span></div>`);
  });
  if (summary.neglected) rows.push(summaryRow('방치 관리비', `-${fmtWon(summary.neglectOverhead)}`, 'neg'));
  rows.push(summaryRow('순 증감', `${summary.net >= 0 ? '+' : ''}${fmtWon(summary.net)}`, summary.net >= 0 ? 'pos' : 'neg'));
  rows.push(summaryRow('신앙지수', summaryDeltaText(summary.faithDelta), summary.faithDelta > 0 ? 'pos' : summary.faithDelta < 0 ? 'neg' : 'zero'));
  rows.push(summaryRow('지역신뢰', summaryDeltaText(summary.repDelta), summary.repDelta > 0 ? 'pos' : summary.repDelta < 0 ? 'neg' : 'zero'));
  rows.push(summaryRow('성도수', summaryDeltaText(summary.memberDelta), summary.memberDelta > 0 ? 'pos' : summary.memberDelta < 0 ? 'neg' : 'zero'));
  rows.push(summaryRow('봉사자', summaryDeltaText(summary.volunteerDelta), summary.volunteerDelta > 0 ? 'pos' : summary.volunteerDelta < 0 ? 'neg' : 'zero'));
  if (summary.neglected) rows.push('<div class="dash-summary-row"><span><img class="inline-icon-sm" src="assets/micon_ui_sleep.png" alt=""> 사역자·직분자·사역이 하나도 없어 교회가 방치되고 있습니다. 사역을 하나라도 시작해 보세요.</span></div>');
  if (summary.crisisNote) rows.push(`<div class="dash-summary-row"><span><img class="inline-icon-sm" src="assets/micon_ui_warning.png" alt=""> ${summary.crisisNote}</span></div>`);
  return rows.join('');
}

function renderDashboardSummary(summary) {
  const box = document.getElementById('dashSummary');
  if (!box) return;
  box.innerHTML = buildSummaryRowsHtml(summary);
}

function actionSetDirection(catKey, optionKey) {
  if (!state.pastoralDirections) state.pastoralDirections = {};
  state.pastoralDirections[catKey] = optionKey;
  const def = PASTORAL_DIRECTIONS[catKey];
  addLog(`목회방향 '${def.name}'을(를) '${def.options[optionKey].name}'(으)로 정했습니다.`);
  saveGame();
  render();
}

function renderDirections() {
  const wrap = el('div');
  wrap.appendChild(el('div', 'section-title', '목회방향 — 이 교회를 어떤 색깔로 이끌어갈지 정합니다'));
  wrap.appendChild(el('div', 'card-sub', '항목마다 하나씩 고르면 비용 없이 매주 계속 적용됩니다. 언제든 다시 바꿀 수 있고, 모든 선택지는 오르는 점과 내리는 점을 함께 가지고 있어 정답은 없습니다.')).style.margin = '0 4px 10px';

  for (const catKey in PASTORAL_DIRECTIONS) {
    const cat = PASTORAL_DIRECTIONS[catKey];
    const chosenKey = (state.pastoralDirections || {})[catKey];
    const chosenName = chosenKey ? cat.options[chosenKey].name : '미설정';
    wrap.appendChild(collapsibleHeader(`dir_${catKey}`, `<img class="inline-icon" src="assets/${cat.icon}" alt=""> ${cat.name} — 현재: ${chosenName}`, true));
    if (collapsedSections[`dir_${catKey}`]) continue;

    const introCard = el('div', 'card');
    introCard.innerHTML = `<div class="card-sub">${cat.desc}</div>`;
    wrap.appendChild(introCard);

    for (const optKey in cat.options) {
      const opt = cat.options[optKey];
      const selected = optKey === chosenKey;
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="card-row">
          <div class="card-main">
            <div class="card-title">${opt.name} ${selected ? '<span class="card-level">선택됨</span>' : ''}</div>
            <div class="card-sub">${opt.desc}</div>
          </div>
          <div class="card-action">
            <button class="btn ${selected ? 'btn-toggle-on' : 'btn-outline'} btn-small" ${selected ? 'disabled' : ''} data-dir-cat="${catKey}" data-dir-opt="${optKey}">${selected ? '선택 중' : '선택'}</button>
          </div>
        </div>`;
      wrap.appendChild(card);
    }
  }
  wrap.querySelectorAll('[data-dir-cat]').forEach((b) => b.addEventListener('click', () => actionSetDirection(b.dataset.dirCat, b.dataset.dirOpt)));

  return wrap;
}

function renderBuildings() {
  const wrap = el('div');
  wrap.appendChild(el('div', 'section-title', '건물 — 교회의 터전을 넓혀갑니다'));
  for (const key in BUILDINGS) {
    const def = BUILDINGS[key];
    const lv = state.buildings[key];
    const next = def.levels[lv + 1];
    const maxed = !next;
    const membersOk = !next || !next.reqMembers || state.members >= next.reqMembers;
    const afford = next && state.fund >= next.cost && membersOk;
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name} <span class="card-level">Lv.${lv}</span></div>
          <div class="card-sub">${def.desc}</div>
          <div class="card-sub">${def.statLine(lv)}</div>
          ${!maxed && next.reqMembers && !membersOk ? `<div class="card-sub"><span class="card-lock"><img class="inline-icon-sm" src="assets/micon_ui_lock.png" alt=""> 성도 ${fmt(next.reqMembers)}명 이상 필요(현재 ${fmt(state.members)}명)</span></div>` : ''}
        </div>
        <div class="card-action">
          ${maxed
            ? `<button class="btn btn-ghost btn-small" disabled>최대 레벨</button>`
            : `<button class="btn btn-outline btn-small" ${afford ? '' : 'disabled'} data-build="${key}">Lv.${lv + 1} · ${fmtWon(next.cost)}</button>`}
        </div>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => actionUpgradeBuilding(b.dataset.build)));
  return wrap;
}

function renderMinistries() {
  const wrap = el('div');
  wrap.appendChild(el('div', 'section-title', '사역 — 지속적인 섬김과 성장의 프로그램'));
  for (const key in MINISTRIES) {
    const def = MINISTRIES[key];
    const active = !!state.ministriesActive[key];
    const unlocked = def.unlock(state);
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name} ${!unlocked ? `<span class="card-lock"><img class="inline-icon-sm" src="assets/micon_ui_lock.png" alt=""> ${def.lockDesc}</span>` : ''}</div>
          <div class="card-sub">${def.desc}</div>
          <div class="card-sub">주당 유지비 ${fmtWon(def.upkeep)}</div>
        </div>
        <div class="card-action">
          <button class="btn btn-small ${active ? 'btn-toggle-on' : 'btn-toggle-off'}" ${unlocked ? '' : 'disabled'} data-ministry="${key}">${active ? '운영 중' : '시작하기'}</button>
        </div>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-ministry]').forEach((b) => b.addEventListener('click', () => actionToggleMinistry(b.dataset.ministry)));

  wrap.appendChild(el('div', 'section-title', '교회 기관·부서 — 성도들이 함께 섬기는 공동체'));
  for (const key in DEPARTMENTS) {
    const def = DEPARTMENTS[key];
    const active = !!state.departmentsActive[key];
    const unlocked = def.unlock(state);
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name} ${!unlocked ? `<span class="card-lock"><img class="inline-icon-sm" src="assets/micon_ui_lock.png" alt=""> ${def.lockDesc}</span>` : ''}</div>
          <div class="card-sub">${def.desc}</div>
          <div class="card-sub">주당 유지비 ${fmtWon(def.upkeep)}</div>
        </div>
        <div class="card-action">
          <button class="btn btn-small ${active ? 'btn-toggle-on' : 'btn-toggle-off'}" ${unlocked ? '' : 'disabled'} data-dept="${key}">${active ? '운영 중' : '조직하기'}</button>
        </div>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-dept]').forEach((b) => b.addEventListener('click', () => actionToggleDepartment(b.dataset.dept)));

  return wrap;
}

function genderLabel(g) { return g === 'F' ? '여성' : '남성'; }

function renderRoster() {
  const wrap = el('div');
  wrap.appendChild(collapsibleHeader('roster', '교적부 — 담임목회자·부교역자·직분자·성도 명단', true));
  if (collapsedSections.roster) return wrap;

  const pastorCard = el('div', 'card');
  const pastorWeekly = pastorWeeklySalary(state);
  const psm = state.pastorSalaryMult || 1;
  pastorCard.innerHTML = `
    <div class="card-row">
      <img class="card-emoji-img" src="assets/micon_b_sanctuary.png" alt="">
      <div class="card-main">
        <div class="card-title">담임목사 <span class="card-level">플레이어</span></div>
        <div class="card-sub">${state.name}을(를) 섬기고 있습니다.</div>
        <div class="card-sub">월 사례비 ${fmtWon(pastorWeekly * 52 / 12)} (${psm.toFixed(1)}배)${psm < 0.7 ? ' · 박봉으로 사기가 떨어지고 있습니다' : psm > 1.0 ? ' · 넉넉한 사례비로 사기가 오릅니다' : ''}</div>
      </div>
    </div>
    <div class="card-row" style="margin-top:8px; gap:6px">
      <button class="btn btn-ghost btn-small" id="pastorSalaryDown" ${psm <= PASTOR_SALARY_MIN_MULT ? 'disabled' : ''}>− 낮추기</button>
      <button class="btn btn-ghost btn-small" id="pastorSalaryUp" ${psm >= PASTOR_SALARY_MAX_MULT ? 'disabled' : ''}>+ 올리기</button>
    </div>`;
  wrap.appendChild(pastorCard);
  pastorCard.querySelector('#pastorSalaryDown').addEventListener('click', () => actionAdjustPastorSalary(-PASTOR_SALARY_STEP));
  pastorCard.querySelector('#pastorSalaryUp').addEventListener('click', () => actionAdjustPastorSalary(PASTOR_SALARY_STEP));

  for (const key in STAFF) {
    const hired = state.staffHired[key];
    if (!hired) continue;
    const def = STAFF[key];
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title"><span class="status-dot ${wellbeingColor(hired.wellbeing)}"></span>${hired.name} <span class="card-level">${def.name}</span></div>
          <div class="card-sub">${genderLabel(hired.gender)}·${hired.age}세 · ${hired.family} · MBTI ${hired.mbti}</div>
          <div class="card-sub">주력: ${hired.styles.join('·')}${hired.housing ? ' · 사택 거주' : ''}</div>
          <div class="card-sub">${assignmentLabel(hired.assignedTo) ? `담당: ${assignmentLabel(hired.assignedTo)}` : '담당 사역 없음'}</div>
        </div>
      </div>`;
    wrap.appendChild(card);
  }

  const officerNames = { elder: '장로', deacon: '집사', exhorter: '권사' };
  for (const key in officerNames) {
    const list = (state.officers && state.officers[key]) || [];
    if (!list.length) continue;
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${OFFICERS[key].icon}" alt="">
        <div class="card-main">
          <div class="card-title">${officerNames[key]} <span class="card-level">${list.length}명</span></div>
          <div class="card-sub">공동의회 투표·노회 고시를 거쳐 임직한 직분자입니다(임기 정년까지).</div>
        </div>
      </div>`;
    wrap.appendChild(card);
    list.forEach((entry, idx) => {
      const p = typeof entry === 'object' ? entry : officerDisplayProfile(key, entry, idx); // 구버전(주차 숫자만) 저장 호환
      const personCard = el('div', 'card');
      personCard.innerHTML = `
        <div class="card-row">
          <img class="card-emoji-img" src="assets/${OFFICERS[key].icon}" alt="">
          <div class="card-main">
            <div class="card-title"><span class="status-dot ${wellbeingColor(p.wellbeing)}"></span>${p.name} <span class="card-level">${officerNames[key]}·${p.age}세</span></div>
            <div class="card-sub">${p.family}${p.tenureYears ? ` · 등록 ${p.tenureYears}년차` : ''}</div>
          </div>
        </div>`;
      wrap.appendChild(personCard);
    });
  }

  const staffCount = Object.keys(STAFF).filter((k) => state.staffHired[k]).length;
  const officerCount = (state.officers.elder || []).length + (state.officers.deacon || []).length + (state.officers.exhorter || []).length;
  const namedCount = 1 + staffCount + officerCount; // 담임목사 + 부교역자 + 직분자
  const generalCount = Math.max(0, state.members - namedCount);
  if (generalCount > 0) {
    wrap.appendChild(el('div', 'section-title', `일반 성도 (${fmt(generalCount)}명)`));
    const shown = Math.min(generalMembersShown, generalCount);
    for (let i = 0; i < shown; i++) {
      const p = generalMemberProfile(i, Math.max(0, state.week - 1));
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="card-row">
          <img class="card-emoji-img" src="assets/micon_ui_people.png" alt="">
          <div class="card-main">
            <div class="card-title">${p.name} <span class="card-level">${genderLabel(p.gender)}·${p.age}세</span></div>
            <div class="card-sub">${p.status} · ${p.family}${p.joinYears > 0 ? ` · 등록 ${p.joinYears}년차` : ''}</div>
            <div class="card-sub">은사: ${p.gift}</div>
          </div>
        </div>`;
      wrap.appendChild(card);
    }
    if (shown < generalCount) {
      const remain = generalCount - shown;
      const moreBtn = el('button', 'btn btn-outline btn-small', `${fmt(Math.min(GENERAL_MEMBERS_PAGE, remain))}명 더 보기 (${fmt(remain)}명 남음)`);
      moreBtn.style.width = '100%';
      moreBtn.addEventListener('click', () => { generalMembersShown += GENERAL_MEMBERS_PAGE; render(); });
      wrap.appendChild(moreBtn);
    }
  }

  if (staffCount === 0 && officerCount === 0 && state.members <= 1) {
    wrap.appendChild(el('div', 'log-empty', '아직 담임목사 혼자입니다. 부교역자를 청빙하거나 직분자를 임직해 보세요.'));
  }

  return wrap;
}

function renderStaff() {
  const wrap = el('div');
  wrap.appendChild(renderRoster());
  wrap.appendChild(el('div', 'section-title', '부교역자 — 이력서를 보고 직접 청빙합니다'));
  for (const key in STAFF) {
    const def = STAFF[key];
    const hired = state.staffHired[key];
    const unlocked = state.members >= def.unlockMembers;

    if (!unlocked) {
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="card-row">
          <img class="card-emoji-img" src="assets/${def.icon}" alt="">
          <div class="card-main">
            <div class="card-title">${def.name} <span class="card-lock"><img class="inline-icon-sm" src="assets/micon_ui_lock.png" alt=""> 성도 ${def.unlockMembers}명 이상 필요</span></div>
            <div class="card-sub">${def.desc}</div>
          </div>
        </div>`;
      wrap.appendChild(card);
      continue;
    }

    if (hired) {
      const weeklySalary = staffWeeklySalary(key, hired);
      const card = el('div', 'card');
      card.innerHTML = `
        <div class="card-row">
          <img class="card-emoji-img" src="assets/${def.icon}" alt="">
          <div class="card-main">
            <div class="card-title"><span class="status-dot ${wellbeingColor(hired.wellbeing)}"></span>${def.name} · ${hired.name} <span class="card-level">${genderLabel(hired.gender)}·${hired.age}세</span></div>
            <div class="card-sub">${hired.family} · MBTI ${hired.mbti} · 주력: ${hired.styles.join('·')}</div>
            <div class="card-sub">"${hired.intro}"</div>
            <div class="card-sub">${assignmentLabel(hired.assignedTo) ? `담당: ${assignmentLabel(hired.assignedTo)} (효과 +${Math.round((STAFF_ASSIGNMENT_MULT - 1) * 100)}%)` : '담당 사역 없음'}</div>
            <div class="card-sub">월 사례비 ${fmtWon(weeklySalary * 52 / 12)}${hired.housing ? ' (사택 제공 포함)' : ''}</div>
          </div>
        </div>
        <div class="card-row" style="margin-top:8px">
          <label class="housing-toggle">
            <input type="checkbox" data-housing="${key}" ${hired.housing ? 'checked' : ''}>
            사택 제공 (주 ${fmtWon(HOUSING_WEEKLY_COST)} 추가, 사역 효과 +30%)
          </label>
          <button class="btn btn-ghost btn-small" data-release="${key}">내보내기</button>
        </div>`;
      wrap.appendChild(card);
    } else {
      const wrap2 = el('div', 'card');
      const cands = candidatesFor(key);
      wrap2.innerHTML = `
        <div class="card-row">
          <div class="card-main">
            <div class="card-title"><img class="inline-icon" src="assets/${def.icon}" alt=""> ${def.name} 후보자 ${cands.length}명</div>
            <div class="card-sub">${def.desc}</div>
          </div>
          <div class="card-action"><button class="btn btn-ghost btn-small" data-reroll="${key}">다른 후보 보기</button></div>
        </div>`;
      wrap.appendChild(wrap2);
      cands.forEach((c, i) => {
        const monthlyAsk = Math.round((def.baseMonthlySalary * c.salaryFactor) / 10000) * 10000;
        const card = el('div', 'card');
        card.innerHTML = `
          <div class="card-main">
            <div class="card-title">${c.name} <span class="card-level">${genderLabel(c.gender)}·${c.age}세</span></div>
            <div class="card-sub">${c.family} · MBTI ${c.mbti} · 희망 사례비 월 ${fmtWon(monthlyAsk)}</div>
            <div class="card-sub">주력 사역: ${c.styles.join(' · ')}${c.wantsHousing ? ' · 사택 희망' : ''}</div>
            <div class="card-sub">"${c.intro}"</div>
          </div>
          <div class="card-action" style="margin-top:8px">
            <button class="btn btn-outline btn-small" data-candidate-hire="${key}" data-candidate-idx="${i}">이 분을 청빙</button>
          </div>`;
        wrap.appendChild(card);
      });
    }
  }
  wrap.querySelectorAll('[data-candidate-hire]').forEach((b) => b.addEventListener('click', () => actionHireCandidate(b.dataset.candidateHire, Number(b.dataset.candidateIdx))));
  wrap.querySelectorAll('[data-reroll]').forEach((b) => b.addEventListener('click', () => actionRerollCandidates(b.dataset.reroll)));
  wrap.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', () => actionReleaseStaff(b.dataset.release)));
  wrap.querySelectorAll('[data-housing]').forEach((b) => b.addEventListener('change', () => actionToggleHousing(b.dataset.housing)));

  wrap.appendChild(el('div', 'section-title', '직분자 임직 — 고신헌법 2부(관리표준) 기준'));
  for (const key in OFFICERS) {
    const def = OFFICERS[key];
    const count = (state.officers && (state.officers[key] || []).length) || 0;
    const officerMax = officerMaxFor(state);
    const maxed = count >= officerMax;
    const unlocked = def.unlock(state);
    const afford = state.fund >= def.cost && state.volunteerFrac >= def.volCost;
    const card = el('div', 'card');
    card.innerHTML = `
      <div class="card-row">
        <img class="card-emoji-img" src="assets/${def.icon}" alt="">
        <div class="card-main">
          <div class="card-title">${def.name} <span class="card-level">${count}/${officerMax}</span> ${!unlocked ? `<span class="card-lock"><img class="inline-icon-sm" src="assets/micon_ui_lock.png" alt=""> ${def.lockDesc}</span>` : ''}</div>
          <div class="card-sub">${def.desc}</div>
          <div class="card-sub">1인당 ${def.perUnitNote} · 봉사자 ${def.volCost}명 위촉</div>
        </div>
        <div class="card-action">
          ${maxed
            ? `<button class="btn btn-ghost btn-small" disabled>임직 완료</button>`
            : `<button class="btn btn-outline btn-small" ${unlocked && afford ? '' : 'disabled'} data-ordain="${key}">임직 ${fmtWon(def.cost)}</button>`}
        </div>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll('[data-ordain]').forEach((b) => b.addEventListener('click', () => actionOrdainOfficer(b.dataset.ordain)));

  return wrap;
}

function renderLog() {
  const wrap = el('div');

  wrap.appendChild(el('div', 'section-title', '저장 관리'));
  const saveCard = el('div', 'card');
  saveCard.innerHTML = `
    <div class="card-title"><img class="inline-icon" src="assets/micon_ui_floppy.png" alt=""> 저장 파일 내보내기·불러오기</div>
    <div class="card-sub">슬롯1은 자동으로 저장되는 지금 진행 중인 게임입니다. 슬롯2·3은 원할 때 "슬롯에 저장"으로 스냅샷을 담아두는 여분 슬롯입니다.</div>
    <div class="card-row" style="margin-top:10px; gap:6px">
      <button class="btn btn-ghost btn-small" id="saveSlot2Btn">슬롯2에 저장</button>
      <button class="btn btn-ghost btn-small" id="saveSlot3Btn">슬롯3에 저장</button>
    </div>
    <div class="card-row" style="margin-top:6px; gap:6px">
      <button class="btn btn-outline btn-small" id="exportSaveBtn">내보내기</button>
      <button class="btn btn-outline btn-small" id="importSaveBtn">불러오기</button>
    </div>
    <input type="file" id="importSaveInput" accept="application/json" style="display:none">`;
  wrap.appendChild(saveCard);
  saveCard.querySelector('#exportSaveBtn').addEventListener('click', actionExportSave);
  saveCard.querySelector('#saveSlot2Btn').addEventListener('click', () => actionSaveToSlot(2));
  saveCard.querySelector('#saveSlot3Btn').addEventListener('click', () => actionSaveToSlot(3));
  const importInput = saveCard.querySelector('#importSaveInput');
  saveCard.querySelector('#importSaveBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) actionImportSaveFile(importInput.files[0]);
    importInput.value = '';
  });

  wrap.appendChild(collapsibleHeader('log', '지난 발자취', false));
  if (collapsedSections.log) return wrap;
  if (!state.logs.length) {
    wrap.appendChild(el('div', 'log-empty', '아직 기록이 없습니다. 다음 주로 넘어가 보세요.'));
    return wrap;
  }
  const card = el('div', 'card');
  state.logs.forEach((l) => {
    const row = el('div', 'log-entry', `<span class="log-week">${l.week}주차</span>${escapeHtml(l.text)}`);
    card.appendChild(row);
  });
  wrap.appendChild(card);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===================== 이벤트 모달 ===================== */

function snapshotStats(s) {
  return { fund: s.fund, members: s.members, faith: s.faith, reputation: s.reputation, volunteers: s.volunteers };
}

/* 자동진행 중 예고 없이 뜨는 팝업(일반 이벤트·개인사 이벤트)은 탭 한 번으로 바로 실행하지
   않고 2단계로 나눈다 — 첫 탭은 그 선택지에 빨간 점 표시만 남기고(선택), 확정 버튼을 한 번
   더 눌러야 실제로 실행된다(확정). 화면 어딘가를 누르던 손가락 위치에 팝업이 갑자기 뜨면서
   의도치 않은 선택이 즉시 실행돼버리는 문제(베타테스터 Coony 제보)를 막기 위함 — 오조작이
   나도 표시만 되고 확정을 따로 눌러야 하니 되돌릴 여지가 생긴다. 플레이어가 직접 연 확인창
   (임직·초기화 등)은 애초에 팝업이 "예고 없이" 뜨는 상황이 아니라서 대상이 아니다. */
function renderConfirmableChoices(box, choices) {
  box.innerHTML = '';
  let selected = null;
  const btns = choices.map((c, i) => {
    const btn = el('button', 'choice-btn choice-btn-markable');
    btn.innerHTML = `<span class="choice-mark"></span><span class="choice-label">${c.label}</span>`;
    btn.addEventListener('click', () => {
      selected = i;
      btns.forEach((b, j) => b.classList.toggle('selected', j === i));
      confirmBtn.disabled = false;
      confirmBtn.textContent = `"${c.label}" 확정하기`;
    });
    box.appendChild(btn);
    return btn;
  });
  const hint = el('div', 'choice-confirm-hint');
  hint.textContent = '선택지를 누르면 표시만 되고, 아래 버튼을 눌러야 확정됩니다';
  box.appendChild(hint);
  const confirmBtn = el('button', 'btn btn-primary result-ok-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '선택 후 확정하기';
  confirmBtn.addEventListener('click', () => {
    if (selected == null) return;
    choices[selected].onConfirm();
  });
  box.appendChild(confirmBtn);
}

function showEvent(ev) {
  document.getElementById('eventIcon').src = 'assets/' + ev.icon;
  document.getElementById('eventTitle').textContent = ev.title;
  document.getElementById('eventBody').textContent = ev.body;
  const choicesBox = document.getElementById('eventChoices');
  renderConfirmableChoices(choicesBox, ev.choices.map((c) => ({
    label: c.label,
    onConfirm: () => {
      const before = snapshotStats(state);
      const msg = c.apply(state);
      const after = snapshotStats(state);
      if (msg) addLog(msg);
      saveGame();
      render();
      showEventResult(ev, msg, before, after);
    },
  })));
  showModal('eventModal');
}

function showEventResult(ev, msg, before, after) {
  document.getElementById('eventIcon').src = 'assets/' + ev.icon;
  document.getElementById('eventTitle').textContent = '그 결과…';
  document.getElementById('eventBody').textContent = msg || '';
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';

  const deltas = [
    ['교회 재정', after.fund - before.fund, 'won'],
    ['성도수', after.members - before.members, 'count'],
    ['신앙지수', +(after.faith - before.faith).toFixed(1), 'num'],
    ['지역신뢰', +(after.reputation - before.reputation).toFixed(1), 'num'],
    ['봉사자', after.volunteers - before.volunteers, 'count'],
  ];
  const deltaWrap = el('div', 'dash-summary');
  let any = false;
  deltas.forEach(([label, delta, kind]) => {
    if (!delta) return;
    any = true;
    const cls = delta > 0 ? 'delta-pos' : 'delta-neg';
    const valueText = kind === 'won' ? (delta > 0 ? '+' : '') + fmtWon(delta) : `${delta > 0 ? '+' : ''}${delta}`;
    deltaWrap.appendChild(el('div', 'dash-summary-row', `<span>${label}</span><span class="${cls}">${valueText}</span>`));
  });
  if (!any) deltaWrap.appendChild(el('div', 'dash-summary-row', '<span>눈에 띄는 변화는 없었습니다.</span>'));
  box.appendChild(deltaWrap);

  const okBtn = el('button', 'btn btn-primary result-ok-btn', '확인');
  okBtn.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(okBtn);
}

function showMilestone(tier, grantedBoost) {
  document.getElementById('milestoneTitle').textContent = `${tier.name}(으)로 성장했습니다!`;
  document.getElementById('milestoneBody').innerHTML = escapeHtml(tier.msg) +
    (grantedBoost ? `<br><br><img class="inline-icon" src="assets/micon_ui_gift.png" alt=""> ${escapeHtml(BOOST_ITEMS[grantedBoost].name)}을(를) 받았습니다! '행사' 탭에서 사용할 수 있습니다.` : '');
  document.getElementById('milestoneCloseBtn').textContent = '계속하기';
  showModal('milestoneModal');
}

function showEnding() {
  const officerCount = (state.officers.elder || []).length + (state.officers.deacon || []).length + (state.officers.exhorter || []).length;
  const buildingLevels = Object.values(state.buildings).reduce((a, b) => a + b, 0);
  const finalTier = TIERS[TIERS.length - 1];
  document.getElementById('milestoneTitle').innerHTML = `<img class="inline-icon" src="assets/micon_ui_party.png" alt=""> ${escapeHtml(state.name)}, ${escapeHtml(finalTier.name)}(으)로 성장했습니다!`;
  document.getElementById('milestoneBody').textContent =
    `${finalTier.msg} 작은 씨앗 하나로 시작한 교회가 ${state.week}주 동안의 여정 끝에 ` +
    `성도 ${fmt(state.members)}명이 함께하는 ${finalTier.name}이(가) 되었습니다.\n\n` +
    `— 교회 재정 ${fmtWon(state.fund)}\n` +
    `— 건물 레벨 합계 ${buildingLevels}단계\n` +
    `— 임직한 직분자 ${officerCount}명\n` +
    `— 신앙지수 ${Math.round(state.faith)} · 지역신뢰 ${Math.round(state.reputation)}\n\n` +
    `게임은 여기서 끝나지 않습니다 — 계속해서 교회를 섬기고 키워나갈 수 있습니다.`;
  document.getElementById('milestoneCloseBtn').textContent = '계속 섬기기';
  showModal('milestoneModal');
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

/* ===================== 초기화 ===================== */

function initTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    render();
  });
}

/* ===================== 자동진행(오토플레이) ===================== */
/* 실제 모바일 타이쿤 게임처럼 시간이 저절로 흐르되, 확인해야 할 이벤트/마일스톤
   모달이 떠 있는 동안에는 절대 다음 주로 넘어가지 않는다(읽기 전에 덮어쓰지 않음). */

let autoPlayOn = false;
let autoPlayTimer = null;
let lastTickAt = Date.now(); // 마지막으로 주가 실제로 넘어간 실시간 시각 — 날짜 표기를 실시간으로 보간하는 데 쓴다
const AUTO_PLAY_INTERVAL_MS = 30 * 1000; // 30초 = 게임 속 1주(오너 지시)

/* 대시보드 상단 날짜·나이 표기가 다음 주 틱까지 멈춰 있지 않고 실시간으로 흘러가도록
   보간한다(오너 지시: "yyyymmdd 표기 실시간 반영"). 실제 게임 상태(state.week)는 건드리지
   않고 화면 표시값만 계산 — 일시정지 중이거나 모달이 떠 있을 때는 보간하지 않는다. */
function currentDisplayWeek() {
  if (!autoPlayOn || isAnyModalOpen()) return state.week;
  const interval = AUTO_PLAY_INTERVAL_MS / currentSpeedMultiplier();
  const frac = Math.min(0.999, Math.max(0, (Date.now() - lastTickAt) / interval));
  return state.week + frac;
}

function updateTimeLabels() {
  const wl = document.getElementById('weekLabel');
  const dl = document.getElementById('dateLabel');
  if (!wl || !dl) return;
  const dw = currentDisplayWeek();
  wl.textContent = formatChurchAge(dw);
  dl.textContent = formatAbsoluteDate({ gameStartDate: state.gameStartDate, week: dw });
}

function isAnyModalOpen() {
  const em = document.getElementById('eventModal');
  const mm = document.getElementById('milestoneModal');
  const im = document.getElementById('introModal');
  return (em && !em.classList.contains('hidden')) || (mm && !mm.classList.contains('hidden')) || (im && !im.classList.contains('hidden'));
}

/* 활성화된 가속권이 있으면 그 배수만큼 틱 간격을 줄인다 — setInterval을 고정하지 않고
   매 틱마다 다시 스케줄링해서, 가속권을 새로 쓰면 다음 틱부터 바로 빨라지게 했다. */
function currentSpeedMultiplier() {
  if (state.speedBoostUntil && Date.now() < state.speedBoostUntil) return state.speedBoostMultiplier || 1;
  if (state.speedBoostUntil) { state.speedBoostUntil = 0; state.speedBoostMultiplier = 1; state.speedBoostKey = null; lastTickAt = Date.now(); }
  return 1;
}

function updateAutoPlayButton() {
  const btn = document.getElementById('autoToggleBtn');
  if (!btn) return;
  const mult = currentSpeedMultiplier();
  const boostSuffix = mult > 1 ? ` · ${mult}배속(${Math.max(0, Math.ceil((state.speedBoostUntil - Date.now()) / 60000))}분 남음)` : '';
  btn.textContent = (autoPlayOn ? '⏸ 은혜가 흐르는 중' : '▶ 일시정지됨 (탭해서 계속)') + boostSuffix;
  btn.classList.toggle('btn-primary', autoPlayOn);
  btn.classList.toggle('btn-outline', !autoPlayOn);
  btn.setAttribute('aria-pressed', autoPlayOn ? 'true' : 'false');
}

function scheduleAutoTick() {
  if (autoPlayTimer) { clearTimeout(autoPlayTimer); autoPlayTimer = null; }
  if (!autoPlayOn) return;
  const interval = Math.max(500, Math.round(AUTO_PLAY_INTERVAL_MS / currentSpeedMultiplier()));
  autoPlayTimer = setTimeout(() => {
    if (!isAnyModalOpen()) actionNextWeek();
    scheduleAutoTick();
  }, interval);
}

function setAutoPlay(on) {
  autoPlayOn = on;
  if (on) lastTickAt = Date.now(); // 재개 시점부터 다시 보간(멈춰 있던 시간이 갑자기 확 흐른 것처럼 보이지 않도록)
  try { localStorage.setItem('church-tycoon-autoplay', on ? '1' : '0'); } catch (e) { /* ignore */ }
  updateAutoPlayButton();
  scheduleAutoTick();
}

function actionUseBoost(key) {
  if (currentSpeedMultiplier() > 1) return; // 이미 가속 중엔 중첩 사용 불가
  if (!state.boostItems[key]) return;
  const def = BOOST_ITEMS[key];
  state.boostItems[key] -= 1;
  state.speedBoostKey = key;
  state.speedBoostMultiplier = def.mult;
  state.speedBoostUntil = Date.now() + def.durationMs;
  lastTickAt = Date.now(); // 배속이 바뀐 시점부터 새 속도로 다시 보간
  addLog(`${def.name}을(를) 사용해 ${def.mult}배속으로 시간이 흐릅니다.`);
  saveGame();
  render();
  updateAutoPlayButton();
  if (autoPlayOn) scheduleAutoTick();
}

function actionBuyBoost(key) {
  const def = BOOST_ITEMS[key];
  if (state.fund < def.cost) return;
  state.fund -= def.cost;
  state.boostItems[key] = (state.boostItems[key] || 0) + 1;
  addLog(`${def.name}을(를) 구매했습니다.`);
  saveGame();
  render();
}

/* ===================== 오프라인(자리비움) 진행 ===================== */
/* 앱을 닫아둔 실제 시간만큼 교회는 계속 운영된다 — 모바일 타이쿤 게임의 핵심 관례. */

const OFFLINE_SECONDS_PER_WEEK = 30; // 실시간 자동진행(30초=1주)과 같은 속도로 맞춤 — 앱을 꺼두는 쪽이 오히려 손해 보지 않도록
/* 웹페이지는 탭이 닫히거나 백그라운드로 가면 실제로 JS가 돌지 않는다(브라우저 표준 제약 —
   진짜 백그라운드 실행은 서버 없이는 불가능) — 그래서 "떠나 있던 만큼 계속 운영됐다"는
   체감은 돌아왔을 때 경과 시간만큼 한 번에 계산해 몰아주는 방식으로 구현한다. 예전엔 최대
   24주(약 24분)만 인정해 그 이상 떠나 있으면 나머지 시간이 그냥 사라졌는데, 오너 지시로
   "앱을 꺼두거나 벗어나 있어도 진행되는 느낌"을 살리기 위해 최대 24시간(하루) 분량까지
   인정하도록 늘렸다. 그 이상(며칠 이상 방치)은 여전히 캡을 둬서 한 번에 게임 후반부를
   건너뛰는 극단적 결과를 막는다. */
const OFFLINE_MAX_WEEKS = 2880; // 30초/주 기준 24시간(하루) 분량 — 속도가 바뀌어도 최대 인정 시간(하루)은 그대로 유지

function applyOfflineProgress() {
  const now = Date.now();
  const last = state.lastSavedAt || now;
  const elapsedSec = Math.floor((now - last) / 1000);
  let weeks = Math.floor(elapsedSec / OFFLINE_SECONDS_PER_WEEK);
  if (weeks < 1) return null;
  weeks = Math.min(weeks, OFFLINE_MAX_WEEKS);

  const before = snapshotStats(state);
  let reachedEnding = false;
  const boostsGranted = {};
  for (let i = 0; i < weeks; i++) {
    const summary = advanceWeek();
    if (summary.grantedBoost) boostsGranted[summary.grantedBoost] = (boostsGranted[summary.grantedBoost] || 0) + 1;
    if (summary.milestone && summary.milestone.key === TIERS[TIERS.length - 1].key && !state.endingShown) {
      state.endingShown = true;
      reachedEnding = true;
    }
  }
  const after = snapshotStats(state);
  saveGame();
  return { weeks, before, after, reachedEnding, boostsGranted };
}

function showOfflineSummary(result) {
  if (result.reachedEnding) { showEnding(); return; }
  document.getElementById('eventIcon').src = 'assets/micon_ui_hourglass.png';
  document.getElementById('eventTitle').textContent = `자리를 비운 사이 ${result.weeks}주가 지났습니다`;
  const boostText = Object.keys(result.boostsGranted || {})
    .map((k) => `${BOOST_ITEMS[k].name} ${result.boostsGranted[k]}개`).join(', ');
  document.getElementById('eventBody').textContent = '떠나 있는 동안에도 교회는 계속 운영되었습니다.' +
    (boostText ? ` (성장 보상으로 ${boostText}을(를) 받았습니다)` : '');
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const deltas = [
    ['교회 재정', result.after.fund - result.before.fund, 'won'],
    ['성도수', result.after.members - result.before.members, 'count'],
    ['신앙지수', +(result.after.faith - result.before.faith).toFixed(1), 'num'],
    ['지역신뢰', +(result.after.reputation - result.before.reputation).toFixed(1), 'num'],
  ];
  const wrap = el('div', 'dash-summary');
  let any = false;
  deltas.forEach(([label, delta, kind]) => {
    if (!delta) return;
    any = true;
    const cls = delta > 0 ? 'delta-pos' : 'delta-neg';
    const text = kind === 'won' ? (delta > 0 ? '+' : '') + fmtWon(delta) : `${delta > 0 ? '+' : ''}${delta}`;
    wrap.appendChild(el('div', 'dash-summary-row', `<span>${label}</span><span class="${cls}">${text}</span>`));
  });
  if (!any) wrap.appendChild(el('div', 'dash-summary-row', '<span>큰 변화 없이 조용한 시간이었습니다.</span>'));
  box.appendChild(wrap);
  const okBtn = el('button', 'btn btn-primary result-ok-btn', '확인');
  okBtn.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(okBtn);
  showModal('eventModal');
}

/* ===================== 탭 보너스 ===================== */
/* 캠퍼스의 빈 곳을 탭하면 아주 작은 은혜의 손길 보너스를 받는다(연타 방지 쿨다운). */

let lastTapBonusAt = 0;
const TAP_BONUS_COOLDOWN_MS = 2500;
const TAP_BONUS_AMOUNT = 8000;

function tryTapBonus() {
  const now = Date.now();
  if (now - lastTapBonusAt < TAP_BONUS_COOLDOWN_MS) return false;
  lastTapBonusAt = now;
  state.fund += TAP_BONUS_AMOUNT;
  saveGame();
  setStat('statFund', fmtWon(state.fund));
  const fundEl = document.getElementById('statFund');
  if (fundEl) {
    fundEl.classList.remove('flash-good');
    void fundEl.offsetWidth;
    fundEl.classList.add('flash-good');
  }
  return true;
}

/* 라이트/다크 테마 — 기기 설정을 기본 따르되(오너 지시) 앱 안에서 직접 고를 수도 있다.
   footer 아이콘 버튼을 탭할 때마다 시스템→라이트→다크→시스템 순으로 순환한다. */
const THEME_STORAGE_KEY = 'church-tycoon-theme';
const THEME_CYCLE = ['system', 'light', 'dark'];

function systemPrefersDark() {
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch (e) { /* ignore */ }
  const btn = document.getElementById('themeToggleBtn');
  const icon = document.getElementById('themeToggleIcon');
  if (!btn || !icon) return;
  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  icon.src = 'assets/' + (isDark ? 'micon_ui_moon.png' : 'micon_ui_sun.png');
  const label = mode === 'system' ? '시스템' : mode === 'light' ? '라이트' : '다크';
  btn.title = `테마: ${label} (탭하여 전환)`;
}

function initTheme() {
  let saved = 'system';
  try { saved = localStorage.getItem(THEME_STORAGE_KEY) || 'system'; } catch (e) { /* ignore */ }
  if (THEME_CYCLE.indexOf(saved) === -1) saved = 'system';
  applyTheme(saved);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      let cur = 'system';
      try { cur = localStorage.getItem(THEME_STORAGE_KEY) || 'system'; } catch (e) { /* ignore */ }
      const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
      applyTheme(next);
    });
  }
}

function initFooter() {
  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirmReset();
  });
  const autoBtn = document.getElementById('autoToggleBtn');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => setAutoPlay(!autoPlayOn));
    let saved = null;
    try { saved = localStorage.getItem('church-tycoon-autoplay'); } catch (e) { /* ignore */ }
    setAutoPlay(saved === null ? true : saved === '1');
  }
  setInterval(updateAutoPlayButton, 5000); // 가속권 잔여시간 표시를 주기적으로 갱신
  setInterval(updateTimeLabels, 1000); // 상단 날짜·나이 표기를 실시간으로 흘러가듯 갱신
}

function showConfirmReset() {
  document.getElementById('eventIcon').src = 'assets/micon_ui_refresh.png';
  document.getElementById('eventTitle').textContent = '새로 시작할까요?';
  document.getElementById('eventBody').textContent = '지금까지의 진행 상황이 사라지고 처음부터 다시 시작합니다.';
  const box = document.getElementById('eventChoices');
  box.innerHTML = '';
  const yes = el('button', 'choice-btn');
  yes.innerHTML = `<span class="choice-label">새로 시작한다</span>`;
  yes.addEventListener('click', () => { actionResetGame(); hideModal('eventModal'); });
  const no = el('button', 'choice-btn');
  no.innerHTML = `<span class="choice-label">계속 진행한다</span>`;
  no.addEventListener('click', () => hideModal('eventModal'));
  box.appendChild(yes);
  box.appendChild(no);
  showModal('eventModal');
}

function initChurchNameInput() {
  const input = document.getElementById('churchName');
  input.addEventListener('change', () => {
    state.name = input.value.trim() || '은혜교회';
    saveGame();
    render();
  });
}

function initMilestoneModal() {
  document.getElementById('milestoneCloseBtn').addEventListener('click', () => hideModal('milestoneModal'));
}

function initScene() {
  const canvas = document.getElementById('scene');
  const hint = document.getElementById('sceneHint');
  if (!canvas || typeof Scene === 'undefined') return;
  const ctx = canvas.getContext('2d');

  Scene.preload().then(() => {
    canvas.style.cursor = 'default';
  });

  function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('click', (e) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const key = Scene.hitTest(x, y);
    if (key) {
      currentTab = key;
      render();
      document.getElementById('tabContent').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      tryTapBonus();
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    canvas.style.cursor = Scene.hitTest(x, y) ? 'pointer' : 'default';
  });

  function loop(tMs) {
    if (Scene.ready) {
      const result = Scene.draw(ctx, state, tMs);
      if (hint) {
        hint.textContent = result.overflow > 0 ? `+${result.overflow}명 더 함께하고 있어요` : '건물을 탭해보세요';
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

/* 링크로 처음 들어왔을 때: 로고 스플래시 → (첫 실행이면) 간단한 게임 소개 확인창 →
   게임 시작. 기존 저장 데이터가 있는 재방문자는 스플래시만 잠깐 보고 바로 이어서 한다. */
function startGamePlay() {
  render();
  const off = applyOfflineProgress();
  if (off) {
    render();
    showOfflineSummary(off);
  }
}

function dismissSplash() {
  const splash = document.getElementById('splashScreen');
  if (!splash || splash.classList.contains('hidden')) return;
  splash.classList.add('hidden');
  setTimeout(() => { splash.style.display = 'none'; }, 400);
  if (isFirstEverLaunch) showModal('introModal');
  else startGamePlay();
}

function initSplash() {
  const splash = document.getElementById('splashScreen');
  if (!splash) { if (isFirstEverLaunch) showModal('introModal'); else startGamePlay(); return; }
  splash.addEventListener('click', dismissSplash);
  setTimeout(dismissSplash, 1400);
}

function initIntro() {
  const btn = document.getElementById('introStartBtn');
  if (!btn) return;
  btn.addEventListener('click', () => { hideModal('introModal'); startGamePlay(); });
}

function init() {
  initTheme();
  initTabs();
  initFooter();
  initChurchNameInput();
  initMilestoneModal();
  initIntro();
  initScene();
  initPwa();
  initSplash();
}

document.addEventListener('DOMContentLoaded', init);
