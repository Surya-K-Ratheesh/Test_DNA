"use client"

import React, { useRef, useEffect, useState } from 'react'

type Profile = { name: string; embeddings: number[][]; skinRGB: number[]; eyeColorRGB?: number[] }

function computeEmbedding(landmarks: any) {
  // Build a richer periocular embedding:
  // - distances between consecutive eye points
  // - eyebrow shape distances
  // - vertical distances from brow center to eye center
  // - eye widths and heights
  const pts = landmarks.positions

  const idx = {
    leftEye: [36, 37, 38, 39, 40, 41],
    rightEye: [42, 43, 44, 45, 46, 47],
    leftBrow: [17, 18, 19, 20, 21],
    rightBrow: [22, 23, 24, 25, 26],
  }

  const pick = (arr: number[]) => arr.map((i) => ({ x: pts[i].x, y: pts[i].y }))
  const leftEye = pick(idx.leftEye)
  const rightEye = pick(idx.rightEye)
  const leftBrow = pick(idx.leftBrow)
  const rightBrow = pick(idx.rightBrow)

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

  const consecutiveDistances = (arr: { x: number; y: number }[]) => {
    const out: number[] = []
    for (let i = 1; i < arr.length; i++) out.push(dist(arr[i], arr[i - 1]))
    return out
  }

  const center = (arr: { x: number; y: number }[]) => {
    const s = arr.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
    return { x: s.x / arr.length, y: s.y / arr.length }
  }

  const leftEyeCenter = center(leftEye)
  const rightEyeCenter = center(rightEye)
  const leftBrowCenter = center(leftBrow)
  const rightBrowCenter = center(rightBrow)

  const interEye = dist(leftEyeCenter, rightEyeCenter) || 1

  const feats: number[] = []
  // eye consecutive distances (normalized)
  consecutiveDistances(leftEye).forEach((d) => feats.push(d / interEye))
  consecutiveDistances(rightEye).forEach((d) => feats.push(d / interEye))
  // brow consecutive distances
  consecutiveDistances(leftBrow).forEach((d) => feats.push(d / interEye))
  consecutiveDistances(rightBrow).forEach((d) => feats.push(d / interEye))
  // vertical gap from brow center to eye center
  feats.push((leftEyeCenter.y - leftBrowCenter.y) / interEye)
  feats.push((rightEyeCenter.y - rightBrowCenter.y) / interEye)
  // eye width and height (approx)
  const leftEyeWidth = dist(leftEye[0], leftEye[3]) / interEye
  const rightEyeWidth = dist(rightEye[0], rightEye[3]) / interEye
  const leftEyeHeight = (dist(leftEye[1], leftEye[5]) + dist(leftEye[2], leftEye[4])) / (2 * interEye)
  const rightEyeHeight = (dist(rightEye[1], rightEye[5]) + dist(rightEye[2], rightEye[4])) / (2 * interEye)
  feats.push(leftEyeWidth, rightEyeWidth, leftEyeHeight, rightEyeHeight)
  // brow-eye horizontal offsets
  feats.push((leftBrowCenter.x - leftEyeCenter.x) / interEye)
  feats.push((rightBrowCenter.x - rightEyeCenter.x) / interEye)

  return feats
}

export default function Periocular() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState('Idle')
  const [mode, setMode] = useState<'scan' | 'register'>('scan')
  const [liveData, setLiveData] = useState<{leftColor: number[], rightColor: number[]}>({leftColor: [0,0,0], rightColor: [0,0,0]})
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    try {
      const raw = localStorage.getItem('peri_profiles')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      // normalize older profiles that used `embedding` -> convert to `embeddings`
      if (Array.isArray(parsed)) {
        return parsed.map((p: any) => {
          if (!p) return null
          const name = p.name || 'unknown'
          const skinRGB = p.skinRGB || p.skin || [128, 128, 128]
          if (p.embeddings && Array.isArray(p.embeddings)) return { name, embeddings: p.embeddings, skinRGB }
          if (p.embedding && Array.isArray(p.embedding)) return { name, embeddings: [p.embedding], skinRGB }
          return { name, embeddings: [], skinRGB }
        }).filter(Boolean) as Profile[]
      }
      return []
    } catch (e) {
      console.error('Failed to read profiles from storage', e)
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('peri_profiles', JSON.stringify(profiles))
    } catch {
      // ignore storage errors
    }
  }, [profiles])

  useEffect(() => {
    let faceapi: any = null
    let running = true

    async function setupCamera() {
      setStatus('Requesting Camera')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    }

    async function loadModels() {
      setStatus('Loading Models')
      const fa = await import('face-api.js')
      const modelUrl = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin + '/models' : '/models'
      await fa.nets.tinyFaceDetector.loadFromUri(modelUrl)
      await fa.nets.faceLandmark68Net.loadFromUri(modelUrl)
      ;(window as any).globalFaceApi = fa
      faceapi = fa
      setStatus('Models Loaded')
    }

    async function captureLoop() {
      if (!videoRef.current || !canvasRef.current || !faceapi) return
      const video = videoRef.current
      const canvas = canvasRef.current
      const displaySize = { width: video.videoWidth, height: video.videoHeight }
      canvas.width = displaySize.width
      canvas.height = displaySize.height
      const ctx = canvas.getContext('2d')

      setStatus('Searching for Eyes')

      while (running) {
        const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks()
        ctx!.clearRect(0, 0, canvas.width, canvas.height)
        if (detections && detections.landmarks) {
          const lm = detections.landmarks
          // compute eye bounding box
          const leftEyePts = lm.getLeftEye()
          const rightEyePts = lm.getRightEye()
          const allX = [...leftEyePts, ...rightEyePts].map((p: any) => p.x)
          const allY = [...leftEyePts, ...rightEyePts].map((p: any) => p.y)
          const minX = Math.min(...allX) - 10
          const maxX = Math.max(...allX) + 10
          const minY = Math.min(...allY) - 10
          const maxY = Math.max(...allY) + 10
          const w = maxX - minX
          const h = maxY - minY

          // draw box
          ctx!.strokeStyle = '#00FFAA'
          ctx!.lineWidth = 2
          ctx!.strokeRect(minX, minY, w, h)

          // extract image data for skin tone avg
          ctx!.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx!.getImageData(Math.max(0, Math.floor(minX)), Math.max(0, Math.floor(minY)), Math.floor(w), Math.floor(h))
          let r = 0, g = 0, b = 0
          for (let i = 0; i < img.data.length; i += 4) {
            r += img.data[i]
            g += img.data[i + 1]
            b += img.data[i + 2]
          }
          const pxCount = img.data.length / 4 || 1
          const skinRGB = [Math.round(r / pxCount), Math.round(g / pxCount), Math.round(b / pxCount)]

          const embedding = computeEmbedding(lm)

          if (mode === 'register') {
            setStatus('Registering: capture frame')
            // Draw live Eyebrow/Eye bounding boxes
            const extractBox = (pts: any[]) => {
              const xs = pts.map(p => p.x)
              const ys = pts.map(p => p.y)
              return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
            }
            
            // Draw eyebrows (Magenta)
            ctx!.strokeStyle = '#FF00FF'
            ;[lm.getLeftEyeBrow(), lm.getRightEyeBrow()].forEach(brow => {
              const b = extractBox(brow)
              ctx!.strokeRect(b.minX - 5, b.minY - 5, b.maxX - b.minX + 10, b.maxY - b.minY + 10)
            })

            // Draw eyes (Cyan)
            ctx!.strokeStyle = '#00FFFF'
            ;[lm.getLeftEye(), lm.getRightEye()].forEach(eye => {
              const b = extractBox(eye)
              ctx!.strokeRect(b.minX - 5, b.minY - 5, b.maxX - b.minX + 10, b.maxY - b.minY + 10)
            })

            // Calculate live eye color
            const getEyeColor = (pts: any[]) => {
              const b = extractBox(pts)
              const w = Math.max(1, b.maxX - b.minX)
              const h = Math.max(1, b.maxY - b.minY)
              try {
                const eyeImg = ctx!.getImageData(Math.max(0, Math.floor(b.minX)), Math.max(0, Math.floor(b.minY)), Math.floor(w), Math.floor(h))
                let rc=0, gc=0, bc=0
                for(let i=0; i<eyeImg.data.length; i+=4) { rc += eyeImg.data[i]; gc += eyeImg.data[i+1]; bc += eyeImg.data[i+2] }
                const n = eyeImg.data.length / 4 || 1
                return [Math.round(rc/n), Math.round(gc/n), Math.round(bc/n)]
              } catch(e) { return [0,0,0] }
            }
            setLiveData({
              leftColor: getEyeColor(lm.getLeftEye()), 
              rightColor: getEyeColor(lm.getRightEye())
            })
            // store a single-frame registration (we capture several frames in UI flow)
          } else {
            // scanning: compare to stored profiles
            if (profiles.length > 0) {
              let best: { name: string; score: number; dist: number; skinDiff: number } | null = null
              for (const p of profiles) {
                // compare against multiple stored embeddings per profile
                let bestForProfile = { dist: Infinity, idx: -1 }
                for (let ei = 0; ei < p.embeddings.length; ei++) {
                  const emb = p.embeddings[ei]
                  const len = Math.min(emb.length, embedding.length)
                  let sum = 0
                  for (let i = 0; i < len; i++) {
                    const d = (emb[i] - embedding[i])
                    sum += d * d
                  }
                  const dist = Math.sqrt(sum)
                  if (dist < bestForProfile.dist) bestForProfile = { dist, idx: ei }
                }
                const dist = bestForProfile.dist
                // skin difference (euclidean RGB)
                const skinDiff = Math.hypot(p.skinRGB[0] - skinRGB[0], p.skinRGB[1] - skinRGB[1], p.skinRGB[2] - skinRGB[2])
                // combined score: embedding dist + 0.5 * normalized skin diff
                const combined = dist + 0.5 * (skinDiff / 255)
                if (!best || combined < best.score) best = { name: p.name, score: combined, dist, skinDiff }
              }
              // threshold tuned for this simple embedding; you can adjust
              if (best && best.score < 0.6) {
                setStatus(`Match Found: ${best.name} (d=${best.dist.toFixed(3)}, skin=${Math.round(best.skinDiff)})`)
              } else {
                setStatus('Searching for Eyes')
              }
            }
          }
        } else {
          setStatus('Searching for Eyes')
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    setupCamera().then(loadModels).then(() => {
      captureLoop()
    }).catch((e) => {
      console.error(e)
      setStatus('Error: ' + (e.message || e))
    })

    return () => { running = false }
  }, [mode, profiles])

  // registration handler: capture 6 frames and average embedding
  async function handleRegister() {
    const name = prompt('Enter name for this profile')?.trim()
    if (!name) return
    setStatus('Registering')
    const faceapi: any = (window as any).globalFaceApi || await import('face-api.js')
    const video = videoRef.current!
    const captures: number[][] = []
    const skinSamples: number[][] = []
    const eyeColorSamples: number[][] = []
    
    // allow a brief warm-up
    await new Promise((r) => setTimeout(r, 500))

    // capture a larger number of frames for robustness
    for (let i = 0; i < 15; i++) {
      try {
        const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks()
        if (det && det.landmarks) {
          const embedding = computeEmbedding(det.landmarks)
          captures.push(embedding)
          // approximate skin avg by sampling the center of eye bbox
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth || 640
          canvas.height = video.videoHeight || 480
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const pts = det.landmarks.getLeftEye().concat(det.landmarks.getRightEye())
        const xs = pts.map((p: any) => p.x)
        const ys = pts.map((p: any) => p.y)
        const minX = Math.max(0, Math.floor(Math.min(...xs) - 10))
        const minY = Math.max(0, Math.floor(Math.min(...ys) - 10))
        const w = Math.min(80, Math.max(20, Math.floor(Math.max(...xs) - minX)))
        const h = Math.min(60, Math.max(20, Math.floor(Math.max(...ys) - minY)))
        try {
          const img = ctx.getImageData(minX, minY, w, h)
          let r = 0, g = 0, b = 0
          for (let k = 0; k < img.data.length; k += 4) { r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2] }
          const n = img.data.length / 4 || 1
          skinSamples.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)])
          
          const getEyeColor = (pts: any[]) => {
              const xs2 = pts.map((p: any) => p.x)
              const ys2 = pts.map((p: any) => p.y)
              const minX2 = Math.min(...xs2), maxX2 = Math.max(...xs2), minY2 = Math.min(...ys2), maxY2 = Math.max(...ys2)
              const w2 = Math.max(1, maxX2 - minX2), h2 = Math.max(1, maxY2 - minY2)
              try {
                const eyeImg = ctx.getImageData(Math.max(0, Math.floor(minX2)), Math.max(0, Math.floor(minY2)), Math.floor(w2), Math.floor(h2))
                let rc=0, gc=0, bc=0
                for(let i=0; i<eyeImg.data.length; i+=4) { rc += eyeImg.data[i]; gc += eyeImg.data[i+1]; bc += eyeImg.data[i+2] }
                const ne = eyeImg.data.length / 4 || 1
                return [Math.round(rc/ne), Math.round(gc/ne), Math.round(bc/ne)]
              } catch { return [0,0,0] }
          }
          const lc = getEyeColor(det.landmarks.getLeftEye())
          const rc = getEyeColor(det.landmarks.getRightEye())
          eyeColorSamples.push([
             Math.round((lc[0] + rc[0])/2),
             Math.round((lc[1] + rc[1])/2),
             Math.round((lc[2] + rc[2])/2)
          ])

        } catch {
          skinSamples.push([128, 128, 128])
          eyeColorSamples.push([0, 0, 0])
        }
        }
      } catch (e) {
        console.error('Frame capture error:', e)
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    if (captures.length === 0) { setStatus('No faces captured'); return }
    // store the set of embeddings (do not collapse to a single averaged vector)
    const avgSkin = [0, 0, 0]
    for (const s of skinSamples) { avgSkin[0] += s[0]; avgSkin[1] += s[1]; avgSkin[2] += s[2] }
    avgSkin[0] = Math.round(avgSkin[0] / Math.max(1, skinSamples.length))
    avgSkin[1] = Math.round(avgSkin[1] / Math.max(1, skinSamples.length))
    avgSkin[2] = Math.round(avgSkin[2] / Math.max(1, skinSamples.length))

    const avgEyeColor = [0, 0, 0]
    for (const s of eyeColorSamples) { avgEyeColor[0] += s[0]; avgEyeColor[1] += s[1]; avgEyeColor[2] += s[2] }
    avgEyeColor[0] = Math.round(avgEyeColor[0] / Math.max(1, eyeColorSamples.length))
    avgEyeColor[1] = Math.round(avgEyeColor[1] / Math.max(1, eyeColorSamples.length))
    avgEyeColor[2] = Math.round(avgEyeColor[2] / Math.max(1, eyeColorSamples.length))

    const newProfile: Profile = { name: name!, embeddings: captures, skinRGB: avgSkin, eyeColorRGB: avgEyeColor }
    const updated = [...profiles, newProfile]
    // update state and persist immediately to avoid relying solely on effect
    try {
      setProfiles(updated)
      localStorage.setItem('peri_profiles', JSON.stringify(updated))
      console.log('Saved profile', newProfile)
      setStatus(`Registered ${name}`)
    } catch (e) {
      console.error('Failed to save profile', e)
      setStatus('Error saving profile')
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-gray-900 rounded p-2 flex flex-col items-center">
        <div className="relative" style={{ width: '100%', maxWidth: 480, aspectRatio: '4/3' }}>
            <video ref={videoRef} className="rounded w-full h-full object-cover" muted playsInline autoPlay />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>
        <div className="mt-3 w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setMode('register')} className={`px-3 py-1 rounded ${mode === 'register' ? 'bg-green-600' : 'bg-gray-700'}`}>Registration Mode</button>
            <button onClick={() => setMode('scan')} className={`px-3 py-1 rounded ${mode === 'scan' ? 'bg-blue-600' : 'bg-gray-700'}`}>Scan Mode</button>
          </div>
          <div className="flex flex-col items-end">
             <div className="status-chip bg-gray-800 text-gray-200">{status}</div>
             {mode === 'register' && (
                <div className="text-xs text-gray-300 mt-1 flex gap-2">
                    <span>L-Eye: <div className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `rgb(${liveData.leftColor.join(',')})`}}></div></span>
                    <span>R-Eye: <div className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `rgb(${liveData.rightColor.join(',')})`}}></div></span>
                </div>
             )}
          </div>
        </div>
        <div className="mt-3 w-full flex gap-2">
          <button onClick={handleRegister} className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-2">Register Profile</button>
          <button onClick={() => { localStorage.removeItem('peri_profiles'); setProfiles([]) }} className="bg-red-600 hover:bg-red-500 rounded px-3 py-2">Clear Profiles</button>
        </div>
      </div>

      <div className="bg-gray-800 rounded p-4">
        <h2 className="text-lg font-medium mb-2">Profiles</h2>
        <div className="space-y-2 max-h-96 overflow-auto pr-2">
          {profiles.length === 0 && <div className="text-sm text-gray-400">No profiles registered yet.</div>}
          {profiles.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-700 p-2 rounded">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-gray-300 flex items-center gap-1">Skin: <div className="w-2 h-2 rounded-full" style={{backgroundColor: `rgb(${p.skinRGB.join(',')})`}}></div></div>
                {p.eyeColorRGB && <div className="text-xs text-gray-300 flex items-center gap-1">Eyes: <div className="w-2 h-2 rounded-full" style={{backgroundColor: `rgb(${p.eyeColorRGB.join(',')})`}}></div></div>}
              </div>
              <button onClick={() => setProfiles((arr) => arr.filter((_, idx) => idx !== i))} className="text-sm bg-red-600 px-2 py-1 rounded">Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
