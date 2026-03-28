import { useState } from 'react'
import { Check, ChevronRight, ExternalLink, Zap, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import { setProviderApiKey, setAdditionalProviderKey } from '@/utils/secureSettings'

// ── Provider definitions ──────────────────────────────────────────────────────

interface ProviderDef {
  id: string        // 'main' | 'ap1' | 'ap2' | 'ap3' | 'ap4'
  name: string
  emoji: string
  tagline: string
  description: string
  url: string
  freeModel: string
  badge: string
  keyUrl: string
  color: string
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'main',
    name: 'OpenRouter',
    emoji: '🔮',
    tagline: 'Hub de IAs gratuitas',
    description: 'Decenas de modelos gratuitos: Gemini, Llama, Mistral y más — todo en una sola API.',
    url: 'https://openrouter.ai/api/v1',
    freeModel: 'google/gemini-2.0-flash-exp:free',
    badge: '★ Más recomendado',
    keyUrl: 'https://openrouter.ai/keys',
    color: 'border-kawaii-purple',
  },
  {
    id: 'ap1',
    name: 'Groq',
    emoji: '⚡',
    tagline: 'El más veloz del mundo',
    description: 'Llama 3.3 70B con inferencia ultrarrápida. Tier gratuito muy generoso.',
    url: 'https://api.groq.com/openai/v1',
    freeModel: 'llama-3.3-70b-versatile',
    badge: '🚀 Ultra-rápido',
    keyUrl: 'https://console.groq.com/keys',
    color: 'border-kawaii-pink',
  },
  {
    id: 'ap2',
    name: 'Google Gemini',
    emoji: '🤖',
    tagline: '1 millón de tokens de contexto',
    description: 'Gemini 1.5 Flash: ventana de contexto gigante, gratis en Google AI Studio.',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    freeModel: 'gemini-1.5-flash',
    badge: '🔭 Contexto masivo',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    color: 'border-blue-400',
  },
  {
    id: 'ap3',
    name: 'Together AI',
    emoji: '🎯',
    tagline: '$5 USD de créditos al registrarse',
    description: 'Llama 3.3 70B gratis + créditos iniciales. Excelente para rotación.',
    url: 'https://api.together.xyz/v1',
    freeModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    badge: '💰 Créditos gratis',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    color: 'border-kawaii-teal',
  },
  {
    id: 'ap4',
    name: 'OpenAI / ChatGPT',
    emoji: '🧠',
    tagline: 'API oficial de ChatGPT',
    description: 'Conecta directamente con modelos GPT en la API oficial de OpenAI.',
    url: 'https://api.openai.com/v1',
    freeModel: 'gpt-5.4-mini',
    badge: '💼 API oficial',
    keyUrl: 'https://platform.openai.com/api-keys',
    color: 'border-emerald-400',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1)
  const [keys, setKeys] = useState<Record<string, string>>({ main: '', ap1: '', ap2: '', ap3: '', ap4: '' })
  const [saving, setSaving] = useState(false)
  const { update } = useSettingsStore()

  const configuredCount = Object.values(keys).filter(k => k.trim().length > 8).length
  const configuredProviders = PROVIDERS.filter(p => keys[p.id].trim().length > 8)

  const openLink = (url: string) => window.api?.openExternal?.(url)

  const handleFinish = async () => {
    setSaving(true)
    try {
      if (keys.main.trim()) await setProviderApiKey(keys.main.trim())
      for (const id of ['ap1', 'ap2', 'ap3', 'ap4'] as const) {
        if (keys[id].trim()) await setAdditionalProviderKey(id, keys[id].trim())
      }

      const mainProv = PROVIDERS[0]
      const optionalProviders = PROVIDERS.slice(1)
      const selectedOptional = optionalProviders
        .filter(p => keys[p.id].trim().length > 8)
        .map(p => ({
          id: p.id,
          name: p.name,
          baseUrl: p.url,
          enabled: true,
        }))

      update({
        provider: 'smart',
        cloudBaseUrl: mainProv.url,
        providerBaseUrl: mainProv.url,
        cloudModel: mainProv.freeModel,
        defaultModel: mainProv.freeModel,
        additionalProviders: selectedOptional,
        autoFailover: true,
        prioritizeUnrestricted: true,
        preferFreeTier: true,
        imageGenEnabled: true,
        imageGenModel: 'dall-e-3',
        hasCompletedSetup: true,
      })
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  const skip = () => {
    update({ hasCompletedSetup: true })
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-[100] bg-kawaii-bg flex items-center justify-center p-4 overflow-y-auto">

      {/* ── Paso 1: Bienvenida ────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="max-w-lg w-full text-center animate-fade-in space-y-6 py-8">
          <div className="text-7xl animate-bounce-slow">🌸</div>

          <div>
            <h1 className="text-4xl font-extrabold gradient-text mb-3">KawaiiGPT</h1>
            <p className="text-kawaii-muted text-sm leading-loose max-w-sm mx-auto">
              Tu asistente de IA personal —{' '}
              <span className="text-kawaii-pink font-bold">sin restricciones</span>,
              conectado a múltiples IAs gratuitas con{' '}
              <span className="text-kawaii-purple font-bold">rotación automática</span>{' '}
              cuando se acaban los límites.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <FeatureCard emoji="🔓" title="Sin censura" desc="Sin filtros ni moralismos" />
            <FeatureCard emoji="💸" title="100% gratis" desc="Solo IAs con tier gratuito" />
            <FeatureCard emoji="🔄" title="Auto-rotación" desc="Cambia de IA automáticamente" />
          </div>

          <div className="bg-kawaii-surface border border-kawaii-surface-3 rounded-2xl p-4 text-left space-y-2">
            <p className="text-xs font-bold text-kawaii-muted uppercase tracking-wider mb-3">
              Lo que vas a configurar
            </p>
            {PROVIDERS.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 text-sm">
                <span className="text-lg">{p.emoji}</span>
                <div>
                  <span className="font-semibold text-kawaii-text">{p.name}</span>
                  <span className="text-kawaii-dim text-xs ml-2">{p.tagline}</span>
                </div>
                {i === 0 && (
                  <span className="ml-auto text-kawaii-purple text-[10px] font-bold">★ Principal</span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep(2)}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white font-bold text-base hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            Configurar ahora <ChevronRight size={18} />
          </button>

          <button onClick={skip} className="text-kawaii-dim text-xs hover:text-kawaii-muted underline">
            Saltar y configurar manualmente después
          </button>
        </div>
      )}

      {/* ── Paso 2: Proveedores ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="max-w-2xl w-full animate-fade-in space-y-5 py-6">
          <div className="text-center">
            <h2 className="text-2xl font-extrabold gradient-text">Conecta tus IAs gratuitas</h2>
            <p className="text-kawaii-dim text-sm mt-1.5 max-w-md mx-auto">
              Haz clic en "Obtener clave gratis" para abrir el sitio, crea tu cuenta y pega la clave aquí.
              Cuantas más configures, más tiempo sin interrupciones.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map(p => (
              <ProviderCard
                key={p.id}
                provider={p}
                value={keys[p.id]}
                onChange={v => setKeys(prev => ({ ...prev, [p.id]: v }))}
                onOpenLink={() => openLink(p.keyUrl)}
                configured={keys[p.id].trim().length > 8}
              />
            ))}
          </div>

          <div className="bg-kawaii-surface border border-kawaii-surface-3 rounded-xl p-3 text-xs text-kawaii-dim leading-relaxed">
            <span className="text-kawaii-purple font-bold">Truco pro:</span>{' '}
            KawaiiGPT usa los modelos gratuitos de cada proveedor. Cuando uno alcanza su límite diario,
            salta automáticamente al siguiente. Con más proveedores conectados, tendrás menos interrupciones.
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={() => setStep(1)}
              className="text-kawaii-dim text-sm hover:text-kawaii-muted flex items-center gap-1 transition-colors"
            >
              ← Atrás
            </button>
            <div className="text-kawaii-dim text-xs">
              {configuredCount} de {PROVIDERS.length} configurados
            </div>
            <button
              onClick={() => setStep(3)}
              disabled={configuredCount === 0}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white font-bold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all active:scale-95"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Listo ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="max-w-md w-full text-center animate-fade-in space-y-6 py-8">
          <div className="text-6xl">✨</div>

          <div>
            <h2 className="text-3xl font-extrabold gradient-text mb-2">¡Todo listo!</h2>
            <p className="text-kawaii-muted text-sm leading-relaxed">
              KawaiiGPT está configurado con{' '}
              <span className="text-kawaii-pink font-bold">
                {configuredCount} proveedor{configuredCount !== 1 ? 'es' : ''} de IA gratuita
              </span>.{' '}
              Modo inteligente activo: usará la mejor IA disponible y rotará automáticamente.
            </p>
          </div>

          {/* Summary */}
          <div className="bg-kawaii-surface border border-kawaii-surface-3 rounded-2xl p-4 text-left space-y-3">
            <p className="text-xs font-bold text-kawaii-muted uppercase tracking-wider">
              Proveedores configurados
            </p>
            {configuredProviders.length === 0 ? (
              <p className="text-kawaii-dim text-sm">Ninguno — puedes añadir claves en Ajustes ⚙️ cuando quieras.</p>
            ) : (
              configuredProviders.map(p => (
                <div key={p.id} className="flex items-start gap-3 text-sm">
                  <Check size={14} className="text-kawaii-success mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-semibold text-kawaii-text">{p.emoji} {p.name}</span>
                    <p className="text-kawaii-dim text-[11px] font-mono mt-0.5">{p.freeModel}</p>
                  </div>
                </div>
              ))
            )}
            <div className="border-t border-kawaii-surface-3 pt-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-kawaii-dim">
                <Zap size={12} className="text-kawaii-purple" />
                Modo Smart: routing inteligente local + nube
              </div>
              <div className="flex items-center gap-2 text-xs text-kawaii-dim">
                <RefreshCw size={12} className="text-kawaii-teal" />
                Auto-failover: rotación automática en caso de límite
              </div>
            </div>
          </div>

          <button
            onClick={handleFinish}
            disabled={saving}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white font-bold text-base hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
          >
            {saving ? 'Guardando...' : '🌸 Comenzar a chatear'}
          </button>

          <button
            onClick={() => setStep(2)}
            className="text-kawaii-dim text-xs hover:text-kawaii-muted underline"
          >
            ← Volver y añadir más proveedores
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FeatureCard({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="bg-kawaii-surface border border-kawaii-surface-3 rounded-xl p-3 text-left">
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="font-bold text-kawaii-text text-xs">{title}</div>
      <div className="text-kawaii-dim text-[11px] mt-0.5">{desc}</div>
    </div>
  )
}

function ProviderCard({
  provider, value, onChange, onOpenLink, configured,
}: {
  provider: ProviderDef
  value: string
  onChange: (v: string) => void
  onOpenLink: () => void
  configured: boolean
}) {
  return (
    <div
      className={`border-2 rounded-2xl p-4 space-y-3 transition-all ${
        configured
          ? `${provider.color} shadow-md`
          : 'border-kawaii-surface-3 bg-kawaii-surface'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{provider.emoji}</span>
            <span className="font-bold text-kawaii-text text-sm">{provider.name}</span>
            {configured && <Check size={13} className="text-kawaii-success" />}
          </div>
          <span className="text-[10px] text-kawaii-purple font-semibold">{provider.badge}</span>
        </div>
      </div>

      <p className="text-kawaii-dim text-[11px] leading-relaxed">{provider.description}</p>

      <div className="text-[10px] text-kawaii-dim bg-kawaii-surface-2 rounded-lg px-2 py-1 font-mono truncate">
        {provider.freeModel}
      </div>

      <button
        onClick={onOpenLink}
        className="flex items-center gap-1 text-kawaii-purple text-[11px] hover:underline transition-all"
      >
        <ExternalLink size={10} />
        Obtener API key →
      </button>

      <input
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Pega tu API key aquí..."
        className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-kawaii-pink transition-colors"
      />
    </div>
  )
}
