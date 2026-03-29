import type { AIProvider, MessageAttachment } from '@/types'

const MAX_TEXT_CHARS = 12_000
const MAX_PREVIEW_CHARS = 240
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const TEXT_FILE_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.htm',
  '.xml', '.yml', '.yaml', '.csv', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php',
  '.rb', '.swift', '.kt', '.sql', '.ini', '.cfg', '.conf', '.log', '.ps1', '.sh', '.bat', '.env', '.toml',
]

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeMimeType(file: File): string {
  return file.type || 'application/octet-stream'
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function isImageAttachment(file: File | MessageAttachment): boolean {
  return normalizeMimeType(file as File).startsWith('image/') || file.kind === 'image'
}

export function isTextAttachment(file: File | MessageAttachment): boolean {
  const mimeType = normalizeMimeType(file as File)
  if ((file as MessageAttachment).kind === 'text') return true
  return mimeType.startsWith('text/') || TEXT_FILE_EXTENSIONS.includes(fileExtension(file.name)) || mimeType.includes('json') || mimeType.includes('xml')
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function sanitizeTextContent(raw: string): string {
  return raw.replace(/\u0000/g, '').trim()
}

export async function createMessageAttachment(file: File): Promise<MessageAttachment> {
  const mimeType = normalizeMimeType(file)

  if (isImageAttachment(file)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return {
        id: createAttachmentId(),
        name: file.name,
        mimeType,
        size: file.size,
        kind: 'binary',
        unsupportedReason: 'Imagen demasiado grande para adjuntarla a la conversación persistida.',
      }
    }

    return {
      id: createAttachmentId(),
      name: file.name,
      mimeType,
      size: file.size,
      kind: 'image',
      dataUrl: await fileToDataUrl(file),
    }
  }

  if (isTextAttachment(file)) {
    const rawText = sanitizeTextContent(await file.text())
    const extractedText = rawText.slice(0, MAX_TEXT_CHARS)
    return {
      id: createAttachmentId(),
      name: file.name,
      mimeType,
      size: file.size,
      kind: 'text',
      extractedText,
      previewText: extractedText.slice(0, MAX_PREVIEW_CHARS),
      isTruncated: rawText.length > MAX_TEXT_CHARS,
    }
  }

  return {
    id: createAttachmentId(),
    name: file.name,
    mimeType,
    size: file.size,
    kind: 'binary',
    unsupportedReason: 'Formato binario sin extracción local de contenido en esta versión.',
  }
}

export async function createMessageAttachments(files: File[]): Promise<MessageAttachment[]> {
  return await Promise.all(files.map(createMessageAttachment))
}

export function buildAttachmentContext(attachment: MessageAttachment): string {
  if (attachment.kind === 'text' && attachment.extractedText?.trim()) {
    const truncation = attachment.isTruncated ? '\n[Contenido truncado para ahorrar contexto.]' : ''
    return `[Archivo adjunto: ${attachment.name} | ${attachment.mimeType} | ${attachment.size} bytes]\n${attachment.extractedText}${truncation}`
  }

  if (attachment.kind === 'image') {
    return `[Imagen adjunta: ${attachment.name} | ${attachment.mimeType} | ${attachment.size} bytes] Usa la imagen si el modelo soporta visión.`
  }

  return `[Archivo adjunto sin extracción automática: ${attachment.name} | ${attachment.mimeType} | ${attachment.size} bytes] ${attachment.unsupportedReason || ''}`.trim()
}

export function buildAttachmentContexts(attachments: MessageAttachment[] = []): string {
  return attachments.map(buildAttachmentContext).join('\n\n')
}

function normalizeModelName(modelName: string): string {
  return modelName.toLowerCase().replace(/^openai\//, '').replace(/^google\//, '')
}

export function modelSupportsVision(modelName: string, provider: AIProvider): boolean {
  const normalized = normalizeModelName(modelName)

  if (provider === 'ollama') {
    return /(llava|bakllava|vision|qwen.*vl|minicpm-v|moondream|gemma3|llama-vision)/.test(normalized)
  }

  return /(gpt-4o|gpt-4\.1|gpt-5|gpt-image-1|vision|gemini|claude-3|qwen.*vl|o4-mini)/.test(normalized)
}

export function getImageVisionAttachments(attachments: MessageAttachment[] = [], modelName: string, provider: AIProvider): MessageAttachment[] {
  if (!modelSupportsVision(modelName, provider)) return []
  return attachments.filter(att => att.kind === 'image' && att.dataUrl)
}
