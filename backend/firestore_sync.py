# Firestore синхрондау модулі
# Backend JSON файлдарға сақтаумен қатар Firestore-ға да жазады

import os
from typing import Dict, Any, Optional
from datetime import datetime

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    FIRESTORE_AVAILABLE = True
except ImportError:
    FIRESTORE_AVAILABLE = False
    print("Warning: Firebase Admin SDK not installed. Real-time features will be disabled.")
    print("Install with: pip install firebase-admin")

# Firebase Admin SDK инициализациясы
_firestore_db: Optional[Any] = None

def init_firestore():
    """Firestore-ты инициализациялау"""
    global _firestore_db
    
    if not FIRESTORE_AVAILABLE:
        return False
    
    try:
        # Егер бұрын инициализацияланған болса, қайта инициализацияламау
        if _firestore_db is not None:
            return True
        
        # Service account key файлын тексеру
        service_account_path = os.path.join(os.path.dirname(__file__), 'serviceAccountKey.json')
        
        if os.path.exists(service_account_path):
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
            _firestore_db = firestore.client()
            print("Firestore initialized successfully")
            return True
        else:
            print(f"Warning: Service account key not found at {service_account_path}")
            print("Real-time features will be disabled. To enable:")
            print("1. Go to Firebase Console > Project Settings > Service Accounts")
            print("2. Click 'Generate new private key'")
            print("3. Save the file as 'serviceAccountKey.json' in the backend directory")
            return False
    except Exception as e:
        print(f"Error initializing Firestore: {e}")
        return False

def sync_code_to_firestore(code: Dict[str, Any]) -> bool:
    """Кодты Firestore-ға синхрондау"""
    if not FIRESTORE_AVAILABLE or _firestore_db is None:
        return False
    
    try:
        code_ref = _firestore_db.collection('codes').document(code['id'])
        # isFolder қасиетін дұрыс анықтау - әртүрлі форматын қолдау
        isFolder_value = code.get('isFolder', False)
        isFolder = bool(isFolder_value) if isFolder_value is not None else False
        
        code_ref.set({
            'title': code.get('title', ''),
            'content': code.get('content', ''),
            'language': code.get('language', ''),
            'author': code.get('author', ''),
            'createdAt': code.get('createdAt', datetime.now().isoformat()),
            'updatedAt': code.get('updatedAt', datetime.now().isoformat()),
            'tags': code.get('tags', []),
            'description': code.get('description', ''),
            'likes': code.get('likes', []),
            'comments': code.get('comments', []),
            'folderId': code.get('folderId'),
            'folderPath': code.get('folderPath'),
            'isFolder': isFolder,  # Boolean мән ретінде сақтау
            'folderStructure': code.get('folderStructure', {}),
            'views': code.get('views', 0),
            'viewedBy': code.get('viewedBy', []),
        }, merge=True)
        
        if isFolder:
            print(f"Firestore sync: Folder '{code.get('title', '')}' synced with isFolder=True")
        
        return True
    except Exception as e:
        print(f"Error syncing code to Firestore: {e}")
        return False

def sync_message_to_firestore(message: Dict[str, Any]) -> bool:
    """Хабарламаны Firestore-ға синхрондау"""
    if not FIRESTORE_AVAILABLE or _firestore_db is None:
        return False
    
    try:
        message_ref = _firestore_db.collection('messages').document(message['id'])
        message_ref.set({
            'fromUserId': message.get('fromUserId', ''),
            'toUserId': message.get('toUserId', ''),
            'content': message.get('content', ''),
            'createdAt': message.get('createdAt', datetime.now().isoformat()),
            'read': message.get('read', False),
        }, merge=True)
        return True
    except Exception as e:
        print(f"Error syncing message to Firestore: {e}")
        return False

def delete_code_from_firestore(code_id: str) -> bool:
    """Кодты Firestore-дан жою"""
    if not FIRESTORE_AVAILABLE or _firestore_db is None:
        return False
    
    try:
        code_ref = _firestore_db.collection('codes').document(code_id)
        code_ref.delete()
        return True
    except Exception as e:
        print(f"Error deleting code from Firestore: {e}")
        return False



