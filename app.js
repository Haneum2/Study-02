/*
 * 구조
 * - 상태: state 객체 하나가 유일한 데이터 원본 (todos, filter, lastCategory, editingId)
 * - 저장: load() / save()만 localStorage에 접근한다 (키 "todo-app:v1")
 * - 변경 함수: addTodo, toggleTodo, deleteTodo, updateTodo, startEdit, cancelEdit,
 *   setFilter, clearDone — 모두 상태 변경 -> save() -> render() 순서
 * - 렌더링: render()가 state를 읽어 진행률, 필터 탭, 목록을 통째로 다시 그린다
 * - 이벤트: #todo-list 하나에 위임, 폼 submit, 필터 탭, 완료 항목 비우기
 */
const STORAGE_KEY = "todo-app:v1";
const BACKUP_KEY = "todo-app:v1:backup";
const MAX_TITLE = 100;
const CATEGORY_LABELS = { work: "업무", personal: "개인", study: "공부" };
const FILTER_LABELS = { all: "전체", ...CATEGORY_LABELS };

// editingId는 화면 상태라서 save()에서 저장하지 않는다.
const state = { todos: [], filter: "all", lastCategory: "work", editingId: null };

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const categorySelect = document.getElementById("todo-category");
const list = document.getElementById("todo-list");
const saveError = document.getElementById("save-error");
const clearDoneBtn = document.getElementById("clear-done");
const filters = document.getElementById("filters");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

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
  state.todos = data.todos;
  if (data.filter in FILTER_LABELS) state.filter = data.filter;
  if (data.lastCategory in CATEGORY_LABELS) state.lastCategory = data.lastCategory;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      filter: state.filter,
      lastCategory: state.lastCategory,
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

function render() {
  const focus = rememberFocus();
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

form.addEventListener("submit", (e) => {
  e.preventDefault();
  addTodo(input.value, categorySelect.value);
  input.value = "";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);

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
