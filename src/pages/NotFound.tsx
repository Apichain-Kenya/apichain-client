import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <main className="page-status">
      <h1>{t('app.notFound.title')}</h1>
      <Link href="/">{t('app.notFound.back')}</Link>
    </main>
  )
}
