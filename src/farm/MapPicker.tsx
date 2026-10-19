import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { Fix } from './FarmServices'
import styles from './MapPicker.module.css'

/** The circle's colour: the honey token, read from the page, so it follows
 *  the theme. Leaflet would otherwise draw its default blue (13 §11 item 5). */
function ringStyle(): L.PathOptions {
  const honey = getComputedStyle(document.documentElement).getPropertyValue('--comb-strong').trim()
  return { color: honey, fillColor: honey, weight: 1.5 }
}

// The online map (12 D11): Leaflet + OpenStreetMap tiles, lazy-loaded, used
// only to confirm or nudge the GPS pin. Tiles get the browser's ordinary HTTP
// cache and nothing else: OpenStreetMap forbids offline use and prefetching,
// so the service worker never touches them. Attribution stays visible.
export default function MapPicker({
  fix,
  onMove,
  label,
}: {
  fix: Fix
  onMove: (fix: Fix) => void
  label: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const pin = useRef<L.Marker | null>(null)
  const ring = useRef<L.Circle | null>(null)
  const latest = useRef(onMove)
  latest.current = onMove

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    // Leaflet positions the icon element with a transform, so the pin's own
    // shape rotates on an inner span.
    const icon = L.divIcon({
      className: styles.pinWrap,
      html: `<span class="${styles.pin}"></span>`,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
    })
    pin.current = L.marker([fix.lat, fix.lon], {
      draggable: true,
      icon,
      keyboard: true,
      title: label,
    })
      .addTo(m)
      .on('dragend', () => {
        const p = pin.current!.getLatLng()
        // A hand-placed pin is as accurate as the farmer's placement; keep
        // the GPS radius as the honest uncertainty.
        latest.current({ lat: p.lat, lon: p.lng, accuracy: fix.accuracy })
      })
    ring.current = L.circle([fix.lat, fix.lon], { radius: fix.accuracy, ...ringStyle() }).addTo(m)
    m.setView([fix.lat, fix.lon], 16)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
    // Only on first mount; later fixes move the pin below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    pin.current?.setLatLng([fix.lat, fix.lon])
    ring.current?.setLatLng([fix.lat, fix.lon]).setRadius(fix.accuracy).setStyle(ringStyle())
  }, [fix])

  return <div ref={el} className={styles.map} role="application" aria-label={label} />
}
