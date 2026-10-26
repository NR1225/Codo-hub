# Қауіпсіздік ескертпелері (pentest)

> Дата: 2026-10-21 · Қамту: жергілікті backend `http://127.0.0.1:3000` (авторизацияланған тест).
> HSTS бойынша бөлек құжат: [SECURITY-HSTS.md](./SECURITY-HSTS.md).

## Берік болып шыққаны ✅

- **JWT** — қолтаңба тексеріледі; `alg=none` және өзгертілген payload → 401.
- **IDOR** — `/messages/{id}`, `/friends/{id}` бөтенге 403; топтар мүшелікті тексереді;
  кодты бөтен адам өшіре/өңдей алмайды (author тексерісі).
- **Rate-limit** — login IP бойынша `5/minute` → 429; әрі аккаунт блогы (5 қате → 15 мин).
- **CORS** — бөтен Origin-ды шағылыстырмайды (тек тізімдегі origin-дер).
- **Қате жауаптарда stack trace жоқ**; `forgot-password` энумерация бермейді
  («If the email exists…»).
- **Қауіпсіздік тақырыптары** бар: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`.

## Түзетілгені 🔧

- **Код авторын спуфинг** (`POST /api/codes`) — бұрын клиент `author` өрісін жіберетін.
  Енді сервер `author`-ды әрқашан аутентификацияланған қолданушыға мәжбүрлейді
  (`backend/routes/codes.py`).
- **Server баннері** — `server: uvicorn` тақырыбы өшірілді: `python main.py` үшін
  `server_header=False` (`backend/main.py`), Docker/Cloud Run үшін `--no-server-header`
  (`backend/Dockerfile`). Бұрын Docker жолында баннер әлі көрінетін.
- **Қолданылмайтын SMS endpoint-тері** (`/api/auth/sms/*`) — тіркелу тек email-ге
  ауысқаннан кейін де ашық тұрған. Енді маршруттар, модельдер, `sms_verifications`
  кестесі және конфиг толық алынып тасталды (шабуыл беті азайды).
- **HSTS** — `SecurityHeadersMiddleware` енді тек HTTPS сұраныстарына
  `Strict-Transport-Security` қосады (`HSTS_MAX_AGE`, `HSTS_INCLUDE_SUBDOMAINS`).
  Толығырақ: [SECURITY-HSTS.md](./SECURITY-HSTS.md).
- **CAPTCHA** — тіркелу мен кіруге Cloudflare Turnstile қосылды. Ол тек
  `TURNSTILE_SECRET_KEY` (backend) және `VITE_TURNSTILE_SITE_KEY` (frontend) орнатылғанда
  іске қосылады; бос болса, бұрынғыдай жұмыс істейді.

---

## Ашық, төмен-тәуекел элементтер (әдейі қалдырылған)

### 1) Тіркелуде email энумерациясы

**Жағдай:** `POST /api/auth/register` бар email-ге **409 «User already exists»** қайтарады.
Осы арқылы қай email тіркелгенін білуге болады (user enumeration).

**Шешім: 409 қалады**, бірақ жаппай тексеру қиындатылды:
- IP бойынша `3/minute` rate-limit;
- прод-та Turnstile CAPTCHA (`TURNSTILE_SECRET_KEY` орнатылса) — бот бір email-ді
  тексеру үшін де CAPTCHA шешуі керек.

Себебі: UX үшін email бос емес екенін айту керек; `username` да бірегей болғандықтан
энумерацияны толық жою мүмкін емес; `forgot-password` бейтарап жауап береді.
Толық жабу керек болса — тіркелуді «растау email-і жіберілді» ағынына ауыстыру керек.

### 2) Аккаунт блогының DoS қайшылығы

Аккаунт блогы (5 қате → 15 мин) аккаунтқа байланысты, сондықтан зиянкес әдейі 5 рет
қате теріп, құрбанды уақытша құлыптай алады. Turnstile кіруге де қосылғандықтан,
прод-та мұны жаппай/автоматты түрде істеу қиын (әр әрекетке CAPTCHA). Қолмен
жасалатын жеке шабуыл мүмкін болып қалады — бұл блок әдісінің белгілі шегі.

### 3) HSTS прод баптауы

Код дайын (тек HTTPS-те жіберіледі). Прод-та `max-age`-ті кезең-кезеңімен үлкейту және
`includeSubDomains`/`preload` шешімі — деплой жұмысы. Қараңыз:
[SECURITY-HSTS.md](./SECURITY-HSTS.md).

---

## Деректер қоймасы

Барлық деректің ақиқат көзі — **SQLite** (`backend/data/kazakh_hub.db`):

| Кесте | Мазмұны | Қолданатын код |
|---|---|---|
| `users`, `password_resets` | аккаунттар, құпиясөз қалпына келтіру | `routes/auth.py`, `routes/users.py` |
| `codes` | кодтар мен папкалар | `services/code_service.py`, `database.py` |
| `direct_messages` | жеке (1:1) хабарламалар | `services/message_service.py`, `database.py` |
| `friend_lists`, `friend_requests` | достар және өтінімдер | `services/friend_service.py`, `database.py` |
| `legacy_users` | ескі `users.json` қолданушылары (тек аты/аватары) | `services/user_lookup.py` |
| `chat_groups*`, `chat_prefs` | топтық чаттар, чат баптаулары | `services/group_service.py` |
| `vibecoding_projects` | Vibecoding жобалары | `routes/vibecoding.py` |

`codes`, `direct_messages`, `friend_*`, `legacy_users` кестелерінде әр жазба толық JSON
құжат (`data` бағаны) ретінде сақталады; сервистер оны жадта өзгертеді, ал
`database.py`-дағы `save_*` тек өзгерген жолдарды бір транзакцияда жазады.

**Миграция:** бұл кестелер бос болса, backend іске қосылғанда ескі
`backend/data/{codes,messages,friends,friendRequests,users}.json` файлдары бір рет
импортталып, `*.json.migrated` болып қайта аталады (сақтық көшірме). Барлығы
дұрыс екеніне көз жеткізген соң оларды өшіруге болады.

JSON-да тек шағын конфигурация қалды: `site_config.json`, `contact_messages.json`.
