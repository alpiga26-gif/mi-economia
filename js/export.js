/* Exportación a Excel (SheetJS) y PDF (jsPDF + autotable) */
(function (App) {
  App.exportXLSX = (filename, sheets) => {
    if (!window.XLSX) return App.toast('La librería de Excel no está disponible (¿sin conexión?)');
    const wb = XLSX.utils.book_new();
    sheets.forEach(sh => {
      const ws = Array.isArray(sh.rows[0]) || !sh.rows.length ? XLSX.utils.aoa_to_sheet(sh.rows.length ? sh.rows : [['Sin datos']]) : XLSX.utils.json_to_sheet(sh.rows);
      // anchos de columna aproximados
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      ws['!cols'] = (data[0] || []).map((_, i) => ({ wch: Math.min(60, Math.max(8, ...data.slice(0, 200).map(r => String(r[i] ?? '').length + 2))) }));
      // formato numérico en celdas numéricas
      Object.keys(ws).forEach(k => { if (k[0] !== '!' && ws[k].t === 'n' && sh.money !== false) ws[k].z = '#,##0.00'; });
      if (sh.autofilter !== false && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, '-'));
    });
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
  };

  /* sections: [{heading, head:[...], body:[[...]], chart: canvas}] */
  App.exportPDF = (filename, title, subtitle, sections, opts = {}) => {
    if (!window.jspdf) return App.toast('La librería de PDF no está disponible (¿sin conexión?)');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(title, 14, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(subtitle || '', 14, 22); doc.text('Generado el ' + App.fdate(App.today()), W - 14, 22, { align: 'right' });
    doc.setTextColor(0);
    let y = 28;
    sections.forEach(sec => {
      if (y > H - 40) { doc.addPage(); y = 16; }
      if (sec.heading) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(sec.heading, 14, y + 4); doc.setFont('helvetica', 'normal'); y += 7; }
      if (sec.chart) {
        try {
          const img = sec.chart.toDataURL('image/png', 1); const ratio = sec.chart.height / sec.chart.width; const w = W - 28; const h = Math.min(90, w * ratio);
          if (y + h > H - 12) { doc.addPage(); y = 16; }
          doc.addImage(img, 'PNG', 14, y, h / ratio > w ? w : h / ratio, h); y += h + 4;
        } catch (e) { console.warn(e); }
      }
      if (sec.head) {
        doc.autoTable({
          startY: y, head: [sec.head], body: sec.body, foot: sec.foot ? [sec.foot] : undefined, theme: 'grid', margin: { left: 14, right: 14 },
          styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' }, headStyles: { fillColor: [28, 92, 171], textColor: 255 }, footStyles: { fillColor: [240, 239, 236], textColor: 20, fontStyle: 'bold' },
          columnStyles: sec.numCols ? Object.fromEntries(sec.numCols.map(i => [i, { halign: 'right' }])) : {}
        });
        y = doc.lastAutoTable.finalY + 8;
      }
    });
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Mi Economía · página ${i} de ${pages}`, W / 2, H - 6, { align: 'center' }); }
    doc.save(filename.endsWith('.pdf') ? filename : filename + '.pdf');
  };

  /* Movimientos en formato tabla Excel (mismas columnas que tus libros X-*) */
  App.movsToRows = (movs) => movs.map(m => ({
    Estado: m.estado, Fecha_p: App.fdate(m.fecha), Fecha_Valor: App.fdate(m.fechaValor), Importe: m.importe, Saldo: m.saldo ?? '',
    Concepto: m.concepto, Observaciones: m.obs || '', Tipo: m.tipo, IdArea: m.area, Area: App.areaName(m.area), Agrup: m.agrup, Categoria: App.catName(m.agrup), Subcategoria: App.subName(m.agrup),
    Cuenta: m.cuenta, Activo: m.activo, Beneficiario: m.beneficiario, Mes_Rec: m.mesRec ? App.ym(m.mesRec) : '', IdRecibo: m.idRecibo, Cierre: m.cierre ? App.fdate(m.cierre) : '', Documento: m.doc?.url || ''
  }));
})(window.App);
