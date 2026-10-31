"""Code service for business logic"""
from typing import List, Dict, Any, Optional
import json
import uuid
from datetime import datetime
from database import codes, save_codes, FIRESTORE_SYNC_AVAILABLE, FIRESTORE_SYNC_CODE, FIRESTORE_DELETE_CODE
from utils.validators import validate_file_on_server
from utils.protected_files import protect_file
from utils.secret_box import decrypt

# Жауапқа ешқашан шықпайтын өрістер: шифрланған түпнұсқа; сұраныстарды тек иесі көреді;
# жұлдыз қойғандар — әр қолданушыға тек өз белгісі (starred) жіберіледі
_HIDDEN_FIELDS = ('privateContent', 'joinRequests', 'starredBy')
# Жүктеу кезінде protect_file қоятын өрістер
_PROTECTION_FIELDS = ('privateContent', 'visibility', 'protection')


_folder_stats_cache: Dict[int, tuple] = {}

# frontend/src/utils/codeCategories.ts CATEGORIES-пен бірдей: `category:<мән>` тегі → бөлім
_CATEGORY_BY_VALUE = {
    **dict.fromkeys(('machine-learning', 'natural-language-processing', 'computer-vision', 'ai-applications'), 'ai'),
    **dict.fromkeys(('ios-app', 'android-app', 'cross-platform-app', 'mobile-game'), 'mobile'),
    'web-app': 'web', 'desktop-app': 'desktop', 'game': 'game', 'api': 'api',
    'database': 'database', 'devops': 'devops', 'other': 'other',
}


def _categories(code: Dict[str, Any]) -> set:
    """codeCategories.ts getCategories: тегтерден, ескі жүктемелерде — сипаттамадан; табылмаса — other"""
    values = [t[len('category:'):] for t in code.get('tags') or [] if isinstance(t, str) and t.startswith('category:')]
    if not values and code.get('description'):
        values.append(str(code['description']).strip())
    keys = {_CATEGORY_BY_VALUE[v] for v in values if v in _CATEGORY_BY_VALUE}
    return keys or {'other'}


def _languages(code: Dict[str, Any]) -> List[str]:
    """codeCategories.ts getLanguages: негізгі тіл + `lang:<тіл>` тегтері"""
    main = str(code.get('language') or '').strip()
    extra = [t[len('lang:'):] for t in code.get('tags') or [] if isinstance(t, str) and t.startswith('lang:')]
    return list(dict.fromkeys([*([main] if main else []), *extra]))


def _matches_search(code: Dict[str, Any], q: str) -> bool:
    fields = [code.get('title'), code.get('description'), code.get('author'), code.get('language'), *(code.get('tags') or [])]
    return any(q in str(f).lower() for f in fields if f)


# codeUtils.ts compareCodes-пен бірдей реттер
_SORT_KEYS = {
    'newest': (lambda c: str(c.get('createdAt') or ''), True),
    'oldest': (lambda c: str(c.get('createdAt') or ''), False),
    'rating': (lambda c: (len(c.get('likes') or []), c.get('views') or 0, str(c.get('createdAt') or '')), True),
    'title': (lambda c: str(c.get('title') or '').lower(), False),
    'author': (lambda c: str(c.get('author') or '').lower(), False),
}


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
        lite = {k: v for k, v in code.items() if k not in ('content', 'folderStructure', *_HIDDEN_FIELDS)}
        lite['hasContent'] = bool(code.get('content'))
        if code.get('isFolder'):
            lite['folderStats'] = _folder_stats(code.get('folderStructure'))
        return lite

    @staticmethod
    def project_of(code: Dict[str, Any]) -> Dict[str, Any]:
        """Файл жататын жоба (папка); жеке файл — өзі"""
        if code.get('folderId'):
            return CodeService.find_code_by_id(code['folderId']) or code
        return code

    @staticmethod
    def can_view(code: Dict[str, Any], username: Optional[str]) -> bool:
        """Жабық жобаны (isPrivate) тек иесі мен мүшелері көреді; ашық жоба — бәріне"""
        project = CodeService.project_of(code)
        if not project.get('isPrivate'):
            return True
        if not username:
            return False
        return username == project.get('author') or username in (project.get('members') or [])

    @staticmethod
    def can_see_private(code: Dict[str, Any], username: Optional[str]) -> bool:
        """Қорғалған файлдың түпнұсқасын көре ала ма: иесі әрқашан, мүшелер — тек visibility=members"""
        if not username:
            return False
        project = CodeService.project_of(code)
        if username in (code.get('author'), project.get('author')):
            return True
        return code.get('visibility') == 'members' and username in (project.get('members') or [])

    @staticmethod
    def for_viewer(code: Dict[str, Any], username: Optional[str]) -> Dict[str, Any]:
        """Толық нұсқа (content-імен) осы қарап отырған адам үшін: қорғалған файлдың
        түпнұсқасы тек рұқсаты барға ашылады, басқаларға жария (бос) нұсқасы қалады"""
        view = CodeService.public(code)
        if code.get('privateContent'):
            allowed = CodeService.can_see_private(code, username)
            view['locked'] = not allowed
            if allowed:
                original = decrypt(code['privateContent'])
                if original is not None:
                    view['content'] = original
        return view

    @staticmethod
    def public(code: Dict[str, Any]) -> Dict[str, Any]:
        """Жауапқа шығатын нұсқа (лайк, пікір т.б.): жасырын өрістерсіз, content — жария нұсқасы"""
        return {k: v for k, v in code.items() if k not in _HIDDEN_FIELDS}

    @staticmethod
    def get_codes(
        folder_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        include_content: bool = False,
        viewer: Optional[str] = None,
        author: Optional[str] = None,
        search: Optional[str] = None,
        lang: Optional[str] = None,
        category: Optional[str] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get codes, optionally filtered by folder with pagination.
        Жобалар тізімінде (folder_id жоқ) — автор/іздеу/тіл/категория сүзгісі мен сұрыптау,
        languages — тіл таңдағышқа арналған санақ (тіл сүзгісінен бұрынғы нәтиже бойынша)"""
        languages = None
        languages_total = 0
        if folder_id:
            filtered_codes = [code for code in codes if code.get('folderId') == folder_id]
        else:
            filtered_codes = [code for code in codes if not code.get('folderId') and CodeService.can_view(code, viewer)]
            if author:
                filtered_codes = [c for c in filtered_codes if c.get('author') == author]
            if category:
                filtered_codes = [c for c in filtered_codes if category in _categories(c)]
            q = (search or '').strip().lower()
            if q:
                filtered_codes = [c for c in filtered_codes if _matches_search(c, q)]

            counts: Dict[str, Dict[str, Any]] = {}
            for c in filtered_codes:
                for label in _languages(c):
                    entry = counts.setdefault(label.lower(), {'label': label, 'count': 0})
                    entry['count'] += 1
            languages = sorted(counts.values(), key=lambda e: (-e['count'], e['label'].lower()))
            languages_total = len(filtered_codes)

            lang_key = (lang or '').strip().lower()
            if lang_key:
                filtered_codes = [c for c in filtered_codes if any(l.lower() == lang_key for l in _languages(c))]
            key, reverse = _SORT_KEYS.get(sort or 'newest', _SORT_KEYS['newest'])
            filtered_codes = sorted(filtered_codes, key=key, reverse=reverse)

        total = len(filtered_codes)

        # Apply pagination
        if limit is not None:
            paginated_codes = filtered_codes[offset:offset + limit]
        else:
            paginated_codes = filtered_codes[offset:]

        # Remove content field if not needed (to reduce payload size)
        if not include_content:
            paginated_codes = [CodeService.to_lite(code) for code in paginated_codes]
        else:
            paginated_codes = [CodeService.for_viewer(code, viewer) for code in paginated_codes]

        return {
            'codes': paginated_codes,
            'total': total,
            'limit': limit,
            'offset': offset,
            'hasMore': limit is not None and (offset + len(paginated_codes)) < total,
            **({'languages': languages, 'languagesTotal': languages_total} if languages is not None else {}),
        }

    @staticmethod
    def create_code(code_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new code"""
        validation = validate_file_on_server(code_data['title'], code_data['content'])
        if not validation['valid']:
            raise ValueError(validation['error'])
        # Жалғыз .env т.б. — папкадағыдай қорғалады
        protected = protect_file(code_data.get('folderPath') or code_data['title'], code_data['content'].encode('utf-8'))
        if protected.get('content') is not None:
            code_data = {**code_data, **protected}

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
            'isPrivate': bool(code_data.get('isPrivate')) and not code_data.get('folderId'),
            'views': 0,
            'viewedBy': [],
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat()
        }
        new_code.update({k: code_data[k] for k in _PROTECTION_FIELDS if code_data.get(k)})

        codes.append(new_code)
        save_codes()

        # Firestore sync
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(new_code)
            except Exception as e:
                print(f'Warning: Firestore sync failed for new code: {e}')

        return CodeService.public(new_code)

    @staticmethod
    def update_code(code_id: str, code_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a code"""
        code = CodeService.find_code_by_id(code_id)
        if not code:
            raise ValueError("Code file not found")

        if code_data.get('title') is not None:
            code['title'] = code_data['title']
        if code_data.get('content') is not None:
            if code.get('protection') == 'database':
                raise ValueError("Деректер базасын мәтін ретінде өзгертуге болмайды")
            # Қорғалған файлды иесі түзетсе — түпнұсқасы қайта шифрланып, жария нұсқасы қайта құрылады
            protected = protect_file(code.get('folderPath') or code['title'], code_data['content'].encode('utf-8'))
            for field in _PROTECTION_FIELDS:
                code.pop(field, None)
            code['content'] = protected['content'] if protected.get('content') is not None else code_data['content']
            code.update({k: protected[k] for k in _PROTECTION_FIELDS if protected.get(k)})
        if code_data.get('language') is not None:
            code['language'] = code_data['language']
        if code_data.get('description') is not None:
            code['description'] = code_data['description']
        if code_data.get('tags') is not None:
            code['tags'] = code_data['tags']
        # Ашық/жабық — тек жобаның өзінде (ішкі файлдар жобаның күйін алады)
        visibility_changed = False
        if code_data.get('isPrivate') is not None and not code.get('folderId'):
            visibility_changed = bool(code.get('isPrivate')) != bool(code_data['isPrivate'])
            code['isPrivate'] = bool(code_data['isPrivate'])
        code['updatedAt'] = datetime.now().isoformat()

        save_codes()

        # Firestore sync: ашық/жабық ауысса — жобаның файлдары да (жабық болса Firestore-дан жойылады)
        if FIRESTORE_SYNC_AVAILABLE and FIRESTORE_SYNC_CODE:
            try:
                FIRESTORE_SYNC_CODE(code)
                if visibility_changed:
                    for child in [c for c in codes if c.get('folderId') == code['id']]:
                        FIRESTORE_SYNC_CODE(child)
            except Exception as e:
                print(f'Warning: Firestore sync failed for update: {e}')

        return CodeService.public(code)

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
            'isPrivate': bool(folder_data.get('isPrivate')),
            'members': [],
            'joinRequests': [],
            # codo CLI коммиттері: [{id, message, author, createdAt, added, changed, removed}]
            'commits': folder_data.get('commits') or [],
            'views': 0,
            'viewedBy': [],
            'createdAt': now,
            'updatedAt': now,
        }
        codes.append(folder_code)

        result = CodeService._add_children(folder_id, files_data, now, [folder_code])
        return {'folder': CodeService.public(folder_code), 'folderId': folder_id, **result}

    @staticmethod
    def append_folder_files(folder_id: str, files_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Үлкен жобаның келесі бөлігін бар жобаға қосу (бір сұрау ~32 МБ-тан аспауы үшін бөлінеді).
        Бөлік қайта жіберілсе (желі үзілгенде) — бар жолдар қайталанбайды"""
        folder = CodeService.find_code_by_id(folder_id)
        if not folder or not folder.get('isFolder'):
            raise ValueError("Project not found")
        existing = {c.get('folderPath') for c in codes if c.get('folderId') == folder_id}
        fresh = [f for f in files_data if f.get('folderPath') not in existing]
        now = datetime.now().isoformat()
        result = CodeService._add_children(folder_id, fresh, now, [])
        new_count = len(existing) + result['created']
        # Бұрын жүктелгендері де «жүктелді» деп саналады
        result['created'] += len(files_data) - len(fresh)

        # Контейнердегі файл санын жаңарту
        try:
            meta = json.loads(folder.get('content') or '{}')
            meta['fileCount'] = new_count
            folder['content'] = json.dumps(meta, ensure_ascii=False, indent=2)
        except (ValueError, TypeError):
            pass
        folder['updatedAt'] = now
        save_codes([folder_id])
        return {'folderId': folder_id, **result}

    @staticmethod
    def commit_folder(
        folder_id: str, keep_paths: List[str], replace_paths: List[str],
        files_data: List[Dict[str, Any]], structure: Dict[str, Any], commit: Dict[str, Any],
    ) -> Dict[str, Any]:
        """codo push: бар жобаны жаңа коммитпен жаңарту (жаңа жоба жасалмайды).
        keep_paths — коммиттегі барлық файл жолдары (қалғаны өшіріледі); replace_paths — бүкіл
        push-тағы өзгерген файлдар (ескі нұсқасы өшіріледі, жаңасы осы немесе кейінгі
        /codes/{id}/files бөліктерімен келеді); files_data — осы бөліктегі файлдар"""
        folder = CodeService.find_code_by_id(folder_id)
        if not folder or not folder.get('isFolder'):
            raise ValueError("Project not found")
        keep, replace = set(keep_paths), set(replace_paths)
        removed = [c for c in codes if c.get('folderId') == folder_id
                   and (c.get('folderPath') not in keep or c.get('folderPath') in replace)]
        for child in removed:
            codes.remove(child)
        now = datetime.now().isoformat()
        result = CodeService._add_children(folder_id, files_data, now, [])

        folder['folderStructure'] = structure
        try:
            meta = json.loads(folder.get('content') or '{}')
        except (ValueError, TypeError):
            meta = {}
        meta['structure'] = structure
        meta['fileCount'] = len(keep)
        folder['content'] = json.dumps(meta, ensure_ascii=False, indent=2)
        folder.setdefault('commits', []).append({**commit, 'createdAt': now})
        folder['updatedAt'] = now
        # Өшірілгендер бар — толық сақтау (ішінара сақтау өшірілген жолдарды көрмейді)
        save_codes()
        if removed and FIRESTORE_SYNC_AVAILABLE and FIRESTORE_DELETE_CODE:
            try:
                for child in removed:
                    if child.get('folderPath') not in replace:
                        FIRESTORE_DELETE_CODE(child['id'])
            except Exception as e:
                print(f'Warning: Firestore delete failed: {e}')
        return {'folderId': folder_id, **result}

    @staticmethod
    def _add_children(
        folder_id: str, files_data: List[Dict[str, Any]], now: str, also_sync: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Жобаға ішкі файлдарды қосып, бір рет сақтау. {created, failed, failedFiles} қайтарады"""
        created = 0
        failed = 0
        failed_files: List[str] = []
        created_codes: List[Dict[str, Any]] = list(also_sync)

        for f in files_data:
            try:
                # Жол түбірлік папка атымен басталады — оны алып, жобаның ішкі жолымен тексереміз
                # (әйтпесе «build» деп аталған жоба қоқыс болып танылады)
                inner = (f.get('folderPath') or '').split('/', 1)
                validation = validate_file_on_server(
                    f['title'], f['content'], inner[1] if len(inner) == 2 else None
                )
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
                child.update({k: f[k] for k in _PROTECTION_FIELDS if f.get(k)})
                codes.append(child)
                created_codes.append(child)
                created += 1
            except Exception as e:
                print(f'Warning: folder file creation failed for '
                      f'{f.get("folderPath") or f["title"]}: {e}')
                failed += 1
                failed_files.append(f.get('folderPath') or f['title'])

        # Барлығын бір рет сақтау (N диск жазуын → 1 жазуға дейін азайтады);
        # save_codes жаңа кодтарды Firestore-ға да өзі синхрондайды
        save_codes([c['id'] for c in created_codes])

        return {'created': created, 'failed': failed, 'failedFiles': failed_files}

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

        return CodeService.public(code)

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

        return CodeService.public(code)

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
            # updatedAt өзгертілмейді: қаралу — мазмұнның өзгерісі емес.
            # Firestore-ға жазылмайды: views келесі нақты өзгерісте (лайк, пікір) бірге кетеді
            save_codes([code_id], sync_firestore=False)

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

        return CodeService.public(code)

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

        return CodeService.public(code)

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

        return CodeService.public(code)

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

        return CodeService.public(code)


    # ---------- Жоба мүшелері ----------
    # Тест деректерін (visibility=members) жоба иесі қабылдаған мүшелер ғана көреді.
    # Мүше болу: қолданушы сұраныс жібереді → иесі қабылдайды немесе қабылдамайды.

    @staticmethod
    def _project(code_id: str) -> Dict[str, Any]:
        project = CodeService.find_code_by_id(code_id)
        if not project or project.get('folderId'):
            raise ValueError("Project not found")
        return project

    @staticmethod
    def _save_project(project: Dict[str, Any]) -> None:
        # members/joinRequests Firestore-ға жіберілмейді — тек серверде
        save_codes([project['id']], sync_firestore=False)

    @staticmethod
    def membership(code_id: str, username: Optional[str]) -> Dict[str, Any]:
        """Жоба мүшелері; сұраныстарды тек иесі көреді. status — қарап отырған адамның күйі"""
        project = CodeService._project(code_id)
        members = project.get('members') or []
        requests = project.get('joinRequests') or []
        is_owner = bool(username) and username == project.get('author')
        if is_owner:
            status = 'owner'
        elif username in members:
            status = 'member'
        elif any(r.get('username') == username for r in requests):
            status = 'pending'
        else:
            status = 'none'
        result: Dict[str, Any] = {'owner': project.get('author'), 'members': members, 'status': status}
        if is_owner:
            result['requests'] = requests
        return result

    @staticmethod
    def request_join(code_id: str, username: str) -> Dict[str, Any]:
        project = CodeService._project(code_id)
        if username == project.get('author') or username in (project.get('members') or []):
            return CodeService.membership(code_id, username)
        requests = project.setdefault('joinRequests', [])
        if not any(r.get('username') == username for r in requests):
            if len(requests) >= 200:
                raise PermissionError("Сұраныстар тым көп — жоба иесі әлі қарамаған")
            requests.append({'username': username, 'requestedAt': datetime.now().isoformat()})
            CodeService._save_project(project)
        return CodeService.membership(code_id, username)

    @staticmethod
    def leave_project(code_id: str, username: str) -> Dict[str, Any]:
        """Өз сұранысын болдырмау немесе жобадан шығу"""
        project = CodeService._project(code_id)
        project['joinRequests'] = [r for r in project.get('joinRequests') or [] if r.get('username') != username]
        project['members'] = [m for m in project.get('members') or [] if m != username]
        CodeService._save_project(project)
        return CodeService.membership(code_id, username)

    @staticmethod
    def accept_member(code_id: str, owner: str, username: str) -> Dict[str, Any]:
        project = CodeService._project(code_id)
        if project.get('author') != owner:
            raise PermissionError("Тек жоба иесі мүше қабыл ала алады")
        requests = project.get('joinRequests') or []
        if not any(r.get('username') == username for r in requests):
            raise ValueError("Бұл қолданушыдан сұраныс жоқ")
        project['joinRequests'] = [r for r in requests if r.get('username') != username]
        members = project.setdefault('members', [])
        if username not in members:
            members.append(username)
        CodeService._save_project(project)
        return CodeService.membership(code_id, owner)

    @staticmethod
    def remove_member(code_id: str, owner: str, username: str) -> Dict[str, Any]:
        """Сұранысты қабылдамау немесе мүшені шығару"""
        project = CodeService._project(code_id)
        if project.get('author') != owner:
            raise PermissionError("Тек жоба иесі мүшелерді басқара алады")
        CodeService.leave_project(code_id, username)
        return CodeService.membership(code_id, owner)


    # ---------- Басты беттегі «Жобалар» ----------
    # Тек қолданушының өз жобалары және мүше болып қосылған жобалары.
    # Жұлдыз қойылған жоба тізімнің басында тұрады (жұлдыз әр қолданушыға жеке).

    @staticmethod
    def my_projects(username: str) -> List[Dict[str, Any]]:
        result = []
        for code in codes:
            if code.get('folderId'):
                continue
            if code.get('author') == username:
                role = 'owner'
            elif username in (code.get('members') or []):
                role = 'member'
            else:
                continue
            item = CodeService.to_lite(code)
            item['role'] = role
            item['starred'] = username in (code.get('starredBy') or [])
            result.append(item)
        return result

    @staticmethod
    def set_projects_visibility(username: str, private: bool) -> int:
        """Иесінің барлық жобасын жабу/ашу; күйі өзгерген жоба саны қайтарылады"""
        targets = [
            c['id'] for c in codes
            if not c.get('folderId') and c.get('author') == username
            and bool(c.get('isPrivate')) != private
        ]
        for code_id in targets:
            CodeService.update_code(code_id, {'isPrivate': private})
        return len(targets)

    @staticmethod
    def set_star(code_id: str, username: str, starred: bool) -> Dict[str, Any]:
        """Жобаға жұлдыз қою/алу — тек иесі не мүшесі (тізімінде бар жоба)"""
        project = CodeService._project(code_id)
        if username != project.get('author') and username not in (project.get('members') or []):
            raise PermissionError("Тек өз жобаңызға не қосылған жобаға жұлдыз қоюға болады")
        stars = [u for u in project.get('starredBy') or [] if u != username]
        if starred:
            stars.append(username)
        project['starredBy'] = stars
        CodeService._save_project(project)
        return {'id': code_id, 'starred': starred}
