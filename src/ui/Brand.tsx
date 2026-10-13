import styles from './Brand.module.css'

export function Brand() {
  return (
    <span className={styles.brand}>
      <svg viewBox="0 0 64 72" aria-hidden="true" className={styles.mark}>
        <path d="M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z" />
      </svg>
      <span>ApiChain</span>
    </span>
  )
}
