import { useEffect, useState } from 'react'

import type { components } from '../api/client/schema'
import { useOutbox } from '../app/useOutbox'
import type { ConsentState } from '../offline/choice'
import type { ActionRecord } from '../offline/outbox'
import { serverDate } from './work'

export { choiceOf, settledKey, type Choice, type ConsentState } from '../offline/choice'

export type FarmerSummary = components['schemas']['FarmerSummary']
export type FarmerPage = components['schemas']['FarmerPage']
export type FarmerDetail = components['schemas']['FarmerDetail']
export type ConsentStates = components['schemas']['ConsentStateResponse']
export type DocumentOut = components['schemas']['DocumentResponse']
export type DocumentList = components['schemas']['DocumentListResponse']
export type Apiary = components['schemas']['ApiaryResponse']
export type Purpose = ConsentState['purpose']

/** The switches staff may set (D11): no photo row, and the required
 *  agreement is a fixed row, never a switch. */
export const TOGGLES = ['document_upload', 'sms_notifications', 'email_notifications'] as const
export type Toggle = (typeof TOGGLES)[number]

export const DOC_TYPES = [
  'national_id',
  'kra_pin_certificate',
  'land_document',
  'farm_photo',
  'other',
] as const

/** This person's saved consent choices and apiaries for one farmer, oldest
 *  first, live from the outbox; null until first read. */
export function useFarmerWork(userId: number, farmerId: number) {
  const { outbox } = useOutbox()
  const [rows, setRows] = useState<ActionRecord[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      void outbox.list(userId).then((all) => {
        if (!live) return
        setRows(
          all
            .filter(
              (r) =>
                (r.kind === 'consent.record' || r.kind === 'apiary.create') &&
                r.body.farmer_id === farmerId,
            )
            .sort((a, b) => a.seq - b.seq),
        )
      })
    load()
    const off = outbox.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [outbox, userId, farmerId])
  return rows
}

// The server's own checks (`media.sniff`, `settings.max_file_bytes`), made
// before any byte is sent, so a renamed Word file is caught at the form.
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const SIGNATURES = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
]

export async function checkFile(file: File): Promise<'tooBig' | 'wrongType' | null> {
  if (file.size > MAX_FILE_BYTES) return 'tooBig'
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  return SIGNATURES.some((sig) => sig.every((b, i) => head[i] === b)) ? null : 'wrongType'
}

/** "2.4 MB", "830 KB". */
export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** "0:47": whole seconds left until `until`, never below zero. */
export function clock(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "11:19", on the device's own clock. */
export function timeOfDay(iso: string): string {
  return serverDate(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
}
