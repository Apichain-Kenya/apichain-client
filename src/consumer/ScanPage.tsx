import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { Camera } from 'lucide-react'

import { extractPublicId } from '../api/batchId'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { startCamera as realStartCamera } from './camera'
import { ConsumerShell } from './ConsumerShell'
import styles from './ScanPage.module.css'

type StartCamera = (video: HTMLVideoElement, onRead: (raw: string) => void) => Promise<() => void>

// Scan a jar, or type its code (12 §10). Adapted from v1 scan.jsx: one path
// (`go`) for the camera and the typed code, and a guard so one QR read
// navigates once. Changed: the camera starts only after a tap, with plain
// copy about what it is used for, never on page load.
export default function ScanPage({ startCamera = realStartCamera }: { startCamera?: StartCamera }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const video = useRef<HTMLVideoElement>(null)
  const stop = useRef<(() => void) | null>(null)
  const done = useRef(false)
  // True while the shopper wants the camera. A camera that finishes starting
  // after they pressed Stop, or left the page, is stopped at once instead of
  // running in a hidden video (review).
  const wanted = useRef(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>()

  useEffect(
    () => () => {
      wanted.current = false
      stop.current?.()
    },
    [],
  )

  const go = (raw: string): boolean => {
    const id = extractPublicId(raw)
    if (!id) return false
    if (done.current) return true
    done.current = true
    stop.current?.()
    stop.current = null
    navigate(`/v/${id}`)
    return true
  }

  const openCamera = async () => {
    setCameraError(false)
    setCameraOn(true)
    wanted.current = true
    try {
      const stopNow = await startCamera(video.current as HTMLVideoElement, (raw) => {
        go(raw)
      })
      if (!wanted.current) stopNow()
      else {
        stop.current?.()
        stop.current = stopNow
      }
    } catch {
      if (wanted.current) {
        setCameraOn(false)
        setCameraError(true)
      }
    }
  }

  const closeCamera = () => {
    wanted.current = false
    stop.current?.()
    stop.current = null
    setCameraOn(false)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!go(code)) setCodeError(t('scan.codeInvalid'))
  }

  return (
    <ConsumerShell scanLink={false}>
      <section className={styles.page}>
        <h1 className="serif">{t('scan.scanTitle')}</h1>
        <p className={styles.lead}>{t('scan.scanLead')}</p>

        <div className={styles.camera} hidden={!cameraOn}>
          <video ref={video} className={styles.video} muted playsInline />
        </div>
        {cameraOn ? (
          <Button variant="secondary" full onClick={closeCamera}>
            {t('scan.stopCamera')}
          </Button>
        ) : (
          <>
            <Button
              full
              icon={<Camera aria-hidden="true" size={20} />}
              onClick={() => void openCamera()}
            >
              {t('scan.useCamera')}
            </Button>
            <p className={styles.help}>
              {cameraError ? t('scan.cameraDenied') : t('scan.cameraHelp')}
            </p>
          </>
        )}

        <form className={styles.form} onSubmit={submit} noValidate>
          <h2 className={styles.or}>{t('scan.typeCode')}</h2>
          <Field label={t('scan.codeLabel')} hint={t('scan.codeHint')} error={codeError}>
            {(p) => (
              <input
                {...p}
                value={code}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value)
                  setCodeError(undefined)
                }}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" full>
            {t('scan.check')}
          </Button>
        </form>
      </section>
    </ConsumerShell>
  )
}
