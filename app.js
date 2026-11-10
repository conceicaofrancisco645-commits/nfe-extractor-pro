/* NF-e Extractor Pro — aplicação */
(function () {
  "use strict";

  const X = window.NfeExtractor;
  const { PENDING, VALID } = X;
  const state = { notes: [], selected: new Set(), sort: { key: "", dir: 1 }, chart: null, history: [], installEvent: null };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
  const qtyFmt = (v) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(v || 0);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id${Date.now()}${Math.random()}`);
  const icons = () => window.lucide && window.lucide.createIcons();
  const TITLES = { painel: "Painel", conferencia: "Conferência", historico: "Histórico" };

  function toast(msg, type = "") {
    const n = document.createElement("div");
    n.className = `toast ${type}`; n.textContent = msg;
    $("#toasts").append(n); setTimeout(() => n.remove(), 5200);
  }

  /* ---------------- navegação ---------------- */
  function go(view) {
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === view));
    $$("[data-go]").forEach((b) => b.classList.toggle("is-active", b.dataset.go === view && !b.classList.contains("brand")));
    $("#page-title").textContent = TITLES[view];
    if (view === "conferencia") renderGrid();
    window.scrollTo({ top: 0 });
  }

  /* ---------------- importação ---------------- */
  function bindImport() {
    const zone = $("#drop-zone"), input = $("#file-input");
    const open = () => input.click();
    $("#select-files").addEventListener("click", (e) => { e.stopPropagation(); open(); });
    zone.addEventListener("click", open);
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    input.addEventListener("change", () => { processFiles([...input.files]); input.value = ""; });
    ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-drag"); }));
    ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("is-drag"); }));
    zone.addEventListener("drop", (e) => processFiles([...e.dataTransfer.files]));
    // evita que o navegador abra o PDF ao soltar fora da área
    ["dragover", "drop"].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));
    $("#clear-queue").addEventListener("click", () => {
      if (!confirm("Limpar as notas desta sessão? O histórico salvo continua disponível.")) return;
      state.notes = []; state.selected.clear(); refresh();
    });
  }

  async function processFiles(files) {
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return toast("Nenhum PDF encontrado. Selecione arquivos .pdf de DANFE.", "err");
    $("#drop-zone").classList.add("is-busy");
    for (const file of pdfs) await processFile(file);
    $("#drop-zone").classList.remove("is-busy");
  }

  async function processFile(file) {
    const note = { id: uid(), fileName: file.name, metadata: { number: "…" }, products: [], pageCount: 0, status: "Na fila", progress: 0, processedAt: new Date().toISOString(), warnings: [] };
    state.notes.push(note); refresh();
    try {
      const r = await X.extractNfe(file, (done, total, label) => {
        note.progress = total ? Math.round((done / total) * 100) : 0;
        note.pageCount = total; note.status = label; renderQueue();
      });
      Object.assign(note, { metadata: r.metadata, products: r.products, pageCount: r.pageCount, ocrPages: r.ocrPages, warnings: r.warnings, progress: 100 });
      note.status = r.products.length ? "Concluída" : "Nenhum produto";
      setHeroKey(r.metadata.accessKey);
      await historySave(snapshot(note));
      state.history = await historyAll();
      const diff = noteDiff(note);
      if (!r.products.length) toast(`${file.name}: nenhum produto identificado.`, "err");
      else if (diff !== null && Math.abs(diff) > 0.01) toast(`NF ${note.metadata.number}: soma dos itens difere do total da nota em ${money(Math.abs(diff))}. Confira antes de exportar.`, "warn");
      else toast(`NF ${note.metadata.number}: ${r.products.length} produtos extraídos.`, "ok");
    } catch (err) {
      console.error(err);
      note.status = "Erro"; note.error = err.message; note.progress = 100;
      toast(`Não foi possível ler ${file.name}: ${err.message}`, "err");
    }
    refresh();
  }

  function setHeroKey(key) {
    const box = $("#hero-key");
    const digits = (key || "").padEnd(44, "·").slice(0, 44);
    box.innerHTML = digits.match(/.{4}/g).map((g, i) => `<span style="--i:${i}" class="${key ? "on" : ""}">${g}</span>`).join("");
  }

  /* ---------------- dados derivados ---------------- */
  const rows = () => state.notes.flatMap((n) => n.products.map((p) => ({ p, n })));
  const noteSum = (n) => X.round2(n.products.reduce((s, p) => s + (Number.isFinite(p.totalValue) ? p.totalValue : 0), 0));
  const noteDiff = (n) => (Number.isFinite(n.metadata.productTotal) ? X.round2(noteSum(n) - n.metadata.productTotal) : null);

  function reaudit(p) {
    const issues = X.auditProduct(p);
    if (p.manualCheck) { p.issues = issues; p.status = VALID; return; }
    p.issues = issues; p.status = issues.length ? PENDING : VALID;
  }
  function markDuplicates() {
    state.notes.forEach((n) => {
      const c = new Map();
      n.products.forEach((p) => c.set(p.code, (c.get(p.code) || 0) + 1));
      n.products.forEach((p) => { p.duplicate = Boolean(p.code) && c.get(p.code) > 1; });
    });
  }

  /* ---------------- render: painel ---------------- */
  function renderMetrics() {
    const all = rows();
    const pending = all.filter(({ p }) => p.status !== VALID).length;
    const total = state.notes.reduce((s, n) => s + noteSum(n), 0);
    const qty = all.reduce((s, { p }) => s + (Number.isFinite(p.quantity) ? p.quantity : 0), 0);
    const pages = state.notes.reduce((s, n) => s + (n.pageCount || 0), 0);
    const codes = new Set(all.map(({ p }) => p.code)).size;
    const valid = all.length ? Math.round(((all.length - pending) / all.length) * 100) : 0;
    $("#m-notes").textContent = state.notes.length;
    $("#m-pages").textContent = `${pages} ${pages === 1 ? "página lida" : "páginas lidas"}`;
    $("#m-products").textContent = all.length;
    $("#m-codes").textContent = `${codes} ${codes === 1 ? "código distinto" : "códigos distintos"}`;
    $("#m-qty").textContent = qtyFmt(qty);
    $("#m-total").textContent = money(total);
    $("#m-pending").textContent = pending;
    $("#m-valid").textContent = `${valid}%`;
    $("#m-valid-bar").style.width = `${valid}%`;
    const check = $("#m-total-check");
    const withTotal = state.notes.filter((n) => Number.isFinite(n.metadata.productTotal));
    if (!state.notes.length) { check.textContent = "Aguardando notas"; check.className = ""; }
    else if (!withTotal.length) { check.textContent = "Total da nota não localizado"; check.className = "warn"; }
    else {
      const off = withTotal.filter((n) => Math.abs(noteDiff(n)) > 0.01).length;
      check.textContent = off ? `${off} nota(s) com divergência no total` : "Confere com o total informado na nota";
      check.className = off ? "warn" : "ok";
    }
    const navCount = $("#nav-pending");
    navCount.hidden = !pending; navCount.textContent = pending;
    $("#export-all").disabled = !state.notes.some((n) => n.products.length);
    $("#clear-queue").disabled = !state.notes.length;
  }

  function renderQueue() {
    const box = $("#queue");
    if (!state.notes.length) {
      box.innerHTML = `<p class="empty">Nenhuma nota importada ainda. Use <b>Importar PDF</b> ou arraste os arquivos para a folha acima.</p>`;
      return;
    }
    box.innerHTML = state.notes.map((n) => {
      const done = n.progress === 100 && n.status !== "Erro";
      const pending = n.products.filter((p) => p.status !== VALID).length;
      const diff = noteDiff(n);
      const cls = n.status === "Erro" ? "is-error" : !done ? "" : pending || (diff !== null && Math.abs(diff) > .01) ? "is-warn" : "is-done";
      const icon = n.status === "Erro" ? "file-x" : !done ? "loader" : cls === "is-done" ? "file-check" : "file-warning";
      const meta = n.status === "Erro" ? esc(n.error)
        : done ? `NF ${esc(n.metadata.number)} · ${n.pageCount} pág. · ${n.products.length} produtos · ${money(noteSum(n))}`
        : `${esc(n.status)}`;
      const side = done && n.products.length
        ? `${pending ? `<span class="pill warn">${pending} pendente${pending > 1 ? "s" : ""}</span>` : `<span class="pill ok">Validada</span>`}
           <button class="icon-btn" data-review="${n.id}" title="Conferir esta nota" aria-label="Conferir NF ${esc(n.metadata.number)}"><i data-lucide="list-checks"></i></button>
           <button class="icon-btn" data-export="${n.id}" title="Exportar esta nota" aria-label="Exportar NF ${esc(n.metadata.number)}"><i data-lucide="download"></i></button>`
        : "";
      return `<div class="note-card ${cls}">
        <span class="nc-icon"><i data-lucide="${icon}"></i></span>
        <span class="nc-title" title="${esc(n.fileName)}">${esc(n.fileName)}</span>
        <span class="nc-side">${side}</span>
        <span class="nc-meta">${meta}</span>
        ${done ? "" : `<span class="nc-progress"><i style="width:${n.progress}%"></i></span>`}
      </div>`;
    }).join("");
    box.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => { $("#f-note").value = b.dataset.review; go("conferencia"); }));
    box.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportNote(state.notes.find((n) => n.id === b.dataset.export))));
    icons();
  }

  function renderChart() {
    if (!window.Chart) return;
    const done = state.notes.filter((n) => n.products.length);
    $(".chart-box").classList.toggle("is-empty", !done.length);
    const data = { labels: done.map((n) => `NF ${n.metadata.number}`), datasets: [{ data: done.map(noteSum), backgroundColor: "#2e8bff", hoverBackgroundColor: "#7fd0ff", borderRadius: 6, maxBarThickness: 48 }] };
    if (state.chart) { state.chart.data = data; state.chart.update(); return; }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    state.chart = new Chart($("#value-chart"), {
      type: "bar", data,
      options: {
        maintainAspectRatio: false, animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.raw) } } },
        scales: {
          x: { ticks: { color: "#b8c9e4" }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: "#8fa9cc", callback: (v) => new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" }).format(v) }, grid: { color: "rgba(143,169,204,.12)" } }
        }
      }
    });
  }

  /* ---------------- render: conferência ---------------- */
  function bindGrid() {
    ["#f-search"].forEach((s) => $(s).addEventListener("input", renderGrid));
    ["#f-note", "#f-ncm", "#f-cst", "#f-pending"].forEach((s) => $(s).addEventListener("change", renderGrid));
    $("#f-clear").addEventListener("click", () => { $("#f-search").value = ""; ["#f-note", "#f-ncm", "#f-cst"].forEach((s) => ($(s).value = "")); $("#f-pending").checked = false; renderGrid(); });
    $$("#grid th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      renderGrid();
    }));
    $("#sel-all").addEventListener("change", (e) => { filtered().forEach(({ p }) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id))); renderGrid(); });
    $("#grid-body").addEventListener("change", onCellChange);
    $("#add-row").addEventListener("click", addManual);
    $("#delete-sel").addEventListener("click", () => {
      const n = state.selected.size;
      if (!n || !confirm(`Excluir ${n} registro${n > 1 ? "s" : ""} selecionado${n > 1 ? "s" : ""}?`)) return;
      state.notes.forEach((note) => (note.products = note.products.filter((p) => !state.selected.has(p.id))));
      state.selected.clear(); persistAll(); refresh(); toast(`${n} registro(s) excluído(s).`, "ok");
    });
    $("#validate-sel").addEventListener("click", () => {
      let n = 0;
      rows().forEach(({ p }) => { if (state.selected.has(p.id)) { p.manualCheck = true; reaudit(p); n++; } });
      state.selected.clear(); persistAll(); refresh(); toast(`${n} registro(s) marcados como conferidos.`, "ok");
    });
    $("#export-note").addEventListener("click", () => {
      const id = $("#f-note").value;
      const note = id ? state.notes.find((n) => n.id === id) : state.notes.length === 1 ? state.notes[0] : null;
      if (!note) return toast("Escolha uma nota no filtro “Nota” para exportar só ela.", "warn");
      exportNote(note);
    });
  }

  function filtered() {
    const q = $("#f-search").value.trim().toLowerCase();
    const noteId = $("#f-note").value, ncm = $("#f-ncm").value, cst = $("#f-cst").value, onlyPending = $("#f-pending").checked;
    let list = rows().filter(({ p, n }) =>
      (!q || String(p.code).toLowerCase().includes(q) || String(p.description).toLowerCase().includes(q)) &&
      (!noteId || n.id === noteId) && (!ncm || p.ncm === ncm) && (!cst || p.cst === cst) && (!onlyPending || p.status !== VALID));
    const { key, dir } = state.sort;
    if (key) list = list.slice().sort((a, b) => {
      const x = a.p[key], y = b.p[key];
      if (typeof x === "number" || typeof y === "number") return ((Number.isFinite(x) ? x : -Infinity) - (Number.isFinite(y) ? y : -Infinity)) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "pt-BR", { numeric: true }) * dir;
    });
    return list;
  }

  function fillSelect(sel, values, allLabel) {
    const el = $(sel), cur = el.value;
    el.innerHTML = `<option value="">${allLabel}</option>` + values.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    el.value = values.some(([v]) => v === cur) ? cur : "";
  }
  function renderFilters() {
    const all = rows();
    fillSelect("#f-note", state.notes.filter((n) => n.products.length).map((n) => [n.id, `NF ${n.metadata.number}`]), "Todas");
    fillSelect("#f-ncm", [...new Set(all.map(({ p }) => p.ncm).filter(Boolean))].sort().map((v) => [v, v]), "Todos");
    fillSelect("#f-cst", [...new Set(all.map(({ p }) => p.cst).filter(Boolean))].sort().map((v) => [v, v]), "Todos");
  }

  function cell(p, n, field, cls = "", numeric = false) {
    const value = numeric ? X.formatBrazil(p[field]) : p[field];
    const bad = numeric && !Number.isFinite(p[field]);
    return `<td class="${cls}"><input class="cell${bad ? " is-bad" : ""}" data-f="${field}" data-p="${p.id}" data-n="${n.id}" value="${esc(value)}" inputmode="${numeric ? "decimal" : "text"}" aria-label="${field}"></td>`;
  }

  function renderGrid() {
    renderFilters();
    const list = filtered();
    const body = $("#grid-body");
    body.innerHTML = list.map(({ p, n }) => {
      const pend = p.status !== VALID;
      const issues = (p.issues || []).join(" · ");
      const status = p.duplicate
        ? `<span class="pill info issue" title="Mesmo código aparece mais de uma vez nesta nota. Nada foi excluído.">Possível duplicidade</span>`
        : pend ? `<span class="pill warn issue" title="${esc(issues)}">Pendente</span>`
        : p.manualCheck ? `<span class="pill ok">Conferido</span>` : `<span class="pill ok">Validado</span>`;
      return `<tr class="${pend ? "is-pending" : ""} ${p.duplicate ? "is-dup" : ""} ${state.selected.has(p.id) ? "is-selected" : ""}" data-row="${p.id}">
        <td class="c-sel"><input type="checkbox" data-sel="${p.id}" ${state.selected.has(p.id) ? "checked" : ""} aria-label="Selecionar ${esc(p.code)}"></td>
        ${cell(p, n, "code", "c-code")}${cell(p, n, "description", "c-desc")}${cell(p, n, "ncm", "c-ncm")}${cell(p, n, "cst", "c-cst")}
        ${cell(p, n, "quantity", "num", true)}${cell(p, n, "unitValue", "num", true)}${cell(p, n, "totalValue", "num", true)}
        <td>${status}</td></tr>`;
    }).join("");
    body.querySelectorAll("[data-sel]").forEach((c) => c.addEventListener("change", () => {
      c.checked ? state.selected.add(c.dataset.sel) : state.selected.delete(c.dataset.sel);
      c.closest("tr").classList.toggle("is-selected", c.checked); updateSelection(list);
    }));
    $("#grid-empty").hidden = rows().length > 0;
    $$("#grid th[data-sort]").forEach((th) => { th.classList.toggle("is-sorted", th.dataset.sort === state.sort.key); th.classList.toggle("desc", th.dataset.sort === state.sort.key && state.sort.dir < 0); });
    const sumShown = list.reduce((s, { p }) => s + (Number.isFinite(p.totalValue) ? p.totalValue : 0), 0);
    $("#grid-foot").textContent = rows().length ? `${list.length} de ${rows().length} registros exibidos · soma do VL. TOTAL exibido: ${money(sumShown)}` : "";
    updateSelection(list);
    renderAudit();
  }

  function updateSelection(list = filtered()) {
    const n = state.selected.size;
    $("#sel-info").textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
    $("#delete-sel").disabled = !n; $("#validate-sel").disabled = !n;
    $("#sel-all").checked = list.length > 0 && list.every(({ p }) => state.selected.has(p.id));
  }

  function onCellChange(e) {
    const input = e.target.closest("input.cell");
    if (!input) return;
    const note = state.notes.find((n) => n.id === input.dataset.n);
    const p = note && note.products.find((x) => x.id === input.dataset.p);
    if (!p) return;
    const f = input.dataset.f;
    p[f] = ["quantity", "unitValue", "totalValue"].includes(f) ? X.parseBrazilNumber(input.value) : input.value.trim();
    p.edited = true; p.manualCheck = false;
    reaudit(p); markDuplicates(); persistNote(note); refresh();
  }

  function addManual() {
    const id = $("#f-note").value;
    let note = id ? state.notes.find((n) => n.id === id) : state.notes.find((n) => n.products.length) || null;
    if (!note) {
      note = { id: uid(), fileName: "Inclusão manual", metadata: { number: "MANUAL", issuer: "", cnpj: "", date: "", productTotal: null }, products: [], pageCount: 0, status: "Concluída", progress: 100, processedAt: new Date().toISOString(), warnings: [] };
      state.notes.push(note);
    }
    const p = { id: uid(), code: "", description: "", ncm: "", cst: "", quantity: NaN, unitValue: NaN, totalValue: NaN, page: 0, manual: true, raw: {} };
    reaudit(p); note.products.push(p);
    state.sort = { key: "", dir: 1 }; refresh();
    const input = document.querySelector(`input[data-p="${p.id}"][data-f="code"]`);
    if (input) { input.scrollIntoView({ block: "center" }); input.focus(); }
    toast(`Linha adicionada à NF ${note.metadata.number}. Preencha os campos.`, "ok");
  }

  function renderAudit() {
    const box = $("#audit");
    const notes = state.notes.filter((n) => n.products.length);
    box.innerHTML = notes.map((n) => {
      const diff = noteDiff(n);
      const incomplete = n.products.filter((p) => (p.issues || []).some((i) => /ausente|não numéric|não identificado|incompleto|padrão/.test(i))).length;
      const mathOff = n.products.filter((p) => (p.issues || []).some((i) => /difere/.test(i))).length;
      const dups = n.products.filter((p) => p.duplicate).length;
      const totalOk = diff !== null && Math.abs(diff) <= 0.01;
      const warn = !totalOk || incomplete || mathOff;
      const checks = [
        diff === null ? `<span class="pill warn">Total dos produtos não localizado na nota</span>`
          : totalOk ? `<span class="pill ok">Soma confere com o total da nota</span>`
          : `<span class="pill err">Diferença de ${money(Math.abs(diff))} no total</span>`,
        mathOff ? `<span class="pill warn">${mathOff} com QTDE × unitário ≠ total</span>` : `<span class="pill ok">QTDE × unitário confere</span>`,
        incomplete ? `<span class="pill warn">${incomplete} incompleto(s)</span>` : `<span class="pill ok">Campos completos</span>`,
        dups ? `<span class="pill info">${dups} linhas com código repetido</span>` : "",
        n.ocrPages ? `<span class="pill warn">${n.ocrPages} página(s) por OCR</span>` : "",
        ...(n.warnings || []).map((w) => `<span class="pill warn">${esc(w)}</span>`)
      ].join("");
      return `<div class="audit-note ${warn ? "is-warn" : ""}">
        <div><h3>NF ${esc(n.metadata.number)}${n.metadata.series ? ` · série ${esc(n.metadata.series)}` : ""}</h3>
        <p>${esc(n.metadata.issuer || "Emitente não identificado")}${n.metadata.cnpj ? ` · ${esc(n.metadata.cnpj)}` : ""}${n.metadata.date ? ` · emitida em ${esc(n.metadata.date)}` : ""}</p></div>
        <div class="audit-sum">Extraído ${money(noteSum(n))}<b>${diff === null ? "—" : `Nota ${money(n.metadata.productTotal)}`}</b></div>
        <div class="audit-checks">${checks}</div></div>`;
    }).join("");
  }

  /* ---------------- exportação ---------------- */
  async function exportNote(note) {
    if (!note || !note.products.length) return toast("Essa nota não tem produtos para exportar.", "warn");
    try { await window.NfeExcel.exportNote(note); toast(`Planilha da NF ${note.metadata.number} exportada.`, "ok"); }
    catch (e) { toast(e.message, "err"); }
  }
  async function exportAll() {
    const notes = state.notes.filter((n) => n.products.length);
    if (!notes.length) return toast("Importe ao menos uma nota antes de exportar.", "warn");
    const pending = notes.reduce((s, n) => s + n.products.filter((p) => p.status !== VALID).length, 0);
    if (pending && !confirm(`Há ${pending} registro(s) pendentes de conferência. Exportar mesmo assim?`)) return;
    try { await window.NfeExcel.exportConsolidated(notes); toast(notes.length > 1 ? `Planilha consolidada com ${notes.length} notas exportada.` : "Planilha exportada.", "ok"); }
    catch (e) { toast(e.message, "err"); }
  }

  /* ---------------- histórico (IndexedDB) ---------------- */
  const DB = "nfe-extractor-pro", STORE = "history";
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
  }
  const historySave = (rec) => tx("readwrite", (s) => s.put(rec)).catch(() => {});
  const historyAll = async () => ((await tx("readonly", (s) => s.getAll()).catch(() => [])) || []).sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  const historyClear = () => tx("readwrite", (s) => s.clear());
  const historyDelete = (id) => tx("readwrite", (s) => s.delete(id));

  function snapshot(n) {
    return { id: n.id, fileName: n.fileName, metadata: n.metadata, pageCount: n.pageCount, ocrPages: n.ocrPages || 0, warnings: n.warnings || [], products: n.products, processedAt: n.processedAt, updatedAt: new Date().toISOString() };
  }
  async function persistNote(n) { if (n.fileName === "Inclusão manual") return; await historySave(snapshot(n)); state.history = await historyAll(); renderHistory(); }
  async function persistAll() { for (const n of state.notes) await persistNote(n); }

  function renderHistory() {
    const box = $("#history");
    $("#clear-history").disabled = !state.history.length;
    if (!state.history.length) { box.innerHTML = `<p class="empty">Nenhuma nota processada neste navegador ainda.</p>`; return; }
    box.innerHTML = state.history.map((h) => {
      const total = h.products.reduce((s, p) => s + (Number.isFinite(p.totalValue) ? p.totalValue : 0), 0);
      const pending = h.products.filter((p) => p.status !== VALID).length;
      return `<article class="h-card">
        <div><h3 title="${esc(h.fileName)}">${esc(h.fileName)}</h3><p class="h-date">Processado em ${new Date(h.processedAt).toLocaleString("pt-BR")}</p></div>
        <div class="h-grid"><div><span>NF</span><b>${esc(h.metadata.number)}</b></div><div><span>Produtos</span><b>${h.products.length}</b></div><div><span>Valor</span><b>${money(total)}</b></div></div>
        <div class="h-actions">${pending ? `<span class="pill warn">${pending} pendente(s)</span>` : `<span class="pill ok">Validada</span>`}
          <button class="btn btn-ghost" data-h-open="${h.id}"><i data-lucide="list-checks"></i>Consultar</button>
          <button class="btn btn-ghost" data-h-export="${h.id}"><i data-lucide="download"></i>Exportar</button>
          <button class="icon-btn" data-h-del="${h.id}" title="Remover do histórico" aria-label="Remover NF ${esc(h.metadata.number)} do histórico"><i data-lucide="x"></i></button></div>
      </article>`;
    }).join("");
    box.querySelectorAll("[data-h-open]").forEach((b) => b.addEventListener("click", () => reopen(b.dataset.hOpen)));
    box.querySelectorAll("[data-h-export]").forEach((b) => b.addEventListener("click", () => { const h = state.history.find((x) => x.id === b.dataset.hExport); exportNote(h); }));
    box.querySelectorAll("[data-h-del]").forEach((b) => b.addEventListener("click", async () => { await historyDelete(b.dataset.hDel); state.history = await historyAll(); renderHistory(); }));
    icons();
  }
  function reopen(id) {
    const h = state.history.find((x) => x.id === id);
    if (!h) return;
    if (!state.notes.some((n) => n.id === id)) state.notes.push({ ...structuredClone(h), status: "Concluída", progress: 100 });
    refresh(); $("#f-note").value = id; go("conferencia");
    toast(`NF ${h.metadata.number} reaberta para conferência.`, "ok");
  }

  /* ---------------- PWA ---------------- */
  function bindPwa() {
    const btn = $("#install-btn");
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (ios && !standalone) btn.hidden = false;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvent = e; btn.hidden = false; });
    window.addEventListener("appinstalled", () => { btn.hidden = true; toast("App instalado. Ele já abre direto pelo ícone.", "ok"); });
    btn.addEventListener("click", async () => {
      if (state.installEvent) { state.installEvent.prompt(); await state.installEvent.userChoice; state.installEvent = null; btn.hidden = true; }
      else if (ios) $("#ios-install").showModal();
    });
    const net = () => { $("#net-status").hidden = navigator.onLine; };
    window.addEventListener("online", net); window.addEventListener("offline", net); net();
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker não registrado:", e));
    }
  }

  /* ---------------- ciclo ---------------- */
  function refresh() {
    markDuplicates();
    renderMetrics(); renderQueue(); renderChart();
    if ($("#conferencia").classList.contains("is-active")) renderGrid(); else { renderFilters(); renderAudit(); }
    renderHistory(); icons();
  }

  async function init() {
    setHeroKey("");
    $$("[data-go]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go(b.dataset.go); }));
    $("#export-all").addEventListener("click", exportAll);
    $("#clear-history").addEventListener("click", async () => {
      if (!confirm("Apagar todo o histórico salvo neste navegador? Essa ação não pode ser desfeita.")) return;
      await historyClear(); state.history = []; renderHistory(); toast("Histórico apagado.", "ok");
    });
    bindImport(); bindGrid(); bindPwa();
    state.history = await historyAll();
    refresh();
    if (location.protocol === "file:") toast("Para instalar como app, abra pelo arquivo INICIAR.bat (servidor local).", "warn");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
