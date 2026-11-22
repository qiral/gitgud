import Dialog from './Dialog'
import { Keys, type Command } from './CommandPalette'
import { useTranslation } from '../i18n'

/** Lists every command that has a shortcut, by group. */
export default function ShortcutsDialog({
  commands,
  onClose,
}: {
  commands: Command[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const withKeys = commands.filter((c) => c.shortcut)
  const groups = [...new Set(withKeys.map((c) => c.group))]
  return (
    <Dialog
      title={t('shortcutsdialog.keyboard-shortcuts')}
      onClose={onClose}
      wide
    >
      <div className="max-h-[60vh] space-y-4 overflow-auto">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs text-muted">{g}</h3>
            <ul>
              {withKeys
                .filter((c) => c.group === g)
                .map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-4 py-1"
                  >
                    <span>{c.label}</span>
                    <Keys shortcut={c.shortcut!} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
