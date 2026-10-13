import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import styles from './AppShell.module.css'
import { Brand } from './Brand'

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>
}

// One navigation, two layouts (12 §4.5): a labelled bottom bar on phones and a
// labelled left rail from 1024 px. Every item has a word under or beside its
// icon (v1's icon-only rail was not learnable).
export function AppShell({
  nav,
  status,
  children,
}: {
  nav: NavItem[]
  status?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const links = nav.map(({ to, label, icon: Icon }) => (
    <Link
      key={to}
      href={to}
      className={(active: boolean) => (active ? `${styles.link} ${styles.active}` : styles.link)}
      aria-current={undefined}
    >
      <Icon aria-hidden="true" size={22} strokeWidth={1.75} />
      <span>{label}</span>
    </Link>
  ))
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Brand />
        {status}
      </header>
      <nav className={styles.rail} aria-label={t('ui.nav.label')}>
        <div className={styles.railBrand}>
          <Brand />
        </div>
        {links}
        <div className={styles.railStatus}>{status}</div>
      </nav>
      <main className={styles.main}>{children}</main>
      <nav className={styles.bottom} aria-label={t('ui.nav.label')}>
        {links}
      </nav>
    </div>
  )
}
