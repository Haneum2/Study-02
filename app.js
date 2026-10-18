/*
 * 구조
 * - 상태: state 객체 하나가 유일한 데이터 원본
 *   (todos, filter, lastCategory, autoClassify, keywords, theme, editingId)
 * - 저장: load() / save()만 localStorage에 접근한다 (키 "todo-app:v1")
 * - 변경 함수: addTodo, toggleTodo, deleteTodo, updateTodo, startEdit, cancelEdit,
 *   setFilter, setAutoClassify, setKeywords, setTheme, importData, clearDone — 모두 상태 변경 -> save() -> render() 순서
 * - 렌더링: render()가 state를 읽어 진행률, 필터 탭, 목록을 통째로 다시 그린다
 * - 내보내기: exportJson()은 상태를 바꾸지 않고 JSON 파일만 내려받게 한다
 * - 불러오기: parseImport()로 파일을 검사한 뒤 importData()가 현재 목록을 통째로 바꾼다
 * - 이벤트: #todo-list 하나에 위임, 폼 submit, 필터 탭, 완료 항목 비우기, 단축키 "/"
 */
const STORAGE_KEY = "todo-app:v1";
const BACKUP_KEY = "todo-app:v1:backup";
const MAX_TITLE = 100;
const CATEGORY_LABELS = { work: "업무", personal: "개인", study: "공부" };
const FILTER_LABELS = { all: "전체", ...CATEGORY_LABELS };

// 자동 분류용 키워드. 제목에 포함된 키워드 수가 가장 많은 카테고리를 고른다.
// ponytail: 단순 부분 문자열 비교라 "책상"도 "책"으로 잡힌다. 오분류가 잦으면 단어 경계 비교로 바꾼다.
// 기본값이다. 사용자가 [분류 설정]에서 바꾼 키워드는 state.keywords에 저장된다.
const DEFAULT_KEYWORDS = {
  work: ["회의", "미팅", "보고", "보고서", "업무", "출근", "프로젝트", "기획", "메일", "이메일", "고객", "거래처", "발표", "결재", "마감", "팀장", "회사", "출장"],
  personal: ["장보기", "마트", "병원", "운동", "헬스", "청소", "빨래", "약속", "친구", "가족", "생일", "여행", "은행", "택배", "산책", "요리", "쇼핑", "예약"],
  study: ["공부", "복습", "예습", "강의", "인강", "과제", "시험", "독서", "책", "단어", "영어", "자격증", "문제", "수업", "학습", "코딩", "알고리즘", "논문"],
};

function classify(title) {
  const text = title.toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const [category, words] of Object.entries(state.keywords)) {
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits > bestHits) {
      best = category;
      bestHits = hits;
    }
  }
  return best;
}

// editingId는 화면 상태라서 save()에서 저장하지 않는다.
const state = {
  todos: [],
  filter: "all",
  lastCategory: "work",
  autoClassify: true,
  keywords: structuredClone(DEFAULT_KEYWORDS),
  theme: null, // null이면 운영체제 설정을 따른다
  editingId: null,
};

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const categorySelect = document.getElementById("todo-category");
const list = document.getElementById("todo-list");
const saveError = document.getElementById("save-error");
const clearDoneBtn = document.getElementById("clear-done");
const filters = document.getElementById("filters");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const autoClassifyBtn = document.getElementById("auto-classify");
const classifyDialog = document.getElementById("classify-dialog");
const classifyForm = document.getElementById("classify-form");
const themeBtn = document.getElementById("theme-toggle");
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

// 저장소나 불러온 파일에서 읽은 할 일 목록을 검사한다.
// 형식이 틀린 항목과 id가 겹치는 항목은 버린다.
function cleanTodos(items) {
  const seen = new Set();
  const todos = [];
  for (const t of items) {
    if (!t || typeof t.id !== "string" || typeof t.title !== "string" || seen.has(t.id)) continue;
    const title = t.title.trim().slice(0, MAX_TITLE);
    if (!title || !Object.hasOwn(CATEGORY_LABELS, t.category)) continue;
    const done = t.done === true;
    seen.add(t.id);
    todos.push({
      id: t.id,
      title,
      category: t.category,
      done,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      completedAt: done && Number.isFinite(t.completedAt) ? t.completedAt : null,
    });
  }
  return todos;
}

// 카테고리별 키워드 배열을 검사한다. 없거나 틀린 카테고리는 base 값을 그대로 쓴다.
function cleanKeywords(raw, base) {
  const keywords = structuredClone(base);
  if (!raw || typeof raw !== "object") return keywords;
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const words = raw[category];
    if (Array.isArray(words)) keywords[category] = words.filter((w) => typeof w === "string" && w);
  }
  return keywords;
}

function load() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return; // 저장소 접근 불가: 빈 목록으로 시작
  }
  if (raw === null) return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    try {
      localStorage.setItem(BACKUP_KEY, raw);
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    return;
  }

  if (!data || !Array.isArray(data.todos)) return;
  state.todos = cleanTodos(data.todos);
  if (data.filter in FILTER_LABELS) state.filter = data.filter;
  if (data.lastCategory in CATEGORY_LABELS) state.lastCategory = data.lastCategory;
  if (typeof data.autoClassify === "boolean") state.autoClassify = data.autoClassify;
  if (data.theme === "light" || data.theme === "dark") state.theme = data.theme;
  state.keywords = cleanKeywords(data.keywords, state.keywords);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      filter: state.filter,
      lastCategory: state.lastCategory,
      autoClassify: state.autoClassify,
      keywords: state.keywords,
      theme: state.theme,
      todos: state.todos,
    }));
    saveError.hidden = true;
  } catch {
    saveError.hidden = false;
  }
}

function button(className, text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  return btn;
}

function createItem(todo) {
  const li = document.createElement("li");
  li.className = "todo-item" + (todo.done ? " done" : "");
  li.dataset.id = todo.id;
  li.dataset.category = todo.category;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "todo-check";
  check.checked = todo.done;
  check.setAttribute("aria-label", `완료: ${todo.title}`);

  const title = document.createElement("span");
  title.className = "todo-title";
  title.textContent = todo.title;

  const label = document.createElement("span");
  label.className = "cat-label";
  label.dataset.category = todo.category;
  label.textContent = CATEGORY_LABELS[todo.category] || todo.category;

  const editBtn = button("edit-btn", "수정");
  editBtn.setAttribute("aria-label", `수정: ${todo.title}`);
  const deleteBtn = button("delete-btn", "삭제");
  deleteBtn.setAttribute("aria-label", `삭제: ${todo.title}`);

  li.append(check, title, label, editBtn, deleteBtn);
  return li;
}

function createEditItem(todo) {
  const li = document.createElement("li");
  li.className = "todo-item editing";
  li.dataset.id = todo.id;
  li.dataset.category = todo.category;

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "edit-input";
  titleInput.maxLength = MAX_TITLE;
  titleInput.value = todo.title;
  titleInput.setAttribute("aria-label", "제목 수정");

  const select = document.createElement("select");
  select.className = "edit-category";
  select.setAttribute("aria-label", "카테고리 수정");
  for (const [value, text] of Object.entries(CATEGORY_LABELS)) {
    select.add(new Option(text, value, false, value === todo.category));
  }

  li.append(titleInput, select, button("save-btn", "저장"), button("cancel-btn", "취소"));
  return li;
}

function renderProgress() {
  // 진행률은 필터와 무관하게 전체 todos 기준
  const total = state.todos.length;
  const done = state.todos.filter((t) => t.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  progressBar.max = total || 1;
  progressBar.value = done;
  progressText.textContent = `완료 ${done} / 전체 ${total} (${percent}%)`;
  clearDoneBtn.disabled = done === 0;

  for (const category of Object.keys(CATEGORY_LABELS)) {
    const items = state.todos.filter((t) => t.category === category);
    const catDone = items.filter((t) => t.done).length;
    document.getElementById(`stat-${category}`).textContent = `${catDone}/${items.length}`;
  }
}

function renderFilters() {
  for (const btn of filters.querySelectorAll(".filter-btn")) {
    const filter = btn.dataset.filter;
    const remaining = state.todos.filter((t) => !t.done && (filter === "all" || t.category === filter)).length;
    const selected = filter === state.filter;
    btn.textContent = `${FILTER_LABELS[filter]} ${remaining}`;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
  }
  autoClassifyBtn.textContent = `자동 재분류 ${state.autoClassify ? "켜짐" : "꺼짐"}`;
  autoClassifyBtn.setAttribute("aria-pressed", String(state.autoClassify));
}

// 목록을 다시 그리기 전에 포커스가 어느 항목의 어느 컨트롤에 있었는지 기억한다.
function rememberFocus() {
  const el = document.activeElement;
  if (el === clearDoneBtn) return { clearDone: true };
  const li = el && el.closest("#todo-list li[data-id]");
  if (!li) return null;
  return { id: li.dataset.id, cls: el.classList[0], index: [...list.children].indexOf(li) };
}

function restoreFocus(saved) {
  if (saved?.clearDone) {
    // 비우기 후 버튼이 비활성화되면 포커스가 사라지므로 입력창으로 옮긴다
    if (clearDoneBtn.disabled) input.focus();
  } else if (saved) {
    // 같은 항목(삭제됐으면 같은 자리의 항목)의 같은 컨트롤, 없으면 편집창/수정 버튼, 그것도 없으면 입력창
    const li = [...list.children].find((el) => el.dataset.id === saved.id)
      || list.children[Math.min(saved.index, list.children.length - 1)];
    const target = li && (li.querySelector(`.${saved.cls}`) || li.querySelector(".edit-input, .edit-btn"));
    (target || input).focus();
  } else if (document.activeElement === document.body) {
    // 제목 더블클릭으로 편집을 시작한 경우
    list.querySelector(".edit-input")?.focus();
  }
}

function currentTheme() {
  return state.theme || (darkQuery.matches ? "dark" : "light");
}

function renderTheme() {
  const dark = currentTheme() === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeBtn.textContent = dark ? "라이트 모드" : "다크 모드";
  themeBtn.setAttribute("aria-pressed", String(dark));
}

function render() {
  const focus = rememberFocus();
  renderTheme();
  renderProgress();
  renderFilters();

  const visible = state.todos.filter((t) => state.filter === "all" || t.category === state.filter);
  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = state.todos.length === 0
      ? "할 일이 없습니다. 위에서 추가해 보세요."
      : "이 카테고리에는 할 일이 없습니다.";
    list.replaceChildren(empty);
  } else {
    const sorted = visible.sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
    list.replaceChildren(...sorted.map((t) => (t.id === state.editingId ? createEditItem(t) : createItem(t))));
  }
  restoreFocus(focus);
}

function findTodo(id) {
  return state.todos.find((t) => t.id === id);
}

function addTodo(title, category) {
  title = title.trim().slice(0, MAX_TITLE);
  if (!title) return;
  if (!(category in CATEGORY_LABELS)) category = "work";

  state.todos.push({
    id: crypto.randomUUID(),
    title,
    category,
    done: false,
    createdAt: Date.now(),
    completedAt: null,
  });
  state.lastCategory = category;
  save();
  render();
}

function toggleTodo(id) {
  const todo = findTodo(id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.completedAt = todo.done ? Date.now() : null;
  save();
  render();
}

function deleteTodo(id) {
  if (!confirm("이 할 일을 삭제할까요?")) return;
  state.todos = state.todos.filter((t) => t.id !== id);
  if (state.editingId === id) state.editingId = null;
  save();
  render();
}

function updateTodo(id, { title, category }) {
  const todo = findTodo(id);
  if (!todo) return;
  title = title.trim().slice(0, MAX_TITLE);
  if (title) todo.title = title;
  if (category in CATEGORY_LABELS) todo.category = category;
  state.editingId = null;
  save();
  render();
}

function startEdit(id) {
  state.editingId = id;
  save();
  render();
}

function cancelEdit() {
  state.editingId = null;
  save();
  render();
}

function setFilter(filter) {
  if (!(filter in FILTER_LABELS)) return;
  state.filter = filter;
  save();
  render();
}

function setAutoClassify(on) {
  state.autoClassify = on;
  save();
  render();
}

function setKeywords(keywords) {
  state.keywords = keywords;
  save();
  render();
}

function setTheme(theme) {
  state.theme = theme;
  save();
  render();
}

// 할 일과 분류 키워드를 JSON 파일로 내려받는다. 파일 이름은 todos-YYYY-MM-DD.json
function exportJson() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    todos: state.todos,
    keywords: state.keywords,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `todos-${new Date().toLocaleDateString("sv")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 내보내기 파일(JSON 문자열)을 검사한다. 쓸 수 없는 파일이면 Error를 던진다.
function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식이 아닙니다.");
  }
  if (!data || !Array.isArray(data.todos)) throw new Error("할 일 목록(todos)이 없습니다.");
  const todos = cleanTodos(data.todos);
  return {
    todos,
    keywords: cleanKeywords(data.keywords, state.keywords),
    skipped: data.todos.length - todos.length,
  };
}

function importData({ todos, keywords }) {
  state.todos = todos;
  state.keywords = keywords;
  state.editingId = null;
  save();
  render();
}

// "회의, 미팅\n보고" -> ["회의", "미팅", "보고"] (공백 제거, 빈 값과 중복 제거)
function parseKeywords(text) {
  return [...new Set(text.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean))];
}

function clearDone() {
  if (!state.todos.some((t) => t.done)) return;
  if (!confirm("완료한 할 일을 모두 삭제할까요?")) return;
  state.todos = state.todos.filter((t) => !t.done);
  save();
  render();
}

function commitEdit(li) {
  updateTodo(li.dataset.id, {
    title: li.querySelector(".edit-input").value,
    category: li.querySelector(".edit-category").value,
  });
}

// 이벤트 위임: #todo-list 하나에서 모든 항목 동작을 처리한다.
list.addEventListener("change", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li && e.target.matches(".todo-check")) toggleTodo(li.dataset.id);
});

list.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.matches(".edit-btn")) startEdit(id);
  else if (e.target.matches(".delete-btn")) deleteTodo(id);
  else if (e.target.matches(".save-btn")) commitEdit(li);
  else if (e.target.matches(".cancel-btn")) cancelEdit();
});

list.addEventListener("dblclick", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li && e.target.matches(".todo-title")) startEdit(li.dataset.id);
});

list.addEventListener("keydown", (e) => {
  const li = e.target.closest("li.editing");
  if (!li) return;
  // 한글 조합 중 Enter 무시. keyCode 229는 조합 종료 직후 Safari가 보내는 값.
  if (e.isComposing || e.keyCode === 229) return;
  // Enter는 입력창과 select에서만 저장. 저장/취소 버튼의 Enter는 각자 click으로 처리된다.
  if (e.key === "Enter" && e.target.matches(".edit-input, .edit-category")) {
    e.preventDefault();
    commitEdit(li);
  } else if (e.key === "Escape") {
    cancelEdit();
  }
});

// 사용자가 카테고리를 직접 고르면 다음 추가 전까지 자동 분류를 멈춘다.
let categoryPicked = false;

input.addEventListener("input", () => {
  if (state.autoClassify && !categoryPicked) categorySelect.value = classify(input.value) || state.lastCategory;
});

autoClassifyBtn.addEventListener("click", () => setAutoClassify(!state.autoClassify));

function fillKeywordFields(keywords) {
  for (const category of Object.keys(CATEGORY_LABELS)) {
    classifyForm.elements[`kw-${category}`].value = keywords[category].join(", ");
  }
}

document.getElementById("classify-settings").addEventListener("click", () => {
  fillKeywordFields(state.keywords);
  classifyDialog.showModal();
});

document.getElementById("kw-reset").addEventListener("click", () => fillKeywordFields(DEFAULT_KEYWORDS));

// 저장 버튼(value="save")으로 제출할 때만 반영한다. 취소와 Esc는 아무것도 바꾸지 않는다.
// close 이벤트는 다시 열었을 때 Chrome에서 오지 않는 경우가 있어 submit을 쓴다.
classifyForm.addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const keywords = {};
  for (const category of Object.keys(CATEGORY_LABELS)) {
    keywords[category] = parseKeywords(classifyForm.elements[`kw-${category}`].value);
  }
  setKeywords(keywords);
});

categorySelect.addEventListener("change", () => {
  categoryPicked = true;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  addTodo(input.value, categorySelect.value);
  categoryPicked = false;
  input.value = "";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);
document.getElementById("export-json").addEventListener("click", exportJson);

const importFile = document.getElementById("import-file");
document.getElementById("import-json").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = ""; // 같은 파일을 다시 고를 수 있게
  if (!file) return;
  let result;
  try {
    result = parseImport(await file.text());
  } catch (err) {
    alert(`불러올 수 없는 파일입니다. ${err.message}`);
    return;
  }
  const note = result.skipped ? `\n(형식이 맞지 않는 ${result.skipped}개는 제외됩니다)` : "";
  if (confirm(`현재 할 일 ${state.todos.length}개를 불러온 할 일 ${result.todos.length}개로 바꿀까요?${note}`)) importData(result);
});
themeBtn.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
darkQuery.addEventListener("change", render); // 운영체제 설정이 바뀌면 따라간다(직접 고르지 않은 경우)

// 단축키: 글을 쓰는 중이 아닐 때 "/"를 누르면 할 일 입력창으로 간다.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.target.closest("input, textarea, select") || classifyDialog.open) return;
  e.preventDefault();
  input.focus();
});

filters.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (btn) setFilter(btn.dataset.filter);
});

load();
render();
input.focus();
categorySelect.value = state.lastCategory;
document.getElementById("today").textContent = new Date().toLocaleDateString("ko-KR", {
  year: "numeric", month: "long", day: "numeric", weekday: "long",
});
