import mammoth from 'mammoth';
import type { DifficultyLevel, QuestionOption, QuestionType } from '../types.ts';

export interface ParsedWordQuestion {
  number: number;
  topic: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  weight: number;
  prompt: string;
  media_type: 'none' | 'image';
  media_url: string;
  options: QuestionOption[];
  correct_answer: string | string[];
  scoring_rule: Record<string, unknown>;
  explanation: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function htmlToStructuredLines(html: string): string[] {
  const tokens = html.split(/(<[^>]+>)/g);
  const listStack: Array<{ type: 'ol' | 'ul'; count: number }> = [];
  let out = '';
  let inTable = false;

  for (const tok of tokens) {
    if (!tok) continue;
    if (tok.startsWith('<')) {
      const lower = tok.toLowerCase();
      if (/^<ol[\s>]/.test(lower)) {
        listStack.push({ type: 'ol', count: 0 });
      } else if (/^<\/ol>/.test(lower)) {
        listStack.pop();
        out += '\n';
      } else if (/^<ul[\s>]/.test(lower)) {
        listStack.push({ type: 'ul', count: 0 });
      } else if (/^<\/ul>/.test(lower)) {
        listStack.pop();
        out += '\n';
      } else if (/^<li[\s>]/.test(lower)) {
        out += '\n';
        const top = listStack[listStack.length - 1];
        if (top && top.type === 'ol') {
          top.count += 1;
          if (listStack.length === 1) {
            out += `[[OL1:${top.count}]] `;
          } else {
            const letter = String.fromCharCode(64 + Math.min(26, top.count));
            out += `[[OL2:${letter}]] `;
          }
        }
      } else if (/^<\/li>/.test(lower)) {
        out += '\n';
      } else if (/^<table[\s>]/.test(lower)) {
        inTable = true;
        out += '\n';
      } else if (/^<\/table>/.test(lower)) {
        inTable = false;
        out += '\n';
      } else if (/^<tr[\s>]/.test(lower)) {
        out += '\n';
      } else if (/^<\/tr>/.test(lower)) {
        out += '\n';
      } else if (/^<\/(td|th)>/.test(lower)) {
        if (inTable) out += '\t';
      } else if (/^<br\s*\/?>$/.test(lower) || /^<\/?(p|div|h[1-6])[\s>]/.test(lower)) {
        out += '\n';
      } else if (/^<img[\s>]/.test(lower)) {
        const srcMatch = tok.match(/src=["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
          out += `\n[[IMG:${srcMatch[1]}]]\n`;
        }
      }
    } else {
      out += decodeHtmlEntities(tok);
    }
  }

  return out
    .split(/\r?\n/)
    .map((line) => {
      // Preserve tab delimiters inside table rows, collapse extra spaces otherwise
      if (line.includes('\t')) {
        return line
          .split('\t')
          .map((cell) => cell.replace(/\s+/g, ' ').trim())
          .join('\t')
          .trim();
      }
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function resolveListMarkers(lines: string[]): string[] {
  return lines.map((line) => {
    const m1 = line.match(/^\[\[OL1:(\d+)\]\]\s*(.*)$/);
    if (m1) {
      const rest = m1[2].trim();
      // If text inside <li> already begins with "1." or "A.", don't double-prefix
      if (/^(?:(?:No\.?|Soal)\s*)?\d+[.)]\s+/i.test(rest) || /^[A-E][.)]\s+/i.test(rest)) {
        return rest;
      }
      return `${m1[1]}. ${rest}`;
    }
    const m2 = line.match(/^\[\[OL2:([A-Z])\]\]\s*(.*)$/);
    if (m2) {
      const rest = m2[2].trim();
      if (/^[A-E][.)]\s+/i.test(rest)) {
        return rest;
      }
      return `${m2[1]}. ${rest}`;
    }
    return line;
  });
}

function extractImages(text: string): { cleanText: string; images: string[] } {
  const images: string[] = [];
  const cleanText = text
    .replace(/\[\[IMG:([^\]]+)\]\]/g, (_, url: string) => {
      if (url && url.trim()) images.push(url.trim());
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { cleanText, images };
}

function tryParseTableQuestions(lines: string[]): ParsedWordQuestion[] {
  const tableLines = lines.filter((l) => l.includes('\t'));
  if (tableLines.length === 0) return [];

  const parsed: ParsedWordQuestion[] = [];
  for (const row of tableLines) {
    const cells = row.split('\t').map((c) => c.trim());
    if (cells.length < 3) continue;
    // Skip header row like "No | Pertanyaan | A | B | C | D | Kunci"
    const firstNumMatch = cells[0].match(/^(\d+)[.)]?$/);
    if (!firstNumMatch) continue;
    const qNum = Number(firstNumMatch[1]);
    const promptExtracted = extractImages(cells[1]);
    let mediaUrl = promptExtracted.images[0] || '';
    const prompt = promptExtracted.cleanText || (mediaUrl ? 'Perhatikan gambar berikut!' : '');
    if (!prompt) continue;

    // Detect if cells 2..N contain options + possible key/explanation at the end
    const remaining = cells.slice(2).filter(Boolean);
    const options: QuestionOption[] = [];
    let correct = '';
    let explanation = '';

    for (let i = 0; i < remaining.length; i++) {
      const cell = remaining[i];
      const cellExtracted = extractImages(cell);
      const cellText = cellExtracted.cleanText;

      if (/^(?:kunci|jawaban|key)\s*[:=]?\s*/i.test(cellText)) {
        correct = cellText.replace(/^(?:kunci|jawaban|key)\s*[:=]?\s*/i, '').trim().toUpperCase();
      } else if (/^(?:pembahasan|penjelasan)\s*[:=]?\s*/i.test(cellText)) {
        explanation = cellText.replace(/^(?:pembahasan|penjelasan)\s*[:=]?\s*/i, '').trim();
      } else if (
        i === remaining.length - 1 &&
        /^[A-E](?:\s*,\s*[A-E])*$/i.test(cellText) &&
        options.length >= 2 &&
        cellExtracted.images.length === 0
      ) {
        correct = cellText.toUpperCase();
      } else if (options.length < 5) {
        const key = String.fromCharCode(65 + options.length);
        const stripped = cellText.replace(/^[A-E][.)]\s*/i, '').trim();
        options.push({
          key,
          text: stripped,
          ...(cellExtracted.images[0] ? { image_url: cellExtracted.images[0] } : {}),
        });
      } else if (!explanation) {
        explanation = cellText;
      }
      if (!mediaUrl && cellExtracted.images[0] && options.length === 0) {
        mediaUrl = cellExtracted.images[0];
      }
    }

    let type: QuestionType = 'pg';
    let correctAnswer: string | string[] = correct || (options[0]?.key ?? '');
    if (options.length === 0) {
      type = correct ? 'isian_singkat' : 'esai';
    } else if (correct.includes(',')) {
      type = 'pg_kompleks';
      correctAnswer = correct
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }

    parsed.push({
      number: qNum,
      topic: 'Impor Word',
      type,
      difficulty: 'sedang',
      weight: type === 'esai' ? 5 : 2,
      prompt,
      media_type: mediaUrl ? 'image' : 'none',
      media_url: mediaUrl,
      options,
      correct_answer: correctAnswer,
      scoring_rule: type === 'pg_kompleks' ? { mode: 'partial' } : {},
      explanation,
    });
  }

  return parsed;
}

export function parseWordLinesToQuestions(rawLines: string[]): ParsedWordQuestion[] {
  const lines = resolveListMarkers(rawLines);

  // If the document is primarily formatted as a Word table of questions, parse table rows first
  const tableQuestions = tryParseTableQuestions(lines);
  if (
    tableQuestions.length >= 2 ||
    (tableQuestions.length === 1 &&
      lines.filter((l) => l.includes('\t')).length >= 1 &&
      !lines.some((l) => /^\d+[.)]\s+/.test(l)))
  ) {
    return tableQuestions;
  }

  // Check if there is a trailing "KUNCI JAWABAN" section at the bottom of the document
  const globalKeys = new Map<number, string>();
  let contentLines = lines;
  const keyHeaderIdx = lines.findIndex((l) => /^(?:KUNCI\s*JAWABAN|ANSWER\s*KEY|KUNCI\s*SOAL)\b/i.test(l));
  if (keyHeaderIdx > 0) {
    const keySection = lines.slice(keyHeaderIdx + 1);
    contentLines = lines.slice(0, keyHeaderIdx);
    for (const kLine of keySection) {
      const pairs = [...kLine.matchAll(/(\d+)\s*[.):-]?\s*([A-E](?:\s*,\s*[A-E])*|Benar|Salah)/gi)];
      for (const m of pairs) {
        globalKeys.set(Number(m[1]), m[2].trim());
      }
    }
  }

  // Split into question blocks using numbered question markers: "1. ...", "1) ...", "No. 1 ...", "Soal 1 ..."
  const blocks: Array<{ number: number; lines: string[] }> = [];
  let current: { number: number; lines: string[] } | null = null;

  for (const line of contentLines) {
    const qStart = line.match(/^(?:(?:No\.?|Soal)\s*)?(\d{1,3})\s*[.)]\s*(.*)$/i);
    if (qStart && Number(qStart[1]) >= 1 && Number(qStart[1]) <= 500) {
      const num = Number(qStart[1]);
      const text = qStart[2].trim();
      if (current) blocks.push(current);
      current = { number: num, lines: text ? [text] : [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  const results: ParsedWordQuestion[] = [];

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx];
    const promptLines: string[] = [];
    const options: QuestionOption[] = [];
    let mediaUrl = '';
    let explicitKey = '';
    let markedKey = '';
    let explanation = '';
    let topic = '';
    let explicitType = '';
    let difficulty: DifficultyLevel = 'sedang';
    let weight: number | null = null;
    let rubric = '';

    for (let i = 0; i < block.lines.length; i++) {
      const rawLine = block.lines[i];
      const { cleanText: line, images: lineImages } = extractImages(rawLine);

      // Attach any images found on this line
      if (lineImages.length > 0) {
        if (options.length === 0) {
          if (!mediaUrl) mediaUrl = lineImages[0];
        } else {
          const lastOpt = options[options.length - 1];
          if (!lastOpt.image_url && !/^\(?[A-E]\)?[.)]/i.test(line)) {
            lastOpt.image_url = lineImages[0];
          }
        }
      }

      if (!line) continue;

      // Metadata lines
      const keyMatch = line.match(/^(?:Kunci(?:\s*Jawaban)?|Jawaban(?:\s*Benar)?|Key|KJ|Answer)\s*[:=]\s*(.+)$/i);
      const expMatch = line.match(/^(?:Pembahasan|Penjelasan|Explanation)\s*[:=]\s*(.+)$/i);
      const topicMatch = line.match(/^(?:Materi|Topik|Topic|KD)\s*[:=]\s*(.+)$/i);
      const diffMatch = line.match(/^(?:Kesulitan|Tingkat\s*Kesulitan|Level)\s*[:=]\s*(mudah|sedang|sukar|sulit)/i);
      const weightMatch = line.match(/^(?:Bobot|Skor|Poin)\s*[:=]\s*(\d+(?:[.,]\d+)?)/i);
      const typeMatch = line.match(/^(?:Jenis(?:\s*Soal)?|Tipe)\s*[:=]\s*(.+)$/i);
      const rubricMatch = line.match(/^(?:Rubrik|Pedoman)\s*[:=]\s*(.+)$/i);

      if (keyMatch) {
        explicitKey = keyMatch[1].trim();
        continue;
      }
      if (expMatch) {
        explanation = expMatch[1].trim();
        continue;
      }
      if (topicMatch) {
        topic = topicMatch[1].trim();
        continue;
      }
      if (diffMatch) {
        const d = diffMatch[1].toLowerCase();
        difficulty = d === 'sulit' ? 'sukar' : (d as DifficultyLevel);
        continue;
      }
      if (weightMatch) {
        weight = Number(weightMatch[1].replace(',', '.'));
        continue;
      }
      if (typeMatch) {
        explicitType = typeMatch[1].trim().toLowerCase();
        continue;
      }
      if (rubricMatch) {
        rubric = rubricMatch[1].trim();
        continue;
      }

      // Option lines: A. ..., *A. ..., (A) ..., A) ...
      const optMatch = line.match(/^(\*)?\s*\(?([A-E])\)?[.)]\s*(.*)$/i);
      if (optMatch) {
        const hasLeadingStar = Boolean(optMatch[1]);
        const key = optMatch[2].toUpperCase();
        let optText = optMatch[3].trim();
        const hasTrailingStar = /\s*\*$/.test(optText) || /\(benar\)$/i.test(optText);
        if (hasTrailingStar) {
          optText = optText.replace(/\s*\*$/, '').replace(/\s*\(benar\)$/i, '').trim();
        }
        if (hasLeadingStar || hasTrailingStar) {
          markedKey = markedKey ? `${markedKey},${key}` : key;
        }
        options.push({
          key,
          text: optText,
          ...(lineImages[0] ? { image_url: lineImages[0] } : {}),
        });
        continue;
      }

      // Continuation of prompt or explanation
      if (options.length === 0 && !explicitKey && !explanation) {
        promptLines.push(line);
      } else if (explanation) {
        explanation = `${explanation} ${line}`.trim();
      } else if (options.length > 0 && !explicitKey) {
        // Multi-line option continuation
        const lastOpt = options[options.length - 1];
        lastOpt.text = `${lastOpt.text} ${line}`.trim();
      }
    }

    const prompt = promptLines.join(' ').trim() || (mediaUrl ? 'Perhatikan gambar berikut!' : '');
    if (!prompt) continue;

    const rawKey = explicitKey || markedKey || globalKeys.get(block.number) || '';
    const upperKey = rawKey.toUpperCase();

    let resolvedType: QuestionType = 'pg';
    let finalOptions: QuestionOption[] = options;
    let finalCorrect: string | string[] = '';
    let scoringRule: Record<string, unknown> = {};

    if (explicitType.includes('esai') || explicitType.includes('uraian')) {
      resolvedType = 'esai';
    } else if (explicitType.includes('isian')) {
      resolvedType = 'isian_singkat';
    } else if (explicitType.includes('benar') || explicitType.includes('salah')) {
      resolvedType = 'benar_salah';
    } else if (explicitType.includes('kompleks')) {
      resolvedType = 'pg_kompleks';
    }

    if (options.length >= 2) {
      const optTextsLower = options.map((o) => o.text.trim().toLowerCase());
      const isTrueFalseOpts =
        options.length === 2 &&
        optTextsLower.includes('benar') &&
        optTextsLower.includes('salah');

      if (resolvedType === 'benar_salah' || isTrueFalseOpts) {
        resolvedType = 'benar_salah';
        finalOptions = [
          { key: 'BENAR', text: 'Benar' },
          { key: 'SALAH', text: 'Salah' },
        ];
        if (upperKey === 'B' || upperKey === 'SALAH') {
          finalCorrect = 'SALAH';
        } else {
          finalCorrect = 'BENAR';
        }
      } else if (
        resolvedType === 'pg_kompleks' ||
        /^[A-E](?:\s*(?:,|dan|&)\s*[A-E])+$/i.test(rawKey)
      ) {
        resolvedType = 'pg_kompleks';
        finalCorrect = upperKey
          .split(/(?:,|DAN|&)+/)
          .map((s) => s.trim())
          .filter((k) => /^[A-E]$/.test(k));
        if ((finalCorrect as string[]).length === 0 && options[0]) {
          finalCorrect = [options[0].key];
        }
        scoringRule = { mode: 'partial' };
      } else {
        resolvedType = 'pg';
        const singleMatch = upperKey.match(/[A-E]/);
        finalCorrect = singleMatch ? singleMatch[0] : options[0].key;
      }
    } else if (upperKey === 'BENAR' || upperKey === 'SALAH' || resolvedType === 'benar_salah') {
      resolvedType = 'benar_salah';
      finalOptions = [
        { key: 'BENAR', text: 'Benar' },
        { key: 'SALAH', text: 'Salah' },
      ];
      finalCorrect = upperKey === 'SALAH' ? 'SALAH' : 'BENAR';
    } else if (resolvedType === 'esai' || (!rawKey && resolvedType !== 'isian_singkat')) {
      resolvedType = 'esai';
      finalOptions = [];
      finalCorrect = '';
      scoringRule = { rubric: rubric || explanation || '' };
    } else {
      resolvedType = 'isian_singkat';
      finalOptions = [];
      finalCorrect = rawKey;
      scoringRule = { variations: [], case_sensitive: false };
    }

    results.push({
      number: block.number || bIdx + 1,
      topic: topic || 'Impor Word',
      type: resolvedType,
      difficulty,
      weight: weight ?? (resolvedType === 'esai' ? 5 : resolvedType === 'pg_kompleks' ? 3 : 2),
      prompt,
      media_type: mediaUrl ? 'image' : 'none',
      media_url: mediaUrl,
      options: finalOptions,
      correct_answer: finalCorrect,
      scoring_rule: scoringRule,
      explanation,
    });
  }

  return results;
}

export async function parseWordDocumentBuffer(buffer: Buffer, fileName: string): Promise<ParsedWordQuestion[]> {
  const lowerName = fileName.toLowerCase();

  // Check if file is a ZIP-based .docx (PK magic bytes)
  const isZipDocx = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (isZipDocx || lowerName.endsWith('.docx')) {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const htmlLines = htmlToStructuredLines(htmlResult.value || '');
    const fromHtml = parseWordLinesToQuestions(htmlLines);
    if (fromHtml.length > 0) return fromHtml;

    const rawResult = await mammoth.extractRawText({ buffer });
    const rawLines = (rawResult.value || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return parseWordLinesToQuestions(rawLines);
  }

  // Fallback for HTML-based .doc files or plain text .txt
  const textContent = buffer.toString('utf-8');
  if (/<html|<body|<p[\s>]|<ol[\s>]|<table[\s>]/i.test(textContent)) {
    const htmlLines = htmlToStructuredLines(textContent);
    return parseWordLinesToQuestions(htmlLines);
  }

  const plainLines = textContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return parseWordLinesToQuestions(plainLines);
}
