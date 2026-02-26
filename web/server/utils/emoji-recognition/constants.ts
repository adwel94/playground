// 이모지/색상 배열 (safari에서는 export 안 하므로 여기서 정의)
export const EMOJI_REC_ANIMAL_EMOJIS = ['🐯', '🐘', '🦒', '🐒', '🦓', '🦁', '🐷', '🐨']
export const EMOJI_REC_BG_COLORS = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
  '#FF00FF', '#00FFFF', '#FFA500', '#800080',
]

// 한국어 매핑 (학습 데이터 정답 생성용)
export const EMOJI_REC_ANIMAL_NAMES_KO: Record<string, string> = {
  '🐯': '호랑이', '🐘': '코끼리', '🦒': '기린', '🐒': '원숭이',
  '🦓': '얼룩말', '🦁': '사자', '🐷': '돼지', '🐨': '코알라',
}
export const EMOJI_REC_COLOR_NAMES_KO: Record<string, string> = {
  '#FF0000': '빨간색', '#00FF00': '초록색', '#0000FF': '파란색', '#FFFF00': '노란색',
  '#FF00FF': '자주색', '#00FFFF': '청록색', '#FFA500': '주황색', '#800080': '보라색',
}
