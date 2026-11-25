/** Документи: категорії і проста підказка за назвою файлу (без ШІ, людина завжди може змінити). */

export const CATEGORIES = ["invoices", "contracts", "bank", "taxes", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  invoices: "Рахунки",
  contracts: "Договори",
  bank: "Банк",
  taxes: "Податки",
  other: "Інше",
};

const KEYWORDS: [Exclude<Category, "other">, string[]][] = [
  ["invoices", ["faktura", "fakturu", "invoice", "rahunok", "рахунок", "рахунку", "uctenka", "paragon", "danovy doklad", "zalohova"]],
  ["contracts", ["smlouva", "smlouvy", "dohoda", "dodatek", "dpp", "dpc", "hpp", "договір", "договор", "угода", "contract", "plna moc", "доручення"]],
  ["bank", ["vypis", "výpis", "bank", "банк", "vipiska", "виписка", "statement", "platebni prikaz", "potvrzeni platby", "csob", "fio", "raiffeisen", "moneta"]],
  ["taxes", ["dph", "dan z", "danove priznani", "priznani", "financni urad", "cssz", "vzp", "pojistovna", "pojisteni", "zdravotni", "socialni", "податк", "декларац", "tax"]],
];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_\-.]+/g, " ");
}

/** Підказка категорії за назвою файлу і підписом у чаті. Якщо нічого не підходить — «Інше». */
export function suggestCategory(fileName: string, caption?: string | null): Category {
  const text = ` ${norm(fileName)} ${norm(caption ?? "")} `;
  for (const [cat, words] of KEYWORDS) {
    if (words.some((w) => {
      const n = norm(w);
      return n.length <= 3 ? new RegExp(`(^|[^a-z0-9а-яіїєґ])${n}([^a-z0-9а-яіїєґ]|$)`).test(text) : text.includes(n);
    })) return cat;
  }
  return "other";
}

export const STATUS_LABELS: Record<string, string> = {
  queued: "не розкладено",
  needs_confirmation: "не розкладено",
  classified: "не розкладено",
  confirmed: "",
  too_large: "завеликий (понад 20 МБ), лишився лише в чаті",
  unsupported: "",
  error: "не вдалося зберегти",
  processing: "",
  budget_paused: "",
};
