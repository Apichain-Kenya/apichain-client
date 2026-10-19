import { useTranslation } from 'react-i18next'

import styles from './Switch.module.css'

// An on/off choice (board: the consent row). The state is said in words
// beside the switch, as well as by its shape, never by colour alone. The
// sentence it answers is elsewhere on the row, named by `labelledBy`.
export function Switch({
  on,
  labelledBy,
  disabled,
  onChange,
}: {
  on: boolean
  labelledBy: string
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <span className={styles.swc}>
      <button
        type="button"
        role="switch"
        className={styles.switch}
        aria-checked={on}
        aria-labelledby={labelledBy}
        disabled={disabled}
        onClick={() => onChange(!on)}
      />
      <span aria-hidden="true">{t(on ? 'ui.switch.on' : 'ui.switch.off')}</span>
    </span>
  )
}
