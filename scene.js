'use strict';

/* 픽셀아트 캠퍼스 씬 렌더러 — 결정론적 배치(성도 스팟·나무 위치는 고정 시드)로
   매 프레임 다시 그려도 흔들리지 않는다. 이미지 로딩 실패 시에도 조용히 건너뛴다. */

const Scene = (function () {
  const TILE = 16;
  const COLS = 20;
  const ROWS = 13;
  const ASSET_BASE = 'assets/';

  const manifest = {
    grass0: 'grass_0.png',
    grass1: 'grass_1.png',
    path0: 'path_0.png',
    tree0: 'tree_0.png',
    tree1: 'tree_1.png',
    bush0: 'bush_0.png',
    fence0: 'fence_0.png',
    flowerBed0: 'flower_bed_0.png',
    sanctuary: [0, 1, 2, 3, 4, 5].map((i) => `sanctuary_${i}.png`),
    education: [0, 1, 2, 3, 4].map((i) => `education_${i}.png`),
    fellowship: [0, 1, 2, 3, 4].map((i) => `fellowship_${i}.png`),
    parking: [0, 1, 2, 3].map((i) => `parking_${i}.png`),
    person: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `person_${i}.png`),
    visitingCar: [0, 1, 2].map((i) => `visiting_car_${i}.png`),
  };

  const images = {};
  let ready = false;

  function loadImage(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = ASSET_BASE + src;
    });
  }

  async function preload() {
    images.grass0 = await loadImage(manifest.grass0);
    images.grass1 = await loadImage(manifest.grass1);
    images.path0 = await loadImage(manifest.path0);
    images.tree0 = await loadImage(manifest.tree0);
    images.tree1 = await loadImage(manifest.tree1);
    images.bush0 = await loadImage(manifest.bush0);
    images.fence0 = await loadImage(manifest.fence0);
    images.flowerBed0 = await loadImage(manifest.flowerBed0);
    images.sanctuary = await Promise.all(manifest.sanctuary.map(loadImage));
    images.education = await Promise.all(manifest.education.map(loadImage));
    images.fellowship = await Promise.all(manifest.fellowship.map(loadImage));
    images.parking = await Promise.all(manifest.parking.map(loadImage));
    images.person = await Promise.all(manifest.person.map(loadImage));
    images.visitingCar = await Promise.all(manifest.visitingCar.map(loadImage));
    ready = true;
  }

  function seededRow(seed, count, prob) {
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
    const row = [];
    for (let i = 0; i < count; i++) row.push(rnd() < prob ? 1 : 0);
    return row;
  }

  const grassPattern = [];
  (function buildGrassPattern() {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
    for (let gy = 0; gy < ROWS; gy++) {
      const row = [];
      for (let gx = 0; gx < COLS; gx++) row.push(rnd() < 0.2 ? 1 : 0);
      grassPattern.push(row);
    }
  })();

  /* 길 네트워크 — 예배당~주차장을 잇는 세로 축 하나만 있던 것을 교육관·친교실까지
     닿는 가로 가지를 더해 3동 모두에 실제로 연결되도록 했다(오너 지적: "건물이
     세 개인데 길이 하나뿐인 게 말이 안 된다"). */
  const PATH_TILES = (function () {
    const set = new Set();
    for (let gy = 5; gy < ROWS; gy++) { set.add(`9,${gy}`); set.add(`10,${gy}`); }
    for (let gx = 4; gx <= 16; gx++) { set.add(`${gx},8`); set.add(`${gx},9`); }
    return set;
  })();
  function isPathTile(gx, gy) { return PATH_TILES.has(`${gx},${gy}`); }

  const TREE_SPOTS = [
    { x: 1, y: 1, v: 0 }, { x: 2, y: 8, v: 1 }, { x: 1, y: 11, v: 0 },
    { x: 18, y: 2, v: 1 }, { x: 18, y: 9, v: 0 }, { x: 17, y: 11, v: 1 },
    { x: 5, y: 0, v: 1 }, { x: 14, y: 0, v: 0 },
  ];
  const BUSH_SPOTS = [{ x: 4, y: 6 }, { x: 16, y: 6 }, { x: 3, y: 10 }, { x: 16, y: 3 }];

  /* 부지 상단 테두리를 따라 낮은 울타리를 둘러 '경내' 느낌을 준다(나무가 이미
     서 있는 칸은 겹치지 않게 건너뜀). */
  const FENCE_COLS = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19];
  /* 예배당·교육관·친교실 출입구 앞에 작은 화단을 배치한다. */
  const FLOWER_SPOTS = [
    { x: 7.4, y: 5 }, { x: 11.9, y: 5 },
    { x: 2.4, y: 9.3 }, { x: 17.3, y: 9.3 },
  ];

  const ANCHORS = {
    sanctuary: { cx: 9.5 * TILE, groundRow: 6.4 },
    education: { cx: 3.4 * TILE, groundRow: 8.4 },
    fellowship: { cx: 15.8 * TILE, groundRow: 8.4 },
    parking: { cx: 9.5 * TILE, groundRow: 12.6 },
  };

  /* 각 사람 스프라이트는 성도 10명을 표현한다(오너 지시) — 화면이 24칸(기본 크기)을
     넘어서면 자동으로 절반 크기·더 촘촘한 격자로 전환해 더 많이 담는다.
     각 스팟은 고정된 "집(home)" 좌표를 중심으로 시간에 따라 결정론적으로 서성인다
     (개별 위상·주기를 부여해 서로 다른 리듬으로 움직이게 함 — 상태 저장 없이
     tMs만으로 매 프레임 재계산되므로 되감기/일시정지에도 안전하다). 길(9~10열)을
     피해 좌우 두 무리로 나눠 배치한다. */
  const PEOPLE_PER_SPRITE = 10;

  function buildPersonSpots(leftCols, rightCols, rows, seed) {
    const spots = [];
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
    const cols = leftCols.concat(rightCols);
    let i = 0;
    for (const gy of rows) {
      for (const gx of cols) {
        spots.push({
          x: gx * TILE + (rnd() * 4 - 2),
          y: gy * TILE + (rnd() * 3 - 1.5),
          periodX: 3600 + (i * 613) % 2600,
          periodY: 2600 + (i * 977) % 2200,
          phase: rnd() * Math.PI * 2,
          rangeX: 6 + (i % 4),
          rangeY: 3 + (i % 3),
        });
        i++;
      }
    }
    return spots;
  }

  const PERSON_SPOTS = buildPersonSpots(
    [6.3, 7.2, 8.1], [11.4, 12.3, 13.2],
    [8.7, 9.5, 10.3, 11.1],
    7
  );
  const DENSE_PERSON_SPOTS = buildPersonSpots(
    [5.9, 6.4, 6.9, 7.4, 7.9], [11.0, 11.5, 12.0, 12.5, 13.0, 13.5],
    [8.3, 8.75, 9.2, 9.65, 10.1, 10.55, 11.0],
    23
  );
  const DENSE_SCALE = 0.5;

  const WANDER_BOUNDS = { x0: 5.5 * TILE, x1: 14.5 * TILE, y0: 8 * TILE, y1: 12.3 * TILE };

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 방문 차량: 주차장이 포장된(레벨 1+) 경우에만, 진입로를 따라 들어와 잠시 머물다 나간다.
     상태 저장 없이 tMs % CYCLE 로만 단계를 계산하는 순수 함수라 프레임을 건너뛰어도 안전하다. */
  const CAR_CYCLE_MS = 22000;
  const CAR_ARRIVE_MS = 3200;
  const CAR_PARK_MS = 11000;
  const CAR_LEAVE_MS = 3200;

  function visitingCarPose(tMs) {
    const t = tMs % CAR_CYCLE_MS;
    const pathX = 9.5 * TILE;
    const enterY = ROWS * TILE + 14;
    const parkY = 12.1 * TILE;
    if (t < CAR_ARRIVE_MS) {
      const p = t / CAR_ARRIVE_MS;
      return { x: pathX, y: enterY + (parkY - enterY) * easeOut(p), visible: true };
    }
    if (t < CAR_ARRIVE_MS + CAR_PARK_MS) {
      return { x: pathX, y: parkY, visible: true };
    }
    if (t < CAR_ARRIVE_MS + CAR_PARK_MS + CAR_LEAVE_MS) {
      const p = (t - CAR_ARRIVE_MS - CAR_PARK_MS) / CAR_LEAVE_MS;
      return { x: pathX, y: parkY + (enterY - parkY) * easeIn(p), visible: true };
    }
    return { x: pathX, y: enterY, visible: false };
  }
  function easeOut(p) { return 1 - Math.pow(1 - p, 2); }
  function easeIn(p) { return p * p; }

  let hitboxes = [];

  function pick(levelsArr, level) {
    if (!levelsArr) return null;
    const clamped = Math.max(0, Math.min(levelsArr.length - 1, level | 0));
    return levelsArr[clamped];
  }

  function drawSprite(ctx, im, x, y, flip, scale) {
    const dw = scale ? Math.round(im.width * scale) : im.width;
    const dh = scale ? Math.round(im.height * scale) : im.height;
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (!flip) { ctx.drawImage(im, rx, ry, dw, dh); return; }
    ctx.save();
    ctx.translate(rx + dw, ry);
    ctx.scale(-1, 1);
    ctx.drawImage(im, 0, 0, dw, dh);
    ctx.restore();
  }

  function drawBuildingShadow(ctx, im, anchor) {
    const gy = anchor.groundRow * TILE;
    const rw = im.width * 0.46;
    const rh = Math.max(3, im.height * 0.06);
    ctx.save();
    ctx.fillStyle = 'rgba(30, 26, 20, 0.28)';
    ctx.beginPath();
    ctx.ellipse(anchor.cx, gy - 1, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBuilding(ctx, key, im, anchor) {
    if (!im) return;
    drawBuildingShadow(ctx, im, anchor);
    const x = Math.round(anchor.cx - im.width / 2);
    const y = Math.round(anchor.groundRow * TILE - im.height);
    ctx.drawImage(im, x, y);
    hitboxes.push({ key, x0: x, y0: y, x1: x + im.width, y1: y + im.height });
  }

  function draw(ctx, state, tMs) {
    if (!ready) return { overflow: 0 };
    hitboxes = [];
    ctx.imageSmoothingEnabled = false;

    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const im = isPathTile(gx, gy) ? images.path0 : (grassPattern[gy][gx] ? images.grass1 : images.grass0);
        if (im) ctx.drawImage(im, gx * TILE, gy * TILE);
      }
    }

    for (const t of TREE_SPOTS) {
      const im = t.v === 0 ? images.tree0 : images.tree1;
      if (im) ctx.drawImage(im, t.x * TILE, (t.y + 1) * TILE - im.height);
    }
    for (const b of BUSH_SPOTS) {
      if (images.bush0) ctx.drawImage(images.bush0, b.x * TILE, (b.y + 1) * TILE - images.bush0.height);
    }
    if (images.fence0) {
      for (const gx of FENCE_COLS) ctx.drawImage(images.fence0, gx * TILE, 3);
    }
    if (images.flowerBed0) {
      for (const f of FLOWER_SPOTS) {
        ctx.drawImage(images.flowerBed0, f.x * TILE, (f.y + 1) * TILE - images.flowerBed0.height);
      }
    }

    drawBuilding(ctx, 'buildings', pick(images.education, state.buildings.education), ANCHORS.education);
    drawBuilding(ctx, 'buildings', pick(images.fellowship, state.buildings.fellowship), ANCHORS.fellowship);
    drawBuilding(ctx, 'buildings', pick(images.parking, state.buildings.parking), ANCHORS.parking);
    drawBuilding(ctx, 'buildings', pick(images.sanctuary, state.buildings.sanctuary), ANCHORS.sanctuary);

    /* 사람·방문 차량은 y좌표(화면상 아래일수록 앞) 기준으로 정렬해 그려야
       서로 겹칠 때 자연스럽다(페인터 알고리즘). */
    const drawables = [];

    const rawSpriteCount = state.members > 0 ? Math.max(1, Math.round(state.members / PEOPLE_PER_SPRITE)) : 0;
    const useDense = rawSpriteCount > PERSON_SPOTS.length;
    const activeSpots = useDense ? DENSE_PERSON_SPOTS : PERSON_SPOTS;
    const spriteScale = useDense ? DENSE_SCALE : 1;
    const count = Math.min(rawSpriteCount, activeSpots.length);

    for (let i = 0; i < count; i++) {
      const spot = activeSpots[i];
      const im = images.person[i % images.person.length];
      if (!im) continue;
      const wx = Math.sin(tMs / spot.periodX + spot.phase) * spot.rangeX;
      const wy = Math.cos(tMs / spot.periodY + spot.phase * 1.3) * spot.rangeY;
      const facingLeft = Math.cos(tMs / spot.periodX + spot.phase) < 0;
      const x = clampNum(spot.x + wx, WANDER_BOUNDS.x0, WANDER_BOUNDS.x1);
      const y = clampNum(spot.y + wy, WANDER_BOUNDS.y0, WANDER_BOUNDS.y1);
      drawables.push({ y, draw: () => drawSprite(ctx, im, x, y, facingLeft, spriteScale) });
    }

    if (state.buildings.parking >= 1) {
      const car = visitingCarPose(tMs);
      if (car.visible && images.visitingCar.length) {
        const carImg = images.visitingCar[state.week % images.visitingCar.length];
        if (carImg) {
          const cx = car.x - carImg.width / 2;
          const cy = car.y - carImg.height / 2;
          drawables.push({ y: car.y - 4, draw: () => ctx.drawImage(carImg, Math.round(cx), Math.round(cy)) });
        }
      }
    }

    drawables.sort((a, b) => a.y - b.y);
    drawables.forEach((d) => d.draw());

    return { overflow: Math.max(0, state.members - count * PEOPLE_PER_SPRITE) };
  }

  function hitTest(px, py) {
    for (let i = hitboxes.length - 1; i >= 0; i--) {
      const h = hitboxes[i];
      if (px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) return h.key;
    }
    return null;
  }

  return {
    preload,
    draw,
    hitTest,
    get ready() { return ready; },
    TILE, COLS, ROWS,
  };
})();
