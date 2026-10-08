// ============================================================
// 더조커 홍대점 · 머더미스터리 찾기
// 구글 시트를 "웹에 게시(CSV)"한 링크를 SHEET_CSV_URL 에 넣으면
// 시트를 수정할 때마다 이 사이트도 자동으로 최신 데이터를 보여줍니다.
// ============================================================

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0dEkjYRjPcSW2-j2ym-8DlT7tj0zFmueOaADZgRHx0-Ec5TXpp95RD3eQ9bVfFUYcOM-DocRKMru0/pub?gid=0&single=true&output=csv";

// 위 링크가 비어있거나 채워지지 않았다면 같은 폴더의 data.csv(샘플)로 미리보기합니다.
const DATA_SOURCE = (!SHEET_CSV_URL || SHEET_CSV_URL.includes("PASTE_YOUR")) ? "data.csv" : SHEET_CSV_URL;

// 시트의 열 이름이 다르면 이 배열에 후보를 추가하세요. (헤더 텍스트 "포함" 여부로 매칭)
const COLUMN_ALIASES = {
  name: ["이름", "제목", "머더미스터리"],
  players: ["플레이인원", "인원수", "인원"],
  comment: ["알바생코멘트", "코멘트", "코멘트/평"],
  theme: ["테마", "장르"],
  image: ["사진링크", "사진", "이미지", "이미지링크"],
  playtime: ["플레이타임", "소요시간", "런타임"],
};

let ALL_GAMES = [];
let DATA_MIN = 1;
let DATA_MAX = 9;
let PT_MIN = 10;
let PT_MAX = 180;

const state = {
  search: "",
  min: 1,
  max: 9,
  commentOnly: false,
  theme: "",
  playtimeActive: false,
  ptMin: 60,
  ptMax: 60,
};

function findColumn(headers, aliasKey) {
  const aliases = COLUMN_ALIASES[aliasKey];
  return headers.find((h) => aliases.some((a) => h.replace(/\s/g, "").includes(a)));
}

function parsePlayerRange(raw) {
  if (!raw) return { min: null, max: null };
  const cleaned = raw.replace(/인용|명/g, "").trim();
  const parts = cleaned.split(/[~\-]/).map((n) => parseInt(n.trim(), 10));
  if (parts.length === 1 && !isNaN(parts[0])) return { min: parts[0], max: parts[0] };
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { min: parts[0], max: parts[1] };
  }
  return { min: null, max: null };
}

function parseComment(raw) {
  if (!raw || !raw.trim()) return { rating: null, text: "" };
  // 지원 형식: "4.3" / "4.3 / 5" / "3.0 텍스트" / "4.5 / 5 | 텍스트"
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*5)?\s*\|?\s*(.*)$/);
  if (match) {
    return { rating: match[1], text: match[2].replace(/^[,\s]+/, "") };
  }
  return { rating: null, text: raw.trim() };
}

function toDirectImageUrl(raw, size) {
  if (!raw || !raw.trim()) return "";
  const url = raw.trim();
  // 구글드라이브 공유 링크(.../file/d/ID/view 또는 ?id=ID)를
  // 구글이 임베딩용으로 제공하는 썸네일 엔드포인트로 변환 (uc?export=view 방식보다 안정적)
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size || 800}`;
  }
  return url; // 드라이브가 아닌 다른 직접 이미지 링크는 그대로 사용
}

function parsePlaytime(raw) {
  if (!raw || !raw.trim()) return "";
  const n = parseInt(raw.trim(), 10);
  if (isNaN(n)) return "";
  return `${n}`; // 분 단위 정수
}

function loadData() {
  Papa.parse(DATA_SOURCE, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      try {
        const headers = results.meta.fields;
        const nameCol = findColumn(headers, "name");
        const playersCol = findColumn(headers, "players");
        const commentCol = findColumn(headers, "comment");
        const themeCol = findColumn(headers, "theme");
        const imageCol = findColumn(headers, "image");
        const playtimeCol = findColumn(headers, "playtime");

        if (!nameCol || !playersCol) {
          showError("이름 또는 인원 수 열을 찾지 못했습니다. 시트 헤더를 확인해주세요.");
          return;
        }

        ALL_GAMES = results.data
          .filter((row) => row[nameCol] && row[nameCol].trim())
          .map((row) => {
            const range = parsePlayerRange(row[playersCol]);
            const comment = parseComment(commentCol ? row[commentCol] : "");
            return {
              name: row[nameCol].trim(),
              playersLabel: (row[playersCol] || "").trim(),
              playerMin: range.min,
              playerMax: range.max,
              theme: themeCol ? (row[themeCol] || "").trim() : "",
              image: imageCol ? toDirectImageUrl(row[imageCol], 500) : "",
              imageLarge: imageCol ? toDirectImageUrl(row[imageCol], 1600) : "",
              playtime: playtimeCol ? parsePlaytime(row[playtimeCol]) : "",
              rating: comment.rating,
              commentText: comment.text,
            };
          })
          .filter((g) => g.playerMin !== null)
          .sort((a, b) => a.playerMin - b.playerMin || a.name.localeCompare(b.name, "ko"));

        DATA_MIN = Math.min(...ALL_GAMES.map((g) => g.playerMin));
        DATA_MAX = Math.max(...ALL_GAMES.map((g) => g.playerMax));
        state.min = DATA_MIN;
        state.max = DATA_MAX;

        document.getElementById("brand-count").textContent = `머더미스터리 ${ALL_GAMES.length}작`;

        setupThemeFilter(themeCol);
        setupPlaytimeFilter();
        bindEvents();
        updateRangeUI();
        updatePlaytimeUI();
        render();
        document.getElementById("loading-state").hidden = true;
      } catch (e) {
        console.error(e);
        showError("데이터를 정리하는 중 문제가 발생했습니다.");
      }
    },
    error: () => {
      showError("시트를 불러오지 못했습니다. 공개 링크인지 확인해주세요.");
    },
  });
}

function setupThemeFilter(themeCol) {
  if (!themeCol) return;
  const themes = [...new Set(ALL_GAMES.map((g) => g.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  if (themes.length === 0) return;

  const field = document.getElementById("theme-field");
  const select = document.getElementById("theme-select");
  themes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });
  field.hidden = false;
  select.addEventListener("change", (e) => {
    state.theme = e.target.value;
    render();
  });
}

function setupPlaytimeFilter() {
  const values = ALL_GAMES
    .map((g) => parseInt(g.playtime, 10))
    .filter((n) => !isNaN(n));

  if (values.length === 0) return; // 플레이타임 데이터가 하나도 없으면 필터 자체를 숨김

  PT_MIN = 60;
  PT_MAX = 300;
  state.ptMin = 60;
  state.ptMax = 90;

  document.getElementById("playtime-toggle").hidden = false;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function formatHours(n) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function updateRangeUI() {
  document.getElementById("min-value").textContent = state.min;
  document.getElementById("max-value").textContent = state.max;
  document.getElementById("range-value").textContent =
    state.min === state.max ? `${state.min}명` : `${state.min}–${state.max}명`;

  document.getElementById("min-down").disabled = state.min <= DATA_MIN;
  document.getElementById("min-up").disabled = state.min >= state.max;
  document.getElementById("max-down").disabled = state.max <= state.min;
  document.getElementById("max-up").disabled = state.max >= DATA_MAX;
}

function updatePlaytimeUI() {
  document.getElementById("pt-min-value").textContent = `${state.ptMin}분`;
  document.getElementById("pt-max-value").textContent = `${state.ptMax}분`;
  document.getElementById("playtime-range-value").textContent =
    state.ptMin === state.ptMax ? `${state.ptMin}분` : `${state.ptMin}–${state.ptMax}분`;

  document.querySelectorAll('[data-pt-side="min"]').forEach((btn) => {
    const delta = parseInt(btn.dataset.ptDelta, 10);
    btn.disabled = delta < 0 ? state.ptMin <= PT_MIN : state.ptMin >= state.ptMax;
  });
  document.querySelectorAll('[data-pt-side="max"]').forEach((btn) => {
    const delta = parseInt(btn.dataset.ptDelta, 10);
    btn.disabled = delta < 0 ? state.ptMax <= state.ptMin : state.ptMax >= PT_MAX;
  });
}

function bindEvents() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById("min-down").addEventListener("click", () => {
    state.min = clamp(state.min - 1, DATA_MIN, state.max);
    updateRangeUI();
    render();
  });
  document.getElementById("min-up").addEventListener("click", () => {
    state.min = clamp(state.min + 1, DATA_MIN, state.max);
    updateRangeUI();
    render();
  });
  document.getElementById("max-down").addEventListener("click", () => {
    state.max = clamp(state.max - 1, state.min, DATA_MAX);
    updateRangeUI();
    render();
  });
  document.getElementById("max-up").addEventListener("click", () => {
    state.max = clamp(state.max + 1, state.min, DATA_MAX);
    updateRangeUI();
    render();
  });

  document.getElementById("comment-toggle").addEventListener("click", (e) => {
    state.commentOnly = !state.commentOnly;
    e.target.classList.toggle("active", state.commentOnly);
    render();
  });

  document.getElementById("playtime-toggle").addEventListener("click", (e) => {
    state.playtimeActive = !state.playtimeActive;
    e.target.classList.toggle("active", state.playtimeActive);
    document.getElementById("playtime-panel").hidden = !state.playtimeActive;
    render();
  });

  document.getElementById("playtime-panel").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-pt-side]");
    if (!btn) return;
    const side = btn.dataset.ptSide;
    const delta = parseInt(btn.dataset.ptDelta, 10);
    if (side === "min") {
      state.ptMin = clamp(state.ptMin + delta, PT_MIN, state.ptMax);
    } else {
      state.ptMax = clamp(state.ptMax + delta, state.ptMin, PT_MAX);
    }
    updatePlaytimeUI();
    render();
  });
}

function render() {
  const filtered = ALL_GAMES.filter((g) => {
    if (state.search && !g.name.toLowerCase().includes(state.search)) return false;
    if (g.playerMax < state.min || g.playerMin > state.max) return false;
    if (state.commentOnly && !(g.commentText || g.rating)) return false;
    if (state.theme && g.theme !== state.theme) return false;
    if (state.playtimeActive) {
      const pt = parseFloat(g.playtime);
      if (isNaN(pt) || pt < state.ptMin || pt > state.ptMax) return false;
    }
    return true;
  });

  const list = document.getElementById("case-list");
  list.innerHTML = "";

  filtered.forEach((g) => {
    const row = document.createElement("article");
    row.className = "case-row";

    const thumbHtml = g.image
      ? `<img src="${escapeHtml(g.image)}" alt="${escapeHtml(g.name)}" loading="lazy"
           data-full="${escapeHtml(g.imageLarge || g.image)}"
           onerror="this.parentElement.classList.add('thumb--empty'); this.remove();">`
      : "";

    row.innerHTML = `
      <div class="thumb${g.image ? "" : " thumb--empty"}">
        ${thumbHtml}
      </div>
      <div class="info">
        <div class="name">${escapeHtml(g.name)}</div>
        <div class="meta-row">
          <span class="players-tag">${escapeHtml(g.playersLabel)}인용</span>
          ${g.playtime ? `<span class="playtime-tag">⏱ ${escapeHtml(g.playtime)}분</span>` : ""}
          ${g.theme ? `<span class="theme-tag">${escapeHtml(g.theme)}</span>` : ""}
        </div>
        ${
          g.commentText || g.rating
            ? `<div class="comment">
                <span class="star">★</span>
                <span class="comment-text">${g.rating ? `<span class="rating">${escapeHtml(g.rating)}</span> ` : ""}${escapeHtml(g.commentText)}</span>
              </div>`
            : ""
        }
      </div>
    `;
    list.appendChild(row);
  });

  document.getElementById("result-count").textContent = `${filtered.length}작`;
  document.getElementById("empty-state").hidden = filtered.length !== 0;
}

function showError(msg) {
  const el = document.getElementById("error-state");
  el.textContent = msg;
  el.hidden = false;
  document.getElementById("loading-state").hidden = true;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setupLightbox() {
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");

  document.getElementById("case-list").addEventListener("click", (e) => {
    const img = e.target.closest(".thumb img");
    if (!img) return;
    lightboxImg.src = img.dataset.full || img.src;
    lightboxImg.alt = img.alt;
    lightbox.hidden = false;
  });

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
  }

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });
}

loadData();
setupLightbox();
