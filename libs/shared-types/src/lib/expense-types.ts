export type ExpensePaidBy = 'alexis' | 'marion';

export const EXPENSE_CATEGORIES = [
  'Courses',
  'Mimi chaton',
  'Restaurant',
  'Divers',
] as const;

export interface Expense {
  id: number;
  paidBy: ExpensePaidBy;
  category: string;
  subcategory: string;
  enseigne: string;
  amount: number;
  date: string;       // YYYY-MM-DD
  comment: string;
  createdAt: string;
}

export interface ExpenseMonthSummary {
  month: string;         // YYYY-MM
  totalAlexis: number;
  totalMarion: number;
  total: number;
}

export interface MonthlyCategory {
  category: string;
  alexis: number;
  marion: number;
  total: number;
}

export interface MonthlySubcategory {
  subcategory: string;
  category: string;
  alexis: number;
  marion: number;
  total: number;
}

export interface MonthlyBreakdown {
  month: string;         // YYYY-MM
  totalAlexis: number;
  totalMarion: number;
  total: number;
  categories: MonthlyCategory[];
  subcategories: MonthlySubcategory[];
}

export const PERSONAL_CATEGORIES = [
  'Loisirs', 'Vêtements', 'Transport', 'Santé',
  'Café & Sorties', 'Abonnements', 'Épargne', 'Divers',
] as const;
export type PersonalCategory = typeof PERSONAL_CATEGORIES[number];

export interface PersonalExpense {
  id: number;
  userId: ExpensePaidBy;
  category: string;
  amount: number;
  date: string;        // YYYY-MM-DD
  comment: string;
  createdAt: string;
}

export interface PersonalBudget {
  userId: ExpensePaidBy;
  month: string;       // YYYY-MM
  income: number;
}

export interface BudgetSummary {
  month: string;
  income: number;
  maisonShare: number;          // total_maison / 2
  personalTotal: number;
  savings: number;              // income - maisonShare - personalTotal
  savingsRate: number;          // savings / income * 100 (0 if income=0)
  personalByCategory: { category: string; total: number }[];
}
