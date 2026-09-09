// ── Velvet Glow エフェクトエンジン（k-eis DESIGN FILTER 00-α・個人用/非公開）
// 「ライカの風合い」のリサーチをもとに、客観的な裏付けのある部分を軸に翻訳した5パラメータ:
// 01 CCD COLOR      → コダックCCD世代の、フィルムのような色の転び（特に赤を深く）
// 02 APO SHARPNESS  → ローパスレス設計を思わせる、緻密な解像感
// 03 MICRO CONTRAST → いわゆる「3Dポップ」。中間トーンの局所コントラストで被写体を浮かせる
// 04 GLOW           → 明るいレンズ開放付近とされる「Leica glow」。賛否があるためデフォルトは控えめ
// 05 TONE ROLLOFF   → ハイライト/シャドウが粘る、穏やかなトーンカーブ

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const outputCanvas = document.getElementById('outputCanvas');
const canvasBadge = document.getElementById('canvasBadge');
const ctx = outputCanvas.getContext('2d');

const ccdColorSlider = document.getElementById('ccdColor');
const apoSharpSlider = document.getElementById('apoSharp');
const microContrastSlider = document.getElementById('microContrast');
const glowSlider = document.getElementById('glow');
const toneRolloffSlider = document.getElementById('toneRolloff');
const crushSlider = document.getElementById('crush');
const grainSlider = document.getElementById('grain');
const colorTempSlider = document.getElementById('colorTemp');
const saturationSlider = document.getElementById('saturation');
const vignetteSlider = document.getElementById('vignette');
const fieldBlurSlider = document.getElementById('fieldBlur');
const softFocusSlider = document.getElementById('softFocus');
const lightLeakSlider = document.getElementById('lightLeak');
const monochromeCheckbox = document.getElementById('monochrome');
const compareModeCheckbox = document.getElementById('compareMode');

const ccdColorVal = document.getElementById('ccdColorVal');
const apoSharpVal = document.getElementById('apoSharpVal');
const microContrastVal = document.getElementById('microContrastVal');
const glowVal = document.getElementById('glowVal');
const toneRolloffVal = document.getElementById('toneRolloffVal');
const crushVal = document.getElementById('crushVal');
const grainVal = document.getElementById('grainVal');
const colorTempVal = document.getElementById('colorTempVal');
const saturationVal = document.getElementById('saturationVal');
const vignetteVal = document.getElementById('vignetteVal');
const fieldBlurVal = document.getElementById('fieldBlurVal');
const softFocusVal = document.getElementById('softFocusVal');
const lightLeakVal = document.getElementById('lightLeakVal');

const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const themeBtns = document.querySelectorAll('.theme-btn');
const patchBtns = document.querySelectorAll('.profile-btn');

let originalImage = null;
let originalImageData = null;
let previewImageData = null;
let isDragging = false;
let lastResultImageData = null; // COMPARE MODE用：直近のフル解像度描画結果を保持
let compareTimeout1 = null, compareTimeout2 = null; // COMPARE MODE用：連打時に前のタイマーを打ち消すため

// ── ファイル読み込み
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
});
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      setupCanvas(img);
      applyVelvetGlow();
      dropZone.style.display = 'none';
      canvasBadge.style.display = 'block';
      outputCanvas.style.display = 'block';
      downloadBtn.disabled = false;
      resetBtn.disabled = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas(img) {
  const MAX_W = 900;
  let w = img.width, h = img.height;
  if (w > MAX_W) { h = h * (MAX_W / w); w = MAX_W; }
  outputCanvas.width = w;
  outputCanvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  originalImageData = ctx.getImageData(0, 0, w, h);

  const PREVIEW_MAX_W = 320;
  const pScale = Math.min(1, PREVIEW_MAX_W / w);
  const pw = Math.max(1, Math.round(w * pScale));
  const ph = Math.max(1, Math.round(h * pScale));
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pw; pCanvas.height = ph;
  const pCtx = pCanvas.getContext('2d');
  pCtx.drawImage(img, 0, 0, pw, ph);
  previewImageData = pCtx.getImageData(0, 0, pw, ph);
}

let driftRAF = null;
function requestApply() {
  if (driftRAF) cancelAnimationFrame(driftRAF);
  driftRAF = requestAnimationFrame(() => {
    driftRAF = null;
    if (isDragging) {
      applyVelvetGlow(true);
    } else {
      const oldText = canvasBadge.textContent;
      canvasBadge.textContent = '処理中… PROCESSING';
      canvasBadge.style.display = 'block';
      setTimeout(() => {
        applyVelvetGlow(false);
        canvasBadge.textContent = 'PREVIEW';
      }, 10);
    }
  });
}

// ── スライディングウィンドウのボックスブラー（半径によらず高速）
// ── 決定論的な擬似ランダム／ノイズ（GRAIN・LIGHT LEAKに使用）
function pseudoRandom2D(x, y) {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
function smoothNoise2D(x, y, scale) {
  const sx = x / scale, sy = y / scale;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const v00 = pseudoRandom2D(x0, y0);
  const v10 = pseudoRandom2D(x0+1, y0);
  const v01 = pseudoRandom2D(x0, y0+1);
  const v11 = pseudoRandom2D(x0+1, y0+1);
  const sfx = fx*fx*(3-2*fx);
  const sfy = fy*fy*(3-2*fy);
  const top = v00 + (v10 - v00) * sfx;
  const bottom = v01 + (v11 - v01) * sfx;
  return top + (bottom - top) * sfy;
}

function boxBlur(data, w, h, radius) {
  if (radius < 1) return data.slice();
  const r = Math.max(1, Math.round(radius));
  const temp = new Float32Array(data.length);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let sr=0, sg=0, sb=0, sa=0;
    for (let k = -r; k <= r; k++) {
      const sx = k < 0 ? 0 : (k >= w ? w - 1 : k);
      const i = row + sx*4;
      sr += data[i]; sg += data[i+1]; sb += data[i+2]; sa += data[i+3];
    }
    const count = 2*r + 1;
    temp[row] = sr/count; temp[row+1] = sg/count; temp[row+2] = sb/count; temp[row+3] = sa/count;
    for (let x = 1; x < w; x++) {
      const addX = (x+r) >= w ? w-1 : x+r;
      const remX = (x-1-r) < 0 ? 0 : x-1-r;
      const ai = row + addX*4, ri = row + remX*4;
      sr += data[ai] - data[ri]; sg += data[ai+1] - data[ri+1]; sb += data[ai+2] - data[ri+2]; sa += data[ai+3] - data[ri+3];
      const oi = row + x*4;
      temp[oi] = sr/count; temp[oi+1] = sg/count; temp[oi+2] = sb/count; temp[oi+3] = sa/count;
    }
  }
  for (let x = 0; x < w; x++) {
    let sr=0, sg=0, sb=0, sa=0;
    for (let k = -r; k <= r; k++) {
      const sy = k < 0 ? 0 : (k >= h ? h - 1 : k);
      const i = (sy*w+x)*4;
      sr += temp[i]; sg += temp[i+1]; sb += temp[i+2]; sa += temp[i+3];
    }
    const count = 2*r + 1;
    let oi = x*4;
    out[oi] = sr/count; out[oi+1] = sg/count; out[oi+2] = sb/count; out[oi+3] = sa/count;
    for (let y = 1; y < h; y++) {
      const addY = (y+r) >= h ? h-1 : y+r;
      const remY = (y-1-r) < 0 ? 0 : y-1-r;
      const ai = (addY*w+x)*4, ri = (remY*w+x)*4;
      sr += temp[ai] - temp[ri]; sg += temp[ai+1] - temp[ri+1]; sb += temp[ai+2] - temp[ri+2]; sa += temp[ai+3] - temp[ri+3];
      oi = (y*w+x)*4;
      out[oi] = sr/count; out[oi+1] = sg/count; out[oi+2] = sb/count; out[oi+3] = sa/count;
    }
  }
  return out;
}

function applyVelvetGlow(preview) {
  if (!originalImageData) return;

  const useData = (preview && previewImageData) ? previewImageData : originalImageData;
  const w = useData.width, h = useData.height;
  const radiusScale = preview ? (w / outputCanvas.width) : 1;

  const ccdColor = parseInt(ccdColorSlider.value) / 100;
  const apoSharp = parseInt(apoSharpSlider.value) / 100;
  const microContrast = parseInt(microContrastSlider.value) / 100;
  const glow = parseInt(glowSlider.value) / 100;
  const toneRolloff = parseInt(toneRolloffSlider.value) / 100;
  const crush = parseInt(crushSlider.value) / 100;
  const grain = parseInt(grainSlider.value) / 100;
  const colorTemp = (parseInt(colorTempSlider.value) - 50) / 50; // -1(寒色)〜0(中間)〜+1(暖色)
  const saturation = (parseInt(saturationSlider.value) - 50) / 50; // -1(彩度低)〜0〜+1(彩度高)
  const vignette = parseInt(vignetteSlider.value) / 100;
  const fieldBlur = parseInt(fieldBlurSlider.value) / 100;
  const softFocus = parseInt(softFocusSlider.value) / 100;
  const lightLeak = parseInt(lightLeakSlider.value) / 100;
  const mono = monochromeCheckbox.checked;

  const src = useData.data;
  let out = new Uint8ClampedArray(src.length);

  // ── STEP 1: CCD COLOR + TONE ROLLOFF（1パスの per-pixel 処理）
  const blackLift = toneRolloff * 14;
  const kneeStart = 0.78 - toneRolloff * 0.12; // ハイライトの粘りが始まる位置

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i+1], b = src[i+2];
    const avg = (r + g + b) / 3;

    // CCD Color：赤を深く鮮やかに、緑・青は控えめに。フィルムのような色の転び（静かな濃さを意識して控えめに）
    r = avg + (r - avg) * (1 + 0.55 * ccdColor);
    g = avg + (g - avg) * (1 + 0.2 * ccdColor);
    b = avg + (b - avg) * (1 + 0.1 * ccdColor);
    r = r * (1 + 0.04 * ccdColor);

    // TONE ROLLOFF：黒を持ち上げ、ハイライトはソフトニーで粘らせる
    r = blackLift + r * (1 - blackLift/255);
    g = blackLift + g * (1 - blackLift/255);
    b = blackLift + b * (1 - blackLift/255);
    const softKnee = (v) => {
      const t = v / 255;
      if (t <= kneeStart) return v;
      const excess = (t - kneeStart) / (1 - kneeStart);
      const compressed = kneeStart + (1 - kneeStart) * (1 - Math.pow(1 - excess, 1 + toneRolloff * 2.5));
      return compressed * 255;
    };
    r = softKnee(Math.max(0, Math.min(255, r)));
    g = softKnee(Math.max(0, Math.min(255, g)));
    b = softKnee(Math.max(0, Math.min(255, b)));

    out[i] = r; out[i+1] = g; out[i+2] = b; out[i+3] = src[i+3];
  }

  // ── STEP 1.5: CRUSH（TONE ROLLOFFと逆方向。黒を締め、ハイライトを硬くクリップする——GR的な硬さ）
  if (crush > 0.01) {
    const factor = 1 + crush * 3;
    for (let i = 0; i < out.length; i += 4) {
      out[i]   = Math.max(0, Math.min(255, 128 + (out[i]   - 128) * factor));
      out[i+1] = Math.max(0, Math.min(255, 128 + (out[i+1] - 128) * factor));
      out[i+2] = Math.max(0, Math.min(255, 128 + (out[i+2] - 128) * factor));
    }
  }

  // ── STEP 2: APO SHARPNESS（アンシャープマスク。緻密だが強調しすぎない）
  if (apoSharp > 0.01) {
    const blurred = boxBlur(out, w, h, 1.4 * Math.max(radiusScale, 0.35));
    const next = new Uint8ClampedArray(out.length);
    const amount = apoSharp * 1.1;
    for (let i = 0; i < out.length; i += 4) {
      next[i]   = out[i]   + (out[i]   - blurred[i])   * amount;
      next[i+1] = out[i+1] + (out[i+1] - blurred[i+1]) * amount;
      next[i+2] = out[i+2] + (out[i+2] - blurred[i+2]) * amount;
      next[i+3] = out[i+3];
    }
    out = next;
  }

  // ── STEP 3: MICRO CONTRAST（中間トーンの局所コントラスト。3Dポップ）
  if (microContrast > 0.01) {
    const blurRadius = 10 * Math.max(radiusScale, 0.35);
    const blurred = boxBlur(out, w, h, blurRadius);
    const next = new Uint8ClampedArray(out.length);
    const amount = microContrast * 0.9;
    for (let i = 0; i < out.length; i += 4) {
      const lum = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
      const midWeight = 1 - Math.abs(lum - 128) / 128; // 中間トーンほど強く効かせる
      const w2 = amount * Math.max(0, midWeight);
      next[i]   = out[i]   + (out[i]   - blurred[i])   * w2;
      next[i+1] = out[i+1] + (out[i+1] - blurred[i+1]) * w2;
      next[i+2] = out[i+2] + (out[i+2] - blurred[i+2]) * w2;
      next[i+3] = out[i+3];
    }
    out = next;
  }

  // ── STEP 4: GLOW（ハイライト抽出→ぼかし→スクリーン合成。賛否ある効果のため控えめ運用）
  if (glow > 0.01) {
    const threshold = 195;
    const highlights = new Uint8ClampedArray(out.length);
    for (let i = 0; i < out.length; i += 4) {
      const lum = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
      const amt = Math.max(0, lum - threshold) / (255 - threshold);
      highlights[i]   = out[i]   * amt;
      highlights[i+1] = out[i+1] * amt;
      highlights[i+2] = out[i+2] * amt;
      highlights[i+3] = 255;
    }
    const bloomRadius = 3 + glow * 14 * Math.max(radiusScale, 0.35);
    const bloomed = boxBlur(highlights, w, h, bloomRadius);
    const bloomStrength = glow * 0.6;
    for (let i = 0; i < out.length; i += 4) {
      out[i]   = 255 - (255 - out[i])   * (1 - (bloomed[i]/255)   * bloomStrength);
      out[i+1] = 255 - (255 - out[i+1]) * (1 - (bloomed[i+1]/255) * bloomStrength);
      out[i+2] = 255 - (255 - out[i+2]) * (1 - (bloomed[i+2]/255) * bloomStrength);
    }
  }

  // ── STEP 5: SOFT FOCUS（画面全体を軽くぼかしてブレンド。プラスチックレンズの柔らかさ）
  if (softFocus > 0.01) {
    const blurred = boxBlur(out, w, h, (2 + softFocus * 10) * Math.max(radiusScale, 0.35));
    const next = new Uint8ClampedArray(out.length);
    for (let i = 0; i < out.length; i += 4) {
      next[i]   = out[i]   * (1-softFocus*0.6) + blurred[i]   * (softFocus*0.6);
      next[i+1] = out[i+1] * (1-softFocus*0.6) + blurred[i+1] * (softFocus*0.6);
      next[i+2] = out[i+2] * (1-softFocus*0.6) + blurred[i+2] * (softFocus*0.6);
      next[i+3] = out[i+3];
    }
    out = next;
  }

  // ── STEP 6: COLOR TEMP + SATURATION（色温度と彩度。1パスのper-pixel処理）
  if (Math.abs(colorTemp) > 0.01 || Math.abs(saturation) > 0.01) {
    for (let i = 0; i < out.length; i += 4) {
      let r = out[i], g = out[i+1], b = out[i+2];
      // COLOR TEMP：暖色側で赤黄を、寒色側で青を持ち上げる
      if (colorTemp > 0) { r += colorTemp*22; g += colorTemp*8; b -= colorTemp*14; }
      else { b += -colorTemp*22; r += colorTemp*14; }
      // SATURATION：平均輝度からの距離を伸縮
      const avg = (r+g+b)/3;
      const satMul = 1 + saturation*0.5;
      r = avg + (r-avg)*satMul; g = avg + (g-avg)*satMul; b = avg + (b-avg)*satMul;
      out[i] = Math.max(0,Math.min(255,r)); out[i+1] = Math.max(0,Math.min(255,g)); out[i+2] = Math.max(0,Math.min(255,b));
    }
  }

  // ── STEP 7: GRAIN（CCD特有の粒状感。輝度ノイズ＋わずかな色ノイズ）
  if (grain > 0.01) {
    const seedOff = 4000;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y*w+x)*4;
        const n = (pseudoRandom2D(x+seedOff, y+seedOff) - 0.5) * 2;
        const lumNoise = n * grain * 24;
        const cn = (pseudoRandom2D(x-seedOff, y+seedOff) - 0.5) * 2;
        const chromaNoise = cn * grain * 8;
        out[i]   = out[i]   + lumNoise + chromaNoise;
        out[i+1] = out[i+1] + lumNoise;
        out[i+2] = out[i+2] + lumNoise - chromaNoise;
      }
    }
  }

  // ── STEP 8: VIGNETTE（周辺減光）
  if (vignette > 0.01) {
    const cx = w/2, cy = h/2, maxDist = Math.sqrt(cx*cx+cy*cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy)) / maxDist;
        const darken = 1 - Math.max(0, d - 0.35) * vignette * 1.3;
        const i = (y*w+x)*4;
        out[i] *= darken; out[i+1] *= darken; out[i+2] *= darken;
      }
    }
  }

  // ── STEP 8.5: FIELD BLUR（像面の滲み。ツァイス系レンズの、中心から周辺への滑らかな像面湾曲）
  //    VIGNETTE（暗くする）とは別軸——「暗くする」のではなく「ぼかす」ことでレンズの光学的な奥行きを再現する
  if (fieldBlur > 0.01) {
    const blurred = boxBlur(out, w, h, (2 + fieldBlur * 10) * Math.max(radiusScale, 0.35));
    const cx = w/2, cy = h/2, maxDist = Math.sqrt(cx*cx+cy*cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy)) / maxDist;
        const blend = Math.max(0, Math.min(1, (d - 0.25) * fieldBlur * 1.3));
        const i = (y*w+x)*4;
        out[i]   = out[i]   * (1-blend) + blurred[i]   * blend;
        out[i+1] = out[i+1] * (1-blend) + blurred[i+1] * blend;
        out[i+2] = out[i+2] * (1-blend) + blurred[i+2] * blend;
      }
    }
  }

  // ── STEP 9: LIGHT LEAK（角からの暖色フレア。主にHolga向け）
  if (lightLeak > 0.01) {
    const cx = w * 0.85, cy = h * 0.1, maxDist = Math.sqrt(w*w+h*h) * 0.6;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy)) / maxDist;
        const amt = Math.max(0, 1 - d) * lightLeak * 0.8;
        const i = (y*w+x)*4;
        out[i]   = out[i]   + amt*180;
        out[i+1] = out[i+1] + amt*70;
        out[i+2] = out[i+2] - amt*30;
      }
    }
  }

  if (mono) {
    for (let i = 0; i < out.length; i += 4) {
      const gray = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
      out[i] = out[i+1] = out[i+2] = gray;
    }
  }

  const resultData = new ImageData(out, w, h);

  if (preview && previewImageData) {
    let tempCanvas = applyVelvetGlow._tempCanvas;
    if (!tempCanvas) { tempCanvas = document.createElement('canvas'); applyVelvetGlow._tempCanvas = tempCanvas; }
    tempCanvas.width = w; tempCanvas.height = h;
    tempCanvas.getContext('2d').putImageData(resultData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tempCanvas, 0, 0, w, h, 0, 0, outputCanvas.width, outputCanvas.height);
  } else {
    ctx.putImageData(resultData, 0, 0);
    lastResultImageData = resultData; // COMPARE MODE用に保持
  }
}

// ── UIイベント
const allSliders = [ccdColorSlider, apoSharpSlider, microContrastSlider, glowSlider, toneRolloffSlider, crushSlider, grainSlider, colorTempSlider, saturationSlider, vignetteSlider, fieldBlurSlider, softFocusSlider, lightLeakSlider];
allSliders.forEach(slider => {
  slider.addEventListener('pointerdown', () => { isDragging = true; });
  slider.addEventListener('touchstart', () => { isDragging = true; }, { passive: true });
});
function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  requestApply();
}
allSliders.forEach(slider => {
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('touchend', endDrag);
  slider.addEventListener('change', endDrag);
});
window.addEventListener('pointerup', () => { if (isDragging) endDrag(); });
window.addEventListener('touchend', () => { if (isDragging) endDrag(); });

ccdColorSlider.addEventListener('input', () => { ccdColorVal.textContent = ccdColorSlider.value + '%'; requestApply(); });
apoSharpSlider.addEventListener('input', () => { apoSharpVal.textContent = apoSharpSlider.value + '%'; requestApply(); });
microContrastSlider.addEventListener('input', () => { microContrastVal.textContent = microContrastSlider.value + '%'; requestApply(); });
glowSlider.addEventListener('input', () => { glowVal.textContent = glowSlider.value + '%'; requestApply(); });
toneRolloffSlider.addEventListener('input', () => { toneRolloffVal.textContent = toneRolloffSlider.value + '%'; requestApply(); });
crushSlider.addEventListener('input', () => { crushVal.textContent = crushSlider.value + '%'; requestApply(); });
grainSlider.addEventListener('input', () => { grainVal.textContent = grainSlider.value + '%'; requestApply(); });
colorTempSlider.addEventListener('input', () => {
  const v = parseInt(colorTempSlider.value);
  colorTempVal.textContent = v === 50 ? '中間' : (v < 50 ? `寒色${50-v}` : `暖色${v-50}`);
  requestApply();
});
saturationSlider.addEventListener('input', () => {
  const v = parseInt(saturationSlider.value);
  saturationVal.textContent = v === 50 ? '中間' : (v < 50 ? `-${50-v}` : `+${v-50}`);
  requestApply();
});
vignetteSlider.addEventListener('input', () => { vignetteVal.textContent = vignetteSlider.value + '%'; requestApply(); });
fieldBlurSlider.addEventListener('input', () => { fieldBlurVal.textContent = fieldBlurSlider.value + '%'; requestApply(); });
softFocusSlider.addEventListener('input', () => { softFocusVal.textContent = softFocusSlider.value + '%'; requestApply(); });
lightLeakSlider.addEventListener('input', () => { lightLeakVal.textContent = lightLeakSlider.value + '%'; requestApply(); });
monochromeCheckbox.addEventListener('change', () => applyVelvetGlow());

// ── テーマ切り替え（Optical Glass / Brass × Leather）
const THEME_CLASS_MAP = { glass: null, nordic: 'theme-nordic' };
function applyTheme(themeKey) {
  if (!(themeKey in THEME_CLASS_MAP)) return;
  Object.values(THEME_CLASS_MAP).forEach(cls => { if (cls) document.body.classList.remove(cls); });
  const cls = THEME_CLASS_MAP[themeKey];
  if (cls) document.body.classList.add(cls);
  themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === themeKey));
  try { localStorage.setItem('velvetglow-theme', themeKey); } catch(e) {}
}
themeBtns.forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));
try {
  const saved = localStorage.getItem('velvetglow-theme');
  if (saved && (saved in THEME_CLASS_MAP)) applyTheme(saved);
} catch(e) {}

// ── 保存（iOS対応：オーバーレイ方式）
// ── CAMERA PATCH：10台のカメラの個性＋初期化
// sat/tempは50が中間（スライダーの生値）。それ以外は0-100のスライダー生値。
const CAMERA_PATCHES = {
  init:      { ccdColor:0,  apoSharp:0,  microContrast:0,  glow:0,  toneRolloff:0,  crush:0,  grain:0,  colorTemp:50, saturation:50, vignette:0,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // 初期化
  lvelvet:   { ccdColor:28, apoSharp:20, microContrast:45, glow:8,  toneRolloff:42, crush:5,  grain:4,  colorTemp:46, saturation:42, vignette:10, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Leica M8 v2：実写比較の結果を反映。edge sharpeningではなくMICRO CONTRASTを最大の個性に、GLOWとCRUSHを大幅に抑え、TONE ROLLOFFで黒とハイライトに余白を残す
  summiluxsoft: { ccdColor:5, apoSharp:8, microContrast:18, glow:22, toneRolloff:60, crush:0, grain:5, colorTemp:54, saturation:44, vignette:12, fieldBlur:15, softFocus:25, lightLeak:0, mono:false }, // Leica Summilux-M 50mm f/1.4 pre-ASPH：レンズの柔らかさが主役。TONE ROLLOFFを最大級に上げ、SOFT FOCUSとFIELD BLURで開放時の空気感を作りつつMICRO CONTRASTだけ芯として残す
  m9:        { ccdColor:42, apoSharp:18, microContrast:32, glow:6,  toneRolloff:20, crush:8,  grain:5,  colorTemp:53, saturation:45, vignette:10, fieldBlur:5,  softFocus:0,  lightLeak:0,  mono:false }, // Leica M9：フルサイズKodak CCDの濃密な色。M8より黒を締め（TONE ROLLOFF低め・CRUSHやや強め）、CCD COLORを高めて「濃い色+深い黒+滑らかな階調」というリッチな方向に
  fvelvet:   { ccdColor:30, apoSharp:5,  microContrast:8,  glow:15, toneRolloff:60, crush:0,  grain:0,  colorTemp:55, saturation:40, vignette:5,  fieldBlur:0,  softFocus:20, lightLeak:0,  mono:false }, // Fuji S5 Pro：実機は色こそX100と同じだが解像感は「等倍でぼやけた感」が本質。APO SHARPNESSを大幅に下げSOFT FOCUSで補強
  spresence: { ccdColor:40, apoSharp:70, microContrast:80, glow:0,  toneRolloff:5,  crush:15, grain:0,  colorTemp:50, saturation:65, vignette:0,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Sigma DP2 Merrill：Foveonは低ノイズが持ち味なので粒状感は0
  rsharp:    { ccdColor:25, apoSharp:65, microContrast:60, glow:5,  toneRolloff:0,  crush:55, grain:25, colorTemp:50, saturation:30, vignette:15, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:true  }, // Ricoh GR Digital：粒状感はGRの数少ない"本当に必要な"個性
  mmono:     { ccdColor:0,  apoSharp:35, microContrast:25, glow:10, toneRolloff:40, crush:0,  grain:0,  colorTemp:50, saturation:50, vignette:5,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:true  }, // Leica M Monochrom：カラーフィルターなしセンサーの、滑らかで階調豊かな白黒。R Sharpとは対極の穏やかさ
  trix:      { ccdColor:0,  apoSharp:15, microContrast:20, glow:10, toneRolloff:20, crush:15, grain:40, colorTemp:50, saturation:50, vignette:10, fieldBlur:0,  softFocus:5,  lightLeak:0,  mono:true  }, // Kodak Tri-X 400：報道写真の定番フィルム。有機的な粒子とほどよいコントラストが特徴
  gchrome:   { ccdColor:15, apoSharp:15, microContrast:10, glow:10, toneRolloff:35, crush:0,  grain:0,  colorTemp:32, saturation:30, vignette:10, fieldBlur:0,  softFocus:5,  lightLeak:0,  mono:false }, // Canon G3
  xfilm:     { ccdColor:30, apoSharp:45, microContrast:20, glow:20, toneRolloff:35, crush:0,  grain:0,  colorTemp:55, saturation:40, vignette:5,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Fuji X100：色はS5 Proと共通のまま、実機評「他社並みにシャープ」を反映しAPO SHARPNESSを引き上げ差別化
  ptdeep:    { ccdColor:22, apoSharp:28, microContrast:18, glow:5,  toneRolloff:10, crush:12, grain:0,  colorTemp:42, saturation:30, vignette:8,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Pentax K10D：再調査の結果「濃すぎない発色」「透明感」が本質と判明、コントラスト・彩度を大幅に控えめに修正
  czuiko:    { ccdColor:20, apoSharp:25, microContrast:20, glow:10, toneRolloff:20, crush:0,  grain:0,  colorTemp:35, saturation:45, vignette:10, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Olympus C-5050
  kmemory:   { ccdColor:60, apoSharp:20, microContrast:20, glow:15, toneRolloff:30, crush:0,  grain:0,  colorTemp:70, saturation:55, vignette:10, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Kodak P880
  hdream:    { ccdColor:20, apoSharp:0,  microContrast:5,  glow:20, toneRolloff:60, crush:0,  grain:30, colorTemp:58, saturation:35, vignette:70, fieldBlur:0,  softFocus:55, lightLeak:60, mono:false }, // Holga 120N：フィルム粒子は本質的な特徴なので維持
  dwarm:     { ccdColor:38, apoSharp:15, microContrast:12, glow:8,  toneRolloff:25, crush:0,  grain:0,  colorTemp:58, saturation:35, vignette:5,  fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Nikon D70：再調査の結果「落ち着いた」「しっとり」「シャドーも色情報が残る」が本質と判明。パンチではなく深さ重視に修正
  psonar:    { ccdColor:15, apoSharp:0,  microContrast:5,  glow:15, toneRolloff:55, crush:0,  grain:0,  colorTemp:65, saturation:30, vignette:45, fieldBlur:0,  softFocus:35, lightLeak:0,  mono:false }, // Polaroid SX-70：パステルな低彩度、Holgaとは違う穏やかな柔らかさ（光漏れは使わない）
  cnega:     { ccdColor:30, apoSharp:15, microContrast:15, glow:10, toneRolloff:45, crush:0,  grain:0,  colorTemp:55, saturation:40, vignette:5,  fieldBlur:0,  softFocus:10, lightLeak:0,  mono:false }, // Canon EOS 5D：アンダー気味で色のりが良い、しっとりしたフィルム的な階調
  swivel707: { ccdColor:25, apoSharp:20, microContrast:10, glow:15, toneRolloff:30, crush:0,  grain:0,  colorTemp:45, saturation:40, vignette:10, fieldBlur:0,  softFocus:5,  lightLeak:0,  mono:false }, // Sony DSC-F707：Y2Kデジカメの柔らかさ＋ツァイスレンズ
  zsonnar:   { ccdColor:20, apoSharp:45, microContrast:30, glow:5,  toneRolloff:20, crush:5,  grain:0,  colorTemp:48, saturation:45, vignette:0,  fieldBlur:20, softFocus:0,  lightLeak:0,  mono:false }, // Sony DSC-R1：大判CMOS×ツァイスの、空気感まで写す解像感。像面の滑らかさにFIELD BLURを軽く
  k14n:      { ccdColor:75, apoSharp:25, microContrast:25, glow:10, toneRolloff:15, crush:20, grain:25, colorTemp:68, saturation:65, vignette:10, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Kodak DCS Pro 14n：ノイズ・粒状感は賛否ある本物の個性なので維持
  p67film:   { ccdColor:25, apoSharp:10, microContrast:10, glow:15, toneRolloff:55, crush:0,  grain:20, colorTemp:55, saturation:35, vignette:25, fieldBlur:0,  softFocus:15, lightLeak:0,  mono:false }, // PENTAX 6x7：中判フィルムの粒状感は本質的な特徴なので維持
  rd1retro:  { ccdColor:28, apoSharp:30, microContrast:25, glow:15, toneRolloff:25, crush:10, grain:0,  colorTemp:45, saturation:36, vignette:10, fieldBlur:0,  softFocus:0,  lightLeak:0,  mono:false }, // Epson R-D1：飾らない実直な発色。静かさを意識し彩度控えめに調整
  g2zeiss:   { ccdColor:20, apoSharp:35, microContrast:20, glow:10, toneRolloff:30, crush:5,  grain:0,  colorTemp:50, saturation:38, vignette:10, fieldBlur:35, softFocus:0,  lightLeak:0,  mono:false }, // Contax G2：静かさを意識し彩度控えめに調整。像面湾曲はFIELD BLURで再現
  nrare:     { ccdColor:55, apoSharp:25, microContrast:20, glow:10, toneRolloff:20, crush:15, grain:0,  colorTemp:40, saturation:55, vignette:15, fieldBlur:15, softFocus:0,  lightLeak:0,  mono:false }, // Contax N Digital：世界初フルサイズCCD一眼の、独特の色転びと希少機らしい癖
};

function setSlider(slider, valEl, value, formatter) {
  slider.value = value;
  valEl.textContent = formatter ? formatter(value) : value + '%';
}

patchBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const p = CAMERA_PATCHES[btn.dataset.patch];
    if (!p) return;
    const compareOn = compareModeCheckbox.checked;
    const beforeSnapshot = lastResultImageData; // 切り替え前の画像を先に確保しておく

    setSlider(ccdColorSlider, ccdColorVal, p.ccdColor);
    setSlider(apoSharpSlider, apoSharpVal, p.apoSharp);
    setSlider(microContrastSlider, microContrastVal, p.microContrast);
    setSlider(glowSlider, glowVal, p.glow);
    setSlider(toneRolloffSlider, toneRolloffVal, p.toneRolloff);
    setSlider(crushSlider, crushVal, p.crush);
    setSlider(grainSlider, grainVal, p.grain);
    setSlider(colorTempSlider, colorTempVal, p.colorTemp, v => v===50?'中間':(v<50?`寒色${50-v}`:`暖色${v-50}`));
    setSlider(saturationSlider, saturationVal, p.saturation, v => v===50?'中間':(v<50?`-${50-v}`:`+${v-50}`));
    setSlider(vignetteSlider, vignetteVal, p.vignette);
    setSlider(fieldBlurSlider, fieldBlurVal, p.fieldBlur || 0);
    setSlider(softFocusSlider, softFocusVal, p.softFocus);
    setSlider(lightLeakSlider, lightLeakVal, p.lightLeak);
    monochromeCheckbox.checked = p.mono;
    patchBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (driftRAF) { cancelAnimationFrame(driftRAF); driftRAF = null; }
    // 連打対策：前のパッチ切り替えで予約された比較タイマーが残っていたら打ち消す
    if (compareTimeout1) { clearTimeout(compareTimeout1); compareTimeout1 = null; }
    if (compareTimeout2) { clearTimeout(compareTimeout2); compareTimeout2 = null; }
    canvasBadge.textContent = '処理中… PROCESSING';
    canvasBadge.style.display = 'block';
    setTimeout(() => {
      applyVelvetGlow(false); // 新しいパッチをフル解像度で描画（lastResultImageDataもここで更新される）
      canvasBadge.textContent = 'PREVIEW';

      const canCompare = compareOn && beforeSnapshot &&
        beforeSnapshot.width === outputCanvas.width && beforeSnapshot.height === outputCanvas.height;
      if (canCompare) {
        canvasBadge.textContent = 'AFTER（新）';
        compareTimeout1 = setTimeout(() => {
          ctx.putImageData(beforeSnapshot, 0, 0);
          canvasBadge.textContent = 'BEFORE（前）';
          compareTimeout2 = setTimeout(() => {
            if (lastResultImageData) ctx.putImageData(lastResultImageData, 0, 0);
            canvasBadge.textContent = 'PREVIEW';
            compareTimeout2 = null;
          }, 2000);
          compareTimeout1 = null;
        }, 2000);
      }
    }, 10);
  });
});

downloadBtn.addEventListener('click', () => {
  try {
    const dataUrl = outputCanvas.toDataURL('image/png');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
      showSaveOverlay(dataUrl);
    } else {
      const link = document.createElement('a');
      link.download = 'velvet-glow.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('PNG保存に失敗しました:', err);
    alert('画像の保存に失敗しました。ブラウザを再読み込みしてもう一度お試しください。');
  }
});

function showSaveOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position: fixed; inset: 0; z-index: 9999; background: rgba(10,10,10,0.96);
    display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;`;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'max-width: 100%; max-height: 75vh; border-radius: 2px;';
  const hint = document.createElement('p');
  hint.innerHTML = '画像を長押しして「写真に保存」を選んでください<br><span style="color:#888; font-size:11px;">Press and hold the image, then tap "Save to Photos"</span>';
  hint.style.cssText = 'color: #ccc; font-family: sans-serif; font-size: 13px; margin-top: 16px; text-align: center; line-height: 1.6;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる / Close';
  closeBtn.style.cssText = `margin-top: 20px; padding: 10px 24px; background: transparent; color: white; border: 1px solid #666; border-radius: 2px; font-family: sans-serif; font-size: 13px; cursor: pointer;`;
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(img); overlay.appendChild(hint); overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}

resetBtn.addEventListener('click', () => {
  originalImage = null;
  originalImageData = null;
  outputCanvas.style.display = 'none';
  canvasBadge.style.display = 'none';
  dropZone.style.display = 'flex';
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  fileInput.value = '';
});
