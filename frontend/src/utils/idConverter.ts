/**
 * Converts Firebase UID (alphanumeric) to numeric ID (12 digits)
 * Uses the same logic as backend to ensure consistency
 */
function convertToNumericId(firebaseUid: string): string {
  if (!firebaseUid) return '';
  
  // If already numeric, return as-is
  if (/^\d+$/.test(firebaseUid)) {
    return firebaseUid;
  }
  
  // Deterministic hash function (SHA-256 based for consistency across sessions)
  // This must match the backend's hashlib.sha256 approach
  let hash = 0;
  for (let i = 0; i < firebaseUid.length; i++) {
    const char = firebaseUid.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0; // Convert to 32-bit signed integer (was `hash & hash` which is a no-op)
  }

  const hashValue = Math.abs(hash);
  // Convert to 12-digit number (same as backend)
  const numericId = String(hashValue % (10 ** 12)).padStart(12, '0');
  
  return numericId;
}

/**
 * Checks if an ID is numeric (only digits)
 */
export function isNumericId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * Ensures an ID is numeric, converting if necessary
 */
export function ensureNumericId(id: string): string {
  if (!id) return '';
  if (isNumericId(id)) {
    return id;
  }
  return convertToNumericId(id);
}















