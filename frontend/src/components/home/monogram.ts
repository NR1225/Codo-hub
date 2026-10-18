// Атаудың бірінші әрпі — жобаның белгішесі ретінде (sidebar мен Сайт ЖИ-де)
export function monogram(title: string): string {
  return Array.from(title.trim())[0]?.toUpperCase() || '?';
}
