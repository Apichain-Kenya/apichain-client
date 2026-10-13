import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'wouter'

import { extractPublicId } from '../api/batchId'
import { Button } from '../ui/Button'
import { ConsumerShell } from './ConsumerShell'
import { loadVerify as realLoad, type VerifyResult } from './verifyApi'
import { VerifyView } from './VerifyView'
import styles from './VerifyPage.module.css'

type Load = (publicId: string) => Promise<VerifyResult>

// /v/:publicId — what a jar's QR opens (12 D10). Errors say what happened and
// what to do next, in the interface's voice, never vaguely (03 §10).
export default function VerifyPage({ load = realLoad }: { load?: Load }) {
  const { t } = useTranslation()
  const params = useParams<{ publicId: string }>()
  const publicId = extractPublicId(params.publicId)
  const [result, setResult] = useState<VerifyResult | 'loading'>(
    publicId ? 'loading' : { kind: 'not_found' },
  )

  const run = useCallback(() => {
    if (!publicId) return
    setResult('loading')
    void load(publicId).then(setResult)
  }, [load, publicId])

  useEffect(run, [run])

  let body
  if (result === 'loading') {
    body = (
      <p role="status" className="page-status">
        {t('app.loading')}
      </p>
    )
  } else if (result.kind === 'ok') {
    body = <VerifyView verify={result.verify} cachedAt={result.cachedAt} />
  } else {
    const message = { not_found: 'scan.notFound', offline: 'scan.offline', error: 'scan.error' }[
      result.kind
    ]
    body = (
      <div className={styles.problem}>
        <p role="alert">{t(message)}</p>
        {result.kind === 'not_found' ? (
          <Link href="/scan" className={styles.link}>
            {t('scan.scanAnother')}
          </Link>
        ) : (
          <Button variant="secondary" onClick={run}>
            {t('scan.tryAgain')}
          </Button>
        )}
      </div>
    )
  }
  // The not-found page offers its own way back; one link is enough.
  const notFound = result !== 'loading' && result.kind === 'not_found'
  return <ConsumerShell scanLink={!notFound}>{body}</ConsumerShell>
}
