/** Flat dot-namespaced translation table, e.g. `{ "emails.recovery.subject": "…" }`. */
export type TranslationFile = Record<string, string>

/** Values interpolatable into ICU messages. */
export type MessageParams = Record<string, string | number | Date>
