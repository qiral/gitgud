/** A message file: flat dot-keys to translated text, e.g. { 'toolbar.fetch': 'Fetch' }. */
export type Messages = Record<string, string>

/** Values interpolated into {placeholders} in a message. */
export type Vars = Record<string, string | number | null | undefined>
