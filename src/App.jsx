import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import './App.css'

const RecruitmentHub = lazy(() => import('./recruitment/RecruitmentHub'))

const GENRES = ['Drama', 'Comedy', 'Thriller', 'Sci-Fi', 'Romance', 'Horror']
const TONES = ['Dark', 'Light', 'Neutral']
const SCENE_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1)
const STORAGE_KEY = 'ai-scriptify-history'

const initialForm = {
  idea: '',
  genres: ['Drama'],
  tone: 'Neutral',
  scenes: 3,
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function normalizeGenres(genres) {
  if (Array.isArray(genres)) {
    return genres.filter(Boolean)
  }

  if (typeof genres === 'string' && genres.trim()) {
    return [genres.trim()]
  }

  return []
}

function formatGenres(genres) {
  const normalizedGenres = normalizeGenres(genres)
  return normalizedGenres.join(', ')
}

function hasGenre(genres, genre) {
  return normalizeGenres(genres).includes(genre)
}

function buildPrompt({ idea, genres, tone, scenes }) {
  return `Write a professional short screenplay based on the following details.

Story idea: ${idea}
Genres: ${formatGenres(genres)}
Tone: ${tone}
Number of scenes: ${scenes}

Requirements:
- Use standard screenplay formatting cues.
- Start with FADE IN:
- Include scene headings, action lines, character names, dialogue, and transitions when appropriate.
- Keep the script cinematic, emotionally engaging, and easy to read.
- Write exactly ${scenes} scenes.
- End with FADE OUT.
- Return only the screenplay text with no explanations or markdown.`
}

function parseScenes(script) {
  if (!script) return [];
  const lines = script.split('\n');
  const scenes = [];
  let currentScene = { title: '', text: '', id: crypto.randomUUID() };
  
  for (const line of lines) {
    if (line.trim().startsWith('INT.') || line.trim().startsWith('EXT.') || line.trim().startsWith('SCENE')) {
      if (currentScene.title || currentScene.text) {
        scenes.push(currentScene);
      }
      currentScene = { title: line.trim(), text: '', id: crypto.randomUUID() };
    } else {
      currentScene.text += line + '\n';
    }
  }
  if (currentScene.title || currentScene.text) {
    scenes.push(currentScene);
  }
  return scenes;
}

async function requestOpenRouter(messages, temperature) {
  const response = await fetch('/api/openrouter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature }),
  })

  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The AI service returned an invalid response.')
  }

  if (!response.ok) {
    const message = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message
    throw new Error(message || `OpenRouter request failed with status ${response.status}.`)
  }
  return data
}

async function generateSceneDirections(script) {
  const data = await requestOpenRouter([
    {
      role: 'system',
      content: 'You are a film director and location scout. Analyze the screenplay and return only valid JSON with this shape: {"scenes":[{"scene_heading":"exact screenplay scene heading","location_suggestion":"specific practical location suggestion with relevant atmosphere","camera_angles":["specific camera angle and movement tied to a story beat","another specific camera angle tied to a story beat"]}]}. Include one item for each screenplay scene, in screenplay order. Base every suggestion on the actual scene content. Do not include markdown or extra keys.',
    },
    { role: 'user', content: script },
  ], 0.6)

  const content = data?.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('OpenRouter returned no camera or location suggestions.')
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('OpenRouter returned camera and location suggestions in an unexpected format.')
  }

  let parsed
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('OpenRouter returned invalid JSON for camera and location suggestions.')
  }

  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
    throw new Error('OpenRouter did not return suggestions for any screenplay scenes.')
  }

  return parsed.scenes.map((scene) => {
    if (
      typeof scene?.scene_heading !== 'string' ||
      typeof scene?.location_suggestion !== 'string' ||
      !Array.isArray(scene?.camera_angles) ||
      !scene.camera_angles.every((angle) => typeof angle === 'string')
    ) {
      throw new Error('OpenRouter returned an incomplete scene suggestion.')
    }

    return scene
  })
}

function downloadScriptPdf(title, script) {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  })

  const margin = 48
  const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2
  const pageHeight = pdf.internal.pageSize.getHeight()

  pdf.setFillColor(10, 10, 10)
  pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pageHeight, 'F')
  pdf.setTextColor(240, 192, 64)
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(18)
  pdf.text(title, margin, 52)

  pdf.setDrawColor(240, 192, 64)
  pdf.line(margin, 64, pdf.internal.pageSize.getWidth() - margin, 64)

  pdf.setTextColor(248, 244, 230)
  pdf.setFont('courier', 'normal')
  pdf.setFontSize(11)

  const lines = pdf.splitTextToSize(script, pageWidth)
  let y = 88

  lines.forEach((line) => {
    if (y > pageHeight - margin) {
      pdf.addPage()
      pdf.setFillColor(10, 10, 10)
      pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pageHeight, 'F')
      pdf.setTextColor(248, 244, 230)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(11)
      y = margin
    }

    pdf.text(line, margin, y)
    y += 16
  })

  pdf.save(`${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'ai-scriptify-script'}.pdf`)
}

function SceneDirectionCard({ scene, index, direction }) {
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)

  const handleGenerateAudio = async () => {
    if (isPlaying) {
      window.speechSynthesis.cancel()
      setIsPlaying(false)
      return
    }

    setAudioLoading(true)
    setAudioError('')
    
    try {
      const textToRead = (scene.title + '\n' + scene.text)
      
      if (!('speechSynthesis' in window)) {
        throw new Error('Text-to-speech is not supported in this browser.')
      }

      window.speechSynthesis.cancel() // Stop any currently playing audio

      const utterance = new SpeechSynthesisUtterance(textToRead)
      
      // Try to find a good English voice
      const voices = window.speechSynthesis.getVoices()
      const englishVoice = voices.find(v => v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'))) || voices.find(v => v.lang.startsWith('en-'))
      
      if (englishVoice) {
        utterance.voice = englishVoice
      }

      utterance.rate = 0.95
      utterance.pitch = 1.0

      utterance.onstart = () => setIsPlaying(true)
      utterance.onend = () => setIsPlaying(false)
      utterance.onerror = (e) => {
        setIsPlaying(false)
        if (e.error !== 'canceled') {
          setAudioError('Failed to play audio.')
        }
      }

      window.speechSynthesis.speak(utterance)
    } catch (err) {
      setAudioError(err.message || 'Audio generation failed.')
      setIsPlaying(false)
    } finally {
      setAudioLoading(false)
    }
  }

  return (
    <article className="scene-direction-card">
      <div className="scene-direction-content">
        <div className="scene-direction-header">
          <div>
            <span className="scene-direction-index">Scene {index + 1}</span>
            <h3>{direction?.scene_heading || scene.title || `Scene ${index + 1}`}</h3>
          </div>
          <div className="scene-direction-audio-actions">
            <button type="button" className="secondary-button" onClick={handleGenerateAudio} disabled={audioLoading}>
              {audioLoading ? 'Preparing audio…' : isPlaying ? 'Stop Audio' : 'Play Scene Audio'}
            </button>
          </div>
        </div>
        {audioError && <p className="status-message error-message">{audioError}</p>}
        <section className="scene-suggestions-panel">
          <div className="scene-suggestions-grid">
            <article className="scene-suggestion-card">
              <span>Location</span>
              <p>{direction?.location_suggestion || 'No location suggestion was returned for this scene.'}</p>
            </article>
            <article className="scene-suggestion-card">
              <span>Camera Angles</span>
              {direction?.camera_angles?.length ? (
                <ul>{direction.camera_angles.map((angle, angleIndex) => <li key={`${angleIndex}-${angle}`}>{angle}</li>)}</ul>
              ) : <p>No camera angles were returned for this scene.</p>}
            </article>
          </div>
        </section>
        <pre className="scene-direction-script">
          {scene.title && <strong>{scene.title}{'\n'}</strong>}
          {scene.text}
        </pre>
      </div>
    </article>
  )
}

function GeneratorPage({
  form,
  script,
  suggestions,
  suggestionsLoading,
  suggestionsError,
  loading,
  error,
  copied,
  onFormChange,
  onGenerate,
  onRetrySuggestions,
  onCopy,
  onDownload,
}) {
  const [viewMode, setViewMode] = useState('text')
  const hasScript = Boolean(script)
  const scenes = useMemo(() => parseScenes(script), [script])
  const screenplayScenes = scenes.filter((scene) => scene.title)

  return (
    <div className="page-shell">
      <section className="hero-panel">
        <div className="eyebrow">AI-Powered Screenplay Studio</div>
        <h1>AI Scriptify</h1>
        <p className="hero-copy">
          Turn a raw story spark into a polished screenplay with cinematic structure,
          dialogue, and scene-by-scene pacing.
        </p>
        <div className="hero-pills">
          <span>OpenRouter + Llama 3.3 70B</span>
          <span>Local script history</span>
          <span>PDF export</span>
        </div>
      </section>

      <section className="workspace-grid">
        <form className="control-panel" onSubmit={onGenerate}>
          <div className="section-heading">
            <h2>Story Setup</h2>
            <p>Shape the world, mood, and pacing before the first scene begins.</p>
          </div>

          <label className="field">
            <span>Story Idea</span>
            <textarea
              name="idea"
              value={form.idea}
              onChange={onFormChange}
              placeholder="A washed-up detective receives calls from his future self warning him about a murder at midnight."
              rows={7}
              required
            />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>Genre</span>
              <select
                name="genrePick"
                value=""
                onChange={(event) => {
                  const nextGenre = event.target.value
                  if (!nextGenre) return
                  onFormChange({
                    target: { name: 'genres', value: Array.from(new Set([...normalizeGenres(form.genres), nextGenre])) },
                  })
                }}
              >
                <option value="" disabled>
                  Select genre…
                </option>
                {GENRES.map((genre) => (
                  <option key={genre} value={genre} disabled={hasGenre(form.genres, genre)}>
                    {genre}
                  </option>
                ))}
              </select>
              {normalizeGenres(form.genres).length ? (
                <div className="genre-chip-row">
                  {normalizeGenres(form.genres).map((genre) => (
                    <span key={genre} className="genre-chip">
                      {genre}
                      <button
                        type="button"
                        className="genre-chip-remove"
                        onClick={() => {
                          const nextGenres = normalizeGenres(form.genres).filter((item) => item !== genre)
                          onFormChange({ target: { name: 'genres', value: nextGenres.length ? nextGenres : ['Drama'] } })
                        }}
                        aria-label={`Remove ${genre}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </label>

            <label className="field">
              <span>Tone</span>
              <select name="tone" value={form.tone} onChange={onFormChange}>
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Scenes</span>
              <select name="scenes" value={form.scenes} onChange={onFormChange}>
                {SCENE_OPTIONS.map((sceneCount) => (
                  <option key={sceneCount} value={sceneCount}>
                    {sceneCount}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true"></span>
                Generating screenplay...
              </>
            ) : (
              'Generate Script'
            )}
          </button>

          {error ? <p className="status-message error-message">{error}</p> : null}
        </form>

        <section className="output-panel">
          <div className="output-header">
            <div>
              <h2>Screenplay Output</h2>
              <p>Formatted for a dramatic, readable screenplay presentation.</p>
            </div>

            <div className="action-group">
              {hasScript && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setViewMode((current) => current === 'text' ? 'directions' : 'text')}
                >
                  {viewMode === 'text' ? 'View Camera & Location' : 'View Text Script'}
                </button>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={onCopy}
                disabled={!hasScript}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={onDownload}
                disabled={!hasScript}
              >
                Download PDF
              </button>
            </div>
          </div>

          <div className={`screenplay-frame ${hasScript ? 'ready' : 'empty'}`}>
            {hasScript ? (
              viewMode === 'text' ? (
                <pre>{script}</pre>
              ) : (
                <div className="scene-direction-list" aria-live="polite">
                  {suggestionsLoading && (
                    <p className="scene-directions-status">
                      <span className="spinner" aria-hidden="true"></span>
                      Analyzing screenplay for camera and location ideas…
                    </p>
                  )}
                  {suggestionsError && (
                    <div className="scene-directions-error">
                      <p className="status-message error-message">{suggestionsError}</p>
                      <button className="secondary-button" type="button" onClick={onRetrySuggestions} disabled={suggestionsLoading}>
                        Retry suggestions
                      </button>
                    </div>
                  )}
                  {!suggestionsLoading && !suggestionsError && !suggestions.length && (
                    <p className="scene-directions-status">No camera or location suggestions are available yet.</p>
                  )}
                  {screenplayScenes.length ? screenplayScenes.map((scene, index) => {
                    const direction = suggestions.find((item) =>
                      item.scene_heading?.trim().toLowerCase() === scene.title.trim().toLowerCase(),
                    ) || suggestions[index]
                    return (
                      <SceneDirectionCard
                        key={scene.id}
                        scene={scene}
                        index={index}
                        direction={direction}
                      />
                    )
                  }) : (
                    <p className="scene-directions-status">No scene headings were found in this screenplay.</p>
                  )}
                </div>
              )
            ) : (
              <div className="empty-state">
                <span className="empty-label">FADE IN:</span>
                <p>Your generated screenplay appears here with scene headings, action lines, and dialogue.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </div>
  )
}

function HistoryPage({ history, onReuse }) {
  const navigate = useNavigate()

  const handleReuse = (entry) => {
    onReuse(entry)
    navigate('/')
  }

  return (
    <div className="page-shell">
      <section className="history-panel">
        <div className="section-heading history-header">
          <div>
            <div className="eyebrow">Saved Scripts</div>
            <h1>History</h1>
            <p>Every generated screenplay is stored locally in your browser for quick revisit and reuse.</p>
          </div>
          <Link className="secondary-button nav-button" to="/">
            Back to Generator
          </Link>
        </div>

        {history.length ? (
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-card" key={entry.id}>
                <div className="history-card-top">
                  <div>
                    <h2>{entry.title}</h2>
                    <p>{formatDate(entry.createdAt)}</p>
                  </div>
                  <div className="history-meta">
                    <span>{formatGenres(entry.genres || entry.genre)}</span>
                    <span>{entry.tone}</span>
                    <span>{entry.scenes} scenes</span>
                  </div>
                </div>

                <p className="history-idea">{entry.idea}</p>
                <pre className="history-preview">{entry.script}</pre>

                <div className="action-group">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleReuse(entry)}
                  >
                    Reuse
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => downloadScriptPdf(entry.title, entry.script)}
                  >
                    Download PDF
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-history">
            <span className="empty-label">NO SAVED SCRIPTS</span>
            <p>Generate your first screenplay and it appears here automatically.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function App() {
  const [form, setForm] = useState(initialForm)
  const [script, setScript] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState([])
  const suggestionsRequestRef = useRef(0)

  useEffect(() => {
    const storedHistory = localStorage.getItem(STORAGE_KEY)

    if (!storedHistory) {
      return
    }

    try {
      setHistory(JSON.parse(storedHistory))
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (!history.length) {
      return
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  }, [history])

  const currentTitle = useMemo(() => {
    const trimmedIdea = form.idea.trim()

    if (!trimmedIdea) {
      return 'AI Scriptify Screenplay'
    }

    return trimmedIdea.split(/[.!?]/)[0].slice(0, 60)
  }, [form.idea])

  const handleFormChange = (event) => {
    const { name, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: name === 'scenes' ? Number(value) : value,
    }))
  }

  const loadSceneSuggestions = async (targetScript) => {
    const requestId = suggestionsRequestRef.current + 1
    suggestionsRequestRef.current = requestId
    setSuggestions([])
    setSuggestionsError('')
    setSuggestionsLoading(true)
    try {
      const generatedSuggestions = await generateSceneDirections(targetScript)
      if (requestId === suggestionsRequestRef.current) {
        setSuggestions(generatedSuggestions)
      }
    } catch (requestError) {
      if (requestId === suggestionsRequestRef.current) {
        setSuggestionsError(requestError.message || 'Unable to generate camera and location suggestions.')
      }
    } finally {
      if (requestId === suggestionsRequestRef.current) {
        setSuggestionsLoading(false)
      }
    }
  }

  const handleGenerate = async (event) => {
    event.preventDefault()
    setCopied(false)
    setError('')

    if (!normalizeGenres(form.genres).length) {
      setError('Select at least one genre before generating.')
      return
    }

    setLoading(true)

    try {
      const prompt = buildPrompt(form)
      const data = await requestOpenRouter([{ role: 'user', content: prompt }], 0.9)
      const generatedScript = data?.choices?.[0]?.message?.content?.trim()

      if (!generatedScript) {
        throw new Error('The model returned an empty response.')
      }

      const entry = {
        id: crypto.randomUUID(),
        title: currentTitle,
        ...form,
        genres: normalizeGenres(form.genres),
        script: generatedScript,
        createdAt: Date.now(),
      }

      setScript(generatedScript)
      setHistory((currentHistory) => [entry, ...currentHistory].slice(0, 12))
      void loadSceneSuggestions(generatedScript)
    } catch (requestError) {
      setError(requestError.message || 'Unable to generate a screenplay right now.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!script) {
      return
    }

    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy failed. Your browser may have blocked clipboard access.')
    }
  }

  const handleDownload = () => {
    if (!script) {
      return
    }

    downloadScriptPdf(currentTitle, script)
  }

  const handleReuse = (entry) => {
    setForm({
      idea: entry.idea,
      genres: normalizeGenres(entry.genres || entry.genre).length ? normalizeGenres(entry.genres || entry.genre) : ['Drama'],
      tone: entry.tone,
      scenes: entry.scenes,
    })
    setScript(entry.script)
    void loadSceneSuggestions(entry.script)
    setCopied(false)
    setError('')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          AI Scriptify
        </Link>
        <nav className="nav-links">
          <Link className="nav-link" to="/">
            Generator
          </Link>
          <Link className="nav-link" to="/history">
            History
          </Link>
          <Link className="nav-link" to="/recruitment">
            Recruitment
          </Link>
        </nav>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <GeneratorPage
              form={form}
              script={script}
              suggestions={suggestions}
              suggestionsLoading={suggestionsLoading}
              suggestionsError={suggestionsError}
              loading={loading}
              error={error}
              copied={copied}
              onFormChange={handleFormChange}
              onGenerate={handleGenerate}
              onRetrySuggestions={() => void loadSceneSuggestions(script)}
              onCopy={handleCopy}
              onDownload={handleDownload}
            />
          }
        />
        <Route path="/history" element={<HistoryPage history={history} onReuse={handleReuse} />} />
        <Route
          path="/recruitment/*"
          element={
            <Suspense fallback={<div className="page-shell">Loading Recruitment Hub…</div>}>
              <RecruitmentHub />
            </Suspense>
          }
        />
      </Routes>
    </div>
  )
}

export default App
