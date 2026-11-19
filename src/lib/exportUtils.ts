import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportToExcel(
  rows: Array<Record<string, unknown>>,
  sheetName: string,
  fileName: string
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportToCsv(
  rows: Array<Record<string, unknown>>,
  fileName: string
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPdf(
  title: string,
  subtitle: string,
  columns: string[],
  rows: Array<Array<string | number>>,
  fileName: string,
  schoolName = 'SMP Negeri 41 Muaro Jambi'
): void {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.setFillColor(10, 25, 47);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('SMART CBT – DIGITAL EXAMINATION SYSTEM', 14, 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(schoolName, 14, 19);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 38);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${subtitle} · Dicetak: ${new Date().toLocaleString('id-ID')}`, 14, 44);

  autoTable(doc, {
    startY: 50,
    head: [columns],
    body: rows,
    theme: 'grid',
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [15, 23, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${fileName}.pdf`);
}

export function downloadStudentTemplate(): void {
  const sample = [
    {
      nis: '2409099',
      nama: 'Bintang Ramadhan',
      kelas: 'IX-A',
      username: 'bintang.r',
      password: 'password123',
      status: 'aktif',
    },
  ];
  exportToExcel(sample, 'Template Siswa', 'Template_Impor_Siswa_SMPN41');
}

export function downloadTeacherTemplate(): void {
  const sample = [
    {
      nip: '198805122015031002',
      nama: 'Dewi Lestari, S.Pd.',
      username: 'dewi.lestari',
      password: 'guru123',
      mapel: 'MTK, IPA',
      peran: 'guru',
      status: 'aktif',
    },
  ];
  exportToExcel(sample, 'Template Guru', 'Template_Impor_Guru_SMPN41');
}

export function downloadQuestionTemplate(): void {
  const sample = [
    {
      kode_mapel: 'MTK',
      kelas: 9,
      materi: 'Aljabar',
      jenis: 'pg',
      kesulitan: 'sedang',
      bobot: 2,
      pertanyaan: 'Hasil dari 2x + 3x adalah ...',
      opsi_a: '5x',
      opsi_b: '6x',
      opsi_c: '5x^2',
      opsi_d: '6x^2',
      kunci: 'A',
      pembahasan: 'Suku sejenis dijumlahkan koefisiennya: 2 + 3 = 5, sehingga 5x.',
    },
  ];
  exportToExcel(sample, 'Template Soal', 'Template_Impor_Bank_Soal');
}

export function downloadWordQuestionTemplate(): void {
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Template Soal Word - SMART CBT</title></head>
<body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5;">
  <p><strong>TEMPLATE BANK SOAL WORD – SMART CBT</strong></p>
  <p><em>Petunjuk: Anda dapat menambah atau mengurangi jumlah soal sesuai kebutuhan (1, 2, 3, ... sampai berapapun). Simpan sebagai .docx sebelum diunggah.</em></p>
  <p>1. Berapakah hasil dari 12 x 8?<br/>
  A. 86<br/>
  B. 96<br/>
  C. 106<br/>
  D. 116<br/>
  Kunci: B<br/>
  Pembahasan: 12 dikali 8 sama dengan 96.</p>

  <p>2. Pilihlah dua pernyataan bilangan berpangkat yang bernilai benar:<br/>
  A. 2^3 x 2^4 = 2^7<br/>
  B. (3^2)^3 = 3^5<br/>
  C. 5^0 = 1<br/>
  D. 4^-1 = -4<br/>
  Kunci: A, C<br/>
  Pembahasan: 2^(3+4) = 2^7 dan 5^0 = 1.</p>

  <p>3. Ibu kota Provinsi Jambi adalah ...<br/>
  Kunci: Jambi<br/>
  Pembahasan: Kota Jambi merupakan ibu kota Provinsi Jambi.</p>

  <p>4. Jelaskan secara singkat manfaat energi matahari bagi tumbuhan hijau!<br/>
  Jenis: Esai<br/>
  Pembahasan: Energi matahari digunakan dalam proses fotosintesis untuk menghasilkan glukosa dan oksigen.</p>
</body>
</html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Template_Soal_Word_SMPN41.doc';
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseSpreadsheetFile(file: File): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
    defval: '',
  });
}

export function parseDocumentQuestions(rawText: string, defaultSubjectId: number) {
  const blocks = rawText
    .split(/\n(?=\d+\.\s)/g)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0].replace(/^\d+\.\s*/, '').trim();
    const options: Array<{ key: string; text: string }> = [];
    let kunci = '';
    let pembahasan = '';
    const promptLines = [firstLine];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const optMatch = line.match(/^([A-E])[.)]\s*(.+)$/i);
      const keyMatch = line.match(/^Kunci\s*:\s*(.+)$/i);
      const expMatch = line.match(/^Pembahasan\s*:\s*(.+)$/i);
      if (optMatch) {
        options.push({ key: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
      } else if (keyMatch) {
        kunci = keyMatch[1].trim().toUpperCase();
      } else if (expMatch) {
        pembahasan = expMatch[1].trim();
      } else if (options.length === 0) {
        promptLines.push(line);
      }
    }

    const type = options.length >= 2 ? 'pg' : 'isian_singkat';
    return {
      subject_id: defaultSubjectId,
      grade_level: 9,
      topic: 'Impor Dokumen',
      type,
      difficulty: 'sedang',
      weight: 2,
      prompt: promptLines.join(' '),
      options,
      correct_answer: kunci || (options[0]?.key ?? ''),
      explanation: pembahasan,
    };
  });
}
