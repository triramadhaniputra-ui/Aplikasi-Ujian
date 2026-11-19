import type { ItemAnalysisRow, QuestionOption, QuestionType } from '../types.ts';

export interface AttemptAnswerRecord {
  attempt_id: number;
  final_grade: number;
  question_id: number;
  answer_json: string | null;
  is_correct: number | null;
  earned_score: number;
}

export interface ExamQuestionMeta {
  question_id: number;
  order_index: number;
  prompt: string;
  type: QuestionType;
  topic: string;
  weight: number;
  options: QuestionOption[];
  correct_answer: unknown;
}

export function computeItemAnalysis(
  questions: ExamQuestionMeta[],
  attemptGrades: Array<{ attempt_id: number; final_grade: number }>,
  answers: AttemptAnswerRecord[]
): ItemAnalysisRow[] {
  const n = attemptGrades.length;

  // Sort attempts descending by total grade for Kelley's 27% upper/lower group discrimination index
  const sortedAttempts = [...attemptGrades].sort((a, b) => b.final_grade - a.final_grade);
  const groupSize = n >= 4 ? Math.max(1, Math.round(n * 0.27)) : 0;
  const upperIds = new Set(sortedAttempts.slice(0, groupSize).map((a) => a.attempt_id));
  const lowerIds = new Set(
    groupSize > 0 ? sortedAttempts.slice(n - groupSize).map((a) => a.attempt_id) : []
  );

  const answersByQuestion = new Map<number, AttemptAnswerRecord[]>();
  for (const ans of answers) {
    const list = answersByQuestion.get(ans.question_id) || [];
    list.push(ans);
    answersByQuestion.set(ans.question_id, list);
  }

  return questions.map((q) => {
    const qAnswers = answersByQuestion.get(q.question_id) || [];
    const answerByAttempt = new Map<number, AttemptAnswerRecord>();
    for (const a of qAnswers) answerByAttempt.set(a.attempt_id, a);

    let correctCount = 0;
    let wrongCount = 0;
    let blankCount = 0;
    let totalEarned = 0;

    let upperScoreSum = 0;
    let lowerScoreSum = 0;

    const optionCounts = new Map<string, number>();
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        if ('key' in opt && opt.key) optionCounts.set(opt.key.toUpperCase(), 0);
      }
    }

    for (const att of attemptGrades) {
      const rec = answerByAttempt.get(att.attempt_id);
      let parsedAns: unknown = null;
      if (rec && rec.answer_json !== null) {
        try {
          parsedAns = JSON.parse(rec.answer_json);
        } catch {
          parsedAns = rec.answer_json;
        }
      }

      const isBlank =
        !rec ||
        parsedAns === null ||
        parsedAns === undefined ||
        (typeof parsedAns === 'string' && parsedAns.trim() === '') ||
        (Array.isArray(parsedAns) && parsedAns.length === 0) ||
        (typeof parsedAns === 'object' && !Array.isArray(parsedAns) && Object.keys(parsedAns as object).length === 0);

      if (isBlank) {
        blankCount += 1;
      } else {
        const earned = Number(rec?.earned_score ?? 0);
        totalEarned += earned;
        const scoreRatio = q.weight > 0 ? earned / q.weight : 0;

        if (rec?.is_correct === 1 || scoreRatio >= 0.99) {
          correctCount += 1;
        } else {
          wrongCount += 1;
        }

        if (upperIds.has(att.attempt_id)) upperScoreSum += scoreRatio;
        if (lowerIds.has(att.attempt_id)) lowerScoreSum += scoreRatio;

        if (q.type === 'pg' || q.type === 'benar_salah') {
          const key = String(parsedAns).trim().toUpperCase();
          optionCounts.set(key, (optionCounts.get(key) || 0) + 1);
        } else if (q.type === 'pg_kompleks' && Array.isArray(parsedAns)) {
          for (const k of parsedAns) {
            const key = String(k).trim().toUpperCase();
            optionCounts.set(key, (optionCounts.get(key) || 0) + 1);
          }
        }
      }
    }

    const difficultyIndex =
      n > 0 && q.weight > 0 ? Math.round((totalEarned / (n * q.weight)) * 1000) / 1000 : 0;
    const difficultyLabel: ItemAnalysisRow['difficulty_label'] =
      difficultyIndex > 0.7 ? 'Mudah' : difficultyIndex >= 0.3 ? 'Sedang' : 'Sukar';

    let discriminationIndex: number | null = null;
    let discriminationLabel: ItemAnalysisRow['discrimination_label'] = 'Data Belum Memadai';
    if (n >= 4 && groupSize > 0) {
      const pUpper = upperScoreSum / groupSize;
      const pLower = lowerScoreSum / groupSize;
      discriminationIndex = Math.round((pUpper - pLower) * 1000) / 1000;
      if (discriminationIndex >= 0.4) discriminationLabel = 'Sangat Baik';
      else if (discriminationIndex >= 0.3) discriminationLabel = 'Baik';
      else if (discriminationIndex >= 0.2) discriminationLabel = 'Cukup';
      else discriminationLabel = 'Jelek';
    }

    const correctKeySet = new Set<string>();
    if (Array.isArray(q.correct_answer)) {
      for (const k of q.correct_answer) correctKeySet.add(String(k).toUpperCase());
    } else if (typeof q.correct_answer === 'string') {
      correctKeySet.add(q.correct_answer.toUpperCase());
    }

    const distractors = Array.isArray(q.options)
      ? q.options
          .filter((o): o is QuestionOption => 'key' in o && 'text' in o)
          .map((opt) => {
            const key = opt.key.toUpperCase();
            const count = optionCounts.get(key) || 0;
            const pct = n > 0 ? Math.round((count / n) * 1000) / 10 : 0;
            const isCorrect = correctKeySet.has(key);
            const effective = isCorrect ? pct >= 10 : n < 5 ? true : pct >= 5;
            return {
              key,
              text: opt.text,
              count,
              pct,
              is_correct: isCorrect,
              effective,
            };
          })
      : [];

    const ineffectiveDistractors = distractors
      .filter((d) => !d.is_correct && !d.effective)
      .map((d) => d.key);

    let recommendation: ItemAnalysisRow['recommendation'] = 'Menunggu Peserta';
    if (n >= 4 && discriminationIndex !== null) {
      if (discriminationIndex >= 0.3 && difficultyIndex >= 0.2 && difficultyIndex <= 0.85) {
        recommendation = ineffectiveDistractors.length > 0 ? 'Direvisi' : 'Dipertahankan';
      } else if (discriminationIndex >= 0.15) {
        recommendation = 'Direvisi';
      } else {
        recommendation = 'Dibuang';
      }
    } else if (n > 0) {
      recommendation = difficultyIndex >= 0.2 && difficultyIndex <= 0.85 ? 'Dipertahankan' : 'Direvisi';
    }

    return {
      question_id: q.question_id,
      order_index: q.order_index,
      prompt: q.prompt,
      type: q.type,
      topic: q.topic,
      weight: q.weight,
      participant_count: n,
      correct_count: correctCount,
      wrong_count: wrongCount,
      blank_count: blankCount,
      correct_pct: n > 0 ? Math.round((correctCount / n) * 1000) / 10 : 0,
      wrong_pct: n > 0 ? Math.round((wrongCount / n) * 1000) / 10 : 0,
      difficulty_index: difficultyIndex,
      difficulty_label: difficultyLabel,
      discrimination_index: discriminationIndex,
      discrimination_label: discriminationLabel,
      distractors,
      ineffective_distractors: ineffectiveDistractors,
      recommendation,
    };
  });
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return Math.round(sorted[mid] * 100) / 100;
}
