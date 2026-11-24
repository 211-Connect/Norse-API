/**
 * Lucas 2026-11-18: lowercase queries where sensible. Measured 2026-11-18
 * (IL211, 40 real queries): UPPER CASE kept the same top 10 for 1 of 40
 * queries, a trailing ? for 2 of 40. The embedding, the classifier and the
 * keyword search get this one form; `intent.query` echoes the typed text.
 *
 * Steps: NFC, lowercase, collapse whitespace, drop leading ¿ ¡ and trailing
 * ? . !. A punctuation-only query keeps its punctuation, so it still reaches
 * the classifier.
 */
export function modelText(text: string): string {
  const base = text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
  const stripped = base
    .replace(/^[¿¡\s]+/u, '')
    .replace(/[?.!\s]+$/u, '')
    .trim();
  return stripped.length > 0 ? stripped : base;
}
