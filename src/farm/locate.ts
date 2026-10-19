import type { Fix } from './FarmServices'

/** One GPS reading, high accuracy, for an apiary pin (12 §11). */
export function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 2 })
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  })
}
