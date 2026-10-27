"""Code service for business logic"""
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
from database import codes, save_codes, FIRESTORE_SYNC_AVAILABLE, FIRESTORE_SYNC_CODE, FIRESTORE_DELETE_CODE
from utils.validators import validate_file_on_server


_folder_stats_cache: Dict[int, tuple] = {}


def _folder_stats(structure: Any) -> Dict[str, Any]:
    """folderStructure → {files, folders, names}; бір құрылым үшін бір рет есептеледі"""
    if not isinstance(structure, dict):
        return {'files': 0, 'folders': 0, 'names': []}
    cached = _folder_stats_cache.get(id(structure))
    if cached and cached[0] is structure and cached[1] == len(structure):
        return cached[2]
    entries = [v for v in structure.values() if isinstance(v, dict)]
    names = sorted(entries, key=lambda v: (v.get('type') != 'folder', str(v.get('name', '')).lower()))[:5]
    stats = {
        'files': sum(1 for v in entries if v.get('type') == 'file'),
        'folders': sum(1 for v in entries if v.get('type') == 'folder'),
        'names': [{'name': v.get('name', ''), 'type': v.get('type', 'file')} for v in names],
    }
    _folder_stats_cache[id(structure)] = (structure, len(structure), stats)
    return stats


class CodeService:
    """Service for code-related operations"""
    
    @staticmethod
    def find_code_by_id(code_id: str) -> Optional[Dict[str, Any]]:
        """Find code by ID"""
        return next((code for code in codes if code['id'] == code_id), None)
    
    @staticmethod
    def to_lite(code: Dict[str, Any]) -> Dict[str, Any]:
        """Тізім/шапка үшін жеңіл нұсқа: content және толық folderStructure жоқ.

        Үлкен жобада folderStructure ондаған мың жазба (node_modules қоса), ал
        папканың content-і — бүкіл манифест, сондықтан олар бірнеше МБ болады.
        Олардың орнына folderStats (саны + алғашқы 5 атау) қайтарылады.
        """
        lite = {k: v for k, v in code.items() if k not in ('content', 'folderStructure')}
        lite['hasContent'] = bool(code.get('content'))
        if code.get('isFolder'):
            lite['folderStats'] = _folder_stats(code.get('folderStructure'))
        return lite

    @staticmethod
    def get_codes(
        folder_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        include_content: bool = False
    ) -> Dict[str, Any]:
        """Get codes, optionally filtered by folder with pagination"""
        # Filter codes
        if folder_id:
            filtered_codes = [code for code in codes if code.get('folderId') == folder_id]
        else:
            filtered_codes = [code for code in codes if not code.get('folderId')]
        
        total = len(filtered_codes)
        
        # Apply pagination
        if limit is not None:
            paginated_codes = filtered_codes[offset:offset + limit]
        else:
            paginated_codes = filtered_codes[offset:]
        
        # Remove content field if not needed (to reduce payload size)
        if not include_content:
            paginated_codes = [CodeService.to_lite(code) for code in paginated_codes]
        
        return {
            'codes': paginated_codes,
            'total': total,
            'limit': limit,
            'offset': offset,
            'hasMore': limit is not None and (offset + len(paginated_codes)) < total
        }
    
    @staticmethod
    def create_code(code_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new code"""
        validation = validate_file_on_server(code_data['title'], code_data['content'])
        if not validation['valid']:
            raise ValueError(validation['error'])
        
        new_code = {
            'id': str(uuid.uuid4()),
            'title': code_data['title'],
            'content': code_data['content'],
            'language': code_data['language'],
            'author': code_data['author'],
            'description': code_data.get('description'),
            'tags': code_data.get('tags', []),
            'likes': [],
            'comments': [],
            'folderId': code_data.get('folderId'),
            'folderPath': code_data.get('folderPath'),
            'isFolder': code_data.get('isFolder', False),
            'folderStructure': code_data.get('folderStructure'),
            'views': 0,
            'viewedBy': [],
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat()
        }
        
        codes.append(new_code)
        save_codes()
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(new_code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for new code: {e}')
        
        return new_code
    
    @staticmethod
    def update_code(code_id: str, code_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a code"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if code_data.get('title') is not None:
            code['title'] = code_data['title']
        if code_data.get('content') is not None:
            code['content'] = code_data['content']
        if code_data.get('language') is not None:
            code['language'] = code_data['language']
        if code_data.get('description') is not None:
            code['description'] = code_data['description']
        if code_data.get('tags') is not None:
            code['tags'] = code_data['tags']
        code['updatedAt'] = datetime.now().isoformat()
        
        save_codes()
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for update: {e}')
        
        return code
    
    @staticmethod
    def delete_code(code_id: str) -> List[str]:
        """Delete a code and return list of deleted IDs"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        deleted_ids = [code_id]
        
        # If it's a folder, delete all files in the folder first
        folder_files = []
        if code.get('isFolder'):
            folder_files = [c for c in codes if c.get('folderId') == code_id]
            for file in folder_files:
                codes.remove(file)
                deleted_ids.append(file['id'])
        
        # Delete the code itself
        codes.remove(code)
        save_codes()
        
        # Firestore delete
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_DELETE_CODE:
            try:
                FIRESTORE_DELETE_CODE(code_id)
                for file in folder_files:
                    FIRESTORE_DELETE_CODE(file['id'])
            except Exception as e:
                print(f'Warning: Firestore delete failed: {e}')
        
        return deleted_ids
    
    @staticmethod
    def create_folder_batch(
        folder_data: Dict[str, Any],
        files_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Контейнер (папка) + барлық ішкі файлдарды бір рет қана дискіге
        сақтайтын пакеттік құру. Frontend әр файл үшін жеке сұрау жасамайтындай
        етіп, бүтін папканы бір сұраумен жіберуге арналған.

        folder_data: контейнер өрістері (title, content, language, author,
                     description, tags, folderStructure, isFolder=True)
        files_data: әр ішкі файл үшін {title, content, language, author,
                    description, tags, folderId, folderPath}

        {folder, folderId, created, failed, failedFiles} қайтарылады.
        """
        # Контейнерді жасау
        container_validation = validate_file_on_server(
            folder_data['title'], folder_data['content']
        )
        if not container_validation['valid']:
            raise ValueError(container_validation['error'])

        now = datetime.now().isoformat()
        folder_id = str(uuid.uuid4())
        folder_code = {
            'id': folder_id,
            'title': folder_data['title'],
            'content': folder_data['content'],
            'language': folder_data['language'],
            'author': folder_data['author'],
            'description': folder_data.get('description'),
            'tags': folder_data.get('tags', []),
            'likes': [],
            'comments': [],
            'folderId': None,
            'folderPath': None,
            'isFolder': True,
            'folderStructure': folder_data.get('folderStructure'),
            'views': 0,
            'viewedBy': [],
            'createdAt': now,
            'updatedAt': now,
        }
        codes.append(folder_code)

        created = 0
        failed = 0
        failed_files: List[str] = []
        created_codes: List[Dict[str, Any]] = [folder_code]

        for f in files_data:
            try:
                validation = validate_file_on_server(f['title'], f['content'])
                if not validation['valid']:
                    failed += 1
                    failed_files.append(f.get('folderPath') or f['title'])
                    continue

                child = {
                    'id': str(uuid.uuid4()),
                    'title': f['title'],
                    'content': f['content'],
                    'language': f['language'],
                    'author': f['author'],
                    'description': f.get('description'),
                    'tags': f.get('tags', []),
                    'likes': [],
                    'comments': [],
                    'folderId': folder_id,
                    'folderPath': f.get('folderPath'),
                    'isFolder': False,
                    'folderStructure': None,
                    'views': 0,
                    'viewedBy': [],
                    'createdAt': now,
                    'updatedAt': now,
                }
                codes.append(child)
                created_codes.append(child)
                created += 1
            except Exception as e:
                print(f'Warning: folder file creation failed for '
                      f'{f.get("folderPath") or f["title"]}: {e}')
                failed += 1
                failed_files.append(f.get('folderPath') or f['title'])

        # Барлығын бір рет сақтау (N диск жазуын → 1 жазуға дейін азайтады)
        save_codes()

        # Firestore синхрондау (барлық құрылған кодтар үшін)
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            for code in created_codes:
                try:
                    FIRESTORE_SYNC_CODE(code)
                except Exception as e:
                    print(f'Warning: Firestore sync failed for '
                          f'{code["id"]}: {e}')

        return {
            'folder': folder_code,
            'folderId': folder_id,
            'created': created,
            'failed': failed,
            'failedFiles': failed_files,
        }

    @staticmethod
    def delete_multiple_codes(code_ids: List[str]) -> int:
        """Delete multiple codes"""
        deleted_ids = set()
        codes_to_delete = [c for c in codes if c['id'] in code_ids]

        # First, delete all files in folders that are being deleted
        for code in codes_to_delete:
            if code.get('isFolder'):
                folder_files = [c for c in codes if c.get('folderId') == code['id']]
                for file in folder_files:
                    if file['id'] not in deleted_ids:
                        deleted_ids.add(file['id'])
                        codes.remove(file)

        # Then delete the codes themselves
        for code_id in code_ids:
            if code_id in deleted_ids:
                continue  # Already deleted as a folder child
            code = CodeService.find_code_by_id(code_id)
            if code:
                deleted_ids.add(code_id)
                codes.remove(code)

                # Firestore delete
                if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_DELETE_CODE:
                    try:
                        FIRESTORE_DELETE_CODE(code_id)
                    except Exception as e:
                        print(f'Warning: Firestore delete failed for {code_id}: {e}')

        save_codes()
        return len(deleted_ids)
    
    @staticmethod
    def like_code(code_id: str, user_id: str) -> Dict[str, Any]:
        """Like a code"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if 'likes' not in code:
            code['likes'] = []
        
        if user_id not in code['likes']:
            code['likes'].append(user_id)
            code['updatedAt'] = datetime.now().isoformat()
            save_codes([code_id])
            
            # Firestore sync
            if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
                try:
                    FIRESTORE_SYNC_CODE(code)
                except Exception as e:
                    print(f'Warning: Firestore sync failed for like: {e}')
        
        return code
    
    @staticmethod
    def unlike_code(code_id: str, user_id: str) -> Dict[str, Any]:
        """Unlike a code"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if 'likes' not in code:
            code['likes'] = []
        
        code['likes'] = [id for id in code['likes'] if id != user_id]
        code['updatedAt'] = datetime.now().isoformat()
        save_codes([code_id])
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for unlike: {e}')
        
        return code
    
    @staticmethod
    def view_code(code_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Increment view count for a code. Жеңіл нұсқа қайтарады (views/viewedBy жаңарту үшін)"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")

        viewed_by = code.setdefault('viewedBy', [])
        if not user_id or user_id not in viewed_by:
            if user_id:
                viewed_by.append(user_id)
            code['views'] = (code.get('views', 0) or 0) + 1
            code['updatedAt'] = datetime.now().isoformat()
            # save_codes өзгерген кодты Firestore-ға да синхрондайды
            save_codes([code_id])

        return CodeService.to_lite(code)

    @staticmethod
    def add_comment(code_id: str, author: str, content: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        """Add a comment to a code"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if 'comments' not in code:
            code['comments'] = []
        
        new_comment = {
            'id': str(uuid.uuid4()),
            'author': author,
            'content': content,
            'createdAt': datetime.now().isoformat(),
            'replies': [],
            'likes': [],
            'parentId': parent_id
        }
        
        code['comments'].append(new_comment)
        code['updatedAt'] = datetime.now().isoformat()
        save_codes([code_id])
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for comment: {e}')
        
        return code
    
    @staticmethod
    def update_comment(code_id: str, comment_id: str, content: str) -> Dict[str, Any]:
        """Update a comment"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if 'comments' not in code:
            raise ValueError("Comment not found")
        
        comment = next((c for c in code['comments'] if c['id'] == comment_id), None)
        if not comment:
            raise ValueError("Comment not found")
        
        comment['content'] = content
        code['updatedAt'] = datetime.now().isoformat()
        save_codes([code_id])
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for comment update: {e}')
        
        return code
    
    @staticmethod
    def delete_comment(code_id: str, comment_id: str) -> Dict[str, Any]:
        """Delete a comment"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")
        
        if 'comments' not in code:
            raise ValueError("Comment not found")
        
        comment_index = next((i for i, c in enumerate(code['comments']) if c['id'] == comment_id), None)
        if comment_index is None:
            raise ValueError("Comment not found")
        
        code['comments'].pop(comment_index)
        code['updatedAt'] = datetime.now().isoformat()
        save_codes([code_id])
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for comment delete: {e}')
        
        return code
    
    @staticmethod
    def like_comment(code_id: str, comment_id: str, user_id: str) -> Dict[str, Any]:
        """Like/unlike a comment"""
        code = CodeService.find_code_by_id(code_id)
        if not code or 'comments' not in code:
            raise ValueError("Code file or comment not found")
        
        comment = next((c for c in code['comments'] if c['id'] == comment_id), None)
        if not comment:
            raise ValueError("Comment not found")
        
        if 'likes' not in comment:
            comment['likes'] = []
        
        # Toggle like
        if user_id in comment['likes']:
            comment['likes'] = [id for id in comment['likes'] if id != user_id]
        else:
            comment['likes'].append(user_id)
        
        code['updatedAt'] = datetime.now().isoformat()
        save_codes([code_id])
        
        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for comment like: {e}')
        
        return code

