"use client"

import React, { useRef, useEffect, useState } from 'react'

type Profile = { name: string; embeddings: number[][]; skinRGB: number[]; eyeColorRGB?: number[] }

function getEyeColorName(rgb: number[]) {
  const [r, g, b] = rgb;
  const colors = [
    { name: 'Brown', rgb: [101, 67, 33] },
    { name: 'Dark Brown', rgb: [60, 40, 20] },
    { name: 'Blue', rgb: [70, 130, 180] },
    { name: 'Light Blue', rgb: [135, 206, 235] },
    { name: 'Green', rgb: [34, 139, 34] },
    { name: 'Hazel', rgb: [142, 118, 24] },
    { name: 'Gray', rgb: [128, 128, 128] },
    { name: 'Black', rgb: [20, 20, 20] }
  ];
  let minDist = Infinity;
  let closest = 'Unknown';
  for (const c of colors) {
    const dist = Math.hypot(r - c.rgb[0], g - c.rgb[1], b - c.rgb[2]);
    if (dist < minDist) { minDist = dist; closest = c.name; }
  }
  return closest;
}

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
  
  const [appState, setAppState] = useState<'intro' | 'main'>('intro')
  const [userName, setUserName] = useState('')
  const [nameInput, setNameInput] = useState('')

  const [status, setStatus] = useState('Idle')
  const [mode, setMode] = useState<'scan' | 'register' | 'database'>('scan')
  const [liveData, setLiveData] = useState<{leftColor: number[], rightColor: number[]}>({leftColor: [0,0,0], rightColor: [0,0,0]})
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    try {
      const raw = localStorage.getItem('peri_profiles')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((p: any) => {
          if (!p) return null
          const name = p.name || 'unknown'
          const skinRGB = p.skinRGB || p.skin || [128, 128, 128]
          if (p.embeddings && Array.isArray(p.embeddings)) return { name, embeddings: p.embeddings, skinRGB, eyeColorRGB: p.eyeColorRGB }
          if (p.embedding && Array.isArray(p.embedding)) return { name, embeddings: [p.embedding], skinRGB, eyeColorRGB: p.eyeColorRGB }
          return { name, embeddings: [], skinRGB, eyeColorRGB: p.eyeColorRGB }
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

    // ONLY start the camera if we are in the main app, and NOT viewing the database
    if (appState !== 'main' || mode === 'database') {
       return () => { running = false }
    }

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
          } else if (mode === 'scan') {
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

    return () => { 
      running = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    }
  }, [appState, mode, profiles])

  // registration handler: capture sequence of frames and average metadata
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

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault()
    if (nameInput.trim().length > 0) {
      setUserName(nameInput.trim())
      setAppState('main')
    }
  }

  // ----------------------------------------------------
  // INTRO SCREEN Render
  // ----------------------------------------------------
  if (appState === 'intro') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] bg-gray-900 rounded-xl p-8 border border-gray-700 shadow-2xl">
        <h2 className="text-3xl font-bold text-white mb-2">Welcome to Periocular</h2>
        <p className="text-gray-400 mb-8">Please identify yourself to proceed.</p>
        <form onSubmit={handleStart} className="flex flex-col gap-4 w-full max-w-sm">
          <input 
            type="text" 
            placeholder="Enter your name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="px-4 py-3 rounded-md bg-gray-800 border border-gray-600 focus:border-blue-500 focus:outline-none text-white text-lg"
            maxLength={30}
            autoFocus
          />
          <button 
            type="submit" 
            disabled={!nameInput.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-md transition-colors"
          >
            Start Scan
          </button>
        </form>
      </div>
    )
  }

  // ----------------------------------------------------
  // MAIN APP Render
  // ----------------------------------------------------
  return (
    <div className="flex flex-col gap-4 rounded-xl">
      {/* HEADER / NAVIGATION */}
      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Hello, {userName}!</h2>
          <p className="text-sm text-gray-400">Select an operational mode</p>
        </div>
        
        <div className="flex bg-gray-900 p-1 rounded-lg gap-1 border border-gray-700 w-full sm:w-auto overflow-x-auto">
          <button 
            onClick={() => setMode('register')} 
            className={`flex-1 sm:flex-none px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${mode === 'register' ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
          >
            Register Profile
          </button>
          <button 
            onClick={() => setMode('scan')} 
            className={`flex-1 sm:flex-none px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${mode === 'scan' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
          >
            Scan Face
          </button>
          <button 
            onClick={() => setMode('database')} 
            className={`flex-1 sm:flex-none px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${mode === 'database' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
          >
            Database
          </button>
        </div>
      </div>

      {/* DYNAMIC CONTENT AREA */}
      {(mode === 'scan' || mode === 'register') ? (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-700 shadow-xl flex flex-col items-center max-w-2xl mx-auto w-full">
          <div className="relative w-full rounded-lg overflow-hidden border-2 border-gray-800" style={{ maxWidth: 640, aspectRatio: '4/3' }}>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover bg-black" muted playsInline autoPlay />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            
            <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md border border-gray-600 px-3 py-1.5 rounded-full flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full animate-pulse ${mode === 'register' ? 'bg-green-400' : 'bg-blue-400'}`}></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">
                {status}
              </span>
            </div>
            
            {mode === 'register' && (
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md border border-gray-600 px-3 py-2 rounded-lg flex flex-col gap-1 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                   <span>L-Eye:</span>
                   <div className="w-3 h-3 rounded shadow-inner" style={{ backgroundColor: `rgb(${liveData.leftColor.join(',')})`}}></div>
                </div>
                <div className="flex items-center gap-2">
                   <span>R-Eye:</span>
                   <div className="w-3 h-3 rounded shadow-inner" style={{ backgroundColor: `rgb(${liveData.rightColor.join(',')})`}}></div>
                </div>
              </div>
            )}
          </div>
          
          {mode === 'register' && (
            <div className="mt-4 w-full">
              <button 
                onClick={handleRegister} 
                className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold py-3 rounded-lg shadow-lg transition-transform active:scale-[0.98]"
              >
                Snap to Register
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-xl w-full">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div>
               <h2 className="text-xl font-bold text-white">Registration Database</h2>
               <p className="text-gray-400 text-sm">Review all identified individuals and their tracked features.</p>
            </div>
            <button 
              onClick={() => { if(confirm('Are you sure you want to clear all data?')) { localStorage.removeItem('peri_profiles'); setProfiles([]); } }} 
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-md shadow transition-colors"
            >
              Clear Database
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
            {profiles.length === 0 && (
              <div className="col-span-full py-12 text-center text-gray-500 border-2 border-dashed border-gray-700 rounded-xl">
                <svg className="mx-auto h-12 w-12 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                <p>No profiles found. Switch back to Register Mode.</p>
              </div>
            )}
            {profiles.map((p, i) => (
              <div key={i} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex flex-col justify-between hover:border-gray-500 transition-colors group">
                <div>
                  <div className="flex justify-between items-start mb-2">
                     <h3 className="font-bold text-lg text-white truncate pr-2">{p.name}</h3>
                     <span className="text-xs bg-gray-800 px-2 py-1 rounded-full text-gray-400 shrink-0">ID: {i + 1}</span>
                  </div>
                  
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Skin Tone</span>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md shadow-sm border border-gray-600" style={{backgroundColor: `rgb(${p.skinRGB.join(',')})`}}></div>
                      </div>
                    </div>
                    {p.eyeColorRGB && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Eye Color</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-300 text-xs">{getEyeColorName(p.eyeColorRGB)}</span>
                          <div className="w-5 h-5 rounded-full shadow-sm border border-gray-600" style={{backgroundColor: `rgb(${p.eyeColorRGB.join(',')})`}}></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <button 
                  onClick={() => setProfiles((arr) => arr.filter((_, idx) => idx !== i))} 
                  className="mt-6 w-full py-2 text-sm text-red-500 bg-red-500/10 hover:bg-red-500 hover:text-white rounded-md transition-colors opacity-0 group-hover:opacity-100"
                >
                  Delete Profile
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
