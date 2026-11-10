/* NF-e Extractor Pro — exportação para Excel (.xlsx)
 * Usa ExcelJS para gravar formatação real: cabeçalho azul-escuro,
 * filtro automático, primeira linha congelada, bordas e formatos
 * numéricos. Códigos e NCM vão como texto (preservam zeros à esquerda).
 */
(function (root) {
  "use strict";

  const HEADERS = ["COD.PROD.", "DESCRIÇÃO DO PRODUTO / SERVIÇO", "NCM/SH", "CST", "QTDE", "VL. UNITÁRIO", "VL. TOTAL"];
  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2857" } };
  const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
  const BORDER_COLOR = { argb: "FFD3DEEE" };
  const BORDER = { top: { style: "thin", color: BORDER_COLOR }, left: { style: "thin", color: BORDER_COLOR }, bottom: { style: "thin", color: BORDER_COLOR }, right: { style: "thin", color: BORDER_COLOR } };
  const NUM4 = "#,##0.0000";

  const num = (v) => (Number.isFinite(v) ? v : null);
  const sum = (items) => items.reduce((s, p) => s + (Number.isFinite(p.totalValue) ? p.totalValue : 0), 0);
  const noteStatus = (note) => (note.products.some((p) => p.status !== "VALIDADO") ? "PENDENTE DE CONFERÊNCIA" : "VALIDADO");

  function toDate(br) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || "");
    return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : (br || null);
  }

  function styleHeader(row) {
    row.height = 22;
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL; cell.font = HEADER_FONT; cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    });
  }

  function autoWidth(sheet, min = 8, max = 60) {
    sheet.columns.forEach((col) => {
      let width = min;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        let text = v instanceof Date ? "00/00/0000" : v === null || v === undefined ? "" : String(v);
        if (typeof v === "number") text = v.toFixed(4).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        width = Math.max(width, text.length + 2);
      });
      col.width = Math.min(max, width);
    });
  }

  function addDataSheet(wb, rows, consolidated) {
    const headers = consolidated ? [...HEADERS, "NUMERO_NF", "DATA_EMISSAO"] : HEADERS;
    const ws = wb.addWorksheet("DADOS_NF", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(headers);
    styleHeader(ws.getRow(1));
    rows.forEach((p) => {
      const values = [String(p.code ?? ""), p.description ?? "", String(p.ncm ?? ""), String(p.cst ?? ""), num(p.quantity), num(p.unitValue), num(p.totalValue)];
      if (consolidated) values.push(String(p.noteNumber ?? ""), toDate(p.noteDate));
      const row = ws.addRow(values);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cell.border = BORDER;
        if (c === 1 || c === 3 || c === 4 || c === 8) { cell.numFmt = "@"; }
        if (c >= 5 && c <= 7) { cell.numFmt = NUM4; cell.alignment = { horizontal: "right" }; }
        if (c === 9) cell.numFmt = "dd/mm/yyyy";
      });
    });
    // garante formato texto mesmo em colunas vazias
    [1, 3, 4].forEach((c) => { ws.getColumn(c).numFmt = "@"; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
    autoWidth(ws);
    ws.getColumn(2).width = Math.min(70, Math.max(ws.getColumn(2).width, 36));
    return ws;
  }

  function addSummarySheet(wb, notes) {
    const ws = wb.addWorksheet("RESUMO_NF", { views: [{ state: "frozen", ySplit: 1 }] });
    const headers = ["NUMERO_NF", "EMITENTE", "CNPJ_EMITENTE", "DATA_EMISSAO", "QTD_PAGINAS", "QTD_PRODUTOS", "VALOR_TOTAL_PRODUTOS", "VALOR_INFORMADO_NA_NOTA", "STATUS_CONFERENCIA"];
    ws.addRow(headers);
    styleHeader(ws.getRow(1));
    notes.forEach((n) => {
      const row = ws.addRow([
        String(n.metadata.number || ""), n.metadata.issuer || "", n.metadata.cnpj || "", toDate(n.metadata.date),
        n.pageCount || 0, n.products.length, Math.round(sum(n.products) * 10000) / 10000,
        Number.isFinite(n.metadata.productTotal) ? n.metadata.productTotal : null, noteStatus(n)
      ]);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cell.border = BORDER;
        if (c === 1 || c === 3) cell.numFmt = "@";
        if (c === 4) cell.numFmt = "dd/mm/yyyy";
        if (c === 7 || c === 8) cell.numFmt = NUM4;
        if (c === 9) cell.font = { bold: true, color: { argb: cell.value === "VALIDADO" ? "FF137A4E" : "FFB26A00" } };
      });
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: notes.length + 1, column: headers.length } };
    autoWidth(ws);
  }

  async function download(wb, name) {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]+/g, "_")}.xlsx`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function newBook() {
    if (!root.ExcelJS) throw new Error("A biblioteca de Excel não carregou. Abra o app com internet ao menos uma vez.");
    const wb = new root.ExcelJS.Workbook();
    wb.creator = "NF-e Extractor Pro"; wb.created = new Date();
    return wb;
  }

  root.NfeExcel = {
    async exportNote(note) {
      const wb = newBook();
      addDataSheet(wb, note.products, false);
      addSummarySheet(wb, [note]);
      await download(wb, `NF_${note.metadata.number || "sem_numero"}`);
    },
    async exportConsolidated(notes) {
      const wb = newBook();
      const rows = notes.flatMap((n) => n.products.map((p) => ({ ...p, noteNumber: n.metadata.number, noteDate: n.metadata.date })));
      addDataSheet(wb, rows, true);
      addSummarySheet(wb, notes);
      const stamp = new Date().toISOString().slice(0, 10);
      await download(wb, notes.length === 1 ? `NF_${notes[0].metadata.number}` : `NF_CONSOLIDADO_${stamp}`);
    },
    _build: { addDataSheet, addSummarySheet, newBook } // usado nos testes
  };
})(typeof window !== "undefined" ? window : globalThis);
