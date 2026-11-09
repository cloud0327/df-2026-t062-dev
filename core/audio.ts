// 録音の形式。Speech-to-Text v2（Chirp 3）の自動の読み取りが受け付けるのは、mp4・m4a・mov なら AAC だけ、
// Opus なら webm か ogg の入れ物だけ（2026-11-09 に公式の説明で確かめた）。PC の Chrome は audio/mp4 を選ぶと Opus になるので、webm を先にする。

/** 録る形式の好み（先に書いたものから、ブラウザが録れるものを選ぶ） */
export const RECORDING_MIME_PREFS = [
  'audio/webm;codecs=opus', // Chrome・Firefox・Edge
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2', // Safari（AAC）
  'audio/mp4', // 古い Safari（AAC）
]

/** ブラウザが録れる形式から選ぶ。なければ空（ブラウザに任せる） */
export function pickRecordingMime(isSupported: (mime: string) => boolean): string {
  return RECORDING_MIME_PREFS.find((m) => isSupported(m)) ?? ''
}

/** 文字起こしできる形式か。入れ物と、指定があれば中の形式（codecs）で見る */
export function transcribable(mime: string): boolean {
  const [type, ...params] = mime.toLowerCase().split(';').map((x) => x.trim())
  const codecs = params.find((p) => p.startsWith('codecs='))?.slice(7).replace(/"/g, '') ?? ''
  if (/^(audio|video)\/(mp4|x-m4a|m4a|quicktime)$/.test(type)) return codecs === '' || codecs.startsWith('mp4a')
  if (/^(audio|video)\/(webm|ogg)$/.test(type)) return codecs === '' || codecs === 'opus'
  return true
}
