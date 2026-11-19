import type { QuestionType } from '../types.ts';

export interface GradeEvaluationInput {
  type: QuestionType;
  weight: number;
  correctAnswer: unknown;
  scoringRule?: {
    mode?: 'all_or_nothing' | 'partial';
    variations?: string[];
    case_sensitive?: boolean;
    rubric?: string;
  };
  studentAnswer: unknown;
}

export interface GradeEvaluationResult {
  is_correct: number | null; // 1 = correct, 0 = wrong, null = ungraded essay
  earned_score: number;
  is_blank: boolean;
}

export function isStudentAnswerBlank(answer: unknown): boolean {
  if (answer === null || answer === undefined) return true;
  if (typeof answer === 'string') return answer.trim().length === 0;
  if (Array.isArray(answer)) return answer.length === 0;
  if (typeof answer === 'object') return Object.keys(answer as Record<string, unknown>).length === 0;
  return false;
}

export function evaluateAnswer(input: GradeEvaluationInput): GradeEvaluationResult {
  const { type, weight, correctAnswer, scoringRule, studentAnswer } = input;
  const blank = isStudentAnswerBlank(studentAnswer);

  if (blank) {
    return {
      is_correct: type === 'esai' ? null : 0,
      earned_score: 0,
      is_blank: true,
    };
  }

  switch (type) {
    case 'pg':
    case 'benar_salah': {
      const expected = String(correctAnswer ?? '').trim().toUpperCase();
      const actual = String(studentAnswer ?? '').trim().toUpperCase();
      const match = expected.length > 0 && expected === actual;
      return {
        is_correct: match ? 1 : 0,
        earned_score: match ? weight : 0,
        is_blank: false,
      };
    }

    case 'pg_kompleks': {
      const expectedArr = Array.isArray(correctAnswer)
        ? correctAnswer.map((v) => String(v).trim().toUpperCase())
        : [];
      const actualArr = Array.isArray(studentAnswer)
        ? Array.from(new Set(studentAnswer.map((v) => String(v).trim().toUpperCase())))
        : [];

      if (expectedArr.length === 0) {
        return { is_correct: 0, earned_score: 0, is_blank: false };
      }

      const mode = scoringRule?.mode || 'partial';
      const exactMatch =
        expectedArr.length === actualArr.length &&
        expectedArr.every((k) => actualArr.includes(k));

      if (mode === 'all_or_nothing') {
        return {
          is_correct: exactMatch ? 1 : 0,
          earned_score: exactMatch ? weight : 0,
          is_blank: false,
        };
      }

      const correctHits = actualArr.filter((k) => expectedArr.includes(k)).length;
      const wrongHits = actualArr.filter((k) => !expectedArr.includes(k)).length;
      const rawRatio = Math.max(0, (correctHits - wrongHits * 0.5) / expectedArr.length);
      const earned = Math.round(rawRatio * weight * 100) / 100;
      return {
        is_correct: exactMatch ? 1 : earned > 0 ? 1 : 0,
        earned_score: earned,
        is_blank: false,
      };
    }

    case 'menjodohkan': {
      // correctAnswer is array of { id, left, right } or Record<leftId, rightText>
      const expectedMap: Record<string, string> = {};
      if (Array.isArray(correctAnswer)) {
        for (const pair of correctAnswer as Array<{ id?: string; left?: string; right?: string }>) {
          const key = String(pair.id ?? pair.left ?? '');
          if (key) expectedMap[key] = String(pair.right ?? '').trim();
        }
      } else if (correctAnswer && typeof correctAnswer === 'object') {
        for (const [k, v] of Object.entries(correctAnswer as Record<string, unknown>)) {
          expectedMap[k] = String(v ?? '').trim();
        }
      }

      const actualMap = (studentAnswer && typeof studentAnswer === 'object'
        ? studentAnswer
        : {}) as Record<string, unknown>;

      const keys = Object.keys(expectedMap);
      if (keys.length === 0) {
        return { is_correct: 0, earned_score: 0, is_blank: false };
      }

      let matched = 0;
      for (const k of keys) {
        if (String(actualMap[k] ?? '').trim() === expectedMap[k]) {
          matched += 1;
        }
      }

      const ratio = matched / keys.length;
      const earned = Math.round(ratio * weight * 100) / 100;
      return {
        is_correct: matched === keys.length ? 1 : 0,
        earned_score: earned,
        is_blank: false,
      };
    }

    case 'isian_singkat': {
      const caseSensitive = Boolean(scoringRule?.case_sensitive);
      const normalize = (s: string) => (caseSensitive ? s.trim() : s.trim().toLowerCase());
      const actual = normalize(String(studentAnswer ?? ''));
      const acceptedList: string[] = [];
      if (typeof correctAnswer === 'string' && correctAnswer.trim()) {
        acceptedList.push(normalize(correctAnswer));
      } else if (Array.isArray(correctAnswer)) {
        for (const item of correctAnswer) {
          if (String(item).trim()) acceptedList.push(normalize(String(item)));
        }
      }
      if (Array.isArray(scoringRule?.variations)) {
        for (const v of scoringRule.variations) {
          if (String(v).trim()) acceptedList.push(normalize(String(v)));
        }
      }
      const match = acceptedList.includes(actual);
      return {
        is_correct: match ? 1 : 0,
        earned_score: match ? weight : 0,
        is_blank: false,
      };
    }

    case 'esai':
    default:
      return {
        is_correct: null,
        earned_score: 0,
        is_blank: false,
      };
  }
}

export function calculateFinalGrade(totalScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round(((totalScore / maxScore) * 100) * 100) / 100;
}
