import React, { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Edit3,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  downloadQuestionTemplate,
  downloadWordQuestionTemplate,
  parseDocumentQuestions,
  parseSpreadsheetFile,
} from '../lib/exportUtils';
import { MathText } from '../components/MathText';
import { ConfirmModal } from '../components/ConfirmModal';
import type {
  DifficultyLevel,
  MatchingPair,
  MediaType,
  Question,
  QuestionOption,
  QuestionType,
  Subject,
} from '../types';

const TYPE_LABELS: Record<QuestionType, string> = {
  pg: 'Pilihan Ganda',
  pg_kompleks: 'PG Kompleks',
  benar_salah: 'Benar / Salah',
  menjodohkan: 'Menjodohkan',
  isian_singkat: 'Isian Singkat',
  esai: 'Uraian / Esai',
};

const DIFF_LABELS: Record<DifficultyLevel, string> = {
  mudah: 'Mudah',
  sedang: 'Sedang',
  sukar: 'Sukar',
};

interface QuestionBankPageProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export const QuestionBankPage: React.FC<QuestionBankPageProps> = ({ onToast }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [subjectFilter, setSubjectFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [diffFilter, setDiffFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'none'>('all');
  const [search, setSearch] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [docImportOpen, setDocImportOpen] = useState(false);
  const [wordImportOpen, setWordImportOpen] = useState(false);
  const [editingQ, setEditingQ] = useState<Question | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);

  // Question editor states
  const [subjectId, setSubjectId] = useState<number>(1);
  const [gradeLevel, setGradeLevel] = useState<number>(9);
  const [topic, setTopic] = useState('');
  const [qType, setQType] = useState<QuestionType>('pg');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('sedang');
  const [weight, setWeight] = useState<number>(2);
  const [prompt, setPrompt] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [pgOptions, setPgOptions] = useState<QuestionOption[]>([
    { key: 'A', text: '' },
    { key: 'B', text: '' },
    { key: 'C', text: '' },
    { key: 'D', text: '' },
  ]);
  const [singleCorrect, setSingleCorrect] = useState('A');
  const [multiCorrect, setMultiCorrect] = useState<string[]>(['A']);
  const [complexMode, setComplexMode] = useState<'partial' | 'all_or_nothing'>('partial');
  const [matchingPairs, setMatchingPairs] = useState<MatchingPair[]>([
    { id: 'p1', left: '', right: '' },
    { id: 'p2', left: '', right: '' },
    { id: 'p3', left: '', right: '' },
  ]);
  const [shortAnswer, setShortAnswer] = useState('');
  const [shortVariations, setShortVariations] = useState('');
  const [shortCaseSensitive, setShortCaseSensitive] = useState(false);
  const [essayRubric, setEssayRubric] = useState('');
  const [explanation, setExplanation] = useState('');

  // Document import state
  const [docText, setDocText] = useState('');
  const [docSubjectId, setDocSubjectId] = useState<number>(1);

  // Word (.docx) upload state
  const [wordSubjectId, setWordSubjectId] = useState<number>(1);
  const [wordGradeLevel, setWordGradeLevel] = useState<number>(9);
  const [wordTopic, setWordTopic] = useState<string>('');
  const [wordFileName, setWordFileName] = useState<string>('');
  const [wordParsing, setWordParsing] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);
  const [isDraggingWord, setIsDraggingWord] = useState(false);
  const [parsedWordQuestions, setParsedWordQuestions] = useState<
    Array<{
      selected: boolean;
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
    }>
  >([]);

  const excelInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [qRes, sRes] = await Promise.all([
        apiFetch<Question[]>(
          `/api/questions?subject_id=${subjectFilter}&grade_level=${gradeFilter}&difficulty=${diffFilter}&type=${typeFilter}&search=${encodeURIComponent(search)}`
        ),
        apiFetch<Subject[]>('/api/subjects'),
      ]);
      setQuestions(qRes);
      setSubjects(sRes);
      if (sRes.length > 0 && !sRes.some((s) => s.id === subjectId)) {
        setSubjectId(sRes[0].id);
        setDocSubjectId(sRes[0].id);
        setWordSubjectId(sRes[0].id);
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memuat bank soal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [subjectFilter, gradeFilter, diffFilter, typeFilter]);

  const openCreate = () => {
    setEditingQ(null);
    setSubjectId(subjects[0]?.id || 1);
    setGradeLevel(9);
    setTopic('');
    setQType('pg');
    setDifficulty('sedang');
    setWeight(2);
    setPrompt('');
    setMediaType('none');
    setMediaUrl('');
    setPgOptions([
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ]);
    setSingleCorrect('A');
    setMultiCorrect(['A']);
    setComplexMode('partial');
    setMatchingPairs([
      { id: 'p1', left: '', right: '' },
      { id: 'p2', left: '', right: '' },
      { id: 'p3', left: '', right: '' },
    ]);
    setShortAnswer('');
    setShortVariations('');
    setShortCaseSensitive(false);
    setEssayRubric('');
    setExplanation('');
    setEditorOpen(true);
  };

  const openEdit = (q: Question) => {
    setEditingQ(q);
    setSubjectId(q.subject_id);
    setGradeLevel(q.grade_level);
    setTopic(q.topic);
    setQType(q.type);
    setDifficulty(q.difficulty);
    setWeight(q.weight);
    setPrompt(q.prompt);
    setMediaType(q.media_type);
    setMediaUrl(q.media_url);
    setExplanation(q.explanation || '');

    if (q.type === 'pg' || q.type === 'pg_kompleks') {
      const opts = (q.options as QuestionOption[]) || [];
      setPgOptions(
        opts.length >= 2
          ? opts
          : [
              { key: 'A', text: '' },
              { key: 'B', text: '' },
              { key: 'C', text: '' },
              { key: 'D', text: '' },
            ]
      );
      if (q.type === 'pg') setSingleCorrect(String(q.correct_answer || 'A'));
      else {
        setMultiCorrect(Array.isArray(q.correct_answer) ? (q.correct_answer as string[]) : ['A']);
        setComplexMode(q.scoring_rule?.mode || 'partial');
      }
    } else if (q.type === 'benar_salah') {
      setSingleCorrect(String(q.correct_answer || 'BENAR'));
    } else if (q.type === 'menjodohkan') {
      setMatchingPairs((q.options as MatchingPair[]) || []);
    } else if (q.type === 'isian_singkat') {
      setShortAnswer(String(q.correct_answer || ''));
      setShortVariations((q.scoring_rule?.variations || []).join(', '));
      setShortCaseSensitive(Boolean(q.scoring_rule?.case_sensitive));
    } else if (q.type === 'esai') {
      setEssayRubric(q.scoring_rule?.rubric || '');
    }
    setEditorOpen(true);
  };

  const handleTypeChange = (nextType: QuestionType) => {
    setQType(nextType);
    if (nextType === 'benar_salah') {
      setSingleCorrect('BENAR');
    } else if (nextType === 'pg') {
      setSingleCorrect('A');
    }
  };

  const readImageAsDataUrl = (file: File, onLoaded: (dataUrl: string) => void) => {
    if (file.size > 4 * 1024 * 1024) {
      onToast('error', 'Ukuran file media maksimal 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onLoaded(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleMediaFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageAsDataUrl(file, (url) => setMediaUrl(url));
    e.target.value = '';
  };

  const handleOptionImageUpload = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageAsDataUrl(file, (url) => {
      setPgOptions((prev) => prev.map((opt, i) => (i === idx ? { ...opt, image_url: url } : opt)));
    });
    e.target.value = '';
  };

  const handleWordQuestionImageUpload = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageAsDataUrl(file, (url) => {
      setParsedWordQuestions((prev) =>
        prev.map((q, i) => (i === idx ? { ...q, media_type: 'image', media_url: url } : q))
      );
    });
    e.target.value = '';
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();

    let optionsPayload: unknown = [];
    let correctPayload: unknown = '';
    let rulePayload: Record<string, unknown> = {};

    if (qType === 'pg') {
      optionsPayload = pgOptions;
      correctPayload = singleCorrect;
    } else if (qType === 'pg_kompleks') {
      optionsPayload = pgOptions;
      correctPayload = multiCorrect;
      rulePayload = { mode: complexMode };
    } else if (qType === 'benar_salah') {
      optionsPayload = [
        { key: 'BENAR', text: 'Benar' },
        { key: 'SALAH', text: 'Salah' },
      ];
      correctPayload = singleCorrect === 'SALAH' ? 'SALAH' : 'BENAR';
    } else if (qType === 'menjodohkan') {
      optionsPayload = matchingPairs;
      const map: Record<string, string> = {};
      for (const p of matchingPairs) {
        if (p.id && p.right) map[p.id] = p.right;
      }
      correctPayload = map;
    } else if (qType === 'isian_singkat') {
      correctPayload = shortAnswer;
      rulePayload = {
        variations: shortVariations
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        case_sensitive: shortCaseSensitive,
      };
    } else if (qType === 'esai') {
      rulePayload = { rubric: essayRubric };
    }

    const body = {
      subject_id: subjectId,
      grade_level: gradeLevel,
      topic: topic || 'Umum',
      type: qType,
      difficulty,
      weight,
      prompt,
      media_type: mediaType,
      media_url: mediaType === 'none' ? '' : mediaUrl,
      options: optionsPayload,
      correct_answer: correctPayload,
      scoring_rule: rulePayload,
      explanation,
    };

    try {
      if (editingQ) {
        await apiFetch(`/api/questions/${editingQ.id}`, { method: 'PUT', body: JSON.stringify(body) });
        onToast('success', 'Soal berhasil diperbarui.');
      } else {
        await apiFetch('/api/questions', { method: 'POST', body: JSON.stringify(body) });
        onToast('success', 'Soal baru berhasil disimpan ke Bank Soal.');
      }
      setEditorOpen(false);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menyimpan soal.');
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      await apiFetch(`/api/questions/${id}/duplicate`, { method: 'POST' });
      onToast('success', 'Soal berhasil digandakan.');
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menggandakan soal.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/questions/${deleteTarget.id}`, { method: 'DELETE' });
      onToast('success', 'Soal berhasil dihapus.');
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal menghapus soal.');
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      const items = rows.map((r) => {
        const opts: QuestionOption[] = [];
        if (r.opsi_a) opts.push({ key: 'A', text: String(r.opsi_a) });
        if (r.opsi_b) opts.push({ key: 'B', text: String(r.opsi_b) });
        if (r.opsi_c) opts.push({ key: 'C', text: String(r.opsi_c) });
        if (r.opsi_d) opts.push({ key: 'D', text: String(r.opsi_d) });
        if (r.opsi_e) opts.push({ key: 'E', text: String(r.opsi_e) });
        return {
          subject_code: String(r.kode_mapel || ''),
          grade_level: Number(r.kelas || 9),
          topic: String(r.materi || 'Umum'),
          type: String(r.jenis || 'pg'),
          difficulty: String(r.kesulitan || 'sedang'),
          weight: Number(r.bobot || 2),
          prompt: String(r.pertanyaan || ''),
          options: opts,
          correct_answer: String(r.kunci || 'A'),
          explanation: String(r.pembahasan || ''),
        };
      });
      const res = await apiFetch<{ inserted: number }>('/api/questions/import', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      onToast('success', `${res.inserted} soal berhasil diimpor dari Excel.`);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengimpor file Excel.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDocImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseDocumentQuestions(docText, docSubjectId);
    if (parsed.length === 0) {
      onToast('error', 'Format teks soal tidak terdeteksi. Pastikan diawali nomor (1. ...).');
      return;
    }
    try {
      const res = await apiFetch<{ inserted: number }>('/api/questions/import', {
        method: 'POST',
        body: JSON.stringify({ items: parsed }),
      });
      onToast('success', `${res.inserted} soal berhasil diimpor dari dokumen.`);
      setDocImportOpen(false);
      setDocText('');
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengimpor dokumen soal.');
    }
  };

  const openWordUploadModal = () => {
    setWordSubjectId(subjects[0]?.id || 1);
    setWordGradeLevel(9);
    setWordTopic('');
    setWordFileName('');
    setParsedWordQuestions([]);
    setWordImportOpen(true);
  };

  const processWordFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      onToast('error', 'Ukuran berkas Word maksimal 10 MB.');
      return;
    }
    setWordParsing(true);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca file Word.'));
        reader.readAsDataURL(file);
      });

      const res = await apiFetch<{
        count: number;
        questions: Array<{
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
        }>;
      }>('/api/questions/parse-word', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileBase64 }),
      });

      setWordFileName(file.name);
      setParsedWordQuestions(res.questions.map((q) => ({ ...q, selected: true })));
      onToast('success', `Berhasil membaca ${res.count} soal dari berkas Word.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal memproses berkas Word.');
    } finally {
      setWordParsing(false);
    }
  };

  const handleWordFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processWordFile(file);
    }
    e.target.value = '';
  };

  const handleConfirmWordImport = async () => {
    const selectedItems = parsedWordQuestions.filter((q) => q.selected);
    if (selectedItems.length === 0) {
      onToast('error', 'Pilih minimal 1 soal untuk diimpor.');
      return;
    }
    setWordImporting(true);
    try {
      const items = selectedItems.map((q) => ({
        subject_id: wordSubjectId,
        grade_level: wordGradeLevel,
        topic: wordTopic.trim() || q.topic || 'Impor Word',
        type: q.type,
        difficulty: q.difficulty,
        weight: q.weight,
        prompt: q.prompt,
        media_type: q.media_type,
        media_url: q.media_url,
        options: q.options,
        correct_answer: q.correct_answer,
        scoring_rule: q.scoring_rule,
        explanation: q.explanation,
      }));
      const res = await apiFetch<{ inserted: number }>('/api/questions/import', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      onToast('success', `${res.inserted} soal dari berkas Word berhasil ditambahkan ke Bank Soal.`);
      setWordImportOpen(false);
      setWordFileName('');
      setParsedWordQuestions([]);
      loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Gagal mengimpor soal dari berkas Word.');
    } finally {
      setWordImporting(false);
    }
  };

  const filtered = questions.filter((q) => {
    const hasOptionImage =
      Array.isArray(q.options) &&
      (q.options as QuestionOption[]).some((opt) => Boolean(opt && typeof opt === 'object' && 'image_url' in opt && opt.image_url));
    const hasImage = (q.media_type === 'image' && Boolean(q.media_url)) || hasOptionImage;
    if (mediaFilter === 'image' && !hasImage) return false;
    if (mediaFilter === 'none' && (q.media_type !== 'none' || hasOptionImage)) return false;

    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return q.prompt.toLowerCase().includes(s) || q.topic.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari isi soal atau materi..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>

            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Mapel</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Kelas</option>
              <option value="7">Kelas VII</option>
              <option value="8">Kelas VIII</option>
              <option value="9">Kelas IX</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Jenis</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={diffFilter}
              onChange={(e) => setDiffFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Kesulitan</option>
              <option value="mudah">Mudah</option>
              <option value="sedang">Sedang</option>
              <option value="sukar">Sukar</option>
            </select>

            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value as 'all' | 'image' | 'none')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="all">Semua Media</option>
              <option value="image">Soal Bergambar</option>
              <option value="none">Tanpa Gambar</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadQuestionTemplate}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              Template Excel
            </button>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => excelInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Impor Excel
            </button>
            <button
              type="button"
              onClick={openWordUploadModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
            >
              <FileUp className="h-3.5 w-3.5" />
              Upload Soal Word
            </button>
            <button
              type="button"
              onClick={() => setDocImportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5" />
              Tempel Teks
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              Buat Soal Baru
            </button>
          </div>
        </div>
      </div>

      {/* Question Cards List */}
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-500 rounded-xl border border-slate-200 bg-white">
          Memuat bank soal...
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm font-medium text-slate-700">Belum ada soal yang sesuai filter.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-lg"
          >
            Buat Soal Pertama
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((q, idx) => (
            <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-800">#{idx + 1}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-blue-700">{q.subject_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>Kelas {q.grade_level}</span>
                    <span aria-hidden="true">·</span>
                    <span>{q.topic}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700">{TYPE_LABELS[q.type]}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        q.difficulty === 'sukar'
                          ? 'text-red-600 font-medium'
                          : q.difficulty === 'sedang'
                          ? 'text-amber-600 font-medium'
                          : 'text-emerald-600 font-medium'
                      }
                    >
                      {DIFF_LABELS[q.difficulty]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Bobot {q.weight}</span>
                    {((q.media_type === 'image' && q.media_url) ||
                      (Array.isArray(q.options) &&
                        (q.options as QuestionOption[]).some((opt) => opt.image_url))) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <ImageIcon className="h-3 w-3" />
                          Bergambar
                        </span>
                      </>
                    )}
                  </div>

                  <div className="text-sm text-slate-900 leading-relaxed">
                    <MathText text={q.prompt} />
                  </div>

                  {q.media_type === 'image' && q.media_url && (
                    <img
                      src={q.media_url}
                      alt="Lampiran soal"
                      referrerPolicy="no-referrer"
                      className="max-h-48 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                  )}

                  {Array.isArray(q.options) && q.options.length > 0 && q.type !== 'menjodohkan' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {(q.options as QuestionOption[]).map((opt) => {
                        const isKey = Array.isArray(q.correct_answer)
                          ? q.correct_answer.includes(opt.key)
                          : String(q.correct_answer) === opt.key;
                        return (
                          <div
                            key={opt.key}
                            className={`text-xs px-3 py-1.5 rounded-lg border space-y-1.5 ${
                              isKey
                                ? 'border-emerald-300 bg-emerald-50/70 text-emerald-900 font-medium'
                                : 'border-slate-200 bg-slate-50/50 text-slate-700'
                            }`}
                          >
                            <div>
                              <span className="font-mono font-semibold mr-1.5">{opt.key}.</span>
                              {opt.text && <MathText text={opt.text} />}
                            </div>
                            {opt.image_url && (
                              <img
                                src={opt.image_url}
                                alt={`Gambar opsi ${opt.key}`}
                                referrerPolicy="no-referrer"
                                className="max-h-24 rounded border border-slate-200 bg-white object-contain"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {q.type === 'menjodohkan' && Array.isArray(q.options) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-xs">
                      {(q.options as MatchingPair[]).map((p) => (
                        <div key={p.id} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                          <span className="font-medium">{p.left}</span> → <span className="text-emerald-700 font-medium">{p.right}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {q.type === 'isian_singkat' && (
                    <div className="text-xs text-emerald-700">
                      Kunci jawaban: <span className="font-mono font-semibold">{String(q.correct_answer)}</span>
                      {q.scoring_rule?.variations?.length ? (
                        <span className="text-slate-500">
                          {' '}
                          (Variasi: {q.scoring_rule.variations.join(', ')})
                        </span>
                      ) : null}
                    </div>
                  )}

                  {q.explanation && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <span className="font-semibold text-slate-800">Pembahasan: </span>
                      <MathText text={q.explanation} />
                    </div>
                  )}
                </div>

                <div className="flex sm:flex-col items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(q)}
                    className="p-2 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                    title="Edit Soal"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(q.id)}
                    className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                    title="Gandakan Soal"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(q)}
                    className="p-2 text-slate-500 hover:text-red-600 rounded-lg hover:bg-red-50"
                    title="Hapus Soal"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Question Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingQ ? 'Edit Butir Soal' : 'Buat Butir Soal Baru'}
              </h3>
              <button type="button" onClick={() => setEditorOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mata Pelajaran</label>
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tingkat Kelas</label>
                  <select
                    value={gradeLevel}
                    onChange={(e) => setGradeLevel(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value={7}>Kelas VII</option>
                    <option value={8}>Kelas VIII</option>
                    <option value={9}>Kelas IX</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Materi / Topik</label>
                  <input
                    type="text"
                    required
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Contoh: Persamaan Kuadrat"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Soal</label>
                  <select
                    value={qType}
                    onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tingkat Kesulitan</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="mudah">Mudah</option>
                    <option value="sedang">Sedang</option>
                    <option value="sukar">Sukar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bobot Nilai</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={0.5}
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Pertanyaan (Mendukung rumus LaTeX dengan tanda $...$)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: 'Pecahan', tex: '$\\frac{a}{b}$' },
                      { label: 'Akar', tex: '$\\sqrt{x}$' },
                      { label: 'Pangkat', tex: '$x^2$' },
                      { label: 'Pi', tex: '$\\pi$' },
                    ].map((snip) => (
                      <button
                        key={snip.label}
                        type="button"
                        onClick={() => setPrompt((p) => `${p} ${snip.tex}`.trim())}
                        className="px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100"
                      >
                        + {snip.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={3}
                  required
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Tulis pertanyaan di sini. Gunakan $...$ untuk rumus matematika."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
                {prompt.includes('$') && (
                  <div className="mt-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <span className="font-semibold text-slate-500 mr-2">Pratinjau Rumus:</span>
                    <MathText text={prompt} />
                  </div>
                )}
              </div>

              {/* Media Attachment */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Lampiran Media</label>
                    <select
                      value={mediaType}
                      onChange={(e) => setMediaType(e.target.value as MediaType)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="none">Tanpa Media</option>
                      <option value="image">Gambar (Soal Bergambar)</option>
                      <option value="audio">Audio</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                  {mediaType !== 'none' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">URL Media / Data</label>
                        <input
                          type="text"
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="Tempel URL atau unggah file..."
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                        />
                      </div>
                      <div>
                        <label className="inline-flex items-center justify-center w-full gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                          <Upload className="h-3.5 w-3.5" />
                          Unggah File {mediaType === 'image' ? 'Gambar' : 'Media'}
                          <input
                            type="file"
                            accept={mediaType === 'image' ? 'image/*' : mediaType === 'audio' ? 'audio/*' : 'video/*'}
                            onChange={handleMediaFileUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>

                {mediaType === 'image' && mediaUrl && (
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <img
                      src={mediaUrl}
                      alt="Pratinjau gambar soal"
                      referrerPolicy="no-referrer"
                      className="max-h-36 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setMediaUrl('')}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Hapus Gambar
                    </button>
                  </div>
                )}
              </div>

              {/* Type-specific Answer Configuration */}
              {(qType === 'pg' || qType === 'pg_kompleks') && (
                <div className="space-y-2.5 border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Opsi Jawaban & Kunci ({qType === 'pg' ? 'Pilih 1 Kunci' : 'Centang Semua Kunci Benar'})
                    </span>
                    {qType === 'pg_kompleks' && (
                      <select
                        value={complexMode}
                        onChange={(e) => setComplexMode(e.target.value as 'partial' | 'all_or_nothing')}
                        className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white"
                      >
                        <option value="partial">Skor Parsial (Proporsional)</option>
                        <option value="all_or_nothing">Semua Harus Benar</option>
                      </select>
                    )}
                  </div>
                  {pgOptions.map((opt, idx) => (
                    <div key={opt.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        {qType === 'pg' ? (
                          <input
                            type="radio"
                            name="pg-correct"
                            checked={singleCorrect === opt.key}
                            onChange={() => setSingleCorrect(opt.key)}
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={multiCorrect.includes(opt.key)}
                            onChange={(e) =>
                              setMultiCorrect((prev) =>
                                e.target.checked ? [...prev, opt.key] : prev.filter((k) => k !== opt.key)
                              )
                            }
                          />
                        )}
                        <span className="w-6 text-xs font-mono font-bold text-slate-700">{opt.key}.</span>
                        <input
                          type="text"
                          required={!opt.image_url}
                          value={opt.text}
                          onChange={(e) => {
                            const next = [...pgOptions];
                            next[idx] = { ...opt, text: e.target.value };
                            setPgOptions(next);
                          }}
                          placeholder={`Isi pilihan ${opt.key} (atau unggah gambar)`}
                          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300"
                        />
                        <label
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer shrink-0"
                          title={`Unggah gambar untuk opsi ${opt.key}`}
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>Gambar</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleOptionImageUpload(idx, e)}
                            className="hidden"
                          />
                        </label>
                      </div>
                      {opt.image_url && (
                        <div className="ml-8 flex items-center gap-2">
                          <img
                            src={opt.image_url}
                            alt={`Pratinjau opsi ${opt.key}`}
                            referrerPolicy="no-referrer"
                            className="max-h-20 rounded border border-slate-200 bg-white object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...pgOptions];
                              next[idx] = { ...opt, image_url: undefined };
                              setPgOptions(next);
                            }}
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            Hapus Gambar Opsi
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {pgOptions.length < 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPgOptions([...pgOptions, { key: String.fromCharCode(65 + pgOptions.length), text: '' }])
                      }
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      + Tambah Opsi E
                    </button>
                  )}
                </div>
              )}

              {qType === 'benar_salah' && (
                <div className="border-t border-slate-200 pt-3">
                  <span className="block text-xs font-semibold text-slate-800 mb-2">Kunci Jawaban</span>
                  <div className="flex gap-4">
                    {['BENAR', 'SALAH'].map((val) => (
                      <label key={val} className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                        <input
                          type="radio"
                          name="bs-correct"
                          checked={singleCorrect === val}
                          onChange={() => setSingleCorrect(val)}
                        />
                        <span>{val === 'BENAR' ? 'Benar' : 'Salah'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {qType === 'menjodohkan' && (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">Pasangan Pernyataan & Jawaban</span>
                    <button
                      type="button"
                      onClick={() =>
                        setMatchingPairs([...matchingPairs, { id: `p${matchingPairs.length + 1}`, left: '', right: '' }])
                      }
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      + Tambah Pasangan
                    </button>
                  </div>
                  {matchingPairs.map((pair, idx) => (
                    <div key={pair.id} className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        placeholder={`Pernyataan ${idx + 1}`}
                        value={pair.left}
                        onChange={(e) => {
                          const next = [...matchingPairs];
                          next[idx] = { ...pair, left: e.target.value };
                          setMatchingPairs(next);
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg border border-slate-300"
                      />
                      <input
                        type="text"
                        required
                        placeholder={`Pasangan Benar ${idx + 1}`}
                        value={pair.right}
                        onChange={(e) => {
                          const next = [...matchingPairs];
                          next[idx] = { ...pair, right: e.target.value };
                          setMatchingPairs(next);
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg border border-slate-300"
                      />
                    </div>
                  ))}
                </div>
              )}

              {qType === 'isian_singkat' && (
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Kunci Jawaban Utama</label>
                    <input
                      type="text"
                      required
                      value={shortAnswer}
                      onChange={(e) => setShortAnswer(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Variasi Jawaban Diterima (pisahkan dengan koma)
                    </label>
                    <input
                      type="text"
                      value={shortVariations}
                      onChange={(e) => setShortVariations(e.target.value)}
                      placeholder="Contoh: (3, 4), 3,4"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shortCaseSensitive}
                      onChange={(e) => setShortCaseSensitive(e.target.checked)}
                    />
                    <span>Peka huruf besar/kecil (case sensitive)</span>
                  </label>
                </div>
              )}

              {qType === 'esai' && (
                <div className="border-t border-slate-200 pt-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Rubrik / Pedoman Penskoran Guru
                  </label>
                  <textarea
                    rows={2}
                    value={essayRubric}
                    onChange={(e) => setEssayRubric(e.target.value)}
                    placeholder="Contoh: Skor penuh jika siswa menuliskan rumus, langkah hitung, dan satuan."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Pembahasan Jawaban</label>
                <textarea
                  rows={2}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="Penjelasan kunci jawaban (tidak ditampilkan kepada siswa saat ujian berlangsung)"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg"
                >
                  Simpan Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Text Import Modal */}
      {docImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Impor Soal dari Dokumen / Teks</h3>
              <button type="button" onClick={() => setDocImportOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleDocImport} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mata Pelajaran Tujuan</label>
                <select
                  value={docSubjectId}
                  onChange={(e) => setDocSubjectId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tempel Naskah Soal (Gunakan format bernomor: 1. Pertanyaan, A. Opsi, Kunci: A, Pembahasan: ...)
                </label>
                <textarea
                  rows={9}
                  required
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  placeholder={`1. Berapakah hasil dari 12 x 8?\nA. 86\nB. 96\nC. 106\nD. 116\nKunci: B\nPembahasan: 12 dikali 8 sama dengan 96.`}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDocImportOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-lg"
                >
                  Proses & Impor Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Word (.docx) Modal */}
      {wordImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white border border-slate-200 shadow-xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <FileUp className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Upload Soal dari Berkas Word</h3>
                  <p className="text-xs text-slate-500">
                    Jumlah soal otomatis menyesuaikan seluruh butir soal yang terdeteksi di dalam file Word (.docx).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWordImportOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mata Pelajaran Tujuan</label>
                <select
                  value={wordSubjectId}
                  onChange={(e) => setWordSubjectId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tingkat Kelas</label>
                <select
                  value={wordGradeLevel}
                  onChange={(e) => setWordGradeLevel(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value={7}>Kelas VII</option>
                  <option value={8}>Kelas VIII</option>
                  <option value={9}>Kelas IX</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Materi / Topik (Opsional)</label>
                <input
                  type="text"
                  value={wordTopic}
                  onChange={(e) => setWordTopic(e.target.value)}
                  placeholder="Default: Impor Word"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 mb-4 text-xs text-slate-600 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Format Penulisan Soal Word yang Didukung:</span>
                <button
                  type="button"
                  onClick={downloadWordQuestionTemplate}
                  className="text-blue-600 hover:text-blue-700 font-semibold hover:underline"
                >
                  Unduh Contoh Template Word
                </button>
              </div>
              <p>
                Awali setiap soal dengan nomor (<code className="px-1 py-0.5 bg-white border border-slate-200 rounded">1. ...</code> atau daftar bernomor otomatis Word / tabel soal), diikuti pilihan{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">A.</code>–<code className="px-1 py-0.5 bg-white border border-slate-200 rounded">E.</code>,{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">Kunci: A</code> (atau <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">Kunci: A, C</code> untuk PG Kompleks, atau bagian <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">KUNCI JAWABAN</code> di akhir dokumen), dan{' '}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">Pembahasan: ...</code>. Gambar yang disisipkan di file Word (.docx) pada soal maupun opsi otomatis terbaca, dan Anda juga dapat menambah atau mengganti gambar langsung di pratinjau.
              </p>
            </div>

            <input
              ref={wordInputRef}
              type="file"
              accept=".docx,.doc,.txt"
              onChange={handleWordFileChange}
              className="hidden"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingWord(true);
              }}
              onDragLeave={() => setIsDraggingWord(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDraggingWord(false);
                const file = e.dataTransfer.files?.[0];
                if (file) await processWordFile(file);
              }}
              onClick={() => wordInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                isDraggingWord
                  ? 'border-blue-500 bg-blue-50/70'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <Upload className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-800">
                {wordParsing
                  ? 'Sedang membaca dan mendeteksi soal dari berkas Word...'
                  : wordFileName
                  ? wordFileName
                  : 'Klik untuk memilih berkas Word (.docx) atau seret ke sini'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Otomatis menyesuaikan seluruh jumlah soal & gambar di dalam file (PG, PG Kompleks, Benar/Salah, Isian, Esai)
              </p>
            </div>

            {parsedWordQuestions.length > 0 && (
              <div className="mt-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">
                      Terdeteksi {parsedWordQuestions.length} Soal
                    </span>
                    <span className="text-slate-500">
                      ({parsedWordQuestions.filter((q) => q.selected).length} dipilih untuk diimpor)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = parsedWordQuestions.every((q) => q.selected);
                        setParsedWordQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
                      }}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {parsedWordQuestions.every((q) => q.selected) ? 'Batal Pilih Semua' : 'Pilih Semua'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWordFileName('');
                        setParsedWordQuestions([]);
                      }}
                      className="text-slate-500 hover:text-red-600"
                    >
                      Ganti Berkas
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 max-h-80 overflow-y-auto">
                  {parsedWordQuestions.map((q, idx) => (
                    <div key={`${q.number}-${idx}`} className="p-3.5 text-xs hover:bg-slate-50/70">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={q.selected}
                          onChange={(e) =>
                            setParsedWordQuestions((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, selected: e.target.checked } : item))
                            )
                          }
                          className="mt-0.5"
                        />
                        <div className="flex-1 space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-mono font-bold text-slate-800">No. {q.number}</span>
                              <span>·</span>
                              <span className="font-semibold text-blue-700">{TYPE_LABELS[q.type]}</span>
                              <span>·</span>
                              <span>Bobot {q.weight}</span>
                              {q.media_type === 'image' && q.media_url && (
                                <>
                                  <span>·</span>
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <ImageIcon className="h-3 w-3" />
                                    Soal Bergambar
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer">
                                <ImageIcon className="h-3 w-3" />
                                {q.media_url ? 'Ganti Gambar' : '+ Gambar Soal'}
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleWordQuestionImageUpload(idx, e)}
                                  className="hidden"
                                />
                              </label>
                              {q.media_url && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setParsedWordQuestions((prev) =>
                                      prev.map((item, i) =>
                                        i === idx ? { ...item, media_type: 'none', media_url: '' } : item
                                      )
                                    )
                                  }
                                  className="text-[11px] text-red-600 hover:underline"
                                >
                                  Hapus Gambar
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-slate-900 leading-relaxed">
                            <MathText text={q.prompt} />
                          </div>

                          {q.media_type === 'image' && q.media_url && (
                            <img
                              src={q.media_url}
                              alt={`Gambar soal no. ${q.number}`}
                              referrerPolicy="no-referrer"
                              className="max-h-36 rounded-lg border border-slate-200 bg-white object-contain"
                            />
                          )}

                          {q.options.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-0.5">
                              {q.options.map((opt) => {
                                const isCorrect = Array.isArray(q.correct_answer)
                                  ? q.correct_answer.includes(opt.key)
                                  : String(q.correct_answer) === opt.key;
                                return (
                                  <div
                                    key={opt.key}
                                    className={`px-2 py-1 rounded border space-y-1 ${
                                      isCorrect
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-medium'
                                        : 'border-slate-200 bg-white text-slate-600'
                                    }`}
                                  >
                                    <div>
                                      <span className="font-mono font-semibold mr-1">{opt.key}.</span>
                                      {opt.text && <MathText text={opt.text} />}
                                    </div>
                                    {opt.image_url && (
                                      <img
                                        src={opt.image_url}
                                        alt={`Gambar opsi ${opt.key}`}
                                        referrerPolicy="no-referrer"
                                        className="max-h-20 rounded border border-slate-200 bg-white object-contain"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {q.options.length === 0 && q.type === 'isian_singkat' && (
                            <div className="text-[11px] text-emerald-700">
                              Kunci: <span className="font-mono font-semibold">{String(q.correct_answer)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setWordImportOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={
                  wordParsing ||
                  wordImporting ||
                  parsedWordQuestions.filter((q) => q.selected).length === 0
                }
                onClick={handleConfirmWordImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {wordImporting
                  ? 'Mengimpor...'
                  : `Impor ${parsedWordQuestions.filter((q) => q.selected).length} Soal ke Bank Soal`}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus Butir Soal?"
        message="Butir soal ini akan dihapus permanen dari Bank Soal."
        confirmLabel="Hapus"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
