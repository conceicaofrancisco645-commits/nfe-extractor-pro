/* NF-e Extractor Pro — motor de extração de DANFE
 * Lê o texto COM POSIÇÃO (x, y) de cada página e reconstrói a tabela
 * "DADOS DO PRODUTO / SERVIÇO" pelas colunas do cabeçalho, em vez de
 * adivinhar pela ordem dos números. Funciona igual com texto nativo
 * (PDF.js) e com OCR (Tesseract.js devolve palavras com caixa).
 */
(function (root) {
  "use strict";

  const PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const PENDING = "PENDENTE DE CONFERÊNCIA";
  const VALID = "VALIDADO";

  /* ---------- utilidades numéricas ---------- */
  const NUM_RE = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
  function parseBrazilNumber(value) {
    if (typeof value === "number") return value;
    if (value === null || value === undefined) return NaN;
    const text = String(value).trim().replace(/\s/g, "");
    if (!text) return NaN;
    if (!/^-?[\d.,]+$/.test(text)) return NaN;
    return Number(text.replace(/\./g, "").replace(",", "."));
  }
  function formatBrazil(value, digits = 4) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
      : "";
  }
  const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

  /* ---------- agrupamento em linhas ---------- */
  function buildRows(items, tolerance = 2) {
    const sorted = items.filter((i) => i.str && i.str.trim()).slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const item of sorted) {
      const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
      if (row) row.items.push(item); else rows.push({ y: item.y, items: [item] });
    }
    rows.forEach((r) => { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map((i) => i.str.trim()).join(" "); });
    return rows.sort((a, b) => b.y - a.y);
  }

  /* ---------- metadados por "caixa de rótulo" ---------- */
  function valueBelow(allItems, labelRegex, { maxDrop = 16, pick = "join" } = {}) {
    const items = allItems.filter((i) => i.str && i.str.trim());
    const label = items.find((i) => labelRegex.test(norm(i.str)));
    if (!label) return "";
    const sameRow = items.filter((i) => Math.abs(i.y - label.y) <= 1.5 && i.x > label.x + 2).sort((a, b) => a.x - b.x);
    const limit = sameRow.length ? sameRow[0].x - 1 : Infinity;
    const candidates = items.filter((i) => i !== label && i.y < label.y - 1 && i.y >= label.y - maxDrop && i.x >= label.x - 3 && i.x < limit);
    if (!candidates.length) return "";
    const topY = Math.max(...candidates.map((c) => c.y));
    const line = candidates.filter((c) => Math.abs(c.y - topY) <= 2.5).sort((a, b) => a.x - b.x);
    return (pick === "last" ? line[line.length - 1].str : line.map((c) => c.str.trim()).join(" ")).trim();
  }

  function extractMetadata(pages) {
    const first = pages[0] || { items: [] };
    const items = first.items;
    const allText = pages.map((p) => buildRows(p.items).map((r) => r.text).join("\n")).join("\n");
    const flat = allText.replace(/\s+/g, " ");

    let number = (flat.match(/N[°ºo]\.?\s*:?\s*(\d[\d.]{2,})/i) || [])[1] || "";
    number = number.replace(/\./g, "");
    const series = (flat.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i) || [])[1] || "";

    let issuer = (flat.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i) || [])[1] || "";
    if (!issuer) issuer = valueBelow(items, /IDENTIFICACAO DO EMITENTE/, { maxDrop: 30 });

    let cnpj = valueBelow(items, /^CNPJ$/);
    if (!/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(cnpj)) cnpj = (flat.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/) || [])[1] || "";

    let date = valueBelow(items, /^DATA (DA|DE) EMISSAO$/);
    if (!/\d{2}\/\d{2}\/\d{4}/.test(date)) date = (flat.match(/EMISS[ÃA]O\D{0,40}(\d{2}\/\d{2}\/\d{4})/i) || flat.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1] || "";
    else date = date.match(/\d{2}\/\d{2}\/\d{4}/)[0];

    const productTotalRaw = valueBelow(items, /^VALOR TOTAL DOS PRODUTOS$/, { pick: "last" });
    const noteTotalRaw = valueBelow(items, /^VALOR TOTAL DA NOTA$/, { pick: "last" });
    const recipient = valueBelow(items, /^NOME\s*\/\s*RAZAO SOCIAL$/);

    const keyDigits = (flat.match(/((?:\d{4}\s?){10}\d{4})/) || [])[1];
    const accessKey = keyDigits ? keyDigits.replace(/\s/g, "") : "";

    return {
      number: number || "NÃO IDENTIFICADA",
      series,
      issuer: issuer.trim(),
      cnpj,
      date,
      recipient,
      accessKey,
      productTotal: NUM_RE.test(productTotalRaw) ? parseBrazilNumber(productTotalRaw) : null,
      noteTotal: NUM_RE.test(noteTotalRaw) ? parseBrazilNumber(noteTotalRaw) : null
    };
  }

  /* ---------- tabela de produtos ---------- */
  const COLUMN_DEFS = [
    ["code", /^COD\.?\s*PROD/],
    ["description", /^DESCRICAO DO PRODUTO/],
    ["ncm", /^NCM/],
    ["cst", /^(CST|CSOSN|O\/CST|CST\/CSOSN)$/],
    ["cfop", /^CFOP$/],
    ["unit", /^(UNID|UN|UNID\.)$/],
    ["quantity", /^(QTDE|QUANT|QTD\.?|QUANTIDADE)$/],
    ["unitValue", /^(VL\.?|VALOR)\s*UNIT/],
    ["totalValue", /^(VL\.?|VALOR)\s*TOTAL$/],
    ["discount", /^DESCONTO$/],
    ["bcIcms", /^(BC\.?\s*ICMS|B\.?\s*CALC)/],
    ["icms", /^(VL\.?|VALOR)\s*ICMS$/],
    ["ipi", /^(V\.?|VL\.?|VALOR)\s*IPI$/]
  ];

  function findSection(rows) {
    const startRow = rows.find((r) => /DADOS DOS? PRODUTOS?\s*\/\s*SERVICOS?/.test(norm(r.items[0]?.str)) || /^DADOS DOS? PRODUTOS?\s*\/\s*SERVICOS?/.test(norm(r.text)));
    const endRow = rows.find((r) => (!startRow || r.y < startRow.y) && /^(CALCULO DO ISSQN|DADOS ADICIONAIS|INFORMACOES COMPLEMENTARES)/.test(norm(r.text)));
    return { top: startRow ? startRow.y : null, bottom: endRow ? endRow.y : -Infinity, found: Boolean(startRow) };
  }

  function findHeader(items, top) {
    const pool = items.filter((i) => top === null || (i.y < top && i.y > top - 20));
    const cols = {};
    for (const [key, re] of COLUMN_DEFS) {
      const hit = pool.find((i) => re.test(norm(i.str)));
      if (hit) cols[key] = { x: hit.x, w: hit.w || 0, c: hit.x + (hit.w || 0) / 2, y: hit.y };
    }
    return cols.code && cols.ncm && cols.quantity ? cols : null;
  }

  const INF_AD_RE = /(ISENCAO|ISENTO|RICMS|ARTIGO \d|ANEXO [IVX]|REGIME ESPECIAL|CREDENCIAMENTO|SUSPENSAO|DIFERIMENTO|LEI COMPLEMENTAR|CONVENIO|PEDIDO:|^\d{3,}\/\d{4}$|^NF\s*ORIGEM|^LOTE|^FCI)/;

  function parseProducts(pages) {
    const products = [];
    let lastCols = null;
    let current = null;
    const warnings = [];

    for (const page of pages) {
      const rows = buildRows(page.items);
      const section = findSection(rows);
      if (!section.found && !current) continue; // página sem tabela e sem item em andamento
      const header = findHeader(page.items, section.top) || lastCols;
      if (!header) { warnings.push(`Página ${page.number}: cabeçalho de produtos não localizado.`); continue; }
      lastCols = header;
      const headerY = header.code.y;
      const ncmStart = header.ncm.x - 4;
      const descStart = header.description ? header.description.x - 4 : header.code.x + 30;
      const centers = Object.entries(header).filter(([k]) => !["code", "description"].includes(k)).map(([k, v]) => ({ key: k, c: v.c }));

      const bodyRows = rows.filter((r) => r.y < headerY - 3 && r.y > section.bottom + 1 && !(section.found ? false : false));
      for (const row of bodyRows) {
        const t = norm(row.text);
        if (/^(COD\.?\s*PROD|DESCRICAO DO PRODUTO|DADOS DOS? PRODUTO)/.test(t)) continue;
        const left = row.items.filter((i) => i.x < descStart);
        const desc = row.items.filter((i) => i.x >= descStart && i.x < ncmStart);
        const right = row.items.filter((i) => i.x >= ncmStart);
        const ncmItem = right.find((i) => /^\d{8}$/.test(i.str.trim()) || /^\d{2}\.?\d{2}\.?\d{2}\.?\d{2}$/.test(i.str.trim()));
        const isProductRow = left.length > 0 && ncmItem && right.length >= 4;

        if (isProductRow) {
          const fields = {};
          for (const item of right) {
            const center = item.x + (item.w || 0) / 2;
            let best = null;
            for (const col of centers) {
              const d = Math.abs(col.c - center);
              if (!best || d < best.d) best = { key: col.key, d };
            }
            if (!best) continue;
            fields[best.key] = fields[best.key] ? `${fields[best.key]} ${item.str.trim()}` : item.str.trim();
          }
          // fallback sequencial: NCM, CST, CFOP, UNID, QTDE, VUNIT, VTOTAL
          const seq = right.map((i) => i.str.trim());
          const nums = seq.filter((s) => NUM_RE.test(s) && s.includes(","));
          if (!NUM_RE.test(fields.quantity || "") && nums[0]) fields.quantity = nums[0];
          if (!NUM_RE.test(fields.unitValue || "") && nums[1]) fields.unitValue = nums[1];
          if (!NUM_RE.test(fields.totalValue || "") && nums[2]) fields.totalValue = nums[2];

          current = {
            code: left.map((i) => i.str.trim()).join(""),
            descLines: [desc.map((i) => i.str.trim()).join(" ")],
            ncm: ncmItem.str.replace(/\D/g, ""),
            cst: (fields.cst || "").replace(/\s/g, ""),
            cfop: (fields.cfop || "").replace(/\s/g, ""),
            unit: fields.unit || "",
            raw: { quantity: fields.quantity || "", unitValue: fields.unitValue || "", totalValue: fields.totalValue || "" },
            page: page.number
          };
          products.push(current);
          continue;
        }

        // linha de continuação: só o que está dentro da coluna de descrição
        if (current && desc.length && !left.length && right.length === 0) {
          current.descLines.push(desc.map((i) => i.str.trim()).join(" "));
        }
      }
    }

    // remove blocos de "informação adicional do produto" (infAdProd) repetidos
    const freq = new Map();
    products.forEach((p) => new Set(p.descLines.slice(1).map(norm)).forEach((l) => freq.set(l, (freq.get(l) || 0) + 1)));
    const repeatedThreshold = Math.max(2, Math.ceil(products.length * 0.5));

    return {
      warnings,
      products: products.map((p, index) => {
        const extra = [];
        const kept = [p.descLines[0]];
        let infoStarted = false;
        for (const line of p.descLines.slice(1)) {
          const n = norm(line);
          const isInfo = INF_AD_RE.test(n) || (products.length >= 3 && (freq.get(n) || 0) >= repeatedThreshold);
          if (isInfo) infoStarted = true;
          if (infoStarted) extra.push(line); else kept.push(line);
        }
        const quantity = parseBrazilNumber(p.raw.quantity);
        const unitValue = parseBrazilNumber(p.raw.unitValue);
        const totalValue = parseBrazilNumber(p.raw.totalValue);
        const product = {
          id: (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : `p${Date.now()}${index}${Math.random()}`,
          index: index + 1,
          code: p.code,
          description: kept.join(" ").replace(/\s+/g, " ").replace(/\s+-\s*$/, " -").trim(),
          ncm: p.ncm,
          cst: p.cst,
          cfop: p.cfop,
          unit: p.unit,
          quantity, unitValue, totalValue,
          raw: p.raw,
          additionalInfo: extra.join(" ").replace(/\s+/g, " ").trim(),
          page: p.page
        };
        const issues = auditProduct(product);
        product.issues = issues;
        product.status = issues.length ? PENDING : VALID;
        return product;
      })
    };
  }

  function auditProduct(p) {
    const issues = [];
    if (!p.code) issues.push("Código ausente");
    else if (p.code.length < 3) issues.push("Código possivelmente incompleto");
    if (!p.description) issues.push("Descrição ausente");
    if (!/^\d{8}$/.test(p.ncm || "")) issues.push("NCM fora do padrão de 8 dígitos");
    if (!/^\d{2,4}$/.test(p.cst || "")) issues.push("CST não identificado");
    if (!Number.isFinite(p.quantity)) issues.push("Quantidade não numérica");
    if (!Number.isFinite(p.unitValue)) issues.push("Valor unitário não numérico");
    if (!Number.isFinite(p.totalValue)) issues.push("Valor total não numérico");
    if (Number.isFinite(p.quantity) && Number.isFinite(p.unitValue) && Number.isFinite(p.totalValue)) {
      const diff = Math.abs(round2(p.quantity * p.unitValue) - p.totalValue);
      if (diff > 0.011) issues.push(`QTDE × VL. UNITÁRIO difere do VL. TOTAL em ${formatBrazil(diff, 2)}`);
    }
    return issues;
  }

  function parsePages(pages) {
    const metadata = extractMetadata(pages);
    const { products, warnings } = parseProducts(pages);
    // duplicidades: mesmo código na mesma nota (apenas sinaliza)
    const counts = new Map();
    products.forEach((p) => counts.set(p.code, (counts.get(p.code) || 0) + 1));
    products.forEach((p) => { p.duplicate = p.code && counts.get(p.code) > 1; });
    const sum = round2(products.reduce((s, p) => s + (Number.isFinite(p.totalValue) ? p.totalValue : 0), 0));
    const totalCheck = metadata.productTotal === null ? null : round2(sum - metadata.productTotal);
    if (!products.length) warnings.push("Nenhum produto foi identificado. Verifique se o arquivo é uma DANFE.");
    return { metadata, products, warnings, extractedTotal: sum, totalDifference: totalCheck };
  }

  /* ---------- leitura no navegador ---------- */
  async function loadPdfJs() {
    const lib = root.pdfjsLib;
    if (!lib) throw new Error("PDF.js não carregou. Abra o app com internet ao menos uma vez.");
    lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.js";
    return lib;
  }

  async function pageItems(page) {
    const content = await page.getTextContent();
    return content.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
  }

  async function ocrItems(page) {
    if (!root.Tesseract) throw new Error("OCR indisponível (Tesseract.js não carregou).");
    const scale = 2.5;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const result = await root.Tesseract.recognize(canvas, "por");
    const height = viewport.height / scale;
    return (result.data.words || []).map((w) => ({ str: w.text, x: w.bbox.x0 / scale, y: height - w.bbox.y1 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, ocr: true, conf: w.confidence }));
  }

  async function extractNfe(file, progress = () => {}) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    let ocrPages = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(n - 1, pdf.numPages, `Lendo página ${n} de ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      let items = await pageItems(page);
      if (items.map((i) => i.str).join("").replace(/\s/g, "").length < 40) {
        progress(n - 1, pdf.numPages, `OCR na página ${n}`);
        items = await ocrItems(page);
        ocrPages++;
      }
      pages.push({ number: n, items });
    }
    progress(pdf.numPages, pdf.numPages, "Montando tabela");
    const result = parsePages(pages);
    if (ocrPages) result.products.forEach((p) => { p.issues.push("Lido por OCR"); p.status = PENDING; });
    return { ...result, pageCount: pdf.numPages, ocrPages };
  }

  const api = { extractNfe, parsePages, parseBrazilNumber, formatBrazil, auditProduct, round2, PENDING, VALID };
  root.NfeExtractor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
