// Real-time авто-обновление сервисі - Firestore onSnapshot пайдалана отырып
import { getFirebaseDb, isFirestoreBlocked, markFirestoreBlocked, isFirebaseInitialized } from './firebase';
import { doc, onSnapshot, Unsubscribe, collection, query, where, orderBy, onSnapshot as onSnapshotCollection } from 'firebase/firestore';
import { CodeFile, Message } from './api';

// Real-time listener-ларды сақтау үшін
const listeners: Map<string, Unsubscribe> = new Map();

/**
 * Код файлына real-time listener қосу
 * Комментарий, лайк және басқа өзгерістерді автоматты түрде көрсетеді
 */
export const subscribeToCode = (
  codeId: string,
  onUpdate: (code: CodeFile) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const listenerKey = `code-${codeId}`;
  
  // Егер бұрынғы listener болса, оны жабу
  const existingListener = listeners.get(listenerKey);
  if (existingListener) {
    existingListener();
  }

  // Check if Firestore is blocked before attempting connection
  if (isFirestoreBlocked() || !isFirebaseInitialized()) {
    // Return empty unsubscribe function - don't attempt connection
    return () => {};
  }

  try {
    const db = getFirebaseDb();
    if (!db) return () => {};
    const codeRef = doc(db, 'codes', codeId);
    const unsubscribe = onSnapshot(
      codeRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const code: CodeFile = {
            id: snapshot.id,
            title: data.title || '',
            content: data.content || '',
            language: data.language || '',
            author: data.author || '',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            tags: data.tags || [],
            description: data.description || '',
            likes: data.likes || [],
            comments: data.comments || [],
            folderId: data.folderId,
            folderPath: data.folderPath,
            isFolder: data.isFolder || false,
            folderStructure: data.folderStructure,
            views: data.views || 0,
            viewedBy: data.viewedBy || [],
          };
          onUpdate(code);
        }
      },
      (error: any) => {
        // ERR_BLOCKED_BY_CLIENT қатесін (ad blocker) елемеу
        const errorMessage = error?.message || error?.toString() || '';
        const errorStack = error?.stack || '';
        const errorString = JSON.stringify(error) || '';
        const isBlocked = 
          error?.code === 'unavailable' || 
          error?.code === 'permission-denied' ||
          errorMessage.includes('BLOCKED_BY_CLIENT') ||
          errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Failed to fetch') ||
          errorStack.includes('BLOCKED_BY_CLIENT') ||
          errorStack.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorString.includes('BLOCKED_BY_CLIENT') ||
          errorString.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorString.includes('Listen/channel') ||
          errorString.includes('TYPE=terminate');
        
        if (isBlocked) {
          // Mark Firestore as blocked for future attempts
          markFirestoreBlocked();
          // Тыныштықпен елемеу - API деректері пайдаланылады
          // Error suppression utility will handle console output
          return;
        }
        // Only log non-blocked errors (error suppression will filter known patterns)
        console.error('Error listening to code:', error);
        if (onError) {
          onError(error as Error);
        }
      }
    );

    listeners.set(listenerKey, unsubscribe);
    return unsubscribe;
  } catch (error) {
    console.error('Failed to subscribe to code:', error);
    if (onError) {
      onError(error as Error);
    }
    // Return empty unsubscribe function
    return () => {};
  }
};

/**
 * Хабарламаларға real-time listener қосу
 * Екі пайдаланушы арасындағы хабарламаларды автоматты түрде көрсетеді
 */
export const subscribeToMessages = (
  userId1: string,
  userId2: string,
  onUpdate: (messages: Message[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const listenerKey = `messages-${userId1}-${userId2}`;
  
  // Егер бұрынғы listener болса, оны жабу
  const existingListener = listeners.get(listenerKey);
  if (existingListener) {
    existingListener();
  }

  // Check if Firestore is blocked before attempting connection
  if (isFirestoreBlocked() || !isFirebaseInitialized()) {
    // Return empty unsubscribe function - don't attempt connection
    return () => {};
  }

  try {
    const db = getFirebaseDb();
    if (!db) return () => {};
    // Екі пайдаланушы арасындағы хабарламаларды табу
    const messagesRef = collection(db, 'messages');
    const q = query(
      messagesRef,
      where('fromUserId', 'in', [userId1, userId2]),
      where('toUserId', 'in', [userId1, userId2]),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshotCollection(
      q,
      (snapshot) => {
        const messages: Message[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          messages.push({
            id: doc.id,
            fromUserId: data.fromUserId,
            toUserId: data.toUserId,
            content: data.content,
            createdAt: data.createdAt || new Date().toISOString(),
            read: data.read || false,
          });
        });
        onUpdate(messages);
      },
      (error: any) => {
        // ERR_BLOCKED_BY_CLIENT қатесін (ad blocker) елемеу
        const errorMessage = error?.message || error?.toString() || '';
        const errorStack = error?.stack || '';
        const errorString = JSON.stringify(error) || '';
        const isBlocked = 
          error?.code === 'unavailable' || 
          error?.code === 'permission-denied' ||
          errorMessage.includes('BLOCKED_BY_CLIENT') ||
          errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Failed to fetch') ||
          errorStack.includes('BLOCKED_BY_CLIENT') ||
          errorStack.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorString.includes('BLOCKED_BY_CLIENT') ||
          errorString.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorString.includes('Listen/channel') ||
          errorString.includes('TYPE=terminate');
        
        if (isBlocked) {
          // Mark Firestore as blocked for future attempts
          markFirestoreBlocked();
          // Тыныштықпен елемеу - API деректері пайдаланылады
          // Error suppression utility will handle console output
          return;
        }
        // Only log non-blocked errors (error suppression will filter known patterns)
        console.error('Error listening to messages:', error);
        if (onError) {
          onError(error as Error);
        }
      }
    );

    listeners.set(listenerKey, unsubscribe);
    return unsubscribe;
  } catch (error) {
    console.error('Failed to subscribe to messages:', error);
    if (onError) {
      onError(error as Error);
    }
    // Return empty unsubscribe function
    return () => {};
  }
};

/**
 * Кодтар тізіміне real-time listener қосу
 * Жаңа кодтарды, өзгертілген кодтарды автоматты түрде көрсетеді
 */
export const subscribeToCodes = (
  folderId: string | null,
  onUpdate: (codes: CodeFile[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const listenerKey = folderId ? `codes-folder-${folderId}` : 'codes-all';
  
  // Егер бұрынғы listener болса, оны жабу
  const existingListener = listeners.get(listenerKey);
  if (existingListener) {
    existingListener();
  }

  // Check if Firestore is blocked before attempting connection
  if (isFirestoreBlocked() || !isFirebaseInitialized()) {
    // Return empty unsubscribe function - don't attempt connection
    // Call onUpdate with empty array so component doesn't wait
    setTimeout(() => onUpdate([]), 0);
    return () => {};
  }

  try {
    const db = getFirebaseDb();
    if (!db) {
      setTimeout(() => onUpdate([]), 0);
      return () => {};
    }
    const codesRef = collection(db, 'codes');
    let q;
    
    if (folderId) {
      q = query(
        codesRef,
        where('folderId', '==', folderId),
        orderBy('createdAt', 'desc')
      );
    } else {
      // Басты бетте: folderId === null болатын барлық кодтар мен папкалар
      // Note: Firestore 'where field == null' only matches docs where the field
      // is explicitly set to null, not docs where the field is absent.
      // We also filter client-side to catch documents without folderId.
      try {
        q = query(
          codesRef,
          where('folderId', '==', null),
          orderBy('createdAt', 'desc')
        );
      } catch (indexError: any) {
        // Егер индекс мәселесі болса, orderBy-сыз сұрау жасаймыз
        console.warn('Index error, using query without orderBy:', indexError);
        q = query(
          codesRef,
          where('folderId', '==', null)
        );
      }
    }

    const unsubscribe = onSnapshotCollection(
      q,
      (snapshot) => {
        // Егер snapshot қателі болса, елемеу
        if (!snapshot) {
          return;
        }
        
        const codes: CodeFile[] = [];
        snapshot.forEach((doc) => {
          if (!doc.exists()) {
            return;
          }
          const data = doc.data();
          // isFolder қасиетін дұрыс анықтау - әртүрлі форматын қолдау
          const isFolderValue = data.isFolder;
          const isFolder = isFolderValue === true || 
                          isFolderValue === 'true' || 
                          isFolderValue === 1 || 
                          String(isFolderValue).toLowerCase() === 'true';
          
          const code: CodeFile = {
            id: doc.id,
            title: data.title || '',
            content: data.content || '',
            language: data.language || '',
            author: data.author || '',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            tags: data.tags || [],
            description: data.description || '',
            likes: data.likes || [],
            comments: data.comments || [],
            folderId: data.folderId !== undefined ? data.folderId : null,
            folderPath: data.folderPath,
            isFolder: isFolder,
            folderStructure: data.folderStructure,
            views: data.views || 0,
            viewedBy: data.viewedBy || [],
          };
          // For non-folder queries, also include docs where folderId field is absent
          // (Firestore '== null' doesn't match absent fields)
          if (folderId || code.folderId === null || data.folderId === undefined) {
            codes.push(code);
          }
        });
        
        // Егер orderBy қолданылмаған болса, клиентте сұрыптау
        if (!folderId && codes.length > 0) {
          codes.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return dateB - dateA; // desc order
          });
        }
        
        const folderCount = codes.filter(c => c.isFolder === true).length;
        // Тек маңызды ақпаратты көрсету
        if (codes.length > 0) {
          console.log('subscribeToCodes: Loaded codes:', codes.length, 'folders:', folderCount);
        }
        onUpdate(codes);
      },
      (error: any) => {
        // ERR_BLOCKED_BY_CLIENT қатесін (ad blocker) елемеу
        const errorMessage = error?.message || error?.toString() || '';
        const errorStack = error?.stack || '';
        const errorString = JSON.stringify(error) || '';
        const isBlocked = 
          error?.code === 'unavailable' || 
          error?.code === 'permission-denied' ||
          errorMessage.includes('BLOCKED_BY_CLIENT') ||
          errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Failed to fetch') ||
          errorStack.includes('BLOCKED_BY_CLIENT') ||
          errorStack.includes('ERR_BLOCKED_BY_CLIENT') ||
          errorString.includes('BLOCKED_BY_CLIENT') ||
          errorString.includes('ERR_BLOCKED_BY_CLIENT');
        
        if (isBlocked) {
          // Mark Firestore as blocked for future attempts
          markFirestoreBlocked();
          // Тыныштықпен елемеу - API деректері пайдаланылады
          // Бос массив қайтару, сонда API деректері пайдаланылады
          onUpdate([]);
          return;
        }
        console.error('Error listening to codes:', error);
        if (onError) {
          onError(error as Error);
        }
      }
    );

    listeners.set(listenerKey, unsubscribe);
    return unsubscribe;
  } catch (error: any) {
    // ERR_BLOCKED_BY_CLIENT қатесін (ad blocker) елемеу
    const errorMessage = error?.message || error?.toString() || '';
    const errorStack = error?.stack || '';
    const errorString = JSON.stringify(error) || '';
    const isBlocked = 
      error?.code === 'unavailable' || 
      error?.code === 'permission-denied' ||
      errorMessage.includes('BLOCKED_BY_CLIENT') ||
      errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
      errorMessage.includes('network') ||
      errorMessage.includes('Failed to fetch') ||
      errorStack.includes('BLOCKED_BY_CLIENT') ||
      errorStack.includes('ERR_BLOCKED_BY_CLIENT') ||
      errorString.includes('BLOCKED_BY_CLIENT') ||
      errorString.includes('ERR_BLOCKED_BY_CLIENT');
    
    if (isBlocked) {
      // Mark Firestore as blocked for future attempts
      markFirestoreBlocked();
      // Тыныштықпен елемеу - API деректері пайдаланылады
      // Бос unsubscribe функциясы қайтару
      // Call onUpdate with empty array so component doesn't wait
      setTimeout(() => onUpdate([]), 0);
      return () => {};
    }
    // Тек нақты қателерді көрсету
    if (error?.code !== 'permission-denied' && 
        !errorMessage.includes('network') &&
        !errorMessage.includes('Failed to fetch')) {
      console.error('Failed to subscribe to codes:', error);
    }
    if (onError) {
      onError(error as Error);
    }
    // Return empty unsubscribe function
    return () => {};
  }
};

/**
 * Нақты listener-ды жабу
 */
export const unsubscribe = (key: string) => {
  const listener = listeners.get(key);
  if (listener) {
    listener();
    listeners.delete(key);
  }
};
