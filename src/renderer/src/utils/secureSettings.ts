export async function getProviderApiKey(): Promise<string> {
  try {
    return (await window.api?.getSecret?.('providerApiKey')) ?? ''
  } catch {
    return ''
  }
}

export async function setProviderApiKey(value: string): Promise<void> {
  await window.api?.setSecret?.('providerApiKey', value)
}

export async function getAdditionalProviderKey(id: string): Promise<string> {
  try {
    return (await window.api?.getSecret?.(`ap_${id}_key`)) ?? ''
  } catch {
    return ''
  }
}

export async function setAdditionalProviderKey(id: string, value: string): Promise<void> {
  await window.api?.setSecret?.(`ap_${id}_key`, value)
}

/** Generic lookup — used when providerKeyId is stored on the model object. */
export async function getSecretKey(keyId: string): Promise<string> {
  try {
    return (await window.api?.getSecret?.(keyId)) ?? ''
  } catch {
    return ''
  }
}
