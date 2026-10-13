// Reading a jar's QR code with the camera (12 D14). Native BarcodeDetector
// first, which Chrome for Android ships at zero download cost; otherwise
// `qr-scanner` (~16 KB gzip) is fetched only now, after the shopper tapped
// "Use the camera". v1's html5-qrcode is not ported: several times larger.

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> }
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

/** Starts the camera into `video` and calls `onRead` with each decoded code.
 *  Resolves to a stop function; rejects if the camera is unavailable. */
export async function startCamera(
  video: HTMLVideoElement,
  onRead: (raw: string) => void,
): Promise<() => void> {
  const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  const nativeQr = Native && (await Native.getSupportedFormats?.())?.includes('qr_code')

  if (!Native || !nativeQr) {
    const { default: QrScanner } = await import('qr-scanner')
    const scanner = new QrScanner(video, (r) => onRead(r.data), {
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
    })
    await scanner.start()
    return () => {
      scanner.stop()
      scanner.destroy()
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
  const detector = new Native({ formats: ['qr_code'] })
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const codes = await detector.detect(video)
      if (codes[0]?.rawValue) onRead(codes[0].rawValue)
    } catch {
      // A frame that fails to decode is normal; try the next one.
    }
    if (!stopped) setTimeout(tick, 250)
  }
  void tick()
  return () => {
    stopped = true
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
}
