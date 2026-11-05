import './style.css'

const status = document.querySelector<HTMLElement>('#status')
const button = document.querySelector<HTMLButtonElement>('#check-again')

if (!status || !button) {
  throw new Error('Health status controls are missing')
}

const statusLabel = status
const checkButton = button

async function checkHealth() {
  checkButton.disabled = true
  statusLabel.textContent = '応答を確認しています…'
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('/api/health.json', {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const health = await response.json()
    if (health?.status !== 'ok' || !['api', 'mock'].includes(health.source)) {
      throw new Error('Unexpected health response')
    }

    statusLabel.textContent = health.source === 'mock'
      ? '接続確認 OK（模擬応答）'
      : '接続確認 OK（実API）'
  } catch {
    statusLabel.textContent = '応答を確認できませんでした。もう一度お試しください。'
  } finally {
    window.clearTimeout(timeout)
    checkButton.disabled = false
  }
}

checkButton.addEventListener('click', checkHealth)
void checkHealth()
