import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

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
// `desk`: the console's density (13 §4). Between 1024 and 1279 px the rail
// narrows to 96 px with each word under its icon, so a detail pane keeps room
// for its 560 px form (board call 3). `account`: who is signed in, on the rail.
export function AppShell({
  nav,
  status,
  account,
  desk = false,
  children,
}: {
  nav: NavItem[]
  status?: ReactNode
  account?: { name: string; role: string }
  desk?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [location] = useLocation()
  const links = nav.map(({ to, label, icon: Icon }) => (
    <Link
      key={to}
      href={to}
      // A section stays marked on its own sub-pages (a batch under Batches).
      className={(active: boolean) =>
        active || (to !== '/' && location.startsWith(`${to}/`))
          ? `${styles.link} ${styles.active}`
          : styles.link
      }
      aria-current={undefined}
    >
      <Icon aria-hidden="true" size={22} strokeWidth={1.75} />
      <span>{label}</span>
    </Link>
  ))
  return (
    <div className={desk ? `${styles.shell} ${styles.desk}` : styles.shell}>
      <header className={styles.top}>
        <Brand />
        {status}
      </header>
      <nav className={styles.rail} aria-label={t('ui.nav.label')}>
        <div className={styles.railBrand}>
          <Brand />
        </div>
        {account ? (
          <p className={styles.account}>
            <span className={styles.accountName}>{account.name}</span>
            <span>{account.role}</span>
          </p>
        ) : null}
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
