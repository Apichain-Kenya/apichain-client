import type { ReactNode } from 'react'

import styles from './ChoiceTiles.module.css'

export type Choice<T extends string> = { value: T; label: string; icon?: ReactNode }

type Props<T extends string> = {
  legend: string
  name: string
  value: T | null
  options: Choice<T>[]
  onChange: (value: T) => void
}

// Icon + word tiles with real radio semantics: arrow keys move between them,
// and the selected tile is marked by a thicker border as well as its state.
export function ChoiceTiles<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: Props<T>) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.tiles}>
        {options.map((o) => (
          <label key={o.value} className={styles.tile}>
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.icon ? <span className={styles.icon}>{o.icon}</span> : null}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
