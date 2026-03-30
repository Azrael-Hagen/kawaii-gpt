const WEB_SEARCH_TIMEOUT_MS = 4_000

export async function searchWeb(query: string, maxResults: number): Promise<Array<{ title: string; snippet: string; url: string }>> {
  if (!window.api?.webSearch) return []
  try {
    return await Promise.race([
      window.api.webSearch(query, maxResults),
      new Promise<Array<{ title: string; snippet: string; url: string }>>(resolve => {
        window.setTimeout(() => resolve([]), WEB_SEARCH_TIMEOUT_MS)
      }),
    ])
  } catch {
    return []
  }
}
