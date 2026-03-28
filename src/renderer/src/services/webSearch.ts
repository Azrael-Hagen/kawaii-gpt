export async function searchWeb(query: string, maxResults: number): Promise<Array<{ title: string; snippet: string; url: string }>> {
  if (!window.api?.webSearch) return []
  try {
    return await window.api.webSearch(query, maxResults)
  } catch {
    return []
  }
}
